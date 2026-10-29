import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudHistoryController} from '../cloud-history-controller.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};
const status=(throughSeq=0,lastHistorySeq=4)=>({throughSeq,lastHistorySeq,unreadCount:throughSeq<lastHistorySeq?1:0,firstUnread:throughSeq<lastHistorySeq?{entryId:'a',messageId:'delivery',seq:4}:null});
function setup(t,client={}){
 const saved={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage};
 globalThis.document={visibilityState:'visible',hasFocus:()=>true};globalThis.window=new EventTarget();let storageFailure=false;
 globalThis.localStorage={setItem(){if(storageFailure)throw Error('Synthetic quota failure');}};
 const state={selected:'m',agents:[{id:'m',name:'Synthetic'}],messages:{m:[{id:'cached',productKind:'live-harness'}]},liveHarness:{principalScope:'first',serverIds:{m:'server'},modes:{m:'live'}}};
 let cloud;const snapshots=new Map(),calls=[];
 const host={getState:()=>state,getConversationKey:()=>state.selected,getAgent:key=>state.agents.find(row=>row.id===key),persist:()=>true,render:()=>calls.push('render'),app:{querySelectorAll:()=>[],querySelector:()=>null}};
 const api={status:async()=>({}),conversations:async()=>({principalScope:state.liveHarness.principalScope,conversations:[]}),describeConversation:async()=>{},markRead:async(id,seq)=>{calls.push(['read',id,seq]);return status(seq,seq);},...client};
 cloud=createCloudHistoryController({host,client:api,isLive:key=>state.liveHarness.modes[key]==='live',serverId:key=>state.liveHarness.serverIds[key],snapshot:key=>snapshots.get(key)||{entries:[]},adopt:(value,key)=>snapshots.set(key,cloud.accept(value,key))});
 t.after(()=>{cloud.destroy();Object.assign(globalThis,saved);});
 const accept=(seq=4,through=0)=>{const value=cloud.accept({entries:[{id:'a',historySeq:3,revision:seq}],historyPage:{nextBeforeSeq:3,lastHistorySeq:seq,readStatus:status(through,seq),unreadSince:status(0,seq)},runs:[],tools:[]},'m');snapshots.set('m',value);return value;};
 return {cloud,state,calls,accept,snapshots,failStorage:()=>storageFailure=true};
}
test('only server-confirmed current focused activity advances a remote read watermark',async t=>{
 const f=setup(t);f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept();f.cloud.afterRender();await tick();
 assert.deepEqual(f.calls.filter(row=>Array.isArray(row)),[['read','server',4]]);
 f.accept(6,4);f.cloud.afterRender();await tick();assert.deepEqual(f.calls.filter(row=>Array.isArray(row)).at(-1),['read','server',6]);
 assert.equal(f.cloud.divider('m').entryId,'delivery');
});
test('real older cursor request deduplicates and merges actual server records into the loaded window',async t=>{
 const gate=deferred(),queries=[];const f=setup(t,{history:(id,query)=>{queries.push([id,query]);return gate.promise;}});f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept();
 const first=f.cloud.loadOlder('m');assert.equal(first,f.cloud.loadOlder('m'));
 gate.resolve({entries:[{id:'old',historySeq:1}],nextBeforeSeq:null,hasOlder:false,lastHistorySeq:4,readStatus:status(),unreadSince:status()});
 assert.deepEqual(await first,{added:1,hasOlder:false});assert.equal(queries.length,1);assert.equal(queries[0][1].beforeSeq,3);assert.deepEqual(f.snapshots.get('m').entries.map(row=>row.id),['old','a']);
});
test('late previous-owner catalog cannot repopulate a newly paired owner',async t=>{
 const old=deferred();let calls=0;const f=setup(t,{conversations:()=>++calls===1?old.promise:Promise.resolve({principalScope:'second',conversations:[]})});
 f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();await f.cloud.paired({principalScope:'second'});
 old.resolve({principalScope:'first',conversations:[{conversationId:'old-secret',descriptor:{clientKey:'old',name:'Old owner'},readStatus:status()}]});await tick();
 assert.equal(f.state.liveHarness.principalScope,'second');assert.deepEqual(f.state.liveHarness.serverIds,{});assert.equal(f.state.agents.some(row=>row.id==='old'),false);
});
test('backup quota failure cannot retain the previous owner canonical transcript or bindings',async t=>{
 const f=setup(t);f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.failStorage();await f.cloud.paired({principalScope:'second'});
 assert.deepEqual(f.state.messages.m,[]);assert.deepEqual(f.state.liveHarness.serverIds,{});assert.equal(f.state.liveHarness.principalScope,'second');
});
test('canonical cache stays hidden until server identity is known and historical unlabelled chats are discoverable',async t=>{
 const f=setup(t,{conversations:async()=>({principalScope:'first',conversations:[{conversationId:'legacy',descriptor:null,readStatus:status()}]})});
 assert.equal(f.cloud.filterEntries(f.state.messages.m).length,0);f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();
 assert.equal(f.state.liveHarness.serverIds['cloud-legacy'],'legacy');
});
test('legacy unscoped cache is hidden and stashed rather than assigned to a new identity',async t=>{
 const f=setup(t);delete f.state.liveHarness.principalScope;f.cloud.enable({principalScope:'second',capabilities:{cloudHistory:true}});await tick();
 assert.deepEqual(f.state.messages.m,[]);assert.deepEqual(f.state.liveHarness.serverIds,{});
});
test('identity rotation removes only prior server-bound roster names',async t=>{
 const f=setup(t);f.state.agents.push({id:'local',name:'Local example'});f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();await f.cloud.paired({principalScope:'second'});
 assert.equal(f.state.agents.some(row=>row.id==='m'),false);assert.equal(f.state.agents.some(row=>row.id==='local'),true);
});
test('opening an already read chat does not mark later unfocused deliveries read',async t=>{
 const f=setup(t);f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept(4,4);f.cloud.afterRender();await tick();
 document.hasFocus=()=>false;f.accept(6,4);f.cloud.afterRender();await tick();assert.deepEqual(f.calls.filter(Array.isArray),[]);
});
test('a delayed catalog response cannot rewind an acknowledged read watermark',async t=>{
 const gate=deferred();const f=setup(t,{conversations:()=>gate.promise});f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept();f.cloud.afterRender();await tick();
 gate.resolve({principalScope:'first',conversations:[{conversationId:'server',descriptor:{clientKey:'m',name:'Synthetic'},readStatus:status(0,4)}]});await tick();
 assert.equal(f.cloud.diagnostics().windows.find(row=>row.key==='m').throughSeq,4);
});
test('a delayed catalog with the same watermark cannot erase a newer unread delivery',async t=>{
 const gate=deferred();const f=setup(t,{conversations:()=>gate.promise});f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept(6,4);
 gate.resolve({principalScope:'first',conversations:[{conversationId:'server',descriptor:{clientKey:'m',name:'Synthetic'},readStatus:status(4,4)}]});await tick();
 assert.equal(f.cloud.diagnostics().windows.find(row=>row.key==='m').unreadCount,1);
});
test('a delayed read acknowledgement cannot erase a later delivery status',async t=>{
 const gate=deferred();const f=setup(t,{markRead:()=>gate.promise});f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept(4,0);f.cloud.afterRender();await tick();f.accept(6,4);
 gate.resolve(status(4,4));await tick();assert.equal(f.cloud.diagnostics().windows.find(row=>row.key==='m').unreadCount,1);
});
test('reopening a cached remote chat captures its unread boundary before acknowledging background deliveries',async t=>{
 let serverThrough=4;
 const f=setup(t,{markRead:async(id,seq)=>{serverThrough=seq;return status(seq,seq);}});
 f.cloud.enable({principalScope:'first',capabilities:{cloudHistory:true}});await tick();f.accept(4,4);f.cloud.afterRender();await tick();
 f.state.selected='other';f.cloud.afterRender();f.accept(6,4);
 f.state.selected='m';f.cloud.afterRender();await tick();
 // The real snapshot endpoint computes readStatus after any earlier read request.
 const query=f.cloud.query('m'),readStatus=status(serverThrough,6);
 f.cloud.accept({entries:[],runs:[],tools:[],historyPage:{nextBeforeSeq:null,lastHistorySeq:6,readStatus,...(query.unreadAfterSeq===undefined?{}:{unreadSince:status(query.unreadAfterSeq,6)})}},'m');
 assert.equal(f.cloud.divider('m')?.entryId,'delivery','opening must retain the first background delivery even when read acknowledgement wins the request race');
 f.cloud.afterRender();await tick();assert.equal(serverThrough,6);
 assert.equal(f.cloud.divider('m')?.entryId,'delivery','acknowledging the open chat must preserve its captured divider');
});

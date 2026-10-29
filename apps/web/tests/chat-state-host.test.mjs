// PREPARATION ONLY. Adopt under tests/ after all55 GO and host API agreement.
// Import the real production writer/progress factory; never copy its implementation here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatStateHost} from '../chat-state-host.js';

const KEY='grok-local-replica-v1';
const freeze=value=>{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))if('value' in descriptor)freeze(descriptor.value);
 }
 return value;
};
function seed(){
 return {version:1,selected:'c1',agents:[{id:'c1',name:'One'},{id:'c2',name:'Two'}],
  messages:{c1:[
   {id:'legacy',role:'bot',text:'old',localRun:{status:'complete',output:'old'},voice:{id:'voice'}},
   {id:'input',role:'user',text:'one two'},
   {id:'output',role:'bot',text:'ONE',transcript:{schema:1,kind:'send-message',revision:2,status:'streaming',runId:'r1',generation:1,replica:{producer:'local-text-v1',operation:'upper'},payload:{layoutMode:'bubble'}}}
  ],c2:[{id:'other',role:'user',text:'unrelated'}]},
  chatRuns:{r1:{schema:1,id:'r1',conversationId:'c1',submissionId:'s1',inputEntryId:'input',outputEntryId:'output',noticeEntryIds:[],adapterId:'local-text-v1',operation:'upper',style:'short',styleProfileVersion:'local-answer-v1',generation:1,lastSeq:1,progress:{processed:3,total:7},phase:'running',createdAt:1700000000000,updatedAt:1700000000000,delivery:null}},
  drafts:{c1:'new draft',c2:'keep draft'},replyDrafts:{c1:{messageId:'legacy',text:'old',title:'Old'}},settings:{theme:'light'},documents:[{id:'doc',text:'keep'}]};
}
// This is the ONLY fault boundary. It records Storage.setItem, never serializes,
// builds candidates, publishes state, constructs receipts or maintains save markers.
class TestStorage{
 constructor(initial,events){this.bytes=initial;this.events=events;this.calls=[];this.failure=null;}
 setItem(key,bytes){
  this.calls.push({key,bytes});this.events.push('setItem');
  if(this.failure)throw this.failure;
  assert.equal(typeof bytes,'string');this.bytes=bytes;
 }
}
function fixture({live=seed(),saved=live,notify}={}){
 let state=freeze(live);
 const events=[],publications=[],notifications=[];
 const storage=new TestStorage(saved===null?null:JSON.stringify(saved),events);
 const host=createChatStateHost({getState:()=>state,publishState(next){events.push('publish');state=freeze(next);publications.push(next);},storage,storageKey:KEY,initialSavedState:saved,
  onSaveResult(result){events.push('notify');notifications.push(result);notify?.(result,state);}});
 return {host,storage,events,publications,notifications,get state(){return state;},get durable(){return storage.bytes===null?null:JSON.parse(storage.bytes);},
  // Simulate an existing legacy mutable caller's already-published form edit.
  // No writer, progress validation, serialization or marker logic is implemented here.
  legacyChange(build){state=freeze(build(state));}};
}
const output=s=>s.messages.c1.find(e=>e.id==='output');
const marker=h=>h.host.getChatSaveState({conversationId:'c1',runId:'r1'});
const progress=(overrides={})=>({conversationId:'c1',runId:'r1',entryId:'output',generation:1,seq:2,text:'ONE TWO',phase:'running',progress:{processed:7,total:7},...overrides});
const saveMarker=s=>({entryId:'output',generation:s.chatRuns.r1.generation,revision:output(s).transcript.revision,lastSeq:s.chatRuns.r1.lastSeq,phase:s.chatRuns.r1.phase,deliveryId:s.chatRuns.r1.delivery?.id??null});
function unchangedAfterRejection(h,call){
 const before=h.state,bytes=h.storage.bytes,writes=h.storage.calls.length,published=h.publications.length,saved=marker(h);
 const result=call();assert.equal(result.ok,false);
 assert.equal(h.state,before);assert.equal(h.storage.bytes,bytes);assert.equal(h.storage.calls.length,writes);assert.equal(h.publications.length,published);assert.deepEqual(marker(h),saved);
 return result;
}
function terminal(s){
 const entry=output(s),revision=entry.transcript.revision+1,total=s.messages.c1.find(e=>e.id==='input').text.length;
 return {...s,messages:{...s.messages,c1:s.messages.c1.map(e=>e===entry?{...e,text:'ONE TWO',transcript:{...e.transcript,revision,status:'stable'}}:e)},chatRuns:{...s.chatRuns,r1:{...s.chatRuns.r1,phase:'delivered',progress:{processed:total,total},delivery:{id:'r1:final',entryId:'output',generation:1,revision,committedAt:1700000000100,scope:'browser-local'}}}};
}

test('construction is inert and initializes metadata from raw saved state without checkpointing live repairs',()=>{
 const raw=seed(),live=seed();live.chatRuns.r1.phase='interrupted';output(live).transcript.status='interrupted';
 const h=fixture({live,saved:raw});assert.equal(h.storage.calls.length,0);assert.equal(h.publications.length,0);assert.equal(h.notifications.length,0);
 assert.deepEqual(marker(h),saveMarker(raw));assert.equal(h.state.chatRuns.r1.phase,'interrupted');assert.equal(h.durable.chatRuns.r1.phase,'running');
});
test('missing raw saved state gives no marker even if repaired live state contains readable runs',()=>{
 const h=fixture({saved:null});assert.equal(marker(h),null);assert.equal(h.storage.calls.length,0);
});
test('successful commit builds from latest state, writes exactly once, then publishes and notifies',()=>{
 const h=fixture();h.legacyChange(s=>({...s,drafts:{...s.drafts,c2:'latest unrelated'}}));const before=h.state;let built=0,candidate;
 const result=h.host.commit(current=>{assert.equal(current,before);built++;return candidate=terminal(current);});
 assert.deepEqual(result,{ok:true});assert.equal(built,1);assert.equal(h.storage.calls.length,1);assert.equal(h.storage.calls[0].key,KEY);assert.deepEqual(h.events,['setItem','publish','notify']);assert.equal(h.state,candidate);
 assert.equal(h.state.messages.c2,before.messages.c2);assert.equal(h.state.messages.c1[0],before.messages.c1[0]);assert.equal(h.state.messages.c1[0].localRun,before.messages.c1[0].localRun);assert.equal(h.state.messages.c1[0].voice,before.messages.c1[0].voice);
 assert.equal(h.state.documents,before.documents);assert.equal(h.state.settings,before.settings);assert.equal(h.state.drafts,before.drafts);assert.equal(h.durable.drafts.c2,'latest unrelated');
 const durable=h.durable,e=output(durable),r=durable.chatRuns.r1;assert.equal(e.text,'ONE TWO');assert.equal(e.transcript.status,'stable');assert.equal(r.phase,'delivered');assert.equal(r.delivery.revision,e.transcript.revision);assert.deepEqual(marker(h),saveMarker(durable));
});
for(const [name,build] of [
 ['throwing builder',()=>{throw new Error('build');}],
 ['published-state mutation',s=>{s.drafts.c1='illegal';return s;}],
 ['undefined candidate',()=>undefined],['null candidate',()=>null],['array candidate',()=>[]],
 ['wrong envelope version',s=>({...s,version:2})],['missing messages map',s=>({...s,messages:null})],
 ['promise candidate',s=>Promise.resolve(s)],['thenable candidate',s=>({then(){},version:1,messages:s.messages})],
 ['BigInt serialization',s=>({...s,extra:1n})],
 ['throwing toJSON',s=>({...s,extra:{toJSON(){throw new Error('JSON');}}})],
 ['cyclic serialization',s=>{const extra={};extra.self=extra;return {...s,extra};}]
])test(`commit rejects ${name} before Storage or publication`,()=>{
 const h=fixture();const result=unchangedAfterRejection(h,()=>h.host.commit(build));assert.equal(result.error.code,'invalid');
});
test('rejected asynchronous builder is rejected synchronously and cannot later publish',async()=>{
 const h=fixture();let rejected;
 unchangedAfterRejection(h,()=>h.host.commit(()=>{rejected=(async()=>{throw new Error('async build');})();rejected.catch(()=>{});return rejected;}));
 await assert.rejects(rejected,/async build/);assert.equal(h.storage.calls.length,0);assert.equal(h.publications.length,0);
});
test('setItem failure leaves published reference, durable bytes and saved metadata untouched',()=>{
 const h=fixture(),before=h.state,bytes=h.storage.bytes,saved=marker(h);h.storage.failure=new DOMException('quota','QuotaExceededError');
 const result=h.host.commit(terminal);assert.equal(result.ok,false);assert.equal(result.error.code,'storage');assert.equal(h.storage.calls.length,1);assert.equal(h.state,before);assert.equal(h.storage.bytes,bytes);assert.equal(h.publications.length,0);assert.deepEqual(marker(h),saved);
});
test('post-publication notification error cannot report a durable commit as failed',()=>{
 let observed;const h=fixture({notify:(_result,state)=>{observed=state;throw new Error('view listener');}});
 const result=h.host.commit(terminal);assert.deepEqual(result,{ok:true});assert.equal(observed,h.state);assert.equal(h.state.chatRuns.r1.phase,'delivered');assert.equal(h.durable.chatRuns.r1.phase,'delivered');assert.equal(marker(h).deliveryId,'r1:final');assert.equal(h.storage.calls.length,1);
});
test('legacy persist writes the current live graph, refreshes metadata, and never republishes it',()=>{
 const h=fixture();assert.equal(h.host.publishChatProgress(progress()).ok,true);const live=h.state,published=h.publications.length;
 assert.notDeepEqual(marker(h),saveMarker(live));assert.equal(h.host.persist(),true);assert.equal(h.state,live);assert.equal(h.publications.length,published);assert.equal(h.storage.calls.length,1);assert.deepEqual(marker(h),saveMarker(live));assert.equal(h.durable.chatRuns.r1.phase,'running');assert.equal(h.durable.chatRuns.r1.delivery,null);
 assert.equal(h.host.publishChatProgress(progress({seq:3,text:'FINAL',phase:'final-pending-delivery'})).ok,true);assert.equal(h.host.persist(),true);assert.equal(h.storage.calls.length,2);assert.deepEqual(marker(h),saveMarker(h.state));assert.equal(h.durable.chatRuns.r1.delivery,null);assert.equal(output(h.durable).transcript.status,'streaming');
});
for(const mode of ['quota','serialization'])test(`failed legacy ${mode} save retains latest volatile text and old metadata`,()=>{
 const h=fixture(),saved=marker(h),bytes=h.storage.bytes;assert.equal(h.host.publishChatProgress(progress()).ok,true);
 if(mode==='quota')h.storage.failure=new Error('quota');else h.legacyChange(s=>({...s,extra:1n}));
 const before=h.state;assert.equal(h.host.persist(),false);assert.equal(h.state,before);assert.equal(output(h.state).text,'ONE TWO');assert.equal(h.storage.bytes,bytes);assert.deepEqual(marker(h),saved);
});
test('legacy notification error after successful persistence does not falsify its boolean result',()=>{
 const h=fixture({notify:()=>{throw new Error('view');}});assert.equal(h.host.persist(),true);assert.equal(h.storage.calls.length,1);assert.deepEqual(marker(h),saveMarker(h.state));
});
test('unrelated commit checkpoints current live progress without creating a terminal receipt',()=>{
 const h=fixture();assert.equal(h.host.publishChatProgress(progress({phase:'final-pending-delivery'})).ok,true);const liveOutput=output(h.state);
 assert.equal(h.host.commit(s=>({...s,settings:{...s.settings,theme:'dark'}})).ok,true);assert.equal(output(h.state),liveOutput);assert.equal(h.durable.chatRuns.r1.phase,'final-pending-delivery');assert.equal(h.durable.chatRuns.r1.delivery,null);assert.equal(output(h.durable).transcript.status,'streaming');assert.deepEqual(marker(h),saveMarker(h.state));
});
test('progress replaces only the owned entry/run branch without Storage, notification or full render capabilities',()=>{
 const h=fixture(),before=h.state,saved=marker(h);const result=h.host.publishChatProgress(progress());assert.deepEqual(result,{ok:true});assert.equal(h.storage.calls.length,0);assert.equal(h.notifications.length,0);assert.deepEqual(marker(h),saved);
 const next=h.state;assert.notEqual(next,before);assert.notEqual(next.messages,before.messages);assert.notEqual(next.messages.c1,before.messages.c1);assert.notEqual(output(next),output(before));assert.notEqual(output(next).transcript,output(before).transcript);assert.notEqual(next.chatRuns,before.chatRuns);assert.notEqual(next.chatRuns.r1,before.chatRuns.r1);
 assert.equal(next.messages.c1[0],before.messages.c1[0]);assert.equal(next.messages.c1[1],before.messages.c1[1]);assert.equal(next.messages.c2,before.messages.c2);assert.equal(next.drafts,before.drafts);assert.equal(next.replyDrafts,before.replyDrafts);assert.equal(next.documents,before.documents);assert.equal(next.settings,before.settings);assert.equal(next.agents,before.agents);
 assert.equal(output(next).transcript.replica,output(before).transcript.replica);assert.equal(output(next).transcript.payload,output(before).transcript.payload);assert.equal(output(next).transcript.kind,'send-message');assert.equal(output(next).transcript.status,'streaming');assert.equal(output(next).transcript.revision,3);assert.equal(next.chatRuns.r1.lastSeq,2);assert.equal(next.chatRuns.r1.delivery,null);
 assert.deepEqual(next.chatRuns.r1.progress,{processed:7,total:7});assert.notEqual(next.chatRuns.r1.progress,before.chatRuns.r1.progress);
 for(const key of ['text','input','output','chunks','messages','chatEntries','processed','total'])assert.equal(Object.hasOwn(next.chatRuns.r1,key),false);
 for(const key of ['progress','processed','total']){assert.equal(Object.hasOwn(output(next).transcript,key),false);assert.equal(Object.hasOwn(output(next).transcript.payload,key),false);}
});
test('final preview remains streaming with exact text and no receipt',()=>{
 const h=fixture(),text='```text\nEXACT\tß\n```\n';assert.equal(h.host.publishChatProgress(progress({text,phase:'final-pending-delivery'})).ok,true);
 assert.equal(output(h.state).text,text);assert.equal(output(h.state).transcript.status,'streaming');assert.equal(h.state.chatRuns.r1.phase,'final-pending-delivery');assert.equal(h.state.chatRuns.r1.delivery,null);assert.equal(h.storage.calls.length,0);
});
for(const [name,patch] of [
 ['zero sequence',{seq:0}],['negative sequence',{seq:-1}],['duplicate sequence',{seq:1}],['gap sequence',{seq:3}],['fractional sequence',{seq:1.5}],['NaN sequence',{seq:NaN}],['infinite sequence',{seq:Infinity}],['unsafe sequence',{seq:Number.MAX_SAFE_INTEGER+1}],
 ['wrong generation',{generation:2}],['zero generation',{generation:0}],['fractional generation',{generation:1.5}],['infinite generation',{generation:Infinity}],
 ['wrong conversation',{conversationId:'c2'}],['missing conversation',{conversationId:'deleted'}],['wrong run',{runId:'missing'}],['wrong output',{entryId:'input'}],['foreign output',{entryId:'other'}],
 ['nonstring text',{text:7}],['oversized output',{text:'x'.repeat(300001)}],['stable status forgery',{status:'stable'}],['delivered phase forgery',{phase:'delivered'}],['receipt forgery',{delivery:{id:'r1:final'}}],['revision forgery',{revision:99}],['new entry forgery',{inputEntryId:'new'}],
 ['nonfinite processed',{progress:{processed:NaN,total:7}}],['infinite total',{progress:{processed:1,total:Infinity}}],['negative processed',{progress:{processed:-1,total:7}}],['fractional progress',{progress:{processed:1.5,total:7}}],['processed exceeds total',{progress:{processed:8,total:7}}],['unsafe total',{progress:{processed:1,total:Number.MAX_SAFE_INTEGER+1}}],['mismatched input total',{progress:{processed:6,total:6}}],['text hidden in progress',{progress:{processed:7,total:7,text:'DUPLICATE'}}]
])test(`progress rejects ${name} without any publication or write`,()=>{
 const h=fixture();unchangedAfterRejection(h,()=>h.host.publishChatProgress(progress(patch)));
});
for(const [name,damage] of [
 ['deleted input',s=>{s.messages.c1=s.messages.c1.filter(e=>e.id!=='input');}],
 ['deleted output',s=>{s.messages.c1=s.messages.c1.filter(e=>e.id!=='output');}],
 ['deleted conversation',s=>{delete s.messages.c1;}],['deleted run',s=>{delete s.chatRuns.r1;}],
 ['foreign run conversation',s=>{s.chatRuns.r1.conversationId='c2';}],['wrong run identity',s=>{s.chatRuns.r1.id='r2';}],
 ['wrong owned run',s=>{output(s).transcript.runId='r2';}],['wrong owned generation',s=>{output(s).transcript.generation=2;}],
 ['unowned output',s=>{delete output(s).transcript.runId;delete output(s).transcript.generation;}],
 ['terminal output',s=>{output(s).transcript.status='stable';}],['unsafe entry revision',s=>{output(s).transcript.revision=Number.MAX_SAFE_INTEGER;}],['nonfinite entry revision',s=>{output(s).transcript.revision=NaN;}],
 ['unsafe saved sequence',s=>{s.chatRuns.r1.lastSeq=Number.MAX_SAFE_INTEGER;}],['nonfinite saved sequence',s=>{s.chatRuns.r1.lastSeq=NaN;}],
 ['preexisting receipt',s=>{s.chatRuns.r1.delivery={id:'r1:final'};}],
 ['oversized persisted input',s=>{s.messages.c1.find(e=>e.id==='input').text='x'.repeat(100001);}]
])test(`progress refuses ${name} and cannot recreate it`,()=>{
 const live=seed();damage(live);const h=fixture({live});unchangedAfterRejection(h,()=>h.host.publishChatProgress(progress()));
});
for(const phase of ['cancelled','failed','interrupted','delivered','awaiting-question','awaiting-approval'])test(`progress cannot revive ${phase} run`,()=>{
 const live=seed();live.chatRuns.r1.phase=phase;const h=fixture({live});unchangedAfterRejection(h,()=>h.host.publishChatProgress(progress()));
});
test('host admits bounded 100000-unit input and uppercase expansion, without an input-sized output cap',()=>{
 const live=seed();live.messages.c1.find(e=>e.id==='input').text='ß'.repeat(100000);live.chatRuns.r1.progress={processed:0,total:100000};const h=fixture({live});
 assert.equal(h.host.publishChatProgress(progress({text:'SS'.repeat(100000),progress:{processed:100000,total:100000}})).ok,true);assert.equal(output(h.state).text.length,200000);assert.equal(h.storage.calls.length,0);
});
test('host accepts its explicit 300000 UTF-16 output ceiling',()=>{
 const h=fixture();assert.equal(h.host.publishChatProgress(progress({text:'x'.repeat(300000)})).ok,true);assert.equal(output(h.state).text.length,300000);
});
for(const target of ['event','run-map','conversation-map','input-id','output-id','transcript'])test(`inherited ${target} references never establish progress ownership`,()=>{
 const live=seed();let event=progress();
 if(target==='event')event=Object.create(event);
 if(target==='run-map'){live.chatRuns=Object.create({r1:live.chatRuns.r1});}
 if(target==='conversation-map'){live.messages=Object.assign(Object.create({c1:live.messages.c1}),{c2:live.messages.c2});}
 if(target==='input-id'){live.messages.c1[1]=Object.assign(Object.create({id:'input'}),{role:'user',text:'one two'});}
 if(target==='output-id'){const original=output(live);live.messages.c1[2]=Object.assign(Object.create({id:'output'}),{role:'bot',text:original.text,transcript:original.transcript});}
 if(target==='transcript'){const entry=output(live),transcript=entry.transcript;delete entry.transcript;Object.setPrototypeOf(entry,{transcript});}
 const h=fixture({live});unchangedAfterRejection(h,()=>h.host.publishChatProgress(event));
});
for(const name of ['__proto__','constructor','toString'])test(`prototype-like absent ID ${name} cannot select inherited conversation or run`,()=>{
 const h=fixture();unchangedAfterRejection(h,()=>h.host.publishChatProgress(progress({conversationId:name,runId:name})));assert.equal(h.host.getChatSaveState({conversationId:name,runId:name}),null);
});
for(const target of ['event','run','transcript'])test(`accessor ${target} is rejected without invoking metadata getters`,()=>{
 const live=seed();let event=progress(),reads=0;
 const object=target==='event'?event:target==='run'?live.chatRuns.r1:output(live).transcript,key=target==='event'?'seq':target==='run'?'generation':'revision';
 Object.defineProperty(object,key,{enumerable:true,configurable:true,get(){reads++;throw new Error('metadata getter must not execute');}});
 // Raw parsed saved data cannot contain getters. Keep the durable seed clean.
 const h=fixture({live,saved:seed()});unchangedAfterRejection(h,()=>h.host.publishChatProgress(event));assert.equal(reads,0);
});
test('save marker exposes readonly metadata only and cannot be mutated to forge persistence',()=>{
 const h=fixture(),m=marker(h);assert.deepEqual(Object.keys(m).sort(),['deliveryId','entryId','generation','lastSeq','phase','revision']);
 assert.ok(Object.values(m).every(value=>value===null||['string','number'].includes(typeof value)));
 try{m.revision=999;m.phase='delivered';}catch(error){assert.ok(error instanceof TypeError);}
 assert.deepEqual(marker(h),saveMarker(h.state));assert.notEqual(marker(h).revision,999);
});
test('marker lookup requires matching own conversation/run, and removed runs disappear after successful save',()=>{
 const h=fixture();assert.equal(h.host.getChatSaveState({conversationId:'c2',runId:'r1'}),null);assert.equal(h.host.getChatSaveState({conversationId:'c1',runId:'unknown'}),null);
 h.legacyChange(s=>({...s,chatRuns:{}}));assert.equal(h.host.persist(),true);assert.equal(marker(h),null);
});
test('unknown raw run never manufactures saved delivery metadata from repaired live state',()=>{
 const raw=seed();raw.chatRuns={};const live=terminal(seed());const h=fixture({live,saved:raw});assert.equal(marker(h),null);assert.equal(h.storage.calls.length,0);
});

test('valid own prototype-like conversation and run IDs remain usable without prototype selection',()=>{
 const live=seed(),list=live.messages.c1,run=live.chatRuns.r1;delete live.messages.c1;delete live.chatRuns.r1;
 Object.defineProperty(live.messages,'__proto__',{value:list,enumerable:true,writable:true,configurable:true});
 run.id='__proto__';run.conversationId='__proto__';list[2].transcript.runId='__proto__';
 Object.defineProperty(live.chatRuns,'__proto__',{value:run,enumerable:true,writable:true,configurable:true});
 const h=fixture({live});assert.equal(h.host.publishChatProgress(progress({conversationId:'__proto__',runId:'__proto__'})).ok,true);
 assert.equal(Object.hasOwn(h.state.messages,'__proto__'),true);assert.equal(Object.hasOwn(h.state.chatRuns,'__proto__'),true);assert.equal(h.state.messages.__proto__[2].text,'ONE TWO');assert.equal(Object.hasOwn(Object.prototype,'r1'),false);assert.equal(h.storage.calls.length,0);
});
test('every successful legacy save refreshes every valid run marker, including unselected conversation',()=>{
 const live=seed(),input={id:'input2',role:'user',text:'another'},entry={...output(live),id:'output2',text:'A',transcript:{...output(live).transcript,runId:'r2',revision:1}};
 live.messages.c2.push(input,entry);live.chatRuns.r2={...live.chatRuns.r1,id:'r2',conversationId:'c2',submissionId:'s2',inputEntryId:'input2',outputEntryId:'output2',lastSeq:0};
 const h=fixture({live});assert.equal(h.host.publishChatProgress(progress({conversationId:'c2',runId:'r2',entryId:'output2',seq:1,text:'ANOTHER',progress:{processed:7,total:7}})).ok,true);
 assert.equal(h.host.getChatSaveState({conversationId:'c2',runId:'r2'}).revision,1);assert.equal(h.host.persist(),true);
 assert.deepEqual(h.host.getChatSaveState({conversationId:'c2',runId:'r2'}),{entryId:'output2',generation:1,revision:2,lastSeq:1,phase:'running',deliveryId:null});assert.deepEqual(marker(h),saveMarker(h.state));
});
test('valid raw legacy receipt without counters still seeds delivery metadata without inventing progress',()=>{
 const raw=terminal(seed());delete raw.chatRuns.r1.progress;const h=fixture({live:raw,saved:raw});assert.deepEqual(marker(h),saveMarker(raw));assert.equal(marker(h).deliveryId,'r1:final');assert.equal(Object.hasOwn(h.state.chatRuns.r1,'progress'),false);assert.equal(h.storage.calls.length,0);assert.equal(h.publications.length,0);
});
for(const damage of ['missing','mismatch'])test(`invalid raw ${damage} receipt never becomes saved-delivery evidence`,()=>{
 const raw=terminal(seed());if(damage==='missing')raw.chatRuns.r1.delivery=null;else raw.chatRuns.r1.delivery.revision=999;
 const h=fixture({live:raw,saved:raw}),m=marker(h);assert.ok(m===null||m.deliveryId===null);assert.equal(h.storage.calls.length,0);
});

test('running event without required counters rejects even when canonical progress already exists',()=>{
 const h=fixture(),prior=h.state.chatRuns.r1.progress,event=progress();delete event.progress;
 unchangedAfterRejection(h,()=>h.host.publishChatProgress(event));assert.equal(h.state.chatRuns.r1.progress,prior);assert.equal(h.state.chatRuns.r1.lastSeq,1);assert.equal(output(h.state).transcript.revision,2);
 assert.equal(h.host.persist(),true);assert.deepEqual(h.durable.chatRuns.r1.progress,{processed:3,total:7});
 for(const node of [h.state,output(h.state),output(h.state).transcript,output(h.state).transcript.payload])for(const key of ['progress','processed','total'])assert.equal(Object.hasOwn(node,key),false);
});
for(const supplied of [false,true])test(`final preview refuses ${supplied?'incomplete':'missing'} required actual counters`,()=>{
 const h=fixture(),event=progress({phase:'final-pending-delivery',progress:{processed:6,total:7}});if(!supplied)delete event.progress;
 unchangedAfterRejection(h,()=>h.host.publishChatProgress(event));
});
test('final preview cannot reuse an already complete canonical pair when required event counters are missing',()=>{
 const live=seed();live.chatRuns.r1.progress={processed:7,total:7};const h=fixture({live}),event=progress({phase:'final-pending-delivery'});delete event.progress;
 unchangedAfterRejection(h,()=>h.host.publishChatProgress(event));
});
test('final-pending preview cannot regress to running even with a newer sequence and complete counters',()=>{
 const live=seed();live.chatRuns.r1.phase='final-pending-delivery';live.chatRuns.r1.progress={processed:7,total:7};const h=fixture({live});unchangedAfterRejection(h,()=>h.host.publishChatProgress(progress()));
});
test('legacy journal without progress stays readable without adding an inferred control record',()=>{
 const live=seed();delete live.chatRuns.r1.progress;const h=fixture({live}),before=h.state;
 assert.deepEqual(marker(h),saveMarker(live));assert.equal(h.publications.length,0);assert.equal(h.host.persist(),true);assert.equal(h.state,before);assert.equal(Object.hasOwn(h.state.chatRuns.r1,'progress'),false);assert.equal(Object.hasOwn(h.durable.chatRuns.r1,'progress'),false);
});
for(const shape of ['inherited','accessor'])test(`progress pair rejects ${shape} counters without reading getters`,()=>{
 let reads=0,pair;if(shape==='inherited')pair=Object.create({processed:7,total:7});else{pair={total:7};Object.defineProperty(pair,'processed',{enumerable:true,get(){reads++;throw new Error('counter getter');}});}
 const h=fixture();unchangedAfterRejection(h,()=>h.host.publishChatProgress(progress({progress:pair})));assert.equal(reads,0);
});
test('save notifications are frozen plain outcome records with reason after the durable outcome is fixed',()=>{
 const h=fixture();assert.equal(h.host.commit(s=>({...s,settings:{theme:'dark'}}),{reason:'host-test'}).ok,true);
 const success=h.notifications.at(-1);assert.equal(Object.getPrototypeOf(success),Object.prototype);assert.equal(Object.isFrozen(success),true);assert.deepEqual(success,{ok:true,reason:'host-test'});
 assert.equal(h.host.commit(()=>undefined,{reason:'invalid-test'}).ok,false);const invalid=h.notifications.at(-1);assert.equal(Object.isFrozen(invalid),true);assert.deepEqual(invalid,{ok:false,reason:'invalid-test',error:{code:'invalid'}});
 h.storage.failure=new Error('quota');assert.equal(h.host.commit(s=>({...s}),{reason:'storage-test'}).ok,false);const denied=h.notifications.at(-1);assert.equal(Object.isFrozen(denied),true);assert.deepEqual(denied,{ok:false,reason:'storage-test',error:{code:'storage'}});
});


test('unknown legacy progress requires a newly supplied actual pair before volatile publication',()=>{
 const live=seed();delete live.chatRuns.r1.progress;const h=fixture({live}),event=progress();delete event.progress;
 unchangedAfterRejection(h,()=>h.host.publishChatProgress(event));assert.equal(Object.hasOwn(h.state.chatRuns.r1,'progress'),false);
 assert.equal(h.host.publishChatProgress(progress()).ok,true);assert.deepEqual(h.state.chatRuns.r1.progress,{processed:7,total:7});assert.equal(h.state.chatRuns.r1.lastSeq,2);assert.equal(h.storage.calls.length,0);
});

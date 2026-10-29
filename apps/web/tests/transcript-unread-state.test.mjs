import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnreadBoundaryStore,isUnreadEntry,updateUnreadPillState,unreadDivider,unreadDividerSide,showsUnreadPill} from '../transcript-unread-state.js';

test('opening captures old read boundary, same-agent reopen retains it, empty/new read clears it',()=>{
 const store=createUnreadBoundaryStore();
 store.noteAgentOpenBegin({agentId:'a',row:{lastViewedAt:10,lastActivityAt:20},isSameAgentReopen:false});assert.equal(store.read('a'),10);
 store.noteAgentOpenBegin({agentId:'a',row:{lastViewedAt:20,lastActivityAt:20},isSameAgentReopen:true});assert.equal(store.read('a'),10);
 store.noteAgentOpenBegin({agentId:'a',row:{lastViewedAt:20,lastActivityAt:20},isSameAgentReopen:false});assert.equal(store.read('a'),null);
 store.noteAgentOpenBegin({agentId:'b',row:{lastViewedAt:NaN,lastActivityAt:20},isSameAgentReopen:false});assert.equal(store.read('b'),0);
 store.dispose();store.noteAgentOpenBegin({agentId:'c',row:{lastActivityAt:30}});assert.equal(store.read('c'),null);
});
test('source candidate excludes suppressed branched tools attachments and transport channels, ordinary outgoing user is not unread',()=>{
 const item={id:'x',kind:'message',role:'assistant',timestampMs:20};assert.equal(isUnreadEntry(item),true);
 for(const change of [{suppressed:false},{branched:true},{kind:'tool-call'},{kind:'user-attachment'},{kind:'mcp-app'},{kind:'error'},{kind:'spend-initiation'},{channel:'voice:x'},{channel:'meeting:x'},{role:'user'},{timestampMs:0},{timestampMs:Infinity},{toAgent:{kind:'external'}}])assert.equal(isUnreadEntry({...item,...change}),false,JSON.stringify(change));
 assert.equal(isUnreadEntry({...item,role:'user',fromUser:'someone'}),true);assert.equal(isUnreadEntry({...item,kind:'send-message',message:{type:'text'}}),true);
});
test('divider counts source eligible entries strictly newer than frozen boundary and retains exact first identity',()=>{
 const entries=[{id:'old',kind:'message',role:'assistant',timestampMs:10},{id:'new',entryId:'aggregate',kind:'send-message',message:{type:'text'},timestampMs:11},{id:'tool',kind:'tool-call',timestampMs:30},{id:'new2',kind:'message',role:'assistant',timestampMs:12}];
 assert.deepEqual(unreadDivider(entries,10),{id:'unread-divider',entryId:'new',parentEntryId:'aggregate',newMessageCount:2});assert.equal(unreadDivider(entries,null),null);
});
test('only observed intersection marks seen; boundary reset clears flags; above+unseen+uncovered exposes upward pill',()=>{
 const initial={boundaryAt:10,hasSeen:false,hasDismissed:false};const seen=updateUnreadPillState(initial,{boundaryAt:10,observedSide:'in-view'});assert.equal(seen.hasSeen,true);
 assert.deepEqual(updateUnreadPillState({...seen,hasDismissed:true},{boundaryAt:20,observedSide:null}),{boundaryAt:20,hasSeen:false,hasDismissed:false});
 assert.equal(unreadDividerSide({rowIndex:1,mountedRange:{firstIndex:3,lastIndex:5},observedSide:'in-view'}),'above');
 for(const side of ['below','in-view',null])assert.equal(showsUnreadPill({hasPortal:true,hasDivider:true,side,state:initial,isCovered:false,isUnreadJumpSettling:false}),false);
 assert.equal(showsUnreadPill({hasPortal:true,hasDivider:true,side:'above',state:initial,isCovered:false,isUnreadJumpSettling:false}),true);
 assert.equal(showsUnreadPill({hasPortal:true,hasDivider:true,side:'above',state:initial,isCovered:true,isUnreadJumpSettling:false}),false);
});

test('candidate, boundary store and seen transitions match frozen native helpers across exact differential vectors',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const evidence=JSON.parse(readFileSync(new URL('./fixtures/source-reference/transcript-unread.json',import.meta.url),'utf8'));
 const source=id=>evidence.records.find(record=>record.id===id).excerpt;
 const context={};vm.createContext(context);
 vm.runInContext(`const ge=value=>({get:()=>value,set:next=>{value=next}});const tI=['spend-initiation','error'];${['boundary-store','positive-time','suppressed','branched','directed-message','non-agent-target','entry-channel','voice-channel','candidate-exclusions','eligible-entry','newer-entry'].map(source).join('\n')}${source('pill-seen-reset')}this.nativeCandidate=LK;this.nativeBoundary=LRe;this.nativePill=oLe;`,context);
 let compared=0;
 for(const kind of ['message','send-message','tool-call','user-attachment','mcp-app','spend-initiation','error','event','notice'])for(const suppressed of [undefined,false,true])for(const branched of [false,true])for(const role of ['user','assistant'])for(const channel of [undefined,'voice:x','meeting:x','normal']){
  const entry={id:'vector',kind,timestampMs:20,suppressed,branched,role,channel,message:{type:'text',channel}};
  assert.equal(isUnreadEntry(entry),context.nativeCandidate(entry),JSON.stringify(entry));compared++;
 }
 assert.equal(compared,432);
 for(const hasSeen of [false,true])for(const hasDismissed of [false,true])for(const boundaryAt of [10,20])for(const observedSide of [null,'above','in-view']){
  const previous={boundaryAt:10,hasSeen,hasDismissed},event={boundaryAt,observedSide};assert.deepEqual(updateUnreadPillState(previous,event),JSON.parse(JSON.stringify(context.nativePill(previous,event))));
 }
 for(const lastViewedAt of [undefined,NaN,-1,0,1,100])for(const lastActivityAt of [undefined,NaN,-1,0,1,100])for(const isSameAgentReopen of [false,true]){
  const ours=createUnreadBoundaryStore(),native=context.nativeBoundary(),request={agentId:'a',row:{lastViewedAt,lastActivityAt},isSameAgentReopen};ours.noteAgentOpenBegin(request);native.noteAgentOpenBegin(request);assert.equal(ours.read('a'),native.snapshotFor('a').get());
 }
});

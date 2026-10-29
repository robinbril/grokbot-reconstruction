import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatStateHost} from '../chat-state-host.js';
import {createSendJournal} from '../send-journal.js';

const draft=(text='first',conversationId='c1')=>({conversationId,text,attachments:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(options={}) {
 let state=options.state||{version:1,messages:{c1:[],c2:[]},drafts:{c1:'first',c2:'other'}};
 let fail=false,id=0;const calls=[],writes=[];
 const storage={setItem(_key,bytes){if(fail)throw Error('disk');writes.push(JSON.parse(bytes));}};
 const host=createChatStateHost({getState:()=>state,publishState:next=>{state=next;},storage,storageKey:'test'});
 const journal=createSendJournal({getState:()=>state,commit:host.commit,newId:()=>`id-${++id}`,now:()=>123,
   dispatch:async snapshot=>{calls.push(snapshot);return {accepted:true};},lookupAcceptance:async()=>({status:'unknown'}),...options});
 return {journal,calls,writes,get state(){return state;},set fail(value){fail=value;},replace(next){state=next;},host};
}

test('enqueue atomically consumes the matching draft and persists distinct immutable snapshots before any dispatch',async()=>{
 const h=fixture({prepareEnqueue:(state,snapshot)=>({...state,drafts:{...state.drafts,[snapshot.conversationId]:''}})});
 const input=draft();const first=h.journal.enqueue(input);input.text='mutated';
 assert.equal(first.ok,true);assert.equal(h.calls.length,0);assert.equal(h.state.drafts.c1,'');assert.equal(h.state.drafts.c2,'other');
 assert.equal(h.writes.at(-1).sendJournal.records[0].snapshot.text,'first');
 const second=h.journal.enqueue(draft('second'));assert.equal(second.ok,true);assert.notEqual(first.nonce,second.nonce);
 assert.equal(h.journal.records()[0].snapshot.text,'first');
 const projected=h.journal.records();projected[0].snapshot.text='view mutation';
 assert.equal(h.journal.records()[0].snapshot.text,'first');
});

test('drain persists dispatching before transport, retains accepted until proven echo, and never duplicates concurrent drain',async()=>{
 const wait=deferred();let h;
 h=fixture({dispatch:async snapshot=>{h.calls.push(snapshot);assert.equal(h.writes.at(-1).sendJournal.records[0].phase,'dispatching');await wait.promise;return {accepted:true};}});
 const result=h.journal.enqueue(draft());const a=h.journal.drain(),b=h.journal.drain();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,1);assert.equal(a,b);
 wait.resolve();await a;assert.equal(h.journal.records()[0].phase,'accepted-awaiting-echo');
 assert.equal(h.calls[0].nonce,result.nonce);assert.equal(h.calls[0].clientNonce,result.nonce);assert.equal(h.calls[0].inputEntryId,result.inputEntryId);
 await h.journal.drain();assert.equal(h.calls.length,1);
});

test('oldest queued draft first; held or failed conversation does not block unrelated drafts',async()=>{
 let held=true;const accepted=new Set(),h=fixture({isHeld:record=>held&&record.conversationId==='c1',lookupAcceptance:async snapshot=>({status:accepted.has(snapshot.nonce)?'found':'unknown'}),dispatch:async snapshot=>{h.calls.push(snapshot);if(snapshot.text==='bad')return {accepted:false,code:'refused'};accepted.add(snapshot.nonce);return {accepted:true};}});
 h.journal.enqueue({...draft('later'),createdAt:50});h.journal.enqueue({...draft('oldest'),createdAt:1});h.journal.enqueue(draft('other','c2'));
 await h.journal.drain();assert.deepEqual(h.calls.map(item=>item.text),['other']);held=false;
 await h.journal.drain();assert.deepEqual(h.calls.map(item=>item.text),['other','oldest','later']);assert.equal(h.journal.records().length,0);
 const bad=h.journal.enqueue(draft('bad'));h.journal.enqueue(draft('blocked'));h.journal.enqueue(draft('next other','c2'));
 await h.journal.drain();assert.deepEqual(h.calls.slice(-2).map(item=>item.text),['bad','next other']);
 assert.equal(h.journal.records('c1')[0].phase,'failed');assert.equal(h.journal.removeFailed(bad.nonce).ok,true);
 await h.journal.drain();assert.equal(h.calls.at(-1).text,'blocked');
});

test('restart parks ambiguous dispatch and resends fixed nonce only after authoritative not-found',async()=>{
 const first=fixture({dispatch:async()=>{throw Error('lost ACK');}});const {nonce}=first.journal.enqueue(draft());await first.journal.drain();
 assert.equal(first.journal.records()[0].phase,'dispatching');first.journal.destroy();
 let status='unknown';const restarted=fixture({state:JSON.parse(JSON.stringify(first.state)),lookupAcceptance:async()=>({status})});
 await restarted.journal.drain();assert.equal(restarted.calls.length,0);
 assert.equal((await restarted.journal.retry(nonce)).ok,false);assert.equal(restarted.calls.length,0);
 status='not-found';await restarted.journal.retry(nonce);assert.equal(restarted.calls.length,1);assert.equal(restarted.calls[0].nonce,nonce);
 status='found';await restarted.journal.reconcile();assert.equal(restarted.journal.records().length,0);
});

test('storage errors retain drafts and records, never dispatch from a non-durable transition',async()=>{
 const h=fixture({prepareEnqueue:(state,snapshot)=>({...state,drafts:{...state.drafts,[snapshot.conversationId]:''}})});
 h.fail=true;assert.equal(h.journal.enqueue(draft()).ok,false);assert.equal(h.state.drafts.c1,'first');assert.equal(h.journal.records().length,0);
 h.fail=false;const {nonce}=h.journal.enqueue(draft());h.fail=true;await h.journal.drain();assert.equal(h.calls.length,0);assert.equal(h.journal.records()[0].nonce,nonce);assert.equal(h.journal.records()[0].phase,'queued');
 h.fail=false;await h.journal.drain();assert.equal(h.calls.length,1);
});

test('destroy ignores late acceptance and cannot dispatch or mutate afterward',async()=>{
 const wait=deferred(),h=fixture({dispatch:async snapshot=>{h.calls.push(snapshot);return wait.promise;}});h.journal.enqueue(draft());const work=h.journal.drain();
 await new Promise(resolve=>setImmediate(resolve));const saved=h.writes.length;h.journal.destroy();wait.resolve({accepted:true});await work;
 assert.equal(h.writes.length,saved);assert.equal(h.journal.records()[0].phase,'dispatching');assert.equal(h.journal.enqueue(draft()).ok,false);await h.journal.drain();assert.equal(h.calls.length,1);
});

test('late result cannot overwrite a replaced record identity',async()=>{
 const wait=deferred(),h=fixture({dispatch:async()=>wait.promise});h.journal.enqueue(draft());const work=h.journal.drain();await new Promise(resolve=>setImmediate(resolve));
 const current=h.state.sendJournal.records[0];h.replace({...h.state,sendJournal:{schema:1,records:[{...current,phase:'failed',errorCode:'replaced'}]}});
 wait.resolve({accepted:true});await work;assert.equal(h.journal.records()[0].errorCode,'replaced');
});

test('explicit failure retries stable nonce and removal only applies to failed records',async()=>{
 let accepted=false;const h=fixture({dispatch:async snapshot=>{h.calls.push(snapshot);return {accepted,code:'refused'};}});const {nonce}=h.journal.enqueue(draft());
 assert.equal(h.journal.removeFailed(nonce).ok,false);await h.journal.drain();assert.equal(h.journal.records()[0].phase,'failed');accepted=true;
 assert.equal((await h.journal.retry(nonce)).ok,true);assert.equal(h.calls.length,2);assert.equal(h.calls[1].nonce,nonce);assert.equal(h.journal.records()[0].phase,'accepted-awaiting-echo');
});

test('malformed own-data boundaries reject getters, sparse arrays and excessive input without executing them',async()=>{
 let touched=0;const h=fixture();const hostile={conversationId:'c1',attachments:[],get text(){touched++;return 'bad';}};
 assert.equal(h.journal.enqueue(hostile).ok,false);assert.equal(h.journal.enqueue({...draft(),text:'x'.repeat(100001)}).ok,false);
 const sparse=[];sparse.length=1;assert.equal(h.journal.enqueue({...draft(),attachments:sparse}).ok,false);assert.equal(touched,0);
 const stored={schema:1,get records(){touched++;return [];}};h.replace({...h.state,sendJournal:stored});assert.deepEqual(h.journal.records(),[]);assert.equal(h.journal.enqueue(draft()).ok,false);await h.journal.drain();assert.equal(h.calls.length,0);assert.equal(touched,0);
});

test('a newly enqueued distinct draft during an in-flight dispatch is drained by that same pump',async()=>{
 const wait=deferred(),found=new Set();let first=true;
 const h=fixture({lookupAcceptance:async snapshot=>({status:found.has(snapshot.nonce)?'found':'unknown'}),dispatch:async snapshot=>{h.calls.push(snapshot);if(first){first=false;await wait.promise;}found.add(snapshot.nonce);return {accepted:true};}});
 h.journal.enqueue(draft('first'));const work=h.journal.drain();await new Promise(resolve=>setImmediate(resolve));h.journal.enqueue(draft('second'));h.journal.drain();wait.resolve();await work;
 assert.deepEqual(h.calls.map(snapshot=>snapshot.text),['first','second']);assert.deepEqual(h.journal.records(),[]);
});

test('failed ACK checkpoint stays ambiguous and finds durable transcript after restart without resending',async()=>{
 let h;h=fixture({dispatch:async snapshot=>{h.calls.push(snapshot);h.fail=true;return {accepted:true};}});h.journal.enqueue(draft());await h.journal.drain();assert.equal(h.journal.records()[0].phase,'dispatching');
 const restarted=fixture({state:JSON.parse(JSON.stringify(h.state)),lookupAcceptance:async()=>({status:'found'})});await restarted.journal.drain();assert.equal(restarted.calls.length,0);assert.equal(restarted.journal.records().length,0);
});

test('skill-only sends and durable attachment metadata preserve exact raw snapshot',async()=>{
 const h=fixture(),skill={kind:'skill',id:'skill-1',label:'Find',description:'Local reference'};
 assert.equal(h.journal.enqueue({...draft(''),skillReferences:[skill]}).ok,true);
 assert.equal(h.journal.enqueue({...draft('  exact  '),attachments:[{id:'attachment',name:'demo.txt',type:'text/plain',size:2,conversation:'c1',namespace:'local',createdAt:0}]}).ok,true);
 assert.equal(h.journal.records()[0].snapshot.skillReferences[0].kind,'skill');assert.equal(h.journal.records()[1].snapshot.text,'  exact  ');
});

test('restored record identity collisions or mismatched snapshot identities are inert',async()=>{
 const h=fixture();h.journal.enqueue({...draft(),inputEntryId:'input'});const valid=JSON.parse(JSON.stringify(h.state));
 for(const corrupt of [
  state=>{state.sendJournal.records[0].snapshot.inputEntryId='other';},
  state=>{state.sendJournal.records[0].noticeEntryId=state.sendJournal.records[0].inputEntryId;},
  state=>{state.sendJournal.records.push({...state.sendJournal.records[0],nonce:'other-nonce'});}
 ]){
  const state=JSON.parse(JSON.stringify(valid));corrupt(state);const restored=fixture({state});await restored.journal.drain();assert.equal(restored.calls.length,0);assert.equal(restored.journal.enqueue(draft()).ok,false);
 }
});

test('enqueue callback failure preserves every draft and does not insert a record',()=>{
 const h=fixture({prepareEnqueue(){throw Error('draft changed');}});assert.equal(h.journal.enqueue(draft()).ok,false);assert.equal(h.state.drafts.c1,'first');assert.equal(h.writes.length,0);assert.deepEqual(h.journal.records(),[]);
});

test('queued cancellation durably recovers the complete snapshot and returns an independent draft without lookup or dispatch',async()=>{
 let lookups=0;const h=fixture({lookupAcceptance:async()=>{lookups++;throw Error('must not inspect queued');},
  prepareCancel:(state,snapshot)=>({...state,recoveredDrafts:{...state.recoveredDrafts,[snapshot.conversationId]:snapshot}})});
 const snapshot={...draft('  exact\ntext  '),quote:{id:'reply-1',text:'quoted'},skillReferences:[{id:'skill',label:'Skill'}],attachments:[{id:'file',name:'example.txt',type:'text/plain',size:3}]};
 const {nonce}=h.journal.enqueue(snapshot),result=await h.journal.cancelQueued(nonce);
 assert.equal(result.ok,true);assert.equal(result.nonce,nonce);assert.deepEqual(result.draft,snapshot);
 assert.deepEqual(h.state.recoveredDrafts.c1,snapshot);assert.deepEqual(h.journal.records(),[]);assert.equal(lookups,0);assert.equal(h.calls.length,0);
 const written=h.writes.at(-1);assert.deepEqual(written.recoveredDrafts.c1,snapshot);assert.deepEqual(written.sendJournal.records,[]);
 result.draft.text='changed';result.draft.attachments[0].name='changed.txt';assert.deepEqual(h.state.recoveredDrafts.c1,snapshot);
});

test('prepared and ambiguous dispatch cancellation require authoritative not-found before recovering',async()=>{
 for(const phase of ['prepared','dispatching'])for(const status of ['found','unknown','not-found']){
  const seen=[],h=fixture({lookupAcceptance:async snapshot=>{seen.push(snapshot);return {status};}}),{nonce}=h.journal.enqueue(draft());
  h.replace({...h.state,sendJournal:{schema:1,records:h.state.sendJournal.records.map(record=>({...record,phase}))}});
  const result=await h.journal.cancelQueued(nonce);
  assert.equal(result.ok,status==='not-found',phase+' '+status);assert.equal(seen.length,1);assert.equal(seen[0].clientNonce,nonce);assert.equal(h.calls.length,0);
  assert.equal(h.journal.records().length,status==='not-found'?0:1);
 }
});

test('missing failed and explicitly accepted sends cannot be cancelled',async()=>{
 const h=fixture();assert.equal((await h.journal.cancelQueued('missing')).error.code,'missing');
 const {nonce}=h.journal.enqueue(draft());
 for(const phase of ['failed','accepted-awaiting-echo']){
  h.replace({...h.state,sendJournal:{schema:1,records:h.state.sendJournal.records.map(record=>({...record,phase}))}});
  assert.equal((await h.journal.cancelQueued(nonce)).ok,false);assert.equal(h.journal.records()[0].phase,phase);
 }
 assert.equal(h.calls.length,0);
});

test('failed cancellation persistence preserves both queued snapshot and the newer draft',async()=>{
 const h=fixture({prepareCancel:(state,snapshot)=>({...state,drafts:{...state.drafts,[snapshot.conversationId]:snapshot.text}})}),{nonce}=h.journal.enqueue(draft('older'));
 h.replace({...h.state,drafts:{...h.state.drafts,c1:'newer'}});const before=JSON.parse(JSON.stringify(h.state));h.fail=true;
 assert.equal((await h.journal.cancelQueued(nonce)).ok,false);assert.deepEqual(h.state,before);assert.equal(h.calls.length,0);
 h.fail=false;assert.equal((await h.journal.cancelQueued(nonce)).ok,true);assert.equal(h.state.drafts.c1,'older');assert.deepEqual(h.journal.records(),[]);
});

test('late cancellation lookup cannot delete a replaced record or recover its stale draft',async()=>{
 const wait=deferred(),h=fixture({lookupAcceptance:()=>wait.promise,prepareCancel:state=>({...state,recovered:true})});const {nonce}=h.journal.enqueue(draft());
 h.replace({...h.state,sendJournal:{schema:1,records:h.state.sendJournal.records.map(record=>({...record,phase:'dispatching'}))}});
 const pending=h.journal.cancelQueued(nonce);await new Promise(resolve=>setImmediate(resolve));
 const replacement={...h.state.sendJournal.records[0],phase:'failed',errorCode:'new identity'};h.replace({...h.state,sendJournal:{schema:1,records:[replacement]}});
 wait.resolve({status:'not-found'});assert.equal((await pending).error.code,'stale');assert.equal(h.state.sendJournal.records[0],replacement);assert.equal(h.state.recovered,undefined);
});

test('destroy during cancellation lookup and malformed recovery callbacks preserve the pending record',async()=>{
 const wait=deferred(),h=fixture({lookupAcceptance:()=>wait.promise});const {nonce}=h.journal.enqueue(draft());
 h.replace({...h.state,sendJournal:{schema:1,records:h.state.sendJournal.records.map(record=>({...record,phase:'prepared'}))}});
 const pending=h.journal.cancelQueued(nonce);await new Promise(resolve=>setImmediate(resolve));const writes=h.writes.length;h.journal.destroy();wait.resolve({status:'not-found'});
 assert.equal((await pending).ok,false);assert.equal(h.writes.length,writes);assert.equal(h.journal.records().length,1);assert.equal((await h.journal.cancelQueued(nonce)).error.code,'destroyed');
 for(const prepareCancel of [()=>null,()=>[],()=>{throw Error('recovery refused');}]){
  const fixtureWithBadRecovery=fixture({prepareCancel}),queued=fixtureWithBadRecovery.journal.enqueue(draft()),before=JSON.parse(JSON.stringify(fixtureWithBadRecovery.state));
  assert.equal((await fixtureWithBadRecovery.journal.cancelQueued(queued.nonce)).ok,false);assert.deepEqual(fixtureWithBadRecovery.state,before);
 }
});

test('cancellation is serialized behind in-flight acceptance and cannot undo a later accepted ACK',async()=>{
 const wait=deferred(),h=fixture({dispatch:async()=>wait.promise});const {nonce}=h.journal.enqueue(draft());const sending=h.journal.drain();await new Promise(resolve=>setImmediate(resolve));
 const cancelling=h.journal.cancelQueued(nonce);wait.resolve({accepted:true});await sending;
 assert.equal((await cancelling).ok,false);assert.equal(h.journal.records()[0].phase,'accepted-awaiting-echo');
});

test('queued successor cancellation commits before an in-flight predecessor settles and never dispatches the successor',async()=>{
 const wait=deferred(),found=new Set(),h=fixture({lookupAcceptance:async snapshot=>({status:found.has(snapshot.nonce)?'found':'unknown'}),dispatch:async snapshot=>{h.calls.push(snapshot);await wait.promise;found.add(snapshot.nonce);return {accepted:true};}});
 h.journal.enqueue(draft('predecessor'));const sending=h.journal.drain();await new Promise(resolve=>setImmediate(resolve));
 const second=h.journal.enqueue(draft('successor')),cancelling=h.journal.cancelQueued(second.nonce);let resolved=false;cancelling.then(()=>{resolved=true;});
 await new Promise(resolve=>setImmediate(resolve));const cancelledBeforeSettlement=resolved,remainingBeforeSettlement=h.journal.records().map(record=>record.snapshot.text);
 wait.resolve();await sending;const result=await cancelling;
 assert.equal(cancelledBeforeSettlement,true);assert.deepEqual(remainingBeforeSettlement,['predecessor']);assert.equal(result.ok,true);
 assert.deepEqual(h.calls.map(snapshot=>snapshot.text),['predecessor']);assert.deepEqual(h.journal.records(),[]);
});

test('simultaneous queued cancellation calls remove and recover the record exactly once',async()=>{
 let recoveries=0;const h=fixture({prepareCancel:(state,snapshot)=>{recoveries++;return {...state,recovered:snapshot.text};}}),{nonce}=h.journal.enqueue(draft()),writes=h.writes.length;
 const outcomes=await Promise.all([h.journal.cancelQueued(nonce),h.journal.cancelQueued(nonce)]);
 assert.deepEqual(outcomes.map(result=>result.ok),[true,false]);assert.equal(outcomes[1].error.code,'missing');assert.equal(recoveries,1);assert.equal(h.writes.length,writes+1);assert.deepEqual(h.journal.records(),[]);
});

test('accepted receipt survives missing persisted echo and restart without fabricating or resending input',async()=>{
 const first=fixture({lookupAcceptance:async()=>({status:'not-found'})});
 const {nonce}=first.journal.enqueue(draft('accepted input'));
 await first.journal.drain();first.journal.enqueue(draft('successor'));
 assert.equal(first.calls.length,1);assert.equal(first.journal.records()[0].phase,'accepted-awaiting-echo');
 assert.deepEqual(first.state.messages.c1,[]);first.journal.destroy();
 let echo=false;
 const restored=fixture({state:JSON.parse(JSON.stringify(first.state)),lookupAcceptance:async snapshot=>({status:echo&&snapshot.nonce===nonce?'found':'not-found'})});
 for(let attempt=0;attempt<2;attempt++){await restored.journal.reconcile();await restored.journal.drain();}
 assert.equal(restored.calls.length,0);assert.equal(restored.journal.records()[0].phase,'accepted-awaiting-echo');
 assert.deepEqual(restored.state.messages.c1,[]);
 assert.equal((await restored.journal.retry(nonce)).error.code,'uncertain');
 assert.equal((await restored.journal.cancelQueued(nonce)).error.code,'accepted');
 // The adapter's found result stands for an independently persisted echo. The
 // journal retires its intent; it does not insert or render a transcript row.
 echo=true;await restored.journal.reconcile();
 assert.deepEqual(restored.journal.records().map(record=>record.snapshot.text),['successor']);
 assert.deepEqual(restored.state.messages.c1,[]);
 await restored.journal.drain();assert.deepEqual(restored.calls.map(snapshot=>snapshot.text),['successor']);
 assert.notEqual(restored.calls[0].nonce,nonce);
});

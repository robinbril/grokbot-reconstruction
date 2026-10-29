import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptReadLedger} from '../transcript-unread-ledger.js';
const native=(id,timestampMs)=>({id,kind:'send-message',message:{type:'text'},...(timestampMs==null?{}:{timestampMs})});
function setup(){let value=null,fail=false,clock=100;const storage={getItem:()=>value,setItem:(key,next)=>{if(fail)throw Error('disk');value=next;}};return{storage,ledger:createTranscriptReadLedger({storage,now:()=>clock}),setClock:n=>clock=n,setFail:n=>fail=n};}
test('baseline unknown times stay unknown; actual new receipt gets durable time and reload never replays it',()=>{
 const t=setup();assert.equal(t.ledger.noteEntries('a',[native('old')],{baseline:true}),true);assert.deepEqual(t.ledger.row('a'),{lastViewedAt:0,lastActivityAt:0,hasUnread:false});
 t.setClock(200);t.ledger.noteEntries('a',[native('old'),native('new')]);assert.deepEqual(t.ledger.entries('a').map(x=>[x.id,x.timestampMs]),[['new',200]]);assert.equal(t.ledger.row('a').hasUnread,true);
 t.ledger.markRead('a');assert.equal(t.ledger.row('a').lastViewedAt,200);
 const reloaded=createTranscriptReadLedger({storage:t.storage,now:()=>500});reloaded.noteEntries('a',[native('old'),native('new')]);assert.equal(reloaded.row('a').hasUnread,false);assert.equal(reloaded.entries('a')[0].timestampMs,200);
});
test('actual timestamped baseline admits only native eligible activity; user and tool entries are remembered without unread count',()=>{
 const t=setup();t.ledger.noteEntries('a',[native('timed',50),{id:'user',kind:'message',role:'user',timestampMs:80},{id:'tool',kind:'tool-call',timestampMs:90}],{baseline:true});
 assert.equal(t.ledger.row('a').lastActivityAt,50);assert.deepEqual(t.ledger.entries('a').filter(x=>x.eligible).map(x=>x.id),['timed']);
});
test('failed persistence cannot consume arrival or mark read; retry preserves exact receipt identity',()=>{
 const t=setup();t.ledger.noteEntries('a',[native('first',10)],{baseline:true});t.setFail(true);assert.equal(t.ledger.markRead('a'),false);assert.equal(t.ledger.row('a').lastViewedAt,0);
 assert.equal(t.ledger.noteEntries('a',[native('second',20)]),false);assert.deepEqual(t.ledger.entries('a').map(x=>x.id),['first']);assert.equal(t.ledger.diagnostics().saveFailed,true);
 t.setFail(false);assert.equal(t.ledger.noteEntries('a',[native('second',20)]),true);assert.equal(t.ledger.row('a').lastActivityAt,20);
});
test('conversation keys including prototype names remain independent; malformed saved state resets without invoking getters',()=>{
 const t=setup();t.ledger.noteEntries('__proto__',[native('first',10)]);t.ledger.noteEntries('constructor',[native('second',20)]);assert.equal(t.ledger.row('__proto__').lastActivityAt,10);assert.equal(t.ledger.row('constructor').lastActivityAt,20);
 const invalid=createTranscriptReadLedger({storage:{getItem:()=>'{"version":1,"conversations":null}',setItem(){}}});assert.equal(invalid.row('a').hasUnread,false);
});

test('actual source order and deletion determine visible unread candidates rather than receipt insertion order',async()=>{
 const {currentUnreadReceipts,replicaUnreadEntries}=await import('../transcript-unread-ledger.js');
 const receipts=[{id:'later',entryId:'later',timestampMs:20,eligible:true},{id:'deleted',entryId:'deleted',timestampMs:30,eligible:true},{id:'older',entryId:'older',timestampMs:10,eligible:true}];
 assert.deepEqual(currentUnreadReceipts([{id:'older'},{id:'later'}],receipts).map(item=>item.id),['older','later']);
 const native=replicaUnreadEntries([{id:'run',role:'bot',liveHarness:{kind:'assistant',messages:[{id:'one',type:'text',content:'equal'},{id:'two',type:'text',content:'equal'}]}},{id:'tool',liveHarness:{kind:'tool'}},{id:'stream',transcript:{kind:'send-message',status:'streaming'}},{id:'user',role:'user',text:'outgoing'}]);
 assert.deepEqual(native.map(item=>[item.id,item.entryId,item.kind]),[['one','run','send-message'],['two','run','send-message'],['user',undefined,'message']]);
});


test('current eligibility follows native edits in both directions without rewriting durable receipt identity or time',async()=>{
 const {currentUnreadReceipts}=await import('../transcript-unread-ledger.js');
 const {unreadDivider}=await import('../transcript-unread-state.js');
 const receipts=[{id:'edited',entryId:'parent',timestampMs:200,eligible:true}];
 const snapshot=JSON.stringify(receipts);
 for(const entry of [
  {id:'edited',kind:'message',role:'assistant',suppressed:false},
  {...native('edited'),branched:true},
  {...native('edited'),message:{type:'text',channel:'voice:call'}},
 ]){
  const projected=currentUnreadReceipts([entry],receipts);
  assert.equal(projected[0].eligible,false);
  assert.equal(unreadDivider(projected,100),null);
  assert.deepEqual([projected[0].id,projected[0].entryId,projected[0].timestampMs],['edited','parent',200]);
 }
 const restored=currentUnreadReceipts([native('edited',999)],[{...receipts[0],eligible:false}]);
 assert.equal(restored[0].eligible,true);
 assert.equal(restored[0].timestampMs,200);
 assert.equal(unreadDivider(restored,100).newMessageCount,1);
 assert.equal(JSON.stringify(receipts),snapshot);
});

test('effective current activity drives opening boundary and read marking in both eligibility directions without mutating receipts',async()=>{
 const {createUnreadBoundaryStore,unreadDivider}=await import('../transcript-unread-state.js');
 const {currentUnreadReceipts}=await import('../transcript-unread-ledger.js');
 const t=setup(),suppressed={id:'changing',kind:'message',role:'assistant',timestampMs:50,suppressed:false};
 t.ledger.noteEntries('a',[suppressed],{baseline:true});
 const stored=t.ledger.entries('a'),current=[{id:'changing',kind:'message',role:'assistant'}];
 assert.equal(t.ledger.row('a').lastActivityAt,0);
 const effective=t.ledger.row('a',current);assert.equal(effective.lastActivityAt,50);assert.equal(effective.hasUnread,true);
 const boundaries=createUnreadBoundaryStore();boundaries.noteAgentOpenBegin({agentId:'a',row:effective});
 assert.equal(boundaries.read('a'),0);
 assert.equal(unreadDivider(currentUnreadReceipts(current,stored),boundaries.read('a')).newMessageCount,1);
 assert.equal(t.ledger.row('a',[suppressed]).hasUnread,false);
 assert.deepEqual(t.ledger.entries('a'),stored);
 t.setClock(10);assert.equal(t.ledger.markRead('a',current),true);assert.equal(t.ledger.row('a',current).lastViewedAt,50);
 assert.deepEqual(t.ledger.entries('a'),stored);
 const reverse=setup();reverse.ledger.noteEntries('b',current.map(entry=>({...entry,timestampMs:50})),{baseline:true});
 const reverseStored=reverse.ledger.entries('b'),hidden=reverse.ledger.row('b',[suppressed]);
 assert.equal(hidden.lastActivityAt,0);assert.equal(hidden.hasUnread,false);
 boundaries.noteAgentOpenBegin({agentId:'b',row:hidden});assert.equal(boundaries.read('b'),null);
 assert.equal(unreadDivider(currentUnreadReceipts([suppressed],reverseStored),boundaries.read('b')),null);
 assert.deepEqual(reverse.ledger.entries('b'),reverseStored);
});

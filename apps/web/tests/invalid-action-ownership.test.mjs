// Regression against actual production helper/writer/render boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveWorkflowActions} from '../live-workflows-actions.js';
import {createChatStateHost} from '../chat-state-host.js';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';

const lock='A:pause:broken:pause:target',other='A:pause:broken';
const original={requestId:'owned-prior',expectedRevision:1,schema:1,conversationId:'A',serverConversationId:'server-A',action:'pause',targetId:'target'};
function fixture(value=original,serverIds={A:'server-A'}){
 let state={version:1,selected:'A',messages:{A:[]},liveHarness:{serverIds:structuredClone(serverIds),workflowRequests:{[lock]:structuredClone(value)}}};
 let bytes=JSON.stringify(state);const writes=[],calls=[];
 const writer=createChatStateHost({getState:()=>state,publishState:next=>{state=next;},initialSavedState:state,storageKey:'owned-invalid-action',storage:{setItem(key,next){writes.push({key,bytes:next});bytes=next;}}});
 const host={...writer,getState:()=>state,getConversationKey:()=>state.selected,getDialogVersion:()=>0,
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),draftAttachments:()=>[],app:{querySelector:()=>null},overlay:{querySelector:()=>null,querySelectorAll:()=>[]}};
 const guard=(...args)=>{calls.push(args);throw new Error('Unexpected client dispatch in pure ownership test');};
 const client={scheduleAction:guard,cancelQueued:guard,retryQueued:guard,resumeQueue:guard};
 const helper=createLiveWorkflowActions({host,client,serverId:id=>state.liveHarness.serverIds[id]});
 const surface=createLiveWorkflowsSurface({host,client,key:()=>state.selected,serverId:id=>state.liveHarness.serverIds[id],isLive:()=>true,
  snapshot:()=>({queue:[],schedules:[],runs:[],workflow:{}}),refresh:async()=>{},setError:()=>{},activeRun:()=>null});
 return {helper,surface,writes,calls,get state(){return state;},get bytes(){return bytes;}};
}

test('malformed new metadata stays visible to its explicit originating conversation',()=>{
 const f=fixture(),before=f.bytes;
 const records=f.helper.records('A');assert.ok(records.some(row=>row.lock===lock&&!row.valid),'Untrusted lock parsing cannot hide an invalid record from metadata owner A');
 const markup=f.surface.queueMarkup();assert.match(markup,/role="status"/);assert.match(markup,/ongeldig/i,'Actual empty-queue rendering must expose the invalid pending record');
 assert.throws(()=>f.helper.recover('A',lock));assert.equal(f.bytes,before);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);f.surface.destroy();
});

test('malformed new metadata holds all new actions without replacement or dispatch',()=>{
 const f=fixture(),before=f.bytes,journal=structuredClone(f.state.liveHarness.workflowRequests);
 for(const [action,id,revision]of [['enable','target',2],['run-now','target',2],['cancel','owned-queue',undefined],['resume','',undefined]]){
  assert.equal(f.helper.held('A',action,id),true,'An invalid owned journal entry must fail closed before new '+action);
 }
 assert.deepEqual(f.state.liveHarness.workflowRequests,journal);assert.equal(f.bytes,before);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);f.surface.destroy();
});

test('programmatic begin cannot replace or bypass malformed pending ownership',()=>{
 const f=fixture(),before=f.bytes,journal=structuredClone(f.state.liveHarness.workflowRequests);
 assert.throws(()=>f.helper.begin('A','enable','target',2),'Programmatic admission must reject even when called without a UI hold check');
 assert.deepEqual(f.state.liveHarness.workflowRequests,journal);assert.equal(f.bytes,before);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);f.surface.destroy();
});

test('legacy ambiguous lock without an existing owner mapping remains visibly fail closed',()=>{
 const value={requestId:'owned-prior',expectedRevision:1},f=fixture(value),before=f.bytes;
 assert.ok(f.helper.records('A').some(row=>row.lock===lock&&!row.valid),'An unvalidated legacy address must remain visible rather than disappear under an unmapped conversation');
 assert.equal(f.helper.held('A','enable','target'),true);assert.throws(()=>f.helper.begin('A','enable','target',2));assert.throws(()=>f.helper.recover('A',lock));
 assert.equal(f.bytes,before);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);f.surface.destroy();
});

for(const format of ['metadata','legacy'])test('valid '+format+' record for a colon-containing other conversation stays correctly scoped',()=>{
 const value=format==='metadata'?{...original,conversationId:other,serverConversationId:'server-colon'}:{requestId:'owned-prior',expectedRevision:1};
 const f=fixture(value,{A:'server-A',[other]:'server-colon'}),prior=structuredClone(f.state.liveHarness.workflowRequests[lock]);
 const records=f.helper.records(other);assert.equal(records.length,1);assert.equal(records[0].valid,true);assert.equal(records[0].conversationId,other);assert.equal(records[0].serverConversationId,'server-colon');
 assert.deepEqual(records[0].command,{requestId:'owned-prior',expectedRevision:1});assert.equal(f.helper.held(other,'enable','target'),true);
 assert.deepEqual(f.helper.records('A'),[]);assert.equal(f.helper.held('A','enable','target'),false,'A valid distinct conversation must not create a global hold');
 const fresh=f.helper.begin('A','enable','target',2);assert.equal(fresh.conversationId,'A');assert.equal(fresh.serverConversationId,'server-A');assert.notEqual(fresh.requestId,prior.requestId);
 assert.deepEqual(f.state.liveHarness.workflowRequests[lock],prior);assert.deepEqual(f.helper.recover(other,lock).command,{requestId:'owned-prior',expectedRevision:1});assert.equal(f.writes.length,1);assert.equal(f.calls.length,0);f.surface.destroy();
});

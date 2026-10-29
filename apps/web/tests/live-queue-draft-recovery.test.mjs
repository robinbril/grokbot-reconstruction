// Real ledger/writer; queue race states are synthetic and never call a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createChatStateHost} from '../chat-state-host.js';
import {prepareRecoveredSendDraft} from '../send-draft-recovery.js';
import {retainQueuedDraft,queuedDraftKey} from '../live-queued-drafts.js';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {HarnessStore} from '../harness/store.mjs';

const owner='synthetic-live-recovery',canonical=id=>'server-'+id;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve};};
const table=state=>state.liveHarness.workflowRequests||{};
const rawDraft={conversationId:'A',requestId:'enqueue-owned',text:'  RAW_QUEUED\nEXACT  ',attachments:[],quote:{title:'Context',text:'EXACT_REPLY'},skillReferences:[{kind:'skill',id:'owned-skill',label:'Synthetic',description:'Local only'}]};
const payload={requestId:rawDraft.requestId,text:rawDraft.text,quote:'Context\nEXACT_REPLY',skillReferences:rawDraft.skillReferences.map(value=>JSON.stringify(value,null,2))};

async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'live-queue-draft-recovery-'));
 const store=await new HarnessStore({dataDir}).init();
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 const admitted=await engine.enqueue(owner,canonical('A'),payload);
 const row=()=>store.snapshot(store.get(owner,canonical('A'))).queue.find(item=>item.id===admitted.queueId);
 function seed(){
  const request={queued:true,payload:structuredClone(payload),draft:structuredClone(rawDraft)};
  const current={version:1,selected:'A',drafts:{A:'',B:'KEEP_B'},messages:{A:[],B:[]},replyDrafts:{},composerSkillReferences:{},attachmentConsumedIds:[],liveHarness:{serverIds:{A:canonical('A'),B:canonical('B')},pendingSends:{A:request}}};
  const retained=retainQueuedDraft(current,{conversationId:'A',serverConversationId:canonical('A'),queueId:admitted.queueId,request});
  delete retained.liveHarness.pendingSends.A;return retained;
 }
 function mount({saved=seed(),loseReply=false,waitForReply=null,failRetirement=false,raceStatus=null,responseOverride=null}={}){
  let state=structuredClone(saved),bytes=JSON.stringify(saved),snapshot={queue:[row()],schedules:[],runs:[],workflow:{}},prepared=null;
  const calls=[],errors=[],completed=[],writes=[],focus=[],called=deferred();
  const storage={failRetirement,setItem(_key,next){const candidate=JSON.parse(next);if(this.failRetirement&&Object.keys(table(JSON.parse(bytes))).length&&Object.keys(table(candidate)).length===0)throw Error('Synthetic denied atomic recovery');bytes=next;writes.push(JSON.parse(next));}};
  const writer=createChatStateHost({getState:()=>state,publishState:next=>{state=next;},storage,storageKey:'synthetic-recovery',initialSavedState:saved});
  const context=()=>({attachments:[],failed:[],busy:false});
  const host={...writer,getState:()=>state,getConversationKey:()=>state.selected,getDialogVersion:()=>0,esc,
   app:{querySelector:selector=>selector==='#message-input'?{focus:()=>focus.push(state.selected)}:null},overlay:{open:false,querySelector:()=>null,querySelectorAll:()=>[]},draftAttachments:()=>[],render(){},clearChatError(){},
   async prepareQueuedDraftRecovery(draft){prepareRecoveredSendDraft(state,draft,context());prepared=structuredClone(draft);},
   prepareSendCancel(current,draft){assert.deepEqual(draft,prepared);return prepareRecoveredSendDraft(current,draft,context());},
   completeQueuedDraftRecovery(draft,success){completed.push({draft,success});prepared=null;}};
  async function refresh(){snapshot={...snapshot,queue:[row()]};}
  const client={async cancelQueued(id,qid,requestId){calls.push({id,qid,requestId});called.resolve();if(raceStatus)await store.transaction(owner,id,state=>{const queue=state.queue.find(row=>row.id===qid);queue.status=raceStatus;queue.runId='owned-native-run';});const result=await engine.cancel(owner,id,qid,requestId);if(waitForReply)await waitForReply;if(loseReply){loseReply=false;throw new TypeError('Synthetic lost cancel ACK');}return responseOverride?responseOverride(result):result;}};
  const surface=createLiveWorkflowsSurface({host,client,key:()=>state.selected,serverId:id=>state.liveHarness.serverIds[id]||canonical(id),isLive:()=>true,snapshot:()=>snapshot,refresh,setError:(id,error)=>errors.push({id,error}),activeRun:()=>null});
  t.after(()=>surface.destroy());
  return {surface,host,writer,storage,calls,errors,completed,writes,focus,called:called.promise,refresh,get state(){return state;},get durable(){return JSON.parse(bytes);},
   act:(kind,id=admitted.queueId)=>surface.handleAction({action:'live-workflow-'+kind,id}),
   edit(text,id='A'){assert.equal(writer.commit(s=>({...s,drafts:{...s.drafts,[id]:text}})).ok,true);},
   select(id){assert.equal(writer.commit(s=>({...s,selected:id})).ok,true);}};
 }
 return {store,engine,admitted,row,seed,mount};
}
async function recoverPending(ui){const lock=Object.keys(table(ui.state))[0];assert.ok(lock);await ui.act('recover',lock);}

test('only a locally bound never-run queue row exposes draft recovery',async t=>{
 const f=await fixture(t),ui=f.mount();
 assert.match(ui.surface.queueMarkup(),/aria-label="Terug naar concept:   RAW_QUEUED/);
 const missing=f.seed();delete missing.liveHarness.queuedDrafts;assert.doesNotMatch(f.mount({saved:missing}).surface.queueMarkup(),/Terug naar concept/);
 await f.store.transaction(owner,canonical('A'),state=>{state.queue[0].runId='already-ran';});await ui.refresh();
 assert.doesNotMatch(ui.surface.queueMarkup(),/Terug naar concept/);
 await ui.act('recover-draft');assert.equal(ui.calls.length,0);assert.equal(ui.state.drafts.A,'');
});

test('real cancellation restores exact original context and retires both bindings atomically',async t=>{
 const f=await fixture(t),ui=f.mount();await ui.act('recover-draft');
 assert.equal(f.row().status,'cancelled');assert.equal(f.row().runId,undefined);assert.equal(ui.calls.length,1);
 assert.equal(ui.state.drafts.A,rawDraft.text);assert.deepEqual(ui.state.replyDrafts.A,rawDraft.quote);assert.deepEqual(ui.state.composerSkillReferences.A,rawDraft.skillReferences);
 assert.equal(ui.state.drafts.B,'KEEP_B');assert.deepEqual(table(ui.state),{});assert.equal(Object.hasOwn(ui.state.liveHarness.queuedDrafts,queuedDraftKey('A',f.admitted.queueId)),false);
 const restoration=ui.writes.filter(state=>state.drafts.A===rawDraft.text);assert.equal(restoration.length,1);assert.deepEqual(table(restoration[0]),{});assert.deepEqual(restoration[0].liveHarness.queuedDrafts,{});
 assert.equal(ui.completed.filter(item=>item.success).length,1);assert.deepEqual(ui.focus,['A']);
});

test('lost real cancel acknowledgement survives remount and reuses the original identity',async t=>{
 const f=await fixture(t),first=f.mount({loseReply:true});await first.act('recover-draft');
 const original=first.calls[0];assert.equal(f.row().status,'cancelled');assert.equal(first.state.drafts.A,'');assert.equal(Object.keys(table(first.state)).length,1);
 assert.match(first.surface.queueMarkup(),/Ontvangst controleren: Terug naar concept/);first.surface.destroy();
 const ui=f.mount({saved:first.durable});await recoverPending(ui);
 assert.deepEqual(ui.calls[0],original);assert.equal(ui.state.drafts.A,rawDraft.text);assert.deepEqual(table(ui.state),{});
 assert.equal(f.store.get(owner,canonical('A')).queue.length,1);
});

test('failed retirement leaves cancellation and original draft recoverable without partial restoration',async t=>{
 const f=await fixture(t),ui=f.mount({failRetirement:true});await ui.act('recover-draft');
 assert.equal(f.row().status,'cancelled');assert.equal(ui.state.drafts.A,'');assert.equal(Object.keys(table(ui.state)).length,1);
 assert.ok(ui.state.liveHarness.queuedDrafts[queuedDraftKey('A',f.admitted.queueId)]);assert.deepEqual(ui.state,ui.durable);
 const original=ui.calls[0];ui.storage.failRetirement=false;await recoverPending(ui);
 assert.deepEqual(ui.calls[1],original);assert.equal(ui.state.drafts.A,rawDraft.text);assert.deepEqual(table(ui.state),{});
});

test('newer draft before preparation prevents any server cancellation',async t=>{
 const f=await fixture(t),ui=f.mount();ui.edit('NEWER_UNSENT');await ui.act('recover-draft');
 assert.equal(ui.calls.length,0);assert.equal(f.row().status,'queued');assert.equal(ui.state.drafts.A,'NEWER_UNSENT');assert.equal(Object.keys(table(ui.state)).length,1);
 ui.edit('');await recoverPending(ui);assert.equal(ui.calls.length,1);assert.equal(ui.state.drafts.A,rawDraft.text);
});

test('newer draft after real cancellation and conversation switch remains untouched until explicit recovery',async t=>{
 const f=await fixture(t),wait=deferred(),ui=f.mount({waitForReply:wait.promise});
 const operation=ui.act('recover-draft');
 await Promise.race([ui.called,operation.then(()=>assert.ok(ui.calls.length,'The recovery must actually call the cancellation boundary'))]);
 ui.edit('NEWER_DURING_RPC');ui.select('B');wait.resolve();await operation;
 assert.equal(f.row().status,'cancelled');assert.equal(ui.state.drafts.A,'NEWER_DURING_RPC');assert.equal(ui.state.drafts.B,'KEEP_B');assert.equal(ui.state.selected,'B');assert.deepEqual(ui.focus,[]);
 assert.equal(Object.keys(table(ui.state)).length,1);assert.ok(ui.errors.every(item=>item.id==='A'));
 ui.select('A');ui.edit('');await recoverPending(ui);assert.equal(ui.state.drafts.A,rawDraft.text);assert.equal(ui.calls[1].requestId,ui.calls[0].requestId);
});

test('ordinary Cancel retires the retained draft binding without restoring its contents',async t=>{
 const f=await fixture(t),ui=f.mount();await ui.act('cancel');
 assert.equal(f.row().status,'cancelled');assert.equal(ui.state.drafts.A,'');assert.deepEqual(ui.state.liveHarness.queuedDrafts,{});assert.deepEqual(table(ui.state),{});
});

test('a queue that starts before cancel admission retires the definitively rejected recovery only',async t=>{
 const f=await fixture(t),ui=f.mount({raceStatus:'running'});await ui.act('recover-draft');
 assert.equal(f.row().status,'running');assert.equal(f.row().runId,'owned-native-run');assert.equal(ui.state.drafts.A,'');assert.deepEqual(ui.focus,[]);
 assert.deepEqual(table(ui.state),{});assert.ok(ui.errors.some(item=>/gestart|afgehandeld/.test(item.error.message)));
});

test('an exact terminal cancellation response cannot restore work that already completed',async t=>{
 const f=await fixture(t),ui=f.mount({raceStatus:'completed'});await ui.act('recover-draft');
 assert.equal(f.row().status,'completed');assert.equal(ui.state.drafts.A,'');assert.deepEqual(table(ui.state),{});assert.deepEqual(ui.focus,[]);
 assert.ok(ui.errors.some(item=>/gestart|afgehandeld/.test(item.error.message)));
});

test('a terminal-shaped acknowledgement without matching canonical state remains uncertain',async t=>{
 const f=await fixture(t),ui=f.mount({responseOverride:result=>({...result,status:'completed'})});await ui.act('recover-draft');
 assert.equal(f.row().status,'cancelled');assert.equal(ui.state.drafts.A,'');assert.equal(Object.keys(table(ui.state)).length,1);assert.deepEqual(ui.focus,[]);
});

test('late cancelled acknowledgement cannot restore into a remapped local conversation',async t=>{
 const f=await fixture(t),wait=deferred(),ui=f.mount({waitForReply:wait.promise});const operation=ui.act('recover-draft');
 await Promise.race([ui.called,operation.then(()=>assert.ok(ui.calls.length))]);
 assert.equal(ui.writer.commit(state=>({...state,liveHarness:{...state.liveHarness,serverIds:{...state.liveHarness.serverIds,A:'different-server'}}})).ok,true);
 wait.resolve();await operation;assert.equal(ui.state.drafts.A,'');assert.equal(Object.keys(table(ui.state)).length,1);assert.deepEqual(ui.focus,[]);
});

test('failed retirement of a proven in-flight rejection can recover without another cancellation',async t=>{
 const f=await fixture(t),ui=f.mount({raceStatus:'running',failRetirement:true});await ui.act('recover-draft');
 assert.equal(Object.keys(table(ui.state)).length,1);assert.equal(ui.state.drafts.A,'');
 ui.storage.failRetirement=false;await ui.refresh();await recoverPending(ui);
 assert.deepEqual(table(ui.state),{});assert.equal(ui.calls.length,1);assert.equal(ui.state.drafts.A,'');
});

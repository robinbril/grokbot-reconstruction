// Actual surface + durable workflow ledger; no provider, browser, or fabricated response.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {HarnessStore} from '../harness/store.mjs';

const owner='owned-save-journal';
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const fields={scheduleId:'',revision:'',kind:'once',zone:'Europe/Amsterdam',at:'2026-10-20T09:00:00Z',title:'ORIGINAL_TITLE',prompt:'ORIGINAL_PROMPT',enabled:'on'};
function makeForm(initial){
 const inputs=new Map(Object.entries(initial).map(([name,value])=>[name,{value:String(value),checked:name==='enabled'}])),submit={disabled:false,isConnected:true};
 return {dataset:{},isConnected:true,inputs,elements:{namedItem:name=>inputs.get(name)},querySelector(selector){if(selector==='[type=submit]')return submit;return inputs.get(selector.match(/\[name=["']?([^\]"']+)/)?.[1])||null;},data(){return {get:name=>inputs.get(name)?.value??null,has:name=>inputs.has(name)&&(name!=='enabled'||inputs.get(name).checked),getAll:name=>inputs.has(name)?[inputs.get(name).value]:[]};}};
}
function formFromMarkup(markup){
 const inputs={};for(const match of markup.matchAll(/<input\b([^>]+)>/g)){const name=match[1].match(/name="([^"]+)"/)?.[1];if(!name||name==='weekdays'||name==='enabled'&&!/\schecked(?:\s|$)/.test(match[1]))continue;const value=match[1].match(/value="([^"]*)"/);inputs[name]=decode(value?value[1]:'on');}
 inputs.kind=markup.match(/<option value="([^"]+)" selected/)?.[1]||'once';inputs.prompt=decode(markup.match(/<textarea[^>]*name="prompt"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]||'');return makeForm(inputs);
}
async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-save-journal-')),store=await new HarnessStore({dataDir}).init();
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false,clock:()=>new Date('2026-10-18T12:00:00Z')}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 function mount({shared={state:{liveHarness:{serverIds:{}}}},loseAck=false,failCommit=false}={}){
  let version=0,form=null,dialog=null,snapshot={queue:[],schedules:[],runs:[],workflow:{}},lost=false,pendingRefresh=null,refreshGate=null;
  const calls=[],events=[],errors=[],errorNode={textContent:''};
  const host={esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),getState:()=>shared.state,getConversationKey:()=>'A',getDialogVersion:()=>version,draftAttachments:()=>[],closePopover(){},app:{querySelector:()=>null},overlay:{open:true,querySelector:selector=>selector==='[data-live-routine-error]'?errorNode:form?.querySelector(selector)||null,querySelectorAll:()=>[],contains:node=>node===form},commit(fn,{reason}){events.push({kind:'commit',reason,mapping:shared.state.liveHarness.serverIds.A});if(failCommit)return {ok:false};shared.state=fn(shared.state);return {ok:true};},showDialog(kind,label,markup){version++;dialog={label,markup};if(form)form.isConnected=false;form=markup.includes('<form')?formFromMarkup(markup):null;},closeDialog(){version++;host.overlay.open=false;if(form)form.isConnected=false;form=null;}};
  function serverId(id='A'){events.push({kind:'serverId',id});shared.state.liveHarness.serverIds[id]??='server-'+id;return shared.state.liveHarness.serverIds[id];}
  async function refresh(_id='A',{afterPending=false}={}){
   if(pendingRefresh){refreshGate.joined.resolve();if(!afterPending)return pendingRefresh;await pendingRefresh;}
   const state=store.get(owner,'server-A'),captured=state?store.snapshot(state):structuredClone(snapshot);
   if(refreshGate&&!refreshGate.started){refreshGate.started=true;pendingRefresh=refreshGate.release.promise.then(()=>{snapshot=captured;}).finally(()=>{pendingRefresh=null;});return pendingRefresh;}
   snapshot=captured;
  }
  function holdNextRefresh(){const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};refreshGate={started:false,release:deferred(),joined:deferred()};return {release:refreshGate.release.resolve,joined:refreshGate.joined.promise};}
  async function invoke(kind,canonicalId,id,command){calls.push({kind,canonicalId,id,command:structuredClone(command)});const result=kind==='create'?await engine.createSchedule(owner,canonicalId,command):await engine.scheduleAction(owner,canonicalId,id,kind,command);if(loseAck&&!lost){lost=true;throw new TypeError('Lost ACK after actual durable '+kind);}return result;}
  const client={cancelQueued:(canonicalId,id,requestId)=>engine.cancel(owner,canonicalId,id,requestId),createSchedule:(canonicalId,command)=>invoke('create',canonicalId,'',command),scheduleAction:(canonicalId,id,action,command)=>invoke(action,canonicalId,id,command)};
  const surface=createLiveWorkflowsSurface({host,client,key:()=>'A',serverId,isLive:()=>true,snapshot:()=>snapshot,refresh,setError:(id,error)=>errors.push({id,message:error.message,code:error.code}),activeRun:()=>null});
  return {shared,host,surface,calls,events,errors,errorNode,refresh,holdNextRefresh,get dialog(){return dialog;},get form(){return form;},submit(candidate=form){return surface.handleSubmit({submit:'live-workflow-save',form:candidate,data:candidate.data()});}};
 }
 return {store,engine,mount,durable:async()=>JSON.parse(await readFile(path.join(dataDir,'conversation-server-A.json'),'utf8'))};
}

test('changed input cannot admit a second routine while an accepted create intent is unresolved',async t=>{
 const f=await fixture(t),ui=f.mount({loseAck:true});ui.surface.handleAction({action:'live-workflow-new'});await ui.submit(makeForm(fields));
 const first=f.store.get(owner,'server-A').schedules[0],pending=Object.keys(ui.shared.state.liveHarness.workflowSaves);assert.equal(pending.length,1);assert.equal(first.enabled,true);
 ui.host.closeDialog();ui.surface.handleAction({action:'live-workflow-new'});assert.equal(ui.form.inputs.get('prompt').value,'ORIGINAL_PROMPT');
 ui.form.inputs.get('title').value='CHANGED_TITLE';ui.form.inputs.get('prompt').value='CHANGED_PROMPT';const changedForm=ui.form;await ui.submit();
 assert.equal(f.store.get(owner,'server-A').schedules.length,1,'Changed input must not create a second enabled job while the first ACK is unresolved');
 assert.equal(ui.calls.length,1,'Do not issue a new create request for a different signature');
 assert.equal(ui.form,changedForm);assert.equal(ui.form.inputs.get('title').value,'CHANGED_TITLE');assert.equal(ui.form.inputs.get('prompt').value,'CHANGED_PROMPT');
 assert.deepEqual(Object.keys(ui.shared.state.liveHarness.workflowSaves),pending);assert.ok(ui.errors.length>=2,'Show why changed input must wait for prior receipt recovery');
});

test('accepted edit ACK replay after remount uses the original request and revision without a second edit',async t=>{
 const f=await fixture(t),seed=await f.engine.createSchedule(owner,'server-A',{requestId:'seed',title:'EDIT_TITLE',payload:{text:'BEFORE_EDIT',quote:'FROZEN_QUOTE',skillReferences:['FROZEN_SKILL']},rule:{kind:'once',at:fields.at,timeZone:fields.zone},enabled:false});
 const ui=f.mount({loseAck:true});await ui.refresh();ui.surface.handleAction({action:'live-workflow-edit',id:seed.schedule.id});ui.form.inputs.get('prompt').value='AFTER_EDIT';await ui.submit();
 assert.equal(f.store.get(owner,'server-A').schedules[0].revision,2);const original=ui.calls[0].command;assert.equal(original.expectedRevision,1);
 ui.host.closeDialog();ui.surface.destroy();const reloaded=f.mount({shared:ui.shared});await reloaded.refresh();reloaded.surface.handleAction({action:'live-workflow-edit',id:seed.schedule.id});await reloaded.submit();
 const saved=f.store.get(owner,'server-A').schedules[0];assert.equal(saved.revision,2,'Replaying the exact accepted edit must not advance the canonical revision again');
 assert.equal(reloaded.calls.length,1);assert.deepEqual(reloaded.calls[0].command,original,'Replay must retain the complete original immutable command, including expectedRevision and context');
 assert.equal(saved.payload.text,'AFTER_EDIT');assert.equal(saved.payload.quote,'FROZEN_QUOTE');assert.deepEqual(saved.payload.skillReferences,['FROZEN_SKILL']);assert.equal(Object.keys(reloaded.shared.state.liveHarness.workflowSaves).length,0);
});

test('failed durable save intent pins canonical mapping before commit and never dispatches a create',async t=>{
 const f=await fixture(t),ui=f.mount({failCommit:true});ui.surface.handleAction({action:'live-workflow-new'});await ui.submit(makeForm(fields));
 const commit=ui.events.findIndex(event=>event.kind==='commit'&&event.reason==='live-routine-save-intent');assert.ok(commit>0);assert.ok(ui.events.slice(0,commit).some(event=>event.kind==='serverId'));assert.equal(ui.events[commit].mapping,'server-A');
 assert.equal(ui.calls.length,0);assert.equal(f.store.get(owner,'server-A'),undefined);assert.equal(Object.keys(ui.shared.state.liveHarness.workflowSaves||{}).length,0);assert.match(ui.errors[0].message,/niet worden opgeslagen/);
});


test('accepted create waits past a deferred pre-mutation snapshot before showing its exact durable detail',async t=>{
 const f=await fixture(t),ui=f.mount(),gate=ui.holdNextRefresh();
 const oldRefresh=ui.refresh();ui.surface.handleAction({action:'live-workflow-new'});
 const submission=ui.submit(makeForm(fields));await gate.joined;
 const accepted=await f.durable();assert.equal(accepted.schedules.length,1);assert.equal(accepted.schedules[0].revision,1);
 const request=ui.calls[0].command;assert.ok(Object.keys(accepted.requests).some(key=>key.includes(request.requestId)),'The exact request identity has a durable receipt');
 assert.equal(Object.keys(ui.shared.state.liveHarness.workflowSaves).length,1,'Keep the exact receipt intent until post-mutation projection completes');
 gate.release();await oldRefresh;await submission;
 const saved=(await f.durable()).schedules[0];assert.equal(saved.id,accepted.schedules[0].id);assert.equal(saved.title,fields.title);assert.equal(saved.payload.text,fields.prompt);assert.equal(saved.enabled,true);assert.equal(saved.revision,1);
 assert.equal(ui.dialog.label,fields.title,'The acknowledged routine must open its detail, not a stale empty list');
 assert.match(ui.dialog.markup,/ORIGINAL_PROMPT/);assert.match(ui.dialog.markup,new RegExp(saved.id));
 assert.equal(ui.calls.length,1);assert.equal(Object.keys(ui.shared.state.liveHarness.workflowSaves).length,0);assert.deepEqual(ui.errors,[]);
});


test('acknowledged pause waits past a deferred pre-mutation snapshot before retiring its receipt',async t=>{
 const f=await fixture(t),seed=await f.engine.createSchedule(owner,'server-A',{requestId:'pause-seed',title:fields.title,payload:{text:fields.prompt},rule:{kind:'once',at:fields.at,timeZone:fields.zone},enabled:true});
 const ui=f.mount();await ui.refresh();ui.surface.handleAction({action:'live-workflow-open',id:seed.schedule.id});
 const gate=ui.holdNextRefresh(),oldRefresh=ui.refresh();
 const action=ui.surface.handleAction({action:'live-workflow-pause',id:seed.schedule.id});await gate.joined;
 const accepted=await f.durable();assert.equal(accepted.schedules[0].enabled,false);assert.equal(accepted.schedules[0].revision,2);
 const request=ui.calls[0].command;assert.ok(Object.keys(accepted.requests).some(key=>key.includes(request.requestId)));
 assert.equal(Object.keys(ui.shared.state.liveHarness.workflowRequests).length,1,'Retain action identity until the acknowledged state is projected');
 gate.release();await oldRefresh;await action;
 assert.equal(ui.dialog.label,fields.title);assert.match(ui.dialog.markup,/data-live-routine-status>Gepauzeerd<\/dd>/);
 const saved=(await f.durable()).schedules[0];assert.equal(saved.id,seed.schedule.id);assert.equal(saved.revision,2);assert.equal(saved.enabled,false);
 assert.equal(ui.calls.length,1);assert.equal(Object.keys(ui.shared.state.liveHarness.workflowRequests).length,0);assert.deepEqual(ui.errors,[]);
});


test('rejected edit refreshes the external revision past an older poll while retaining local fields',async t=>{
 const f=await fixture(t),seed=await f.engine.createSchedule(owner,'server-A',{requestId:'conflict-edit-seed',title:fields.title,payload:{text:fields.prompt},rule:{kind:'once',at:fields.at,timeZone:fields.zone},enabled:true});
 const ui=f.mount();await ui.refresh();ui.surface.handleAction({action:'live-workflow-edit',id:seed.schedule.id});
 ui.form.inputs.get('prompt').value='RETAIN_LOCAL_CONFLICT_EDIT';const form=ui.form,gate=ui.holdNextRefresh(),oldRefresh=ui.refresh();
 await f.engine.scheduleAction(owner,'server-A',seed.schedule.id,'pause',{requestId:'external-edit-pause',expectedRevision:1});
 const submission=ui.submit();await gate.joined;gate.release();await oldRefresh;await submission;
 assert.equal(ui.errors.at(-1).code,'REVISION_CONFLICT');assert.equal(ui.form,form);assert.equal(ui.form.inputs.get('prompt').value,'RETAIN_LOCAL_CONFLICT_EDIT');
 assert.equal(ui.form.inputs.get('revision').value,'2','A rejected edit must offer the authoritative external revision for its retained draft');
 assert.equal(Object.keys(ui.shared.state.liveHarness.workflowSaves).length,0);
 await ui.submit();const saved=(await f.durable()).schedules[0];assert.equal(saved.revision,3);assert.equal(saved.payload.text,'RETAIN_LOCAL_CONFLICT_EDIT');
});

test('rejected routine action shows the externally changed status past a deferred older poll',async t=>{
 const f=await fixture(t),seed=await f.engine.createSchedule(owner,'server-A',{requestId:'conflict-pause-seed',title:fields.title,payload:{text:fields.prompt},rule:{kind:'once',at:fields.at,timeZone:fields.zone},enabled:true});
 const ui=f.mount();await ui.refresh();ui.surface.handleAction({action:'live-workflow-open',id:seed.schedule.id});
 const gate=ui.holdNextRefresh(),oldRefresh=ui.refresh();await f.engine.scheduleAction(owner,'server-A',seed.schedule.id,'pause',{requestId:'external-action-pause',expectedRevision:1});
 const action=ui.surface.handleAction({action:'live-workflow-pause',id:seed.schedule.id});await gate.joined;gate.release();await oldRefresh;await action;
 assert.equal(ui.errors.at(-1).code,'REVISION_CONFLICT');assert.equal(ui.dialog.label,fields.title);
 assert.match(ui.dialog.markup,/data-live-routine-status>Gepauzeerd<\/dd>/,'A rejected stale action must show the externally paused routine');
 assert.equal(Object.keys(ui.shared.state.liveHarness.workflowRequests).length,0);assert.equal(ui.calls.length,1);
 const saved=(await f.durable()).schedules[0];assert.equal(saved.revision,2);assert.equal(saved.enabled,false);
});


test('in-flight queue rejection removes stale recovery controls without replacing the current draft',async t=>{
 const f=await fixture(t),queued=await f.engine.enqueue(owner,'server-A',{requestId:'queue-original',text:'QUEUED_ORIGINAL'}),ui=f.mount();
 ui.shared.state.liveHarness.serverIds.A='server-A';ui.shared.state.drafts={A:'NEWER_CURRENT_DRAFT'};
 ui.shared.state.liveHarness.queuedDrafts={ [JSON.stringify(['A',queued.queueId])]:{schema:1,conversationId:'A',serverConversationId:'server-A',queueId:queued.queueId,enqueueRequestId:'queue-original',payload:{text:'QUEUED_ORIGINAL'},draft:{conversationId:'A',requestId:'queue-original',text:'QUEUED_ORIGINAL',attachments:[],skillReferences:[]}}};
 ui.host.prepareQueuedDraftRecovery=async()=>{};ui.host.completeQueuedDraftRecovery=()=>{};
 await ui.refresh();assert.match(ui.surface.queueMarkup(),/Terug naar concept/);
 const gate=ui.holdNextRefresh(),oldRefresh=ui.refresh();
 let releaseSend,markSending;const sending=new Promise(resolve=>{markSending=resolve;}),send=new Promise(resolve=>{releaseSend=resolve;});
 f.engine.runtime={active:()=>false,withLifecycle:async(_id,fn)=>fn(),connect:async()=>{},startUnlocked:async()=>{markSending();await send;throw new Error('Synthetic runtime stops at the dispatch boundary');}};
 const pump=f.engine.pump('server-A');await sending;
 try{
  const action=ui.surface.handleAction({action:'live-workflow-recover-draft',id:queued.queueId});await gate.joined;gate.release();await oldRefresh;await action;
  assert.equal(ui.errors.at(-1).code,'QUEUE_ALREADY_STARTED');assert.equal(ui.shared.state.drafts.A,'NEWER_CURRENT_DRAFT');
  assert.doesNotMatch(ui.surface.queueMarkup(),/Terug naar concept/,'An in-flight rejection must remove recovery controls from the formerly queued snapshot');
  assert.equal(Object.keys(ui.shared.state.liveHarness.workflowRequests).length,0);assert.equal((await f.durable()).queue[0].status,'sending');
 }finally{releaseSend();await pump;}
});

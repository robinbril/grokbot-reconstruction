// Actual production surface, WorkflowEngine and fsync-backed HarnessStore.
// Transport/refresh faults below model ambiguous replies, never server admission rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {HarnessStore,harnessError} from '../harness/store.mjs';

const owner='owned-rejected-save',conversation='server-A';
const future='2026-10-20T09:00:00Z',past='2020-01-01T09:00:00Z';
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function makeForm(values){
 const inputs=new Map(Object.entries(values).map(([name,value])=>[name,{value:String(value),checked:name==='enabled'}])),submit={disabled:false,isConnected:true};
 return {dataset:{},isConnected:true,inputs,elements:{namedItem:name=>inputs.get(name)},querySelector(selector){if(selector==='[type=submit]')return submit;return inputs.get(selector.match(/\[name=["']?([^\]"']+)/)?.[1])||null;},data(){return {get:name=>inputs.get(name)?.value??null,has:name=>inputs.has(name)&&(name!=='enabled'||inputs.get(name).checked),getAll:name=>inputs.has(name)?[inputs.get(name).value]:[]};}};
}
function formFromMarkup(markup){
 const values={};for(const match of markup.matchAll(/<input\b([^>]+)>/g)){const name=match[1].match(/name="([^"]+)"/)?.[1];if(!name||name==='weekdays'||name==='enabled'&&!/\schecked(?:\s|$)/.test(match[1]))continue;values[name]=decode(match[1].match(/value="([^"]*)"/)?.[1]??'on');}
 values.kind=markup.match(/<option value="([^"]+)" selected/)?.[1]||'once';values.prompt=decode(markup.match(/<textarea[^>]*name="prompt"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]||'');return makeForm(values);
}
function fill(form,changes){for(const [name,value]of Object.entries(changes)){if(name==='enabled'){form.inputs.set(name,{value:'on',checked:Boolean(value)});}else form.inputs.get(name).value=value;}return form;}
const pending=ui=>Object.values(ui.shared.state.liveHarness.workflowSaves||{});
async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-rejected-save-')),store=await new HarnessStore({dataDir}).init();
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false,clock:()=>new Date('2026-10-18T12:00:00Z')}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 function mount({shared={state:{liveHarness:{serverIds:{}}}},fault=null}={}){
  let version=0,form=null,snapshot={queue:[],schedules:[],runs:[],workflow:{}},faulted=false,refreshFault=null;
  const calls=[],errors=[],commits=[],errorNode={textContent:''};
  const host={esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),getState:()=>shared.state,getConversationKey:()=>'A',getDialogVersion:()=>version,draftAttachments:()=>[],closePopover(){},app:{querySelector:()=>null},overlay:{open:true,querySelector:selector=>selector==='[data-live-routine-error]'?errorNode:form?.querySelector(selector)||null,querySelectorAll:()=>[],contains:node=>node===form},commit(fn,{reason}){const next=fn(shared.state),removesIntent=Object.keys(next.liveHarness.workflowSaves||{}).length<Object.keys(shared.state.liveHarness.workflowSaves||{}).length;commits.push({reason,removesIntent});if(shared.failClear&&removesIntent)return {ok:false};shared.state=next;return {ok:true};},showDialog(kind,label,markup){version++;host.overlay.open=true;errorNode.textContent='';if(form)form.isConnected=false;form=markup.includes('<form')?formFromMarkup(markup):null;},closeDialog(){version++;host.overlay.open=false;if(form)form.isConnected=false;form=null;}};
  function serverId(id='A'){shared.state.liveHarness.serverIds[id]??='server-'+id;return shared.state.liveHarness.serverIds[id];}
  async function refresh(){if(refreshFault){const error=refreshFault;refreshFault=null;throw error;}const state=store.get(owner,conversation);if(state)snapshot=store.snapshot(state);}
  async function invoke(kind,canonicalId,id,command){
   calls.push({kind,canonicalId,id,command:structuredClone(command)});
   if(fault==='conflict'&&!faulted){faulted=true;await engine.createSchedule(owner,canonicalId,{...command,title:'OTHER_ACCEPTED_TITLE'});}
   const result=kind==='create'?await engine.createSchedule(owner,canonicalId,command):await engine.scheduleAction(owner,canonicalId,id,'edit',command);
   if(!faulted&&(fault==='network'||fault==='503')){faulted=true;throw fault==='network'?Object.assign(new TypeError('Owned lost network reply after durable acceptance'),{retryable:false}):harnessError('OWNED_GATEWAY_FAILURE','Owned 503 after durable acceptance',503,false);}
   return result;
  }
  const client={createSchedule:(canonicalId,command)=>invoke('create',canonicalId,'',command),scheduleAction:(canonicalId,id,action,command)=>invoke(action,canonicalId,id,command)};
  const surface=createLiveWorkflowsSurface({host,client,key:()=>'A',serverId,isLive:()=>true,snapshot:()=>snapshot,refresh,setError:(id,error)=>errors.push({id,message:error.message,code:error.code,retryable:error.retryable}),activeRun:()=>null});
  return {shared,host,surface,calls,errors,commits,errorNode,refresh,failNextRefresh(error){refreshFault=error;},get form(){return form;},submit(){return surface.handleSubmit({submit:'live-workflow-save',form,data:form.data()});},open(id){surface.handleAction({action:id?'live-workflow-edit':'live-workflow-new',id});return form;}};
 }
 async function durable(){return JSON.parse(await readFile(path.join(dataDir,'conversation-'+conversation+'.json'),'utf8'));}
 return {store,engine,mount,durable};
}
function createInput(ui,changes={}){return fill(ui.open(),{title:'CORRECTABLE_TITLE',prompt:'OWNED_PROMPT',at:future,zone:'Europe/Amsterdam',enabled:true,...changes});}

test('real past-instant create rejection releases its intent and corrected input admits exactly one durable job',async t=>{
 const f=await fixture(t),ui=f.mount(),form=createInput(ui,{at:past});await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_SCHEDULE');assert.match(ui.errorNode.textContent,/future one-time instant/);assert.equal(f.store.get(owner,conversation),undefined);
 assert.equal(ui.form,form);assert.equal(form.inputs.get('at').value,past);assert.equal(form.inputs.get('prompt').value,'OWNED_PROMPT');assert.equal(pending(ui).length,0,'The server conclusively rejected this original create');
 fill(form,{at:future,title:'CORRECTED_TITLE'});await ui.submit();
 assert.equal(ui.calls.length,2);assert.notEqual(ui.calls[1].command.requestId,ui.calls[0].command.requestId);assert.equal(pending(ui).length,0);
 const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].title,'CORRECTED_TITLE');assert.equal(disk.schedules[0].rule.at,'2026-10-20T09:00:00.000Z');assert.equal(disk.schedules[0].enabled,true);assert.equal(disk.schedules[0].revision,1);assert.equal(Object.keys(disk.requests).filter(key=>key.startsWith('workflow-schedule-create:')).length,1);
});

test('real invalid-IANA-zone rejection permits a corrected zone with a fresh create identity',async t=>{
 const f=await fixture(t),ui=f.mount(),form=createInput(ui,{zone:'Owned/InvalidZone'});await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_SCHEDULE');assert.match(ui.errorNode.textContent,/valid IANA timeZone/);assert.equal(form.inputs.get('zone').value,'Owned/InvalidZone');assert.equal(pending(ui).length,0);
 fill(form,{zone:'UTC'});await ui.submit();assert.equal(ui.calls.length,2);assert.notEqual(ui.calls[0].command.requestId,ui.calls[1].command.requestId);assert.equal(pending(ui).length,0);const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].rule.timeZone,'UTC');
});

test('rejected enabled edit leaves canonical revision untouched and correction advances the same schedule once',async t=>{
 const f=await fixture(t),seed=await f.engine.createSchedule(owner,conversation,{requestId:'seed-edit',title:'EDIT_TITLE',payload:{text:'BEFORE_EDIT',quote:'FROZEN_QUOTE',skillReferences:['FROZEN_SKILL']},rule:{kind:'once',at:future,timeZone:'Europe/Amsterdam'},enabled:true}),ui=f.mount();
 await ui.refresh();const form=fill(ui.open(seed.schedule.id),{at:past,prompt:'CORRECTED_EDIT_PROMPT'});await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_SCHEDULE');assert.deepEqual((await f.durable()).schedules[0],seed.schedule);assert.equal(ui.form,form);assert.equal(form.inputs.get('prompt').value,'CORRECTED_EDIT_PROMPT');assert.equal(pending(ui).length,0);
 fill(form,{at:future,zone:'UTC'});await ui.submit();const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].id,seed.schedule.id);assert.equal(disk.schedules[0].revision,2);assert.equal(disk.schedules[0].enabled,true);assert.equal(disk.schedules[0].payload.text,'CORRECTED_EDIT_PROMPT');assert.equal(disk.schedules[0].payload.quote,'FROZEN_QUOTE');assert.deepEqual(disk.schedules[0].payload.skillReferences,['FROZEN_SKILL']);assert.equal(disk.schedules[0].rule.timeZone,'UTC');assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].command.expectedRevision,1);assert.notEqual(ui.calls[0].command.requestId,ui.calls[1].command.requestId);assert.equal(pending(ui).length,0);
});

test('close and remount after a definitive rejection cannot resurrect a blocking rejected create',async t=>{
 const f=await fixture(t),ui=f.mount();createInput(ui,{at:past});await ui.submit();assert.equal(ui.errors.at(-1).code,'INVALID_SCHEDULE');const rejectedId=ui.calls[0].command.requestId;
 ui.host.closeDialog();ui.surface.destroy();const reloaded=f.mount({shared:JSON.parse(JSON.stringify(ui.shared))});createInput(reloaded,{title:'AFTER_REMOUNT'});await reloaded.submit();
 assert.equal(f.store.get(owner,conversation)?.schedules.length||0,1,'Corrected input after remount must admit one canonical schedule');const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].title,'AFTER_REMOUNT');assert.equal(reloaded.calls.length,1);assert.notEqual(reloaded.calls[0].command.requestId,rejectedId);assert.equal(pending(reloaded).length,0);
});

test('INVALID_SCHEDULE from refresh after accepted create cannot release or replace the accepted original intent',async t=>{
 const f=await fixture(t),ui=f.mount(),form=createInput(ui);ui.failNextRefresh(harnessError('INVALID_SCHEDULE','Owned snapshot refresh failure after accepted create',422));await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_SCHEDULE');assert.equal((await f.durable()).schedules.length,1);assert.equal(pending(ui).length,1,'An unrelated later refresh error cannot prove nonadmission');const original=structuredClone(ui.calls[0].command);
 fill(form,{title:'CHANGED_AFTER_ACCEPTANCE',prompt:'NEWER_PROMPT'});await ui.submit();assert.equal(ui.calls.length,1);assert.equal(ui.form,form);assert.equal(form.inputs.get('prompt').value,'NEWER_PROMPT');assert.equal((await f.durable()).schedules.length,1);
 ui.host.closeDialog();ui.surface.destroy();const reloaded=f.mount({shared:ui.shared});await reloaded.refresh();reloaded.open();await reloaded.submit();assert.deepEqual(reloaded.calls[0].command,original);assert.equal((await f.durable()).schedules.length,1);assert.equal(pending(reloaded).length,0);
});

for(const fault of ['network','503','conflict'])test('ambiguous '+fault+' failure stays pinned even when retryable is false',async t=>{
 const f=await fixture(t),ui=f.mount({fault}),form=createInput(ui);await ui.submit();assert.equal((await f.durable()).schedules.length,1);assert.equal(pending(ui).length,1);assert.equal(ui.errors[0].retryable,false);if(fault==='conflict')assert.equal(ui.errors[0].code,'IDEMPOTENCY_CONFLICT');
 const original=structuredClone(pending(ui)[0]);fill(form,{title:'DIFFERENT_UNCONFIRMED_TITLE'});await ui.submit();assert.equal(ui.calls.length,1,'Changed input cannot dispatch a replacement for an unresolved RPC');assert.deepEqual(pending(ui),[original]);assert.equal((await f.durable()).schedules.length,1);assert.equal(form.inputs.get('title').value,'DIFFERENT_UNCONFIRMED_TITLE');
});

test('failed durable rejection cleanup reports unsaved recovery without claiming the rejected routine was received',async t=>{
 const f=await fixture(t),ui=f.mount();ui.shared.failClear=true;const form=createInput(ui,{at:past});await ui.submit();
 assert.equal(f.store.get(owner,conversation),undefined);assert.equal(pending(ui).length,1);assert.ok(ui.errors.some(error=>/opgeslagen|opslag|bewar/i.test(error.message)),'A failed cleanup must remain visible');assert.ok(ui.errors.every(error=>!/routine is ontvangen/i.test(error.message)),'A rejected create has no acceptance receipt');assert.doesNotMatch(ui.errorNode.textContent,/routine is ontvangen/i);
 fill(form,{at:future});await ui.submit();assert.equal(ui.calls.length,1,'Do not forget an intent whose cleanup could not be persisted');assert.equal(pending(ui).length,1);
 fill(form,{at:past});ui.shared.failClear=false;await ui.submit();assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].command.requestId,ui.calls[0].command.requestId);assert.equal(pending(ui).length,0);fill(form,{at:future});await ui.submit();assert.equal(ui.calls.length,3);assert.notEqual(ui.calls[2].command.requestId,ui.calls[0].command.requestId);assert.equal((await f.durable()).schedules.length,1);assert.equal(pending(ui).length,0);
});

// Real production controller + WorkflowEngine + fsync-backed HarnessStore.
// The only injected error is a later snapshot failure after actual admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {HarnessStore,harnessError} from '../harness/store.mjs';

const owner='owned-rejected-text',conversation='server-A',future='2026-10-20T09:00:00Z';
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function makeForm(values){
 const inputs=new Map(Object.entries(values).map(([name,value])=>[name,{value:String(value),checked:name==='enabled'}])),submit={disabled:false,isConnected:true};
 return {dataset:{},isConnected:true,inputs,elements:{namedItem:name=>inputs.get(name)},querySelector(selector){if(selector==='[type=submit]')return submit;return inputs.get(selector.match(/\[name=["']?([^\]"']+)/)?.[1])||null;},data(){return {get:name=>inputs.get(name)?.value??null,has:name=>inputs.has(name)&&(name!=='enabled'||inputs.get(name).checked),getAll:name=>inputs.has(name)?[inputs.get(name).value]:[]};}};
}
function formFromMarkup(markup){
 const values={};for(const match of markup.matchAll(/<input\b([^>]+)>/g)){const name=match[1].match(/name="([^"]+)"/)?.[1];if(!name||name==='weekdays'||name==='enabled'&&!/\schecked(?:\s|$)/.test(match[1]))continue;values[name]=decode(match[1].match(/value="([^"]*)"/)?.[1]??'on');}
 values.kind=markup.match(/<option value="([^"]+)" selected/)?.[1]||'once';values.prompt=decode(markup.match(/<textarea[^>]*name="prompt"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]||'');return makeForm(values);
}
function fill(form,changes){for(const [name,value]of Object.entries(changes)){if(name==='enabled')form.inputs.set(name,{value:'on',checked:Boolean(value)});else form.inputs.get(name).value=value;}return form;}
const pending=ui=>Object.values(ui.shared.state.liveHarness.workflowSaves||{});
async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-rejected-text-')),store=await new HarnessStore({dataDir}).init();
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false,clock:()=>new Date('2026-10-18T12:00:00Z')}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 function mount({shared={state:{liveHarness:{serverIds:{}}}}}={}){
  let version=0,form=null,snapshot={queue:[],schedules:[],runs:[],workflow:{}},refreshFault=null;
  const calls=[],errors=[],errorNode={textContent:''};
  const host={esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),getState:()=>shared.state,getConversationKey:()=>'A',getDialogVersion:()=>version,draftAttachments:()=>[],closePopover(){},app:{querySelector:()=>null},overlay:{open:true,querySelector:selector=>selector==='[data-live-routine-error]'?errorNode:form?.querySelector(selector)||null,querySelectorAll:()=>[],contains:node=>node===form},commit(fn){shared.state=fn(shared.state);return {ok:true};},showDialog(kind,label,markup){version++;host.overlay.open=true;errorNode.textContent='';if(form)form.isConnected=false;form=markup.includes('<form')?formFromMarkup(markup):null;},closeDialog(){version++;host.overlay.open=false;if(form)form.isConnected=false;form=null;}};
  function serverId(id='A'){shared.state.liveHarness.serverIds[id]??='server-'+id;return shared.state.liveHarness.serverIds[id];}
  async function refresh(){if(refreshFault){const error=refreshFault;refreshFault=null;throw error;}const state=store.get(owner,conversation);if(state)snapshot=store.snapshot(state);}
  async function invoke(kind,canonicalId,id,command){calls.push({kind,canonicalId,id,command:structuredClone(command)});return kind==='create'?engine.createSchedule(owner,canonicalId,command):engine.scheduleAction(owner,canonicalId,id,'edit',command);}
  const client={createSchedule:(canonicalId,command)=>invoke('create',canonicalId,'',command),scheduleAction:(canonicalId,id,action,command)=>invoke(action,canonicalId,id,command)};
  const surface=createLiveWorkflowsSurface({host,client,key:()=>'A',serverId,isLive:()=>true,snapshot:()=>snapshot,refresh,setError:(id,error)=>errors.push({id,message:error.message,code:error.code,status:error.status}),activeRun:()=>null});
  return {shared,host,surface,calls,errors,errorNode,refresh,failNextRefresh(error){refreshFault=error;},get form(){return form;},submit(){return surface.handleSubmit({submit:'live-workflow-save',form,data:form.data()});},open(id){surface.handleAction({action:id?'live-workflow-edit':'live-workflow-new',id});return form;}};
 }
 async function durable(){return JSON.parse(await readFile(path.join(dataDir,'conversation-'+conversation+'.json'),'utf8'));}
 return {store,engine,mount,durable};
}
function createInput(ui,changes={}){return fill(ui.open(),{title:'CORRECTABLE_TEXT_TITLE',prompt:'VALID_ORIGINAL_PROMPT',at:future,zone:'Europe/Amsterdam',enabled:true,...changes});}

test('actual whitespace create INVALID_TEXT rejection allows one corrected durable job with a new request',async t=>{
 const f=await fixture(t),ui=f.mount(),form=createInput(ui,{prompt:'   '});await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_TEXT');assert.equal(ui.errors.at(-1).status,422);assert.match(ui.errorNode.textContent,/Prompt text or ready uploaded attachments required/);assert.equal(f.store.get(owner,conversation),undefined);assert.equal(ui.form,form);assert.equal(form.inputs.get('prompt').value,'   ');assert.equal(ui.calls[0].command.payload.text,'   ');
 fill(form,{prompt:'CORRECTED_NONEMPTY_PROMPT'});await ui.submit();
 assert.equal(f.store.get(owner,conversation)?.schedules.length||0,1,'Correcting definitively rejected text must admit one schedule');assert.equal(ui.calls.length,2);assert.notEqual(ui.calls[1].command.requestId,ui.calls[0].command.requestId);assert.equal(pending(ui).length,0);
 const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].payload.text,'CORRECTED_NONEMPTY_PROMPT');assert.equal(disk.schedules[0].enabled,true);assert.equal(disk.schedules[0].revision,1);assert.equal(Object.keys(disk.requests).filter(key=>key.startsWith('workflow-schedule-create:')).length,1);
});

test('actual whitespace enabled edit rejection preserves canonical data then corrects the same schedule exactly once',async t=>{
 const f=await fixture(t),seed=await f.engine.createSchedule(owner,conversation,{requestId:'seed-text-edit',title:'TEXT_EDIT_TITLE',payload:{text:'BEFORE_TEXT_EDIT',quote:'FROZEN_QUOTE',skillReferences:['FROZEN_SKILL']},rule:{kind:'once',at:future,timeZone:'Europe/Amsterdam'},enabled:true}),ui=f.mount();
 await ui.refresh();const form=fill(ui.open(seed.schedule.id),{prompt:'   '});await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_TEXT');assert.equal(ui.errors.at(-1).status,422);assert.deepEqual((await f.durable()).schedules[0],seed.schedule);assert.equal(ui.form,form);assert.equal(form.inputs.get('prompt').value,'   ');assert.equal(ui.calls[0].command.payload.text,'   ');
 fill(form,{prompt:'CORRECTED_EDIT_PROMPT'});await ui.submit();const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].id,seed.schedule.id);assert.equal(disk.schedules[0].revision,2,'A corrected rejected edit advances canonical revision exactly once');assert.equal(disk.schedules[0].enabled,true);assert.equal(disk.schedules[0].payload.text,'CORRECTED_EDIT_PROMPT');assert.equal(disk.schedules[0].payload.quote,'FROZEN_QUOTE');assert.deepEqual(disk.schedules[0].payload.skillReferences,['FROZEN_SKILL']);assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].command.expectedRevision,1);assert.notEqual(ui.calls[0].command.requestId,ui.calls[1].command.requestId);assert.equal(pending(ui).length,0);
});

test('INVALID_TEXT from postaccepted refresh keeps the original intent and blocks changed input until exact receipt replay',async t=>{
 const f=await fixture(t),ui=f.mount(),form=createInput(ui);ui.failNextRefresh(harnessError('INVALID_TEXT','Owned later snapshot failure after accepted create',422));await ui.submit();
 assert.equal(ui.errors.at(-1).code,'INVALID_TEXT');assert.equal((await f.durable()).schedules.length,1);assert.equal(pending(ui).length,1,'A later snapshot failure cannot establish mutation rejection');const original=structuredClone(ui.calls[0].command);
 fill(form,{title:'CHANGED_AFTER_ACCEPTANCE',prompt:'NEWER_UNSAVED_PROMPT'});await ui.submit();assert.equal(ui.calls.length,1);assert.equal(ui.form,form);assert.equal(form.inputs.get('prompt').value,'NEWER_UNSAVED_PROMPT');assert.equal((await f.durable()).schedules.length,1);assert.deepEqual(pending(ui)[0].command,original);
 ui.host.closeDialog();ui.surface.destroy();const reloaded=f.mount({shared:JSON.parse(JSON.stringify(ui.shared))});await reloaded.refresh();reloaded.open();await reloaded.submit();assert.equal(reloaded.calls.length,1);assert.deepEqual(reloaded.calls[0].command,original);const disk=await f.durable();assert.equal(disk.schedules.length,1);assert.equal(disk.schedules[0].payload.text,'VALID_ORIGINAL_PROMPT');assert.equal(disk.schedules[0].revision,1);assert.equal(pending(reloaded).length,0);
});

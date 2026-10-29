// Ownership regressions exercise the real frontend surface and durable workflow engine.
// The host is a narrow non-DOM adapter; provider dispatch is deliberately occupied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {HarnessStore} from '../harness/store.mjs';

const owner='owned-frontend-regression';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const values=(extra={})=>({scheduleId:'',revision:'',kind:'once',zone:'Europe/Amsterdam',at:'2026-10-20T09:00:00Z',title:'Owned exact routine',prompt:'OWNED_SYNTHETIC_TASK',enabled:'on',...extra});
function makeForm(initial){
 const fields=new Map(Object.entries(initial).map(([name,value])=>[name,{value:String(value),checked:name==='enabled'}]));
 const submit={disabled:false,isConnected:true};
 return {dataset:{},isConnected:true,fields,elements:{namedItem:name=>fields.get(name)},querySelector(selector){if(selector==='[type=submit]')return submit;const name=selector.match(/\[name=["']?([^\]"']+)/)?.[1];return fields.get(name)||null;},data(){return {get:name=>fields.get(name)?.value??null,has:name=>fields.has(name)&&(name!=='enabled'||fields.get(name).checked),getAll:name=>fields.has(name)?[fields.get(name).value]:[]};}};
}
function parseForm(markup){
 const result={};
 for(const match of markup.matchAll(/<input\b([^>]+)>/g)){const name=match[1].match(/name="([^"]+)"/)?.[1];if(!name||name==='weekdays')continue;if(name==='enabled'&&!/\schecked(?:\s|$)/.test(match[1]))continue;result[name]=decode(match[1].match(/value="([^"]*)"/)?.[1]||'on');}
 result.kind=markup.match(/<option value="([^"]+)" selected/)?.[1]||'once';
 result.prompt=decode(markup.match(/<textarea[^>]*name="prompt"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]||'');
 // The production field is called zone; the exact values remain readable by save().
 return makeForm(result);
}
async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-ownership-node-'));
 const store=await new HarnessStore({dataDir}).init();
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false,clock:()=>new Date('2026-10-18T12:00:00Z')}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 const canonical=id=>store.get(owner,'server-'+id);
 const body=requestId=>({requestId,title:'Owned exact routine',payload:{text:'OWNED_SYNTHETIC_TASK'},rule:{kind:'once',at:'2026-10-20T09:00:00Z',timeZone:'Europe/Amsterdam'},enabled:false});
 function mount(selected='A',shared={state:{liveHarness:{}},current:selected}){
  const snapshots=new Map(),errors=[],calls=[];let version=0,dialog=null,currentForm=null;
  const errorNode={textContent:''};
  const host={esc,app:{querySelector:()=>null},overlay:{open:true,querySelector:selector=>selector==='[data-live-routine-error]'?errorNode:currentForm?.querySelector(selector)||null,querySelectorAll:()=>[],contains:node=>node===currentForm},getState:()=>shared.state,getConversationKey:()=>shared.current,getDialogVersion:()=>version,commit:fn=>{shared.state=fn(shared.state);return {ok:true};},draftAttachments:()=>[],closePopover(){},closeDialog(){version++;host.overlay.open=false;if(currentForm)currentForm.isConnected=false;currentForm=null;},showDialog(kind,label,markup){version++;host.overlay.open=true;if(currentForm)currentForm.isConnected=false;dialog={kind,label,markup};currentForm=markup.includes('<form')?parseForm(markup):null;},ensureConversation(){if(shared.current==='new')shared.current='promoted';return {id:shared.current};}};
  const key=()=>shared.current,serverId=(id=key())=>'server-'+id,snapshot=(id=key())=>snapshots.get(id)||{queue:[],runs:[],schedules:[],workflow:{}};
  async function refresh(id=key()){calls.push(['refresh',id]);if(id==='new')return;const state=canonical(id);snapshots.set(id,state?store.snapshot(state):{queue:[],runs:[],schedules:[],workflow:{}});}
  const client={createSchedule:async(id,command)=>{calls.push(['create',id,structuredClone(command)]);return engine.createSchedule(owner,id,command);},scheduleAction:async(id,scheduleId,action,command)=>{calls.push(['action',id,scheduleId,action,structuredClone(command)]);return engine.scheduleAction(owner,id,scheduleId,action,command);}};
  const surface=createLiveWorkflowsSurface({host,client,key,serverId,isLive:()=>true,snapshot,refresh,setError:(id,error)=>errors.push({id,code:error.code,message:error.message}),activeRun:()=>null});
  const submit=form=>surface.handleSubmit({submit:'live-workflow-save',form,data:form.data()});
  return {surface,host,client,key,snapshot,refresh,errors,calls,shared,submit,get dialog(){return dialog;},get form(){return currentForm;},get version(){return version;},switchTo:id=>{shared.current=id;}};
 }
 return {store,engine,canonical,body,mount};
}

test('planning on the live landing promotes ownership before persisting an enabled routine',async t=>{
 const f=await fixture(t),ui=f.mount('new');
 ui.surface.handleAction({action:'live-workflow-new'});
 await ui.submit(makeForm(values()));
 assert.notEqual(ui.key(),'new','A real routine must belong to a visible promoted conversation');
 assert.equal(f.canonical(ui.key())?.schedules.length,1);
 assert.equal(f.canonical(ui.key()).schedules[0].enabled,true);
 assert.equal(ui.snapshot().schedules[0].title,'Owned exact routine');
 assert.equal(f.canonical('new')?.schedules.length||0,0,'No executable schedule may be orphaned under the landing address');
});

test('lost durable schedule-save ACK recovers the same intent after close reopen and remount',async t=>{
 const f=await fixture(t),ui=f.mount('A');
 const original=ui.client.createSchedule;ui.client.createSchedule=async(...args)=>{await original(...args);throw new TypeError('Response lost after durable acceptance');};
 ui.surface.handleAction({action:'live-workflow-new'});await ui.submit(makeForm(values()));
 assert.equal(f.canonical('A').schedules.length,1,'The first request reached the actual durable store');
 ui.host.closeDialog();ui.surface.destroy();
 const reloaded=f.mount('A',ui.shared);
 await reloaded.refresh();reloaded.surface.handleAction({action:'live-workflow-new'});
 await reloaded.submit(makeForm(values()));
 assert.equal(f.canonical('A').schedules.length,1,'An unresolved accepted save must be recovered, not create another enabled routine');
 assert.equal(f.canonical('A').schedules[0].enabled,true);
});

test('late routine save completion keeps a different conversation and its newer unsaved form',async t=>{
 const f=await fixture(t),ui=f.mount('A'),accepted=deferred(),release=deferred();
 const original=ui.client.createSchedule;ui.client.createSchedule=async(...args)=>{const result=await original(...args);accepted.resolve();await release.promise;return result;};
 ui.surface.handleAction({action:'live-workflow-new'});const pending=ui.submit(makeForm(values()));
 await accepted.promise;
 ui.host.closeDialog();ui.switchTo('B');ui.surface.handleAction({action:'live-workflow-new'});
 ui.form.fields.get('title').value='NEWER_UNSAVED_B_TITLE';ui.form.fields.get('prompt').value='NEWER_UNSAVED_B_PROMPT';
 const version=ui.version,newForm=ui.form;release.resolve();await pending;
 assert.equal(ui.key(),'B');
 assert.equal(ui.version,version,'The old completion must not replace the current dialog');
 assert.equal(ui.form,newForm);assert.equal(ui.form.fields.get('title').value,'NEWER_UNSAVED_B_TITLE');assert.equal(ui.form.fields.get('prompt').value,'NEWER_UNSAVED_B_PROMPT');
 assert.equal(f.canonical('A').schedules.length,1);assert.equal(f.canonical('B')?.schedules.length||0,0);
});

test('revision conflict refreshes canonical ownership and preserves edits for a successful retry',async t=>{
 const f=await fixture(t),created=await f.engine.createSchedule(owner,'server-A',f.body('seed')),ui=f.mount('A');
 await ui.refresh();ui.surface.handleAction({action:'live-workflow-edit',id:created.schedule.id});
 ui.form.fields.get('prompt').value='RETAIN_THIS_LOCAL_EDIT';
 await f.engine.scheduleAction(owner,'server-A',created.schedule.id,'pause',{requestId:'other-window-pause',expectedRevision:1});
 await ui.submit(ui.form);
 assert.equal(ui.errors.at(-1)?.code,'REVISION_CONFLICT');
 assert.equal(ui.snapshot().schedules[0].revision,2,'Production REVISION_CONFLICT must refresh the canonical revision');
 assert.equal(ui.form.fields.get('prompt').value,'RETAIN_THIS_LOCAL_EDIT','Refreshing must retain unsaved input');
 await ui.submit(ui.form);
 assert.equal(f.canonical('A').schedules[0].revision,3);
 assert.equal(f.canonical('A').schedules[0].payload.text,'RETAIN_THIS_LOCAL_EDIT');
});

// Historical protocol adapter coverage, not current product-provider execution.
// Real production surface/engine/disk and HTTP/native-protocol regressions.
// The explicit protocol fixture is not installed-provider execution evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HarnessStore} from '../harness/store.mjs';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {createLegacyHarnessHandler as createHarnessHandler} from './fixtures/legacy-runtime.mjs';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';

const owner='owned-edit-enabled',conversation='edit-enabled';
const once=at=>({kind:'once',at,timeZone:'Europe/Amsterdam'});
const future=once('2026-10-20T09:00:00.000Z');
const createBody=enabled=>({requestId:'create',title:'Edit enabled regression',payload:{text:'OWNED_EDIT_ENABLED',quote:'immutable quote',skillReferences:['owned skill']},rule:future,enabled});
const editBody=(row,extra={})=>({requestId:'edit',expectedRevision:row.revision,title:row.title,payload:structuredClone(row.payload),rule:structuredClone(row.rule),...extra});
const rejects=(promise,code,status)=>assert.rejects(promise,error=>error.code===code&&error.status===status);

async function engineFixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'edit-enabled-engine-'));
 const store=await new HarnessStore({dataDir}).init();let clock='2026-10-18T12:00:00.000Z';
 // Occupied provider prevents dispatch; the production scheduler still admits real occurrences.
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false,clock:()=>new Date(clock)}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 const current=()=>store.get(owner,conversation);
 return {store,engine,current,setTime:value=>{clock=value;},disk:async()=>JSON.parse(await readFile(path.join(dataDir,'conversation-'+conversation+'.json'),'utf8')),
  create:async enabled=>(await engine.createSchedule(owner,conversation,createBody(enabled))).schedule,
  edit:(row,command)=>engine.scheduleAction(owner,conversation,row.id,'edit',command)};
}

function mountSurface(f){
 let local={liveHarness:{}},snapshot=f.store.snapshot(f.current()),dialog,version=0;
 const errors=[],commands=[],button={disabled:false,isConnected:true};
 const host={esc:value=>String(value??''),app:{querySelector:()=>null},overlay:{open:true,querySelector:()=>({textContent:''}),querySelectorAll:()=>[]},getState:()=>local,getConversationKey:()=>conversation,getDialogVersion:()=>version,commit:mutate=>{local=mutate(local);return {ok:true};},draftAttachments:()=>[],closePopover(){},showDialog(kind,label,markup){version++;dialog={kind,label,markup};}};
 const client={scheduleAction:async(id,scheduleId,action,command)=>{commands.push(structuredClone(command));return f.engine.scheduleAction(owner,id,scheduleId,action,command);}};
 const surface=createLiveWorkflowsSurface({host,client,key:()=>conversation,serverId:()=>conversation,isLive:()=>true,snapshot:()=>snapshot,refresh:async()=>{snapshot=f.store.snapshot(f.current());},setError:(id,error)=>errors.push(error.message),activeRun:()=>null});
 return {surface,errors,commands,get dialog(){return dialog;},async submit(row,enabled){
  const fields=new Map(Object.entries({scheduleId:row.id,revision:String(row.revision),title:row.title,prompt:row.payload.text,kind:row.rule.kind,at:row.rule.at,zone:row.rule.timeZone,...(enabled?{enabled:'on'}:{})}));
  return surface.handleSubmit({submit:'live-workflow-save',form:{querySelector:()=>button},data:{get:key=>fields.get(key)??null,has:key=>fields.has(key),getAll:key=>fields.has(key)?[fields.get(key)]:[]}});
 }};
}

for(const [initial,desired] of [[false,true],[true,false]])test('actual edit form durably changes enabled '+initial+' to '+desired,async t=>{
 const f=await engineFixture(t),row=await f.create(initial),ui=mountSurface(f);t.after(()=>ui.surface.destroy());
 ui.surface.handleAction({action:'live-workflow-edit',id:row.id});
 assert.match(ui.dialog.markup,/name="enabled"/);assert.match(ui.dialog.markup,/Inschakelen na opslaan/);
 await ui.submit(row,desired);
 assert.deepEqual(ui.errors,[]);assert.equal(ui.commands.length,1);assert.equal(ui.commands[0].enabled,desired);
 const saved=(await f.disk()).schedules[0];
 assert.equal(saved.enabled,desired);assert.equal(saved.status,desired?'enabled':'paused');assert.equal(saved.revision,row.revision+1);
 assert.equal(saved.nextDueAt,desired?future.at:null);assert.deepEqual(saved.payload,row.payload);
 assert.equal(ui.dialog.label,row.title);
 f.setTime('2026-10-20T09:00:00.001Z');await f.engine.tick();
 const queue=(await f.disk()).queue;assert.equal(queue.length,desired?1:0);
 if(desired){assert.equal(queue[0].source.scheduleId,row.id);assert.equal(queue[0].source.scheduleRevision,2);assert.deepEqual(queue[0].payload,row.payload);}
});

test('edit enabled is part of exact receipt identity and stale revisions cannot overwrite',async t=>{
 const f=await engineFixture(t),row=await f.create(true),command=editBody(row,{enabled:false});
 const accepted=await f.edit(row,command);assert.equal(accepted.schedule.revision,2);
 assert.deepEqual(await f.edit(row,structuredClone(command)),accepted);
 await rejects(f.edit(row,{...command,enabled:true}),'IDEMPOTENCY_CONFLICT',409);
 await rejects(f.edit(row,{...command,requestId:'stale'}),'REVISION_CONFLICT',409);
 const updated=(await f.edit(accepted.schedule,editBody(accepted.schedule,{requestId:'later',enabled:true}))).schedule;
 assert.equal(updated.revision,3);assert.equal(updated.enabled,true);
 assert.deepEqual(await f.edit(row,structuredClone(command)),accepted,'Old exact receipt remains original after a later revision');
 assert.equal(f.current().schedules[0].revision,3);
});

test('legacy edit omission retains both enabled states and computes only the enabled next instant',async t=>{
 for(const enabled of [false,true]){
  const f=await engineFixture(t),row=await f.create(enabled),rule=once('2026-10-21T09:00:00.000Z');
  const result=await f.edit(row,editBody(row,{rule}));
  assert.equal(result.schedule.enabled,enabled);assert.equal(result.schedule.status,enabled?'enabled':'paused');
  assert.equal(result.schedule.nextDueAt,enabled?rule.at:null);assert.equal(result.schedule.revision,2);
  assert.deepEqual((await f.disk()).schedules[0],result.schedule);
 }
});

test('supplied nonboolean enabled is rejected without a revision or receipt write',async t=>{
 const f=await engineFixture(t),row=await f.create(false),before=await f.disk();
 for(const [index,enabled] of [null,'false',0,1,{},[]].entries()){
  await rejects(f.edit(row,editBody(row,{requestId:'invalid-'+index,enabled})),'INVALID_SCHEDULE',422);
  assert.deepEqual(await f.disk(),before);
 }
});

test('explicit enabling requires a future occurrence and preserves the old schedule on rejection',async t=>{
 const f=await engineFixture(t),row=await f.create(false),before=await f.disk();
 await rejects(f.edit(row,editBody(row,{enabled:true,rule:once('2026-10-17T09:00:00.000Z')})),'INVALID_SCHEDULE',422);
 assert.deepEqual(await f.disk(),before);
});

async function httpFixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'edit-enabled-http-'));let handler,clock='2026-01-01T10:00:00.000Z',cookie='',csrf='';
 const server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(done=>{if(!done)res.writeHead(404).end();}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl='http://127.0.0.1:'+server.address().port;
 handler=await createHarnessHandler({root:fileURLToPath(new URL('../',import.meta.url)),dataDir,baseUrl,workflowClock:()=>new Date(clock),workflowAutoStart:false,codexBinary:fileURLToPath(new URL('./fixtures/harness-edges-codex-fixture.mjs',import.meta.url))});
 t.after(async()=>{await handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 async function request(route,body){const method=body===undefined?'GET':'POST',response=await fetch(baseUrl+'/api/harness'+route,{method,headers:{cookie,...(body===undefined?{}:{Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};}
 assert.equal((await request('/status')).status,200);
 const route='/conversations/'+conversation;
 return {handler,setTime:value=>{clock=value;},snapshot:async()=>(await request(route)).value,post:(suffix,body)=>request(route+'/'+suffix,body),stop:runId=>request('/runs/'+runId+'/cancel',{requestId:'stop'}),async wait(predicate){const deadline=Date.now()+8000;do{const state=(await request(route)).value;if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,15));}while(Date.now()<deadline);assert.fail('Expected canonical protocol state was not reached');}};
}

test('explicit edit disable cancels never-sent occurrences and leaves the running predecessor alone',async t=>{
 const f=await httpFixture(t),manual=await f.post('runs',{requestId:'manual',text:'FIXTURE_DEFER OWNED_PREDECESSOR'});assert.equal(manual.status,202);
 await f.wait(s=>s.runs[0]?.status==='running');
 const created=await f.post('schedules',{...createBody(true),rule:once('2026-01-01T10:01:00.000Z')});assert.equal(created.status,201);
 f.setTime('2026-01-01T10:02:00.000Z');await f.handler.workflows.tick();
 const before=await f.snapshot();assert.equal(before.queue.length,1);assert.equal(before.queue[0].status,'queued');
 const row=created.value.schedule,response=await f.post('schedules/'+row.id+'/edit',editBody(row,{enabled:false}));assert.equal(response.status,200);
 const disabled=await f.snapshot();assert.equal(disabled.schedules[0].enabled,false);assert.equal(disabled.schedules[0].status,'paused');assert.equal(disabled.schedules[0].nextDueAt,null);
 assert.equal(disabled.queue[0].id,before.queue[0].id);assert.equal(disabled.queue[0].status,'cancelled');assert.equal(disabled.queue[0].runId,undefined);assert.deepEqual(disabled.queue[0].payload,before.queue[0].payload);
 assert.equal(disabled.runs[0].status,'running');assert.deepEqual(response.value.inFlightRunIds,[]);
 assert.equal((await f.stop(manual.value.runId)).status,200);await f.wait(s=>s.runs[0]?.status==='cancelled');
 f.setTime('2026-01-02T12:00:00.000Z');await f.handler.workflows.tick();
 const final=await f.snapshot();assert.equal(final.runs.length,1);assert.equal(final.queue.length,1);assert.equal(final.queue[0].status,'cancelled');
 assert.equal((await f.handler.runtime.connections.get(conversation).rpc.request('test/edges/state',{})).turnStarts.length,1);
});

test('explicit edit disable leaves an already-running scheduled effect until actual Stop',async t=>{
 const f=await httpFixture(t),created=await f.post('schedules',{...createBody(true),payload:{text:'FIXTURE_DEFER OWNED_SCHEDULED_RUN'},rule:once('2026-01-01T10:01:00.000Z')});assert.equal(created.status,201);
 f.setTime('2026-01-01T10:02:00.000Z');await f.handler.workflows.tick();
 const before=await f.wait(s=>s.queue[0]?.status==='running'&&s.runs[0]?.status==='running'),row=created.value.schedule,runId=before.runs[0].id;
 const response=await f.post('schedules/'+row.id+'/edit',editBody(row,{enabled:false}));assert.equal(response.status,200);
 assert.equal(response.value.schedule.enabled,false);assert.equal(response.value.schedule.status,'paused');assert.equal(response.value.schedule.nextDueAt,null);assert.deepEqual(response.value.inFlightRunIds,[runId]);
 f.setTime('2026-01-02T12:00:00.000Z');await f.handler.workflows.tick();
 const disabled=await f.snapshot();assert.equal(disabled.runs.length,1);assert.equal(disabled.runs[0].status,'running');assert.equal(disabled.queue[0].status,'running');assert.equal(disabled.queue[0].runId,runId);
 assert.equal((await f.stop(runId)).status,200);await f.wait(s=>s.runs[0]?.status==='cancelled');
 await f.handler.workflows.tick();assert.equal((await f.snapshot()).queue.length,1);
 assert.equal((await f.handler.runtime.connections.get(conversation).rpc.request('test/edges/state',{})).turnStarts.length,1);
});

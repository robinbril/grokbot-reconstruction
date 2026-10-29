// Production HTTP/store/runtime tests; explicit independent fixture, not provider proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHarnessHandler} from '../harness/http.mjs';
import {createIndependentWorkflowFixture} from './fixtures/independent-workflow-model.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function boot(t,{dataDir,auth,offline=false,clock='2026-01-01T10:00:00Z'}={}){
 dataDir??=await mkdtemp(path.join(tmpdir(),'workflow-http-'));let current=new Date(clock),handler;
 const server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(done=>{if(!done)res.writeHead(404).end();}).catch(e=>res.writeHead(500).end(JSON.stringify({error:{message:e.message}}))));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const baseUrl='http://127.0.0.1:'+server.address().port;
 const fixture=createIndependentWorkflowFixture({offline});
 handler=await createHarnessHandler({root,dataDir,baseUrl,model:fixture.model,toolHostFactory:fixture.toolHostFactory,workflowClock:()=>new Date(current),workflowAutoStart:false});let cookie=auth?.cookie||'',csrf=auth?.csrf||'';
 async function request(route,{method='GET',body,headers={}}={}){const res=await fetch(baseUrl+'/api/harness'+route,{method,headers:{cookie,...(method!=='GET'?{Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];let value;try{value=await res.json();}catch{value=null;}if(value?.csrfToken)csrf=value.csrfToken;return {status:res.status,value};}
 assert.equal((await request('/status')).status,200);let closed=false;
 const app={handler,dataDir,request,baseUrl,fixture,get auth(){return {cookie,csrf};},get owner(){return cookie.split('=')[1];},setTime:value=>{current=new Date(value);},async close(keep=false){if(closed)return;closed=true;await handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!keep)await rm(dataDir,{recursive:true,force:true});}};t.after(()=>app.close());return app;
}
const post=(a,id,route,body)=>a.request('/conversations/'+id+'/'+route,{method:'POST',body}),snapshot=async(a,id)=>(await a.request('/conversations/'+id)).value,input=(requestId,text=requestId)=>({requestId,text}),row=(s,id)=>s.queue?.find(q=>q.id===id);
async function enqueue(a,id,body){const r=await post(a,id,'queue',body);assert.equal(r.status,202,JSON.stringify(r));assert.equal(r.value.accepted,true);assert.equal(r.value.status,'queued');assert.equal(typeof r.value.queueId,'string');return r.value;}
async function stateUntil(a,id,predicate,reason){const deadline=Date.now()+8000;let value;do{value=await snapshot(a,id);if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,15));}while(Date.now()<deadline);assert.fail(reason+' '+JSON.stringify(value));}
async function schedule(a,id,body){const r=await post(a,id,'schedules',body);assert.equal(r.status,201,JSON.stringify(r));return r.value.schedule;}
const once=at=>({kind:'once',at,timeZone:'Europe/Amsterdam'}),spec=(requestId,rule,text='scheduled payload')=>({requestId,title:'Owned schedule '+requestId,payload:{text},rule,enabled:true});
async function action(a,id,s,kind,extra={}){const r=await post(a,id,'schedules/'+s.id+'/'+kind,{requestId:kind+'-'+s.revision+'-'+s.id,expectedRevision:s.revision,...extra});assert.equal(r.status,200,JSON.stringify(r));return r.value;}

test('queue accepts durable immutable context offline and replay never duplicates',async t=>{
 const a=await boot(t,{offline:true}),id='offline',body={...input('constructor','frozen'),quote:'quote',skillReferences:['skill']};const receipt=await enqueue(a,id,body);assert.deepEqual(await enqueue(a,id,structuredClone(body)),receipt);
 const saved=JSON.parse(await readFile(path.join(a.dataDir,'conversation-'+id+'.json'),'utf8'));assert.equal(saved.queue.length,1);assert.deepEqual(saved.queue[0].payload,{text:'frozen',quote:'quote',skillReferences:['skill']});assert.equal(a.handler.runtime.connections.size,0);
 for(const change of [{text:'changed'},{quote:'changed'},{skillReferences:['changed']}]){const r=await post(a,id,'queue',{...body,...change});assert.equal(r.status,409);assert.equal(r.value.error.code,'IDEMPOTENCY_CONFLICT');}
});
test('approval occupies first FIFO run, failure then completion advance exactly once',async t=>{
 const a=await boot(t),id='fifo',q1=await enqueue(a,id,input('a','FIXTURE_APPROVAL A'));let s=await stateUntil(a,id,s=>s.runs.some(r=>r.status==='waiting_approval'),'native approval');const first=s.runs.find(r=>r.status==='waiting_approval'),q2=await enqueue(a,id,input('b','FIXTURE_FAIL B')),q3=await enqueue(a,id,input('c','C unique'));
 s=await snapshot(a,id);assert.equal(s.runs.length,1);assert.equal(row(s,q2.queueId).status,'queued');assert.equal(row(s,q3.queueId).status,'queued');const r=await a.request('/runs/'+first.id+'/approvals/'+first.approvals[0].id+'/decision',{method:'POST',body:{requestId:'reject',decision:'reject'}});assert.equal(r.status,200);
 s=await stateUntil(a,id,s=>row(s,q3.queueId)?.status==='completed','FIFO finish');assert.deepEqual(s.queue.map(q=>q.id),[q1.queueId,q2.queueId,q3.queueId]);assert.deepEqual(s.queue.map(q=>q.status),['completed','failed','completed']);const native=a.fixture.latest();assert.equal(native.turnStarts.length,3);assert.ok(native.turnStarts[1].input[0].text.includes('B'));assert.equal(native.effects.length,0);
});
test('legacy busy409 stays intact; cancelling queued row never submits it',async t=>{
 const a=await boot(t),id='cancel',first=await post(a,id,'runs',input('legacy','FIXTURE_DEFER legacy'));assert.equal(first.status,202);await stateUntil(a,id,s=>s.runs[0]?.status==='running','legacy running');const busy=await post(a,id,'runs',input('busy'));assert.equal(busy.status,409);assert.equal(busy.value.error.code,'RUN_BUSY');const q=await enqueue(a,id,input('queued','MUST_NEVER_SUBMIT'));const r=await post(a,id,'queue/'+q.queueId+'/cancel',{requestId:'cancel'});assert.equal(r.status,200);assert.equal(r.value.status,'cancelled');await a.request('/runs/'+first.value.runId+'/cancel',{method:'POST',body:{requestId:'stop'}});await stateUntil(a,id,s=>s.runs[0]?.status==='cancelled','legacy stopped');assert.equal(a.fixture.latest().turnStarts.length,1);
});
test('uncertainty holds later FIFO until explicit continue without replay',async t=>{
 const a=await boot(t),id='hold',first=await enqueue(a,id,input('first','FIXTURE_DEFER A'));await stateUntil(a,id,s=>s.runs[0]?.status==='running','first running');const second=await enqueue(a,id,input('second','B after uncertainty'));await a.handler.runtime.drop(id);let s=await stateUntil(a,id,s=>s.workflow?.hold&&row(s,first.queueId)?.status==='interrupted','uncertain hold');assert.equal(row(s,second.queueId).status,'queued');assert.equal(s.runs.length,1);assert.equal((await post(a,id,'queue/resume',{requestId:'continue'})).status,200);s=await stateUntil(a,id,s=>row(s,second.queueId)?.status==='completed','continued');assert.equal(s.runs.length,2);assert.equal(s.runs[0].status,'interrupted');const native=a.fixture.latest();assert.equal(native.turnStarts.length,1);assert.ok(native.turnStarts[0].input[0].text.includes('B after uncertainty'));assert.equal(a.fixture.connections.flatMap(connection=>connection.turnStarts).length,2);
});
test('failed durable write creates no queue or native effect and retry accepts once',async t=>{
 const a=await boot(t),id='write',write=a.handler.store.write;a.handler.store.write=async()=>{throw new Error('injected fsync failure');};const r=await post(a,id,'queue',input('failed'));a.handler.store.write=write;assert.equal(r.status,500);assert.equal(a.handler.store.get(a.owner,id),undefined);assert.equal(a.handler.runtime.connections.size,0);await enqueue(a,id,input('failed'));
});
test('restart preserves never-sent rows and same offline acceptance receipt',async t=>{
 const a=await boot(t,{offline:true}),id='restart',body=input('saved','exact bytes'),receipt=await enqueue(a,id,body),auth=a.auth;await a.close(true);const b=await boot(t,{dataDir:a.dataDir,auth,offline:true});assert.deepEqual(await enqueue(b,id,body),receipt);const s=await snapshot(b,id);assert.equal(s.queue.length,1);assert.equal(s.queue[0].payload.text,'exact bytes');assert.notEqual(s.queue[0].status,'interrupted');assert.equal(s.runs.length,0);
});
test('unknown attachment refs and legacy malformed attachments are never omitted',async t=>{
 const a=await boot(t,{offline:true}),id='badrefs';const bad=await post(a,id,'queue',{requestId:'bad',text:'owned',attachmentRefs:[{attachmentId:'missing',sha256:'a'.repeat(64),size:1}]});assert.equal(bad.status,422);assert.equal((await snapshot(a,id)).queue?.length||0,0);assert.equal((await post(a,id,'queue',{requestId:'legacy',text:'owned',attachments:[{name:'fake'}]})).status,422);
});
test('queue ownership, wrong Origin and CSRF remain enforced',async t=>{
 const a=await boot(t,{offline:true}),id='owner',q=await enqueue(a,id,input('owner'));assert.equal((await a.request('/conversations/'+id+'/queue',{method:'POST',body:input('badcsrf'),headers:{'x-harness-csrf':'wrong'}})).status,403);assert.equal((await fetch(a.baseUrl+'/api/harness/conversations/'+id)).status,404);assert.equal((await a.request('/conversations/'+id+'/queue/'+q.queueId+'/cancel',{method:'POST',body:{requestId:'origin'},headers:{Origin:'https://evil.example'}})).status,403);
});
for(const [name,clock,rule,expected] of [
 ['spring gap','2026-03-28T12:00:00Z',{kind:'daily',time:'02:30',timeZone:'Europe/Amsterdam'},'2026-03-29T01:30:00.000Z'],
 ['earlier autumn fold','2026-10-24T12:00:00Z',{kind:'daily',time:'02:30',timeZone:'Europe/Amsterdam'},'2026-10-25T00:30:00.000Z'],
 ['leap civil day','2028-02-28T12:00:00Z',{kind:'daily',time:'09:00',timeZone:'Europe/Amsterdam'},'2028-02-29T08:00:00.000Z'],
 ['weekly weekday','2026-01-01T10:00:00Z',{kind:'weekly',time:'09:15',timeZone:'Asia/Kathmandu',weekdays:[1]},'2026-01-05T03:30:00.000Z']
])test('civil recurrence computes '+name,async t=>{const a=await boot(t,{offline:true,clock}),s=await schedule(a,'civil',spec('civil',rule));assert.equal(s.nextDueAt,expected);assert.equal(s.status,'enabled');assert.equal(s.enabled,true);});
test('invalid date, time, zone and weekday cannot become scheduled work',async t=>{
 const a=await boot(t,{offline:true}),id='invalid';for(const [i,rule] of [once('2026-02-30T09:00:00Z'),{kind:'daily',time:'25:99',timeZone:'UTC'},{kind:'weekly',time:'09:00',weekdays:[0,8],timeZone:'UTC'},{kind:'daily',time:'09:00',timeZone:'Unknown/Zone'}].entries())assert.equal((await post(a,id,'schedules',spec('invalid-'+i,rule))).status,422);const list=await a.request('/conversations/'+id+'/schedules');assert.equal(list.status,200);assert.deepEqual(list.value.schedules,[]);
});
test('simultaneous due scans atomically admit one occurrence linked to real protocol run',async t=>{
 const a=await boot(t),id='due',s=await schedule(a,id,spec('due',once('2026-01-01T10:01:00Z'),'unique scheduled fixture'));a.setTime('2026-01-01T10:02:00Z');await Promise.all([a.handler.workflows.tick(),a.handler.workflows.tick(),a.handler.workflows.tick()]);const state=await stateUntil(a,id,s=>s.queue?.[0]?.status==='completed','due completed');assert.equal(state.queue.length,1);assert.equal(state.queue[0].source.scheduleId,s.id);assert.equal(state.runs.length,1);assert.equal(state.queue[0].runId,state.runs[0].id);assert.ok(state.entries.some(e=>e.role==='assistant'&&e.text.includes('unique scheduled fixture')));await a.handler.workflows.tick();assert.equal((await snapshot(a,id)).queue.length,1);
});
test('due write failure retains cursor and no dispatch, retry admits once',async t=>{
 const a=await boot(t),id='due-failed';await schedule(a,id,spec('due',once('2026-01-01T10:01:00Z')));a.setTime('2026-01-01T10:02:00Z');const write=a.handler.store.write;a.handler.store.write=async()=>{throw new Error('due fsync failure');};await a.handler.workflows.tick().catch(()=>{});a.handler.store.write=write;let s=await snapshot(a,id);assert.equal(s.queue.length,0);assert.equal(s.schedules[0].nextDueAt,'2026-01-01T10:01:00.000Z');assert.equal(a.handler.runtime.connections.size,0);await a.handler.workflows.tick();s=await stateUntil(a,id,s=>s.queue?.[0]?.status==='completed','due retry');assert.equal(s.queue.length,1);
});
test('missed recurring slots coalesce latest24h with no backlog behind active occurrence',async t=>{
 const a=await boot(t),id='missed';await schedule(a,id,spec('daily',{kind:'daily',time:'11:00',timeZone:'UTC'},'FIXTURE_DEFER daily'));a.setTime('2026-01-05T12:00:00Z');await a.handler.workflows.tick();let s=await stateUntil(a,id,s=>s.runs[0]?.status==='running','latest running');assert.equal(s.queue.length,1);assert.equal(s.queue[0].source.dueAt,'2026-01-05T11:00:00.000Z');assert.ok(s.schedules[0].skippedCount>=3);a.setTime('2026-01-08T12:00:00Z');await a.handler.workflows.tick();s=await snapshot(a,id);assert.equal(s.queue.length,1);assert.equal(s.runs.length,1);
});
test('pause/delete cancel unsent schedule rows and stale revision cannot resurrect',async t=>{
 const a=await boot(t),id='pause',head=await enqueue(a,id,input('manual','FIXTURE_DEFER manual'));await stateUntil(a,id,s=>s.runs[0]?.status==='running','manual running');let s=await schedule(a,id,spec('schedule',once('2026-01-01T10:01:00Z')));a.setTime('2026-01-01T10:02:00Z');await a.handler.workflows.tick();assert.equal((await snapshot(a,id)).queue.length,2);s=(await action(a,id,s,'pause')).schedule;let state=await snapshot(a,id);assert.equal(row(state,head.queueId).status,'running');assert.equal(state.queue[1].status,'cancelled');assert.equal(s.status,'paused');assert.equal((await action(a,id,s,'delete')).schedule.status,'deleted');assert.equal((await post(a,id,'schedules/'+s.id+'/enable',{requestId:'stale',expectedRevision:s.revision})).status,409);
});
test('edit never changes accepted payload and run-now same request is idempotent',async t=>{
 const a=await boot(t,{offline:true}),id='edit';let s=await schedule(a,id,spec('schedule',once('2026-01-01T11:00:00Z'),'old frozen'));const first=await action(a,id,s,'run-now');assert.equal(typeof first.queueId,'string');assert.deepEqual(await action(a,id,s,'run-now'),first);s=(await action(a,id,s,'edit',{title:'Updated',payload:{text:'new'},rule:once('2026-01-01T12:00:00Z')})).schedule;assert.equal(s.payload.text,'new');const state=await snapshot(a,id);assert.equal(state.queue.length,1);assert.equal(state.queue[0].payload.text,'old frozen');assert.equal(state.queue[0].source.scheduleRevision,1);
});
test('queue pending capacity is bounded and blocked head prevents leapfrog',async t=>{
 const a=await boot(t,{offline:true}),id='bounded';for(let i=0;i<50;i++)await enqueue(a,id,input('q-'+i));assert.equal((await post(a,id,'queue',input('overflow'))).status,429);const s=await snapshot(a,id);assert.equal(s.queue.length,50);assert.equal(s.runs.length,0);assert.ok(s.queue.slice(1).every(q=>q.status==='queued'));
});

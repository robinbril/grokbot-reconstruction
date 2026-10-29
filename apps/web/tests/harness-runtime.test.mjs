// Historical protocol adapter coverage, not current product-provider execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';
const id=()=>randomUUID();
test('live API binds a secure local owner session and exposes no account/token configuration',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();
 assert.equal(a.status.schema,1);assert.ok(a.cookie);assert.ok(a.csrf);assert.ok(a.status.capabilities);const text=JSON.stringify(a.status);for(const word of ['access_token','refresh_token','api_key','@example'])assert.equal(text.includes(word),false);
 const response=await a.request('/status',{raw:true});const cookie=response.headers.get('set-cookie');if(cookie)assert.match(cookie,/HttpOnly/i);
});
test('mutations reject a cross origin and missing CSRF before executing a prompt',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();const body={requestId:id(),text:'must not execute'};
 for(const headers of [{Origin:'https://unrelated.example'},{'x-harness-csrf':''}]){const r=await a.request('/conversations/security/runs',{method:'POST',body,headers});assert.ok([401,403].includes(r.status),JSON.stringify(r));}
 const snap=await a.request('/conversations/security');assert.equal(snap.status,200);assert.equal(snap.value.runs.length,0);
});
test('owner A cannot read, cancel or approve owner B run',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client(),b=await app.client();
 const result=await a.request('/conversations/private/runs',{method:'POST',body:{requestId:id(),text:'FIXTURE_DEFER'}});assert.equal(result.status,202,JSON.stringify(result));const runId=result.value.runId;
 for(const [route,method,body] of [['/runs/'+runId,'GET'],['/runs/'+runId+'/cancel','POST',{requestId:id()}],['/runs/'+runId+'/approvals/forged/decision','POST',{requestId:id(),decision:'approve'}]]){const r=await b.request(route,{method,body});assert.ok([403,404].includes(r.status),JSON.stringify(r));}
 const other=await b.request('/conversations/private');assert.equal(other.status,404);assert.equal(other.value.entries,undefined);
});
test('invalid conversation IDs and invalid prompt payloads do not acquire an execution',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();
 for(const body of [{requestId:id(),text:''},{requestId:id(),text:42},{requestId:id(),text:'x',attachments:[{id:'unsupported'}]},{requestId:id(),text:'x'.repeat(200001)}]){const r=await a.request('/conversations/validation/runs',{method:'POST',body});assert.ok([400,413,422].includes(r.status),JSON.stringify(r));}
 const snap=await a.request('/conversations/validation');assert.equal(snap.value.runs.length,0);
});
test('idempotent accepted request maps to one run and one user entry, conflicting payload is rejected',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client(),requestId=id(),body={requestId,text:'FIXTURE_DEFER'};
 const first=await a.request('/conversations/idempotent/runs',{method:'POST',body});assert.equal(first.status,202,JSON.stringify(first));const second=await a.request('/conversations/idempotent/runs',{method:'POST',body});assert.equal(second.status,202);assert.equal(second.value.runId,first.value.runId);
 const conflict=await a.request('/conversations/idempotent/runs',{method:'POST',body:{...body,text:'different'}});assert.equal(conflict.status,409);
 const snap=(await a.request('/conversations/idempotent')).value;assert.equal(snap.runs.length,1);assert.equal(snap.entries.filter(x=>x.role==='user').length,1);
});
test('one active turn per conversation rejects a second request without losing the first',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();const first=await a.request('/conversations/busy/runs',{method:'POST',body:{requestId:id(),text:'FIXTURE_DEFER'}});assert.equal(first.status,202,JSON.stringify(first));
 const second=await a.request('/conversations/busy/runs',{method:'POST',body:{requestId:id(),text:'second'}});assert.equal(second.status,409);const snap=(await a.request('/conversations/busy')).value;assert.equal(snap.runs.length,1);
});
test('ordered durable SSE replay is the same canonical completed result after reconnect',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();const r=await a.request('/conversations/replay/runs',{method:'POST',body:{requestId:id(),text:'fixture replay identity'}});assert.equal(r.status,202,JSON.stringify(r));
 const events=await collectUntil(a,r.value.runId,event=>event.type==='run.completed');assert.ok(events.some(x=>x.type==='entry.updated'));for(let i=1;i<events.length;i++)assert.ok(events[i].seq>events[i-1].seq);assert.equal(new Set(events.map(x=>x.id)).size,events.length);
 const offset=events.at(-2)?.seq??0;const replay=await collectUntil(a,r.value.runId,event=>event.type==='run.completed',{after:offset});assert.deepEqual(replay,events.filter(x=>x.seq>offset));
 const snap=(await a.request('/conversations/replay')).value;const out=snap.entries.find(x=>x.id===r.value.outputEntryId);assert.match(out.text,/fixture replay identity/);assert.equal(snap.runs[0].status,'completed');
});
test('Stop uses the matching thread turn and reaches interrupted state without stopping the server',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();const r=await a.request('/conversations/cancel/runs',{method:'POST',body:{requestId:id(),text:'FIXTURE_DEFER'}});assert.equal(r.status,202,JSON.stringify(r));await collectUntil(a,r.value.runId,e=>e.type==='run.started');
 const stop=await a.request('/runs/'+r.value.runId+'/cancel',{method:'POST',body:{requestId:id()}});assert.equal(stop.status,200,JSON.stringify(stop));await collectUntil(a,r.value.runId,e=>['run.cancelled','run.interrupted'].includes(e.type));assert.equal((await a.request('/status')).status,200);
});
test('an unknown approval cannot execute or resolve a real pending approval',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();const r=await a.request('/conversations/approval/runs',{method:'POST',body:{requestId:id(),text:'FIXTURE_APPROVAL'}});assert.equal(r.status,202,JSON.stringify(r));const events=await collectUntil(a,r.value.runId,e=>e.type==='approval.requested');const event=events.at(-1),approval=event.data.approval||event.data;
 const bad=await a.request('/runs/'+r.value.runId+'/approvals/not-the-approval/decision',{method:'POST',body:{requestId:id(),decision:'approve'}});assert.ok([404,409].includes(bad.status));
 const actual=await a.request('/runs/'+r.value.runId+'/approvals/'+(approval.id||approval.approvalId)+'/decision',{method:'POST',body:{requestId:id(),decision:'reject'}});assert.equal(actual.status,200,JSON.stringify(actual));await collectUntil(a,r.value.runId,e=>e.type==='run.completed');
});
test('backend restart preserves accepted history and never resends an interrupted turn',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client();const r=await a.request('/conversations/restart/runs',{method:'POST',body:{requestId:id(),text:'FIXTURE_DEFER'}});assert.equal(r.status,202,JSON.stringify(r));await collectUntil(a,r.value.runId,e=>e.type==='run.started');const auth={cookie:a.cookie,csrf:a.csrf};await app.close({keepData:true});
 const restored=await startHarness({dataDir:app.dataDir});t.after(()=>restored.close());const b=await restored.client(auth),snap=(await b.request('/conversations/restart')).value;assert.equal(snap.runs.length,1);assert.ok(['interrupted','failed','cancelled'].includes(snap.runs[0].status));assert.equal(snap.entries.filter(x=>x.role==='user').length,1);
 const retry=await b.request('/conversations/restart/runs',{method:'POST',body:{requestId:r.value.requestId,text:'FIXTURE_DEFER'}});assert.equal(retry.status,202,JSON.stringify(retry));assert.equal(retry.value.runId,r.value.runId);
});

test('durable accepted receipt replays while the provider is unavailable without redispatch',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),id='receipt-offline',body={requestId:randomUUID(),text:'[defer] keep accepted identity'};
 const first=await client.request('/conversations/'+id+'/runs',{method:'POST',body});assert.equal(first.status,202,JSON.stringify(first.value));
 app.handler.runtime.connect=async()=>{throw Error('Provider currently unavailable');};
 const replay=await client.request('/conversations/'+id+'/runs',{method:'POST',body});assert.equal(replay.status,202,JSON.stringify(replay.value));assert.equal(replay.value.runId,first.value.runId);assert.equal((await client.request('/conversations/'+id)).value.runs.length,1);
 const conflict=await client.request('/conversations/'+id+'/runs',{method:'POST',body:{...body,text:'different'}});assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
});

test('connecting another Computer reclaims only idle children and preserves durable history',async t=>{
 const app=await startHarness();t.after(()=>app.close());app.handler.runtime.maxChildren=2;const client=await app.client();
 const connect=id=>client.request('/conversations/'+id+'/connect',{method:'POST',body:{requestId:randomUUID()}});
 const first=await connect('idle-one');assert.equal(first.status,200);const owner=client.cookie.split('=')[1];await app.handler.store.transaction(owner,'idle-one',s=>{s.terminalSessions.push({id:'prior-command',status:'completed',stdout:'saved output',stderr:'',exitCode:0});});
 for(const id of ['idle-two','idle-three']){const response=await connect(id);assert.equal(response.status,200,JSON.stringify(response.value));assert.ok(app.handler.runtime.connections.size<=2);}
 assert.equal(app.handler.runtime.connections.has('idle-one'),false);const history=(await client.request('/conversations/idle-one')).value;assert.equal(history.workspaceRoot,first.value.workspaceRoot);assert.equal(history.terminalSessions[0].stdout,'saved output');assert.equal(history.terminalSessions[0].exitCode,0);
});

test('capacity never evicts a live model turn or running terminal',async t=>{
 const app=await startHarness();t.after(()=>app.close());app.handler.runtime.maxChildren=2;const client=await app.client();
 const run=await client.request('/conversations/protected-run/runs',{method:'POST',body:{requestId:randomUUID(),text:'FIXTURE_DEFER'}});assert.equal(run.status,202);await collectUntil(client,run.value.runId,e=>e.type==='run.started');
 const terminal=await client.request('/conversations/protected-terminal/terminal',{method:'POST',body:{requestId:randomUUID(),command:process.execPath+" -e 'setInterval(()=>{},1000)'"}});assert.equal(terminal.status,202,JSON.stringify(terminal.value));
 const refused=await client.request('/conversations/over-capacity/connect',{method:'POST',body:{requestId:randomUUID()}});assert.equal(refused.status,503);assert.equal(refused.value.error.code,'RUNTIME_CAPACITY');assert.equal(app.handler.runtime.connections.has('protected-run'),true);assert.equal(app.handler.runtime.connections.has('protected-terminal'),true);
});

test('concurrent conversation initialization never exceeds reserved process capacity',async t=>{
 const app=await startHarness();t.after(()=>app.close());const runtime=app.handler.runtime;runtime.maxChildren=2;const client=await app.client(),original=runtime.reserveCapacity.bind(runtime);let maxClaimed=0;
 runtime.reserveCapacity=async id=>{await original(id);maxClaimed=Math.max(maxClaimed,new Set([...runtime.connections.keys(),...runtime.capacityReservations]).size);};
 const responses=await Promise.all(Array.from({length:7},(_,i)=>client.request('/conversations/parallel-'+i+'/connect',{method:'POST',body:{requestId:randomUUID()}})));
 assert.ok(responses.every(r=>[200,503].includes(r.status)),JSON.stringify(responses.map(r=>r.value)));assert.ok(responses.filter(r=>r.status===200).length>=2);assert.ok(maxClaimed<=2);assert.ok(runtime.connections.size<=2);assert.equal(runtime.capacityReservations.size,0);
});

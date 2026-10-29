// Synthetic model only; HTTP, run ledger and workflow execution are production code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

test('workflow fixture drives independent runtime replies, cancellation, failure and interruption recovery',async t=>{
 const app=await startWorkflowProtocolServer({port:0});t.after(()=>app.close());
 const status=await fetch(app.baseUrl+'/api/harness/status'),metadata=await status.json();
 const cookie=status.headers.get('set-cookie').split(';')[0],csrf=metadata.csrfToken,id='fixture-runtime-regression';
 async function request(route,body){
  const response=await fetch(app.baseUrl+'/api/harness'+route,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json',Origin:app.baseUrl,'x-harness-csrf':csrf}:{})},...(body?{body:JSON.stringify({requestId:randomUUID(),...body})}:{})});
  const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
 }
 const snapshot=()=>request('/conversations/'+id);
 async function until(predicate){
  for(let i=0;i<200;i++){const state=await snapshot();if(predicate(state))return state;await delay(10);}
  assert.fail('Runtime state did not converge: '+JSON.stringify(await snapshot()));
 }
 const send=text=>request('/conversations/'+id+'/runs',{text});
 assert.equal(metadata.runtime.state,'ready');assert.equal(metadata.runtime.provider,'synthetic-workflow-fixture');
 let run=await send('CURRENT_FIRST');await until(s=>s.runs.find(r=>r.id===run.runId)?.status==='completed');
 run=await send('CURRENT_SECOND');let state=await until(s=>s.runs.find(r=>r.id===run.runId)?.status==='completed');
 assert.equal(state.entries.at(-1).text,'Protocol fixture output: CURRENT_SECOND');
 run=await send('FIXTURE_DEFER CANCEL_THIS');await until(s=>s.runs.find(r=>r.id===run.runId)?.status==='running');
 await delay(30);assert.equal((await snapshot()).runs.at(-1).status,'running');
 await request('/runs/'+run.runId+'/cancel',{});state=await until(s=>s.runs.find(r=>r.id===run.runId)?.status==='cancelled');
 assert.equal(state.entries.at(-1).text,'');
 run=await send('FIXTURE_FAIL FAILED_THIS');state=await until(s=>s.runs.find(r=>r.id===run.runId)?.status==='failed');
 assert.equal(state.entries.at(-1).text,'');assert.equal(state.runs.at(-1).error.code,'SYNTHETIC_MODEL_FAILURE');
 run=await send('FIXTURE_DEFER INTERRUPT_THIS');await until(s=>s.runs.find(r=>r.id===run.runId)?.status==='running');
 await request('/conversations/'+id+'/queue',{text:'HELD_SUCCESSOR'});
 await app.interrupt(id);state=await until(s=>s.workflow?.hold&&s.runs.find(r=>r.id===run.runId)?.status==='interrupted');
 assert.equal(state.queue[0].status,'queued');assert.equal(state.queue[0].runId,undefined);
 await request('/conversations/'+id+'/queue/resume',{});
 state=await until(s=>s.queue[0].status==='completed');
 assert.equal(state.entries.at(-1).text,'Protocol fixture output: HELD_SUCCESSOR');
 assert.equal(state.runs.filter(r=>r.id===run.runId).length,1);assert.equal(state.runs.at(-2).status,'interrupted');
});

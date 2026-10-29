// Historical protocol adapter coverage, not current product-provider execution.
// Independent real store/runtime + explicit native protocol fixture, no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLegacyHarnessHandler as createHarnessHandler} from './fixtures/legacy-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const binary=path.join(root,'tests/fixtures/harness-edges-codex-fixture.mjs');
async function until(check){for(let i=0;i<500;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Timed out waiting for real fixture event');}
test('external run cannot take the durable internal queue identity or bind a different accepted prompt',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-binding-review-'));
 const app=await createHarnessHandler({root,dataDir,baseUrl:'http://127.0.0.1:29999',codexBinary:binary,workflowAutoStart:false});
 const owner='synthetic-binding-owner',id='external-queue-collision';
 try{
  await app.runtime.start(owner,id,{requestId:'legacy',text:'FIXTURE_DEFER legacy predecessor'});
  await until(()=>app.store.get(owner,id).runs[0].status==='running');
  const receipt=await app.workflows.enqueue(owner,id,{requestId:'followup',text:'ACCEPTED OWN FOLLOWUP'});
  await app.runtime.drop(id);
  await until(()=>app.store.get(owner,id).workflow.hold);
  const queued=app.store.get(owner,id).queue.find(q=>q.id===receipt.queueId);
  await assert.rejects(app.runtime.start(owner,id,{requestId:queued.nativeRequestId,text:'FOREIGN LEGACY BODY'}),e=>e.code==='INVALID_REQUEST_ID');
  assert.equal(app.store.get(owner,id).queue[0].status,'queued');
  assert.equal(app.store.get(owner,id).runs.length,1);
  await app.workflows.resume(owner,id,'explicit-review');
  await until(()=>app.store.get(owner,id).queue[0].status==='completed');
  const state=app.store.get(owner,id),q=state.queue[0],linked=state.runs.find(r=>r.id===q.runId);
  assert.equal(linked.workflowQueueId,q.id);
  assert.deepEqual(state.entries.filter(e=>e.role==='user').map(e=>e.text),['FIXTURE_DEFER legacy predecessor','ACCEPTED OWN FOLLOWUP']);
 }finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});

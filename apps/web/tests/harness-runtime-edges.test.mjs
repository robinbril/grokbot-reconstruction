// Historical protocol adapter coverage, not current product-provider execution.
// Real production HTTP/runtime/events, explicit protocol fixture, owned commands.
// No installed-provider/model completion is established by this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rm,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';
const binary=fileURLToPath(new URL('./fixtures/harness-edges-codex-fixture.mjs',import.meta.url));
const post=(client,route,body)=>client.request(route,{method:'POST',body});
const submit=(client,id,body)=>post(client,'/conversations/'+id+'/runs',body);
const state=connection=>connection.rpc.request('test/edges/state',{},6000);
async function setup(t){const app=await startHarness({codexBinary:binary});t.after(()=>app.close());return {app,client:await app.client()};}

test('fresh constructor request ID is accepted exactly once and its durable receipt survives restart without redispatch',{timeout:15000},async t=>{
 const app=await startHarness({codexBinary:binary});let restored;t.after(async()=>{await restored?.close();await app.close();await rm(app.dataDir,{recursive:true,force:true});});
 const client=await app.client(),id='edge-constructor',body={requestId:'constructor',text:'A fresh constructor request is ordinary user input'};
 const accepted=await submit(client,id,body);assert.equal(accepted.status,202,JSON.stringify(accepted.value));
 await collectUntil(client,accepted.value.runId,event=>event.runId===accepted.value.runId&&event.type==='run.completed');const connection=app.handler.runtime.connections.get(id);
 const replay=await submit(client,id,{...body});assert.equal(replay.status,202);assert.deepEqual(replay.value,accepted.value);
 const changed=await submit(client,id,{...body,text:'Different text on the same constructor ID'});assert.equal(changed.status,409);assert.equal(changed.value.error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await state(connection)).turnStarts.length,1);const before=(await client.request('/conversations/'+id)).value;assert.equal(before.runs.length,1);assert.equal(before.entries.filter(entry=>entry.role==='user').length,1);
 const auth={cookie:client.cookie,csrf:client.csrf};await app.close({keepData:true});
 restored=await startHarness({dataDir:app.dataDir,codexBinary:path.join(app.dataDir,'unavailable-provider-must-not-start')});const restoredClient=await restored.client(auth);
 const recovered=await submit(restoredClient,id,body);assert.equal(recovered.status,202);assert.deepEqual(recovered.value,accepted.value);
 const conflict=await submit(restoredClient,id,{...body,text:'Still a conflict after restart'});assert.equal(conflict.status,409);
 const after=(await restoredClient.request('/conversations/'+id)).value;assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.runs,before.runs);assert.equal(after.threadId,before.threadId);
 assert.equal(restored.handler.runtime.connections.size,0);assert.equal(restored.handler.runtime.connecting.size,0);assert.equal(restored.handler.runtime.bridges.size,0);
});

test('other valid Object prototype names are fresh independent request IDs in an existing conversation',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='edge-prototype-names',names=['toString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','toLocaleString'];
 for(let index=0;index<names.length;index++){
  const body={requestId:names[index],text:'Independent request body '+names[index]},accepted=await submit(client,id,body);assert.equal(accepted.status,202,names[index]+' must not collide with an inherited request-map property');
  await collectUntil(client,accepted.value.runId,event=>event.runId===accepted.value.runId&&event.type==='run.completed');
  const replay=await submit(client,id,{...body});assert.equal(replay.status,202);assert.equal(replay.value.runId,accepted.value.runId);
  const conflict=await submit(client,id,{...body,text:body.text+' changed'});assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
  const captured=await state(app.handler.runtime.connections.get(id));assert.equal(captured.turnStarts.length,index+1);assert.equal(captured.turnStarts[index].input[0].text,body.text);
 }
 const history=(await client.request('/conversations/'+id)).value;assert.equal(history.runs.length,names.length);assert.equal(history.entries.filter(entry=>entry.role==='user').length,names.length);
});

test('explicitly rejected schema-valid command and file change items stay failed without executing or reporting completion',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='edge-declined';
 for(const type of ['commandExecution','fileChange']){
  const accepted=await submit(client,id,{requestId:randomUUID(),text:'FIXTURE_DEFER EDGE_ITEM:'+type+':declined'});assert.equal(accepted.status,202);const runId=accepted.value.runId;
  const requested=await collectUntil(client,runId,event=>event.runId===runId&&event.type==='approval.requested'),approval=requested.at(-1).data.approval;
  assert.equal(approval.kind,type==='fileChange'?'item/fileChange/requestApproval':'item/commandExecution/requestApproval');
  const decision=await post(client,'/runs/'+runId+'/approvals/'+approval.id+'/decision',{requestId:randomUUID(),decision:'reject'});assert.equal(decision.status,200,JSON.stringify(decision.value));
  const events=await collectUntil(client,runId,event=>event.runId===runId&&event.type==='run.completed'),captured=await state(app.handler.runtime.connections.get(id)),operation=captured.operations.find(operation=>operation.type===type);
  assert.ok(operation);assert.equal(operation.nativeCompletion.status,'declined');assert.equal(operation.decision,'decline');assert.equal(operation.executed,false);assert.equal(operation.pid,null);await assert.rejects(access(operation.markerPath),{code:'ENOENT'});
  const snapshot=(await client.request('/conversations/'+id)).value,tool=snapshot.tools.find(tool=>tool.id===operation.itemId);assert.ok(tool);assert.equal(tool.status,'failed','a declined native item cannot become a completed tool');
  assert.equal(tool.output,type==='fileChange'?JSON.stringify(operation.changes):'');
  const toolEvents=events.filter(event=>event.data.tool?.id===operation.itemId);assert.equal(toolEvents.filter(event=>event.type==='tool.started').length,1);assert.equal(toolEvents.filter(event=>event.type==='tool.failed').length,1);assert.equal(toolEvents.some(event=>event.type==='tool.completed'),false);
  assert.deepEqual(app.handler.store.states.get(id).events.filter(event=>event.data.tool?.id===operation.itemId),toolEvents);
  const terminal=snapshot.terminalSessions.find(terminal=>terminal.id===operation.itemId);
  if(type==='commandExecution'){assert.ok(terminal);assert.equal(terminal.status,'failed');assert.equal(terminal.exitCode,null);assert.equal(terminal.stdout,'');}else assert.equal(terminal,undefined);
 }
});

for(const mode of ['failed','completed'])test('actual owned command '+mode+' preserves native tool lifecycle, output and exit state',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='edge-command-'+mode;
 const accepted=await submit(client,id,{requestId:randomUUID(),text:'FIXTURE_DEFER EDGE_ITEM:commandExecution:'+mode});assert.equal(accepted.status,202,JSON.stringify(accepted.value));const runId=accepted.value.runId;
 const events=await collectUntil(client,runId,event=>event.runId===runId&&event.type==='run.completed'),captured=await state(app.handler.runtime.connections.get(id));assert.equal(captured.operations.length,1);const command=captured.operations[0];assert.equal(command.finished,true);assert.equal(command.executed,true);assert.ok(Number.isInteger(command.pid)&&command.pid>0);
 assert.equal(command.nativeCompletion.status,mode);assert.equal(command.signal,null);assert.equal(command.exitCode,mode==='failed'?7:0);
 const snapshot=(await client.request('/conversations/'+id)).value,tool=snapshot.tools.find(tool=>tool.id===command.itemId),terminal=snapshot.terminalSessions.find(terminal=>terminal.id===command.itemId);
 assert.ok(tool);assert.ok(terminal);assert.equal(tool.status,mode);assert.equal(terminal.status,mode);assert.equal(terminal.exitCode,command.exitCode);
 assert.equal(tool.output,command.output);assert.equal(terminal.stdout,command.output);assert.ok(tool.output.includes('EDGE_STDOUT_'+mode));assert.ok(tool.output.includes('EDGE_STDERR_'+mode));assert.ok(tool.finishedAt);
 const toolEvents=events.filter(event=>event.data.tool?.id===command.itemId);assert.equal(toolEvents.filter(event=>event.type==='tool.started').length,1);assert.equal(toolEvents.filter(event=>event.type==='tool.'+mode).length,1);
 if(mode!=='completed')assert.equal(toolEvents.some(event=>event.type==='tool.completed'),false);
 assert.equal(snapshot.runs.find(run=>run.id===runId).status,'completed');assert.deepEqual(app.handler.store.states.get(id).events.filter(event=>event.data.tool?.id===command.itemId),toolEvents);
});

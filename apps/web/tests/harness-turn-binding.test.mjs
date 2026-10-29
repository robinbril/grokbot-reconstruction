// Historical protocol adapter coverage, not current product-provider execution.
// Real production HTTP/runtime persistence, controlled native protocol fixture.
// Owned exit0/exit7 commands are real; installed-model completion is not claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';
const binary=fileURLToPath(new URL('./fixtures/harness-turn-binding-codex-fixture.mjs',import.meta.url));
const post=(client,id,body)=>client.request('/conversations/'+id+'/runs',{method:'POST',body});
const state=connection=>connection.rpc.request('test/turn-binding/state',{},6000);
const turn=(id,status)=>({id,status,items:[]});
const note=(method,params)=>({method,params});
const snapshot=async(client,id)=>(await client.request('/conversations/'+id)).value;
async function setup(t){const app=await startHarness({codexBinary:binary});t.after(()=>app.close());return {app,client:await app.client()};}
async function waitFor(connection,predicate){const deadline=Date.now()+6000;for(;;){const captured=await state(connection);if(predicate(captured)){await connection.queue;return captured;}assert.ok(Date.now()<deadline,'fixture condition did not become observable');await new Promise(resolve=>setTimeout(resolve,10));}}
async function emit(connection,notifications){const ack=await connection.rpc.request('test/turn-binding/emit',{notifications},6000);assert.equal(ack.emitted,notifications.length);await connection.queue;}
async function accept(client,id,text){const body={requestId:randomUUID(),text},response=await post(client,id,body);assert.equal(response.status,202,JSON.stringify(response));return {body,response};}
async function finish(client,id,text){const accepted=await accept(client,id,text);await collectUntil(client,accepted.response.value.runId,event=>event.runId===accepted.response.value.runId&&event.type==='run.completed');return accepted;}
async function active(app,client,id){const accepted=await accept(client,id,'FIXTURE_DEFER F81 active turn');await collectUntil(client,accepted.response.value.runId,event=>event.runId===accepted.response.value.runId&&event.type==='run.started');const connection=app.handler.runtime.connections.get(id);await connection.queue;const saved=await snapshot(client,id);return {...accepted,connection,run:saved.runs.find(run=>run.id===accepted.response.value.runId)};}
function assertHistoryEqual(before,after){for(const key of ['runs','entries','tools','terminalSessions'])assert.deepEqual(after[key],before[key],key+' must remain unchanged for unbound notifications');}

test('accepted HTTP run genuinely missing a native turn ID survives restart without the next turn stealing its history',{timeout:20000},async t=>{
 const app=await startHarness({codexBinary:binary});let restored;t.after(async()=>{await restored?.close();await app.close();await rm(app.dataDir,{recursive:true,force:true});});
 const client=await app.client(),id='binding-accepted-restart',first=await accept(client,id,'F81_HOLD_START accepted before any native turn identifier');
 const connection=app.handler.runtime.connections.get(id);await waitFor(connection,captured=>captured.heldRequests.length===1);
 const disk=JSON.parse(await readFile(path.join(app.dataDir,'conversation-'+id+'.json'),'utf8')),saved=disk.runs.find(run=>run.id===first.response.value.runId);assert.ok(saved);assert.equal(Object.hasOwn(saved,'turnId'),false);assert.ok(['accepted','starting'].includes(saved.status));assert.equal(disk.entries.filter(entry=>entry.role==='user').length,1);
 const auth={cookie:client.cookie,csrf:client.csrf};await app.close({keepData:true});restored=await startHarness({dataDir:app.dataDir,codexBinary:binary});const restoredClient=await restored.client(auth),before=await snapshot(restoredClient,id),oldRun=before.runs.find(run=>run.id===saved.id),oldEntries=before.entries.filter(entry=>entry.runId===saved.id);
 assert.equal(oldRun.status,'interrupted');assert.equal(Object.hasOwn(oldRun,'turnId'),false);
 const second=await accept(restoredClient,id,'F81 independent successor answer'),newConnection=restored.handler.runtime.connections.get(id);
 const captured=await waitFor(newConnection,value=>value.notifications.some(message=>message.method==='turn/completed'));
 assert.equal(captured.turnStarts.length,1,'restart must not dispatch the historical request again');assert.equal(captured.notifications.find(message=>message.method==='turn/started').params.turn.id,captured.notifications.find(message=>message.method==='turn/completed').params.turn.id);
 const after=await snapshot(restoredClient,id);assert.deepEqual(after.runs.find(run=>run.id===saved.id),oldRun,'historical no-ID run must not be selected by undefined===undefined');assert.deepEqual(after.entries.filter(entry=>entry.runId===saved.id),oldEntries);
 const current=after.runs.find(run=>run.id===second.response.value.runId);assert.equal(current.status,'completed');assert.equal(current.turnId,captured.notifications.find(message=>message.method==='turn/started').params.turn.id);assert.equal(after.entries.find(entry=>entry.id===current.outputEntryId).text,'Protocol fixture output: '+second.body.text);
 const replay=await post(restoredClient,id,first.body);assert.equal(replay.status,202);assert.deepEqual(replay.value,first.response.value);assert.equal((await state(newConnection)).turnStarts.length,1);
});

test('native nested lifecycle IDs bind sequential turns and their separate assistant entries',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='binding-nested';const first=await finish(client,id,'F81 first normal answer'),before=await snapshot(client,id),oldRun=before.runs[0],oldEntries=before.entries.filter(entry=>entry.runId===oldRun.id);
 const second=await finish(client,id,'F81 second normal answer'),after=await snapshot(client,id),connection=app.handler.runtime.connections.get(id),captured=await state(connection);
 assert.deepEqual(after.runs.find(run=>run.id===oldRun.id),oldRun);assert.deepEqual(after.entries.filter(entry=>entry.runId===oldRun.id),oldEntries);assert.equal(after.runs.length,2);assert.notEqual(after.runs[0].turnId,after.runs[1].turnId);
 for(const accepted of [first,second]){const run=after.runs.find(run=>run.id===accepted.response.value.runId);assert.equal(run.status,'completed');assert.equal(after.entries.find(entry=>entry.id===run.outputEntryId).text,'Protocol fixture output: '+accepted.body.text);}
 const lifecycle=captured.notifications.filter(message=>message.method==='turn/started'||message.method==='turn/completed');assert.equal(lifecycle.length,4);for(const message of lifecycle){assert.equal(Object.hasOwn(message.params,'turnId'),false);assert.equal(typeof message.params.turn.id,'string');}assert.equal(captured.turnStarts.length,2);
});

test('wrong-thread, unknown and stale nested lifecycle IDs cannot replace or complete a known active turn',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='binding-lifecycle-guards';await finish(client,id,'F81 historical complete turn');const current=await active(app,client,id),before=await snapshot(client,id),old=before.runs[0],threadId=current.connection.threadId;
 const notifications=[note('turn/started',{threadId:'wrong-thread-'+randomUUID(),turn:turn(randomUUID(),'inProgress')}),note('turn/started',{threadId,turn:turn(randomUUID(),'inProgress')}),note('turn/completed',{threadId,turn:turn(randomUUID(),'completed')}),note('turn/started',{threadId,turn:turn(old.turnId,'inProgress')}),note('turn/completed',{threadId,turn:turn(old.turnId,'completed')})];
 await emit(current.connection,notifications);assertHistoryEqual(before,await snapshot(client,id));
 await emit(current.connection,[note('turn/completed',{threadId,turn:turn(current.run.turnId,'completed')})]);const after=await snapshot(client,id);assert.equal(after.runs.find(run=>run.id===current.run.id).status,'completed');assert.deepEqual(after.runs[0],old);
});

test('unbound item and output notifications cannot mutate current or historical entries, tools or terminals',{timeout:20000},async t=>{
 const {app,client}=await setup(t),id='binding-item-guards';await finish(client,id,'FIXTURE_DEFER EDGE_ITEM:commandExecution:completed');const current=await active(app,client,id),before=await snapshot(client,id),old=before.runs[0],terminal=before.terminalSessions[0],threadId=current.connection.threadId,itemId='foreign-message-'+randomUUID(),foreignTurn=randomUUID();assert.ok(terminal);assert.equal(terminal.status,'completed');
 const agentItem={id:itemId,type:'agentMessage',text:'MUST_NOT_ENTER_HISTORY'},commandItem={id:'foreign-command-'+randomUUID(),type:'commandExecution',status:'completed',command:'never executed',commandActions:[],cwd:before.workspaceRoot,aggregatedOutput:'MUST_NOT_ENTER_TERMINAL',exitCode:0};
 const notifications=[note('item/agentMessage/delta',{threadId,turnId:foreignTurn,itemId,delta:'MUST_NOT_ENTER_HISTORY'}),note('item/completed',{threadId,turnId:foreignTurn,completedAtMs:Date.now(),item:agentItem}),note('item/started',{threadId,turnId:foreignTurn,startedAtMs:Date.now(),item:{...commandItem,status:'inProgress',aggregatedOutput:null,exitCode:null}}),note('item/completed',{threadId,turnId:foreignTurn,completedAtMs:Date.now(),item:commandItem}),note('item/agentMessage/delta',{threadId,turnId:old.turnId,itemId,delta:'MUST_NOT_MUTATE_OLD'}),note('item/commandExecution/outputDelta',{threadId,turnId:foreignTurn,itemId:terminal.id,delta:'MUST_NOT_MUTATE_TERMINAL'}),note('item/commandExecution/outputDelta',{threadId:'wrong-thread',turnId:current.run.turnId,itemId:terminal.id,delta:'MUST_NOT_MUTATE_TERMINAL'}),note('item/commandExecution/outputDelta',{threadId,turnId:old.turnId,itemId:terminal.id,delta:'MUST_NOT_APPEND_AFTER_COMPLETION'})];
 await emit(current.connection,notifications);assertHistoryEqual(before,await snapshot(client,id));
});

test('actual owned native command success and failure keep exact per-turn tools, output and exit state',{timeout:20000},async t=>{
 const {app,client}=await setup(t),id='binding-native-commands';const completed=await finish(client,id,'FIXTURE_DEFER EDGE_ITEM:commandExecution:completed'),before=await snapshot(client,id),failed=await finish(client,id,'FIXTURE_DEFER EDGE_ITEM:commandExecution:failed'),after=await snapshot(client,id),connection=app.handler.runtime.connections.get(id),captured=await connection.rpc.request('test/edges/state',{},6000);
 assert.equal(captured.turnStarts.length,2);assert.equal(captured.operations.length,2);assert.deepEqual(after.runs[0],before.runs[0]);assert.deepEqual(after.entries.slice(0,2),before.entries);assert.deepEqual(after.tools[0],before.tools[0]);assert.deepEqual(after.terminalSessions[0],before.terminalSessions[0]);
 for(const [index,accepted,status,exitCode] of [[0,completed,'completed',0],[1,failed,'failed',7]]){const operation=captured.operations[index],run=after.runs.find(run=>run.id===accepted.response.value.runId),tool=after.tools.find(tool=>tool.id===operation.itemId),terminal=after.terminalSessions.find(item=>item.id===operation.itemId);assert.equal(operation.executed,true);assert.ok(operation.pid>0);assert.equal(operation.exitCode,exitCode);assert.equal(run.status,'completed');assert.equal(tool.runId,run.id);assert.equal(tool.turnId,run.turnId);assert.equal(tool.status,status);assert.equal(terminal.runId,run.id);assert.equal(terminal.status,status);assert.equal(terminal.exitCode,exitCode);assert.equal(tool.output,operation.output);assert.equal(terminal.stdout,operation.output);assert.ok(operation.output.includes('EDGE_STDOUT_'+status));assert.ok(operation.output.includes('EDGE_STDERR_'+status));}
});

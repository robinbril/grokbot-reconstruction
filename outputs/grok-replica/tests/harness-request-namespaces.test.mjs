// Historical protocol adapter coverage, not current product-provider execution.
// Production HTTP/runtime/durable state and real owned Chromium browser actions.
// The reused native-protocol fixture records dispatches; this is not installed-model proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';
const binary=fileURLToPath(new URL('./fixtures/harness-edges-codex-fixture.mjs',import.meta.url));
const post=(client,id,route,body)=>client.request('/conversations/'+id+'/'+route,{method:'POST',body});
const modelBody=requestId=>({requestId,text:'Independent namespace input '+requestId});
const browserBody=requestId=>({requestId,action:'browser_snapshot',arguments:{}});
const modelHash=body=>createHash('sha256').update(JSON.stringify({text:body.text,quote:body.quote??null,skillReferences:body.skillReferences??null})).digest('hex');
const browserHash=body=>JSON.stringify({action:body.action,arguments:body.arguments});
const browserTools=snapshot=>snapshot.tools.filter(tool=>tool.name.startsWith('browser_'));
async function setup(t){const app=await startHarness({codexBinary:binary});t.after(()=>app.close());return {app,client:await app.client()};}
async function finishModel(client,id,body){const response=await post(client,id,'runs',body);assert.equal(response.status,202,JSON.stringify(response));await collectUntil(client,response.value.runId,event=>event.runId===response.value.runId&&event.type==='run.completed');return response;}
async function takeBrowser(client,id,body){const response=await post(client,id,'browser',body);assert.equal(response.status,200,JSON.stringify(response));assert.equal(typeof response.value.result.captureId,'string');return response;}
async function assertReplays(client,id,model,browser,modelReceipt,browserReceipt){
 const run=await post(client,id,'runs',{...model});assert.equal(run.status,202,JSON.stringify(run));assert.deepEqual(run.value,modelReceipt.value);
 const frame=await post(client,id,'browser',structuredClone(browser));assert.equal(frame.status,200,JSON.stringify(frame));assert.deepEqual(frame.value,browserReceipt.value);
 const changedModel=await post(client,id,'runs',{...model,text:model.text+' changed'});assert.equal(changedModel.status,409);assert.equal(changedModel.value.error.code,'IDEMPOTENCY_CONFLICT');
 const changedBrowser=await post(client,id,'browser',{...browser,action:'browser_screenshot'});assert.equal(changedBrowser.status,409);assert.equal(changedBrowser.value.error.code,'IDEMPOTENCY_CONFLICT');
}
async function assertEffects(app,client,id,modelCount,browserCount){
 const snapshot=(await client.request('/conversations/'+id)).value;assert.equal(snapshot.runs.length,modelCount);assert.equal(snapshot.entries.filter(entry=>entry.role==='user').length,modelCount);assert.equal(browserTools(snapshot).length,browserCount);
 const connection=app.handler.runtime.connections.get(id);assert.ok(connection);const captured=await connection.rpc.request('test/edges/state',{},6000);assert.equal(captured.turnStarts.length,modelCount);return snapshot;
}

for(const order of ['browser-first','model-first'])for(const relation of ['same-id','prefix-related'])test('fresh '+relation+' requests remain independent with '+order,{timeout:30000},async t=>{
 const {app,client}=await setup(t),id='namespace-'+order+'-'+relation;
 const browser=browserBody('collision'),model=modelBody(relation==='same-id'?'collision':'browser_collision');let browserReceipt,modelReceipt;
 if(order==='browser-first'){browserReceipt=await takeBrowser(client,id,browser);modelReceipt=await finishModel(client,id,model);}else{modelReceipt=await finishModel(client,id,model);browserReceipt=await takeBrowser(client,id,browser);}
 await assertReplays(client,id,model,browser,modelReceipt,browserReceipt);await assertEffects(app,client,id,1,1);
});

test('valid repeated browser prefixes do not merge distinct route namespaces',{timeout:30000},async t=>{
 const {app,client}=await setup(t),id='namespace-prefix-chain',ids=['chain','browser_chain','browser_browser_chain'],receipts=[];
 for(const requestId of ids){const browser=browserBody(requestId),model=modelBody(requestId),browserReceipt=await takeBrowser(client,id,browser),modelReceipt=await finishModel(client,id,model);receipts.push({browser,model,browserReceipt,modelReceipt});}
 for(const receipt of receipts)await assertReplays(client,id,receipt.model,receipt.browser,receipt.modelReceipt,receipt.browserReceipt);
 await assertEffects(app,client,id,ids.length,ids.length);
});

test('fresh independent model and browser receipts remain distinct and effect-free on restart replay',{timeout:30000},async t=>{
 const app=await startHarness({codexBinary:binary});let restored;t.after(async()=>{await restored?.close();await app.close();await rm(app.dataDir,{recursive:true,force:true});});
 const client=await app.client(),id='namespace-restart',browser=browserBody('restart'),model=modelBody('browser_restart');
 const browserReceipt=await takeBrowser(client,id,browser),modelReceipt=await finishModel(client,id,model);const before=await assertEffects(app,client,id,1,1),auth={cookie:client.cookie,csrf:client.csrf};
 await app.close({keepData:true});restored=await startHarness({dataDir:app.dataDir,codexBinary:binary});const replayClient=await restored.client(auth);
 await assertReplays(replayClient,id,model,browser,modelReceipt,browserReceipt);
 const after=(await replayClient.request('/conversations/'+id)).value;assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.runs,before.runs);assert.deepEqual(after.tools,before.tools);
 const connection=restored.handler.runtime.connections.get(id);if(connection){const captured=await connection.rpc.request('test/edges/state',{},6000);assert.equal(captured.turnStarts.length,0);}assert.equal(browserTools(after).length,1);
});

function legacyBrowserReceipt(body,status='completed'){
 const response={schema:1,result:{captureId:'saved-legacy-frame',title:'Saved legacy browser receipt',pageUrl:'about:blank'},session:{id:'saved-browser-session',captureId:'saved-legacy-frame',title:'Saved legacy browser receipt',pageUrl:'about:blank'}};
 return {hash:browserHash(body),status,...(status==='completed'?{response}:{})};
}
function legacyModelReceipt(id,body){
 const createdAt='2026-10-17T00:00:00.000Z',runId=randomUUID(),inputEntryId=randomUUID(),outputEntryId=randomUUID(),threadId='legacy-thread-'+randomUUID();
 const response={schema:1,accepted:true,requestId:body.requestId,conversationId:id,runId,inputEntryId,outputEntryId,lastSeq:0,persistedAt:createdAt};
 return {receipt:{hash:modelHash(body),response},run:{id:runId,requestId:body.requestId,status:'completed',inputEntryId,outputEntryId,threadId,tools:[],approvals:[],finishedAt:createdAt},entries:[{id:inputEntryId,role:'user',runId,text:body.text,revision:1,status:'completed',createdAt},{id:outputEntryId,role:'assistant',runId,text:'Historical protocol fixture answer',revision:1,status:'completed',createdAt}],threadId};
}
async function legacySetup(t,id,{requests,runs=[],entries=[],threadId,offline=false}){
 const initial=await startHarness({codexBinary:binary});let restored;
 t.after(async()=>{await restored?.close();await initial.close();await rm(initial.dataDir,{recursive:true,force:true});});
 const firstClient=await initial.client(),owner=firstClient.cookie.split('=')[1],auth={cookie:firstClient.cookie,csrf:firstClient.csrf};
 await initial.handler.store.transaction(owner,id,()=>{});const allocated=initial.handler.store.get(owner,id);await initial.close({keepData:true});
 // Exact historical schema-1 format: raw model IDs and browser_<raw ID> receipts.
 // Do not depend on the repaired implementation's new storage representation.
 const historical={schema:1,owner,conversationId:id,workspaceRoot:allocated.workspaceRoot,entries,runs,tools:[],browserSessions:[],terminalSessions:[],servers:[],customServers:[],events:[],requests,lastSeq:0,persistedAt:'2026-10-17T00:00:00.000Z',...(threadId?{threadId}:{})};
 const filename=path.join(initial.dataDir,'conversation-'+id+'.json');await writeFile(filename,JSON.stringify(historical));assert.deepEqual(JSON.parse(await readFile(filename,'utf8')).requests,requests);
 restored=await startHarness({dataDir:initial.dataDir,codexBinary:offline?path.join(initial.dataDir,'provider-unavailable-must-not-dispatch'):binary});return {app:restored,client:await restored.client(auth),historical};
}

test('legacy completed browser receipt replays without becoming a conflicting model receipt',{timeout:30000},async t=>{
 const id='namespace-legacy-completed',browser=browserBody('legacy'),legacy=legacyBrowserReceipt(browser),{app,client}=await legacySetup(t,id,{requests:{browser_legacy:legacy}});
 const replay=await post(client,id,'browser',browser);assert.equal(replay.status,200,JSON.stringify(replay));assert.deepEqual(replay.value,legacy.response);
 const model=modelBody('browser_legacy'),modelReceipt=await finishModel(client,id,model);await assertReplays(client,id,model,browser,modelReceipt,{value:legacy.response});
 await assertEffects(app,client,id,1,0);
});

test('legacy pending browser receipt remains uncertain and never blocks or resends a fresh model request',{timeout:30000},async t=>{
 const id='namespace-legacy-pending',browser=browserBody('pending'),legacy=legacyBrowserReceipt(browser,'pending'),{app,client}=await legacySetup(t,id,{requests:{browser_pending:legacy}});
 const uncertain=()=>post(client,id,'browser',browser);let result=await uncertain();assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.value.error.code,'EFFECT_UNCERTAIN');
 const model=modelBody('browser_pending'),receipt=await finishModel(client,id,model);result=await uncertain();assert.equal(result.status,409);assert.equal(result.value.error.code,'EFFECT_UNCERTAIN');
 const replay=await post(client,id,'runs',model);assert.equal(replay.status,202);assert.deepEqual(replay.value,receipt.value);
 const changed=await post(client,id,'browser',{...browser,action:'browser_screenshot'});assert.equal(changed.status,409);assert.equal(changed.value.error.code,'IDEMPOTENCY_CONFLICT');await assertEffects(app,client,id,1,0);
});

test('legacy raw model receipt remains exactly replayable offline without reinterpretation or redispatch',{timeout:15000},async t=>{
 const id='namespace-legacy-model',model=modelBody('browser_legacy'),legacy=legacyModelReceipt(id,model),{app,client,historical}=await legacySetup(t,id,{requests:{[model.requestId]:legacy.receipt},runs:[legacy.run],entries:legacy.entries,threadId:legacy.threadId,offline:true});
 const replay=await post(client,id,'runs',model);assert.equal(replay.status,202,JSON.stringify(replay));assert.deepEqual(replay.value,legacy.receipt.response);
 const conflict=await post(client,id,'runs',{...model,text:model.text+' changed'});assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
 const after=(await client.request('/conversations/'+id)).value;assert.deepEqual(after.entries,historical.entries);assert.deepEqual(after.runs,historical.runs);assert.equal(after.threadId,legacy.threadId);assert.equal(after.tools.length,0);assert.equal(app.handler.runtime.connections.size,0);assert.equal(app.handler.runtime.connecting.size,0);assert.equal(app.handler.runtime.bridges.size,0);
});

test('coexisting typed legacy receipts preserve both histories while allowing absent cross-route IDs',{timeout:30000},async t=>{
 const id='namespace-legacy-coexist',oldModel=modelBody('browser_raw'),oldBrowser=browserBody('saved'),modelLegacy=legacyModelReceipt(id,oldModel),browserLegacy=legacyBrowserReceipt(oldBrowser);
 const {app,client}=await legacySetup(t,id,{requests:{browser_raw:modelLegacy.receipt,browser_saved:browserLegacy},runs:[modelLegacy.run],entries:modelLegacy.entries,threadId:modelLegacy.threadId});
 const modelReplay=await post(client,id,'runs',oldModel);assert.equal(modelReplay.status,202);assert.deepEqual(modelReplay.value,modelLegacy.receipt.response);
 const browserReplay=await post(client,id,'browser',oldBrowser);assert.equal(browserReplay.status,200);assert.deepEqual(browserReplay.value,browserLegacy.response);
 const freshBrowser=browserBody('raw'),browserReceipt=await takeBrowser(client,id,freshBrowser),freshModel=modelBody('browser_saved'),modelReceipt=await finishModel(client,id,freshModel);
 await assertReplays(client,id,freshModel,freshBrowser,modelReceipt,browserReceipt);
 assert.deepEqual((await post(client,id,'runs',oldModel)).value,modelLegacy.receipt.response);assert.deepEqual((await post(client,id,'browser',oldBrowser)).value,browserLegacy.response);
 const after=(await client.request('/conversations/'+id)).value;assert.equal(after.runs.length,2);assert.deepEqual(after.entries.slice(0,2),modelLegacy.entries);assert.equal(browserTools(after).length,1);const captured=await app.handler.runtime.connections.get(id).rpc.request('test/edges/state',{},6000);assert.equal(captured.turnStarts.length,1);
});

test('reserved Object names stay ordinary independent request IDs on both routes',{timeout:30000},async t=>{
 const {app,client}=await setup(t),id='namespace-reserved',names=['constructor','toString','valueOf'];
 for(const name of names){const model=modelBody(name),browser=browserBody(name),modelReceipt=await finishModel(client,id,model),browserReceipt=await takeBrowser(client,id,browser);await assertReplays(client,id,model,browser,modelReceipt,browserReceipt);}
 await assertEffects(app,client,id,names.length,names.length);
});

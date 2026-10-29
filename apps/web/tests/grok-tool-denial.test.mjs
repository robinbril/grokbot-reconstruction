import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {createBrowserTools,browserToolDefinitions} from '../harness/browser-tools.mjs';

const ready={status:()=>({state:'ready',provider:'synthetic-denial-test'})};
const request=names=>({toolCalls:names.map(name=>({id:name,name,arguments:{value:42}}))});
const reply=()=>({toolCalls:[{id:'reply',name:'SendMessage',arguments:{text:{content:'The declined action was not executed.'}}}]});
async function fixture(t,{complete,call}={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-tool-denial-')),store=await new HarnessStore({dataDir}).init(),effects=[];
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{...ready,complete},toolHostFactory:async({authorizeInteraction})=>({
  getDefinitions:()=>['Danger','Effect','Spoof'].map(name=>({name,requiresApproval:name==='Danger',inputSchema:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}})),
  async call(name,args,options){effects.push(name);return call?call(name,args,dataDir,{authorizeInteraction,options}):{confirmed:name};},close:async()=>{},
 })});
 const runtimes=new Set([runtime]);
 t.after(async()=>{for(const owned of runtimes)await owned.close();await rm(dataDir,{recursive:true,force:true});});
 const start=async requestId=>{const accepted=await runtime.start('synthetic','one',{requestId,text:'Synthetic '+requestId});return {...accepted,done:runtime.jobs.get(accepted.runId).promise};};
 return {runtime,store,dataDir,effects,start,runtimes};
}
async function pending(app,attempts=200){
 for(let attempt=0;attempt<attempts;attempt++){
  const run=app.store.get('synthetic','one')?.runs.at(-1),approval=run?.approvals.find(item=>item.status==='pending');
  if(approval)return {run,approval};await delay(5);
 }
 assert.fail('Expected exact pending approval');
}
async function reject(app){const {run,approval}=await pending(app);await app.runtime.decide('synthetic',run.id,approval.id,'reject');return approval;}
const toolResult=(messages,id)=>JSON.parse(messages.find(message=>message.role==='tool'&&message.tool_call_id===id).content);

test('explicit rejection reaches the model as a durable confirmed no-effect result and permits a final reply',async t=>{
 let rounds=0,received;
 const app=await fixture(t,{complete:async({messages})=>{if(++rounds===1)return request(['Danger']);received=structuredClone(messages);return reply();}});
 const started=await app.start('first'),approval=await reject(app);await started.done;
 const state=app.store.get('synthetic','one');assert.equal(state.runs[0].status,'completed');assert.deepEqual(app.effects,[]);
 const result=toolResult(received,'Danger');
 assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'TOOL_DENIED');assert.equal(result.structuredContent.executed,false);
 assert.equal(result.structuredContent.approvalId,approval.id);assert.equal(result.structuredContent.callId,'Danger');
 assert.match(result.content[0].text,/not executed/i);
 const durable=state.tools.find(tool=>tool.callId==='Danger');assert.equal(durable.approvalId,approval.id);assert.deepEqual(JSON.parse(durable.output),result);
 assert.equal(state.entries.at(-1).text,'The declined action was not executed.');
});

test('an earlier actual confirmed effect survives a later rejection and safe final reply',async t=>{
 let rounds=0,received;
 const app=await fixture(t,{complete:async({messages})=>{if(++rounds===1)return request(['Effect','Danger']);received=structuredClone(messages);return reply();},
  call:async(name,args,dataDir)=>{await appendFile(path.join(dataDir,'effect.txt'),'ACTUAL_EFFECT_42\n');return {confirmed:'ACTUAL_EFFECT_42'};}});
 const started=await app.start('first');await reject(app);await started.done;
 assert.equal(app.store.get('synthetic','one').runs[0].status,'completed');
 assert.deepEqual(app.effects,['Effect']);assert.equal(await readFile(path.join(app.dataDir,'effect.txt'),'utf8'),'ACTUAL_EFFECT_42\n');
 assert.deepEqual(toolResult(received,'Effect'),{confirmed:'ACTUAL_EFFECT_42'});assert.equal(toolResult(received,'Danger').structuredContent.executed,false);
});

test('cancelling a pending approval never becomes explicit rejection or another model inference',async t=>{
 let rounds=0;
 const app=await fixture(t,{complete:async()=>{rounds++;return request(['Danger']);}});
 const started=await app.start('first');await pending(app);await app.runtime.cancel('synthetic',started.runId);await started.done;
 const state=app.store.get('synthetic','one');assert.equal(state.runs[0].status,'cancelled');assert.equal(rounds,1);assert.deepEqual(app.effects,[]);
 assert.equal(state.tools.some(tool=>tool.approvalId),false);
});

test('a host-spoofed TOOL_DENIED after an actual effect remains uncertain and is never a local rejection',async t=>{
 let rounds=0,received;
 const app=await fixture(t,{complete:async({messages})=>{if(++rounds===1)return request(['Spoof']);received=structuredClone(messages);return reply();},
  call:async(name,args,dataDir)=>{await appendFile(path.join(dataDir,'spoof.txt'),'ACTUAL_SPOOF_EFFECT_42\n');throw Object.assign(new Error('Synthetic host error after effect'),{code:'TOOL_DENIED'});}});
 const started=await app.start('first');await started.done;
 assert.equal(app.store.get('synthetic','one').runs[0].status,'interrupted');assert.equal(rounds,1);
 const followup=await app.start('follow-up');await followup.done;
 assert.equal(await readFile(path.join(app.dataDir,'spoof.txt'),'utf8'),'ACTUAL_SPOOF_EFFECT_42\n');assert.deepEqual(app.effects,['Spoof']);
 const result=toolResult(received,'Spoof');assert.match(result.error,/uncertain/i);assert.equal(result.structuredContent,undefined);
});

for(const earlierEffect of [false,true])test((earlierEffect?'confirmed effect plus rejection':'rejection only')+' followed by a model error retains the correct outcome',async t=>{
 let rounds=0;
 const app=await fixture(t,{complete:async()=>{if(++rounds===1)return request(earlierEffect?['Effect','Danger']:['Danger']);throw Error('Synthetic later model error');}});
 const started=await app.start('first');await reject(app);await started.done;
 const state=app.store.get('synthetic','one');assert.equal(rounds,2);assert.deepEqual(app.effects,earlierEffect?['Effect']:[]);
 assert.equal(state.runs[0].status,earlierEffect?'interrupted':'failed');
});

test('direct runtime callers still receive TOOL_DENIED without executing the rejected operation',async t=>{
 const app=await fixture(t,{complete:async({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 const started=await app.start('direct'),connection=app.runtime.connections.get('one');
 const denied=app.runtime.callTool(connection,'Danger',{value:42},{runId:started.runId,callId:'direct-call'});
 const rejected=assert.rejects(denied,{code:'TOOL_DENIED'});await reject(app);await rejected;
 assert.deepEqual(app.effects,[]);await app.runtime.cancel('synthetic',started.runId);await started.done;
});

test('the rejected approval and no-effect receipt survive a crash before the turn receives the denial',async t=>{
 let rounds=0,received;
 const app=await fixture(t,{complete:async()=>{rounds++;return request(['Danger']);}});
 const original=app.runtime.requestApproval.bind(app.runtime);let entered;
 const held=new Promise(resolve=>{entered=resolve;});
 app.runtime.requestApproval=async(connection,options)=>{
  const decision=await original(connection,options);entered();
  await new Promise((resolve,reject)=>{const abort=()=>reject(options.signal.reason);options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();});
  return decision;
 };
 const started=await app.start('first'),approval=await reject(app);await held;
 const checkpoint=await readFile(path.join(app.dataDir,'conversation-one.json'),'utf8');
 const recorded=JSON.parse(checkpoint),durable=recorded.tools.find(tool=>tool.approvalId===approval.id);
 assert.ok(durable);assert.equal(JSON.parse(durable.output).structuredContent.executed,false);
 await app.runtime.cancel('synthetic',started.runId);await started.done;
 const restoreDir=path.join(app.dataDir,'checkpoint'),restored=await new HarnessStore({dataDir:restoreDir}).init();
 await writeFile(path.join(restoreDir,'conversation-one.json'),checkpoint);
 await restored.init();
 const runtime=new GrokRuntime({store:restored,baseUrl:'http://127.0.0.1:8999',model:{...ready,complete:async({messages})=>{received=structuredClone(messages);return reply();}}});app.runtimes.add(runtime);
 const accepted=await runtime.start('synthetic','one',{requestId:'after-restart',text:'Review rejected operation'});await runtime.jobs.get(accepted.runId).promise;
 const result=toolResult(received,'Danger');assert.equal(result.structuredContent.executed,false);assert.equal(result.structuredContent.approvalId,approval.id);
 assert.equal(restored.get('synthetic','one').runs.at(-1).status,'completed');assert.deepEqual(app.effects,[]);
});


test('nested Chromium interaction rejection binds the model call and permits a confirmed no-effect reply',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-browser-denial-')),store=await new HarnessStore({dataDir}).init();
 let rounds=0,received,browser;
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{...ready,complete:async({messages})=>{
  if(++rounds===1)return {toolCalls:[{id:'nested-browser-call',name:'browser_scroll',arguments:{direction:'down',pixels:100}}]};
  received=structuredClone(messages);return reply();
 }},toolHostFactory:async({authorizeInteraction})=>{
  browser=createBrowserTools({authorizeInteraction});
  return {getDefinitions:()=>browserToolDefinitions,call:(...args)=>browser.callTool(...args),close:()=>browser.close()};
 }});
 t.after(async()=>{await runtime.close();await rm(dataDir,{recursive:true,force:true});});
 let release,receivedDecision;
 const original=runtime.requestApproval.bind(runtime),decisionReceived=new Promise(resolve=>{receivedDecision=resolve;}),held=new Promise(resolve=>{release=resolve;});
 runtime.requestApproval=async(...args)=>{const decision=await original(...args);receivedDecision();await held;return decision;};
 const started=await runtime.start('synthetic','one',{requestId:'nested',text:'Synthetic browser action'}),done=runtime.jobs.get(started.runId).promise;
 const app={runtime,store},{approval}=await pending(app,2000);await runtime.decide('synthetic',started.runId,approval.id,'reject');await decisionReceived;
 const checkpoint=JSON.parse(await readFile(path.join(dataDir,'conversation-one.json'),'utf8'));
 const persisted=checkpoint.tools.find(tool=>tool.callId==='nested-browser-call');
 assert.equal(persisted.approvalId,approval.id);assert.equal(JSON.parse(persisted.output).structuredContent.executed,false);
 release();await done;
 const state=store.get('synthetic','one');
 assert.equal(state.runs[0].status,'completed');assert.equal(rounds,2);
 assert.equal(approval.kind,'browser.interaction');assert.equal(approval.callId,'nested-browser-call');
 const result=toolResult(received,'nested-browser-call');
 assert.equal(result.structuredContent.code,'TOOL_DENIED');assert.equal(result.structuredContent.executed,false);
 const receipt=state.tools.find(tool=>tool.callId==='nested-browser-call');
 assert.equal(receipt.approvalId,approval.id);assert.deepEqual(JSON.parse(receipt.output),result);
 assert.equal(state.tools.filter(tool=>tool.callId==='nested-browser-call').length,1);
 assert.equal(browser.browserState(),undefined);
});


test('a host cannot forge a nested browser approval after an effect and claim no execution',async t=>{
 let rounds=0;
 const app=await fixture(t,{complete:async()=>{rounds++;return request(['Spoof']);},
  call:async(name,args,dataDir,{authorizeInteraction,options})=>{
   await appendFile(path.join(dataDir,'spoof-nested.txt'),'ACTUAL_EFFECT_42\n');
   try{await authorizeInteraction({action:name,arguments:args,pageUrl:'about:blank',signal:options.signal});}
   catch{throw Object.assign(new Error('Forged nested denial'),{code:'TOOL_DENIED'});}
  }});
 const started=await app.start('forged-nested');await started.done;
 const state=app.store.get('synthetic','one');
 assert.equal(state.runs[0].status,'interrupted');assert.equal(rounds,1);assert.equal(state.runs[0].approvals.length,0);
 assert.equal(state.tools.some(tool=>tool.approvalId),false);
 assert.equal(await readFile(path.join(app.dataDir,'spoof-nested.txt'),'utf8'),'ACTUAL_EFFECT_42\n');
});

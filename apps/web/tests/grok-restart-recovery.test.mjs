import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';

async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-restart-recovery-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 return {dataDir,store:await new HarnessStore({dataDir}).init()};
}
const runningTool=(id,runId)=>({id,callId:id,runId,name:'SyntheticEffect',status:'running',arguments:{value:42},startedAt:'2026-10-20T00:00:00.000Z'});

test('restart terminates unconfirmed model tools while retaining confirmed receipts and payloads',async t=>{
 const {store,dataDir}=await setup(t);
 const completed={id:'confirmed',runId:'run',callId:'confirmed',name:'Check',status:'completed',output:'{"actual":"confirmed"}',finishedAt:'2026-10-20T00:00:01.000Z'};
 const failed={id:'failed',runId:'run',callId:'failed',name:'Check',status:'failed',error:'Actual rejection',finishedAt:'2026-10-20T00:00:02.000Z'};
 await store.transaction('synthetic','one',s=>{
  s.entries.push({id:'output',role:'assistant',runId:'run',text:'',status:'running',revision:1});
  s.runs.push({id:'run',status:'running',outputEntryId:'output',approvals:[],tools:['pending','confirmed','failed']});
  s.tools.push(runningTool('pending','run'),completed,failed);
 });
 const restored=await new HarnessStore({dataDir}).init(),state=restored.get('synthetic','one'),tool=state.tools[0];
 assert.equal(state.runs[0].status,'interrupted');assert.equal(tool.status,'interrupted');
 assert.equal(tool.error.code,'SERVER_RESTART');assert.match(tool.error.message,/uncertain|incomplete/i);
 assert.ok(Number.isFinite(Date.parse(tool.finishedAt)));assert.deepEqual(tool.arguments,{value:42});
 assert.equal(Object.hasOwn(tool,'output'),false);assert.deepEqual(state.tools.slice(1),[completed,failed]);
 assert.deepEqual(restored.snapshot(state).tools,state.tools);
 assert.deepEqual(JSON.parse(await readFile(path.join(dataDir,'conversation-one.json'),'utf8')).tools,state.tools);
 const events=state.events.filter(event=>event.type==='tool.interrupted');
 assert.equal(events.length,1);assert.equal(events[0].runId,'run');assert.deepEqual(events[0].data.tool,tool);
});

test('restart repairs standalone tools with no active run and recovery is durable and idempotent',async t=>{
 const {store,dataDir}=await setup(t);
 await store.transaction('synthetic','direct',s=>{s.tools.push({...runningTool('browser',null),name:'browser_click'});});
 const restarted=await new HarnessStore({dataDir}).init(),first=restarted.get('synthetic','direct');
 assert.equal(first.tools[0].status,'interrupted');assert.equal(first.tools[0].error.code,'SERVER_RESTART');
 assert.equal(first.events.length,1);assert.equal(first.events[0].type,'tool.interrupted');assert.equal(first.events[0].runId,null);
 assert.deepEqual(JSON.parse(await readFile(path.join(dataDir,'conversation-direct.json'),'utf8')).tools,first.tools);
 const twice=(await new HarnessStore({dataDir}).init()).get('synthetic','direct');
 assert.deepEqual(twice,first);
});

test('next turn treats an interrupted tool as uncertain without replaying it or losing confirmed results',async t=>{
 const {store,dataDir}=await setup(t);
 await store.transaction('synthetic','history',s=>{
  s.entries.push({id:'output',role:'assistant',runId:'old',text:'',status:'running',revision:1});
  s.runs.push({id:'old',status:'running',outputEntryId:'output',approvals:[],tools:['confirmed','pending']});
  s.tools.push({id:'confirmed',runId:'old',callId:'confirmed',name:'Check',status:'completed',output:'{"actual":"confirmed-first-effect"}'},runningTool('pending','old'));
  s.agentHistory=[{role:'assistant',content:'',tool_calls:['confirmed','pending'].map(id=>({id,type:'function',function:{name:'Check',arguments:'{}'}}))}];
 });
 const restarted=await new HarnessStore({dataDir}).init();let modelCalls=0,toolEffects=0;
 const runtime=new GrokRuntime({store:restarted,baseUrl:'http://127.0.0.1:8999',model:{status:()=>({state:'ready'}),complete:async({messages})=>{
  modelCalls++;
  assert.equal(messages.find(message=>message.role==='tool'&&message.tool_call_id==='confirmed').content,'{"actual":"confirmed-first-effect"}');
  const pending=JSON.parse(messages.find(message=>message.role==='tool'&&message.tool_call_id==='pending').content);
  assert.match(pending.error,/uncertain/);assert.match(pending.error,/Do not assume success or automatically repeat/);
  return {toolCalls:[{id:'reply',name:'SendMessage',arguments:{text:{content:'Review prior effects before repeating them.'}}}]};
 }},toolHostFactory:async()=>({getDefinitions:()=>[],call:async()=>{toolEffects++;},close:async()=>{}})});
 t.after(()=>runtime.close());
 const accepted=await runtime.start('synthetic','history',{requestId:'follow-up',text:'What happened before restart?'});
 await runtime.jobs.get(accepted.runId).promise;
 assert.equal(modelCalls,1);assert.equal(toolEffects,0);
 const state=restarted.get('synthetic','history');assert.equal(state.runs[1].status,'completed');
 assert.equal(state.tools.find(tool=>tool.id==='pending').status,'interrupted');
 assert.equal(state.entries.at(-1).text,'Review prior effects before repeating them.');
});

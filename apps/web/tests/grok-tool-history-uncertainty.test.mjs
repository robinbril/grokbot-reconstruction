import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,appendFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';

const ready={status:()=>({state:'ready',provider:'synthetic-uncertainty-fixture'})};
const calls=names=>names.map(name=>({id:name,name,arguments:{}}));
async function fixture(t,{names,call,complete}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-tool-uncertainty-'));
 const store=await new HarnessStore({dataDir}).init();
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{...ready,complete},toolHostFactory:async()=>({
  getDefinitions:()=>names.map(name=>({name,inputSchema:{type:'object',additionalProperties:false}})),
  call,close:async()=>{},
 })});
 t.after(async()=>{await runtime.close();await rm(dataDir,{recursive:true,force:true});});
 const run=async requestId=>{
  const accepted=await runtime.start('synthetic','one',{requestId,text:'Synthetic '+requestId});
  await runtime.jobs.get(accepted.runId).promise;
  return store.get('synthetic','one');
 };
 return {store,runtime,dataDir,run};
}
const reply=()=>({toolCalls:[{id:'reply',name:'SendMessage',arguments:{text:{content:'Review the uncertain operation before repeating it.'}}}]});

test('actual effect followed by a thrown transport error stays explicitly uncertain in the next model input',async t=>{
 let round=0,received,executions=0,marker;
 const app=await fixture(t,{names:['Confirmed','LostResult'],
  async call(name){
   executions++;if(name==='Confirmed')return {receipt:'CONFIRMED_RECEIPT_42'};
   await appendFile(marker,'ACTUAL_EFFECT_42\n');
   throw Object.assign(new Error('Synthetic connection closed before result'),{code:'SYNTHETIC_CONNECTION_CLOSED'});
  },
  async complete({messages}){if(++round===1)return {toolCalls:calls(['Confirmed','LostResult'])};received=structuredClone(messages);return reply();},
 });
 marker=path.join(app.dataDir,'effect.txt');
 const first=await app.run('first');assert.equal(first.runs[0].status,'interrupted');
 assert.equal(await readFile(marker,'utf8'),'ACTUAL_EFFECT_42\n');
 const missing=first.tools.find(tool=>tool.callId==='LostResult');assert.equal(missing.output,undefined);
 const second=await app.run('follow-up');assert.equal(second.runs[1].status,'completed');
 assert.equal(executions,2);assert.equal(await readFile(marker,'utf8'),'ACTUAL_EFFECT_42\n');
 assert.match(received.find(message=>message.role==='tool'&&message.tool_call_id==='Confirmed').content,/CONFIRMED_RECEIPT_42/);
 const uncertain=received.find(message=>message.role==='tool'&&message.tool_call_id==='LostResult');
 assert.match(uncertain.content,/uncertain/i);
 assert.match(uncertain.content,/Do not assume success or automatically repeat/i);
 assert.equal(JSON.parse(uncertain.content).cause,'Synthetic connection closed before result');
});

test('an actual isError result remains an exact confirmed receipt when a later call throws',async t=>{
 let round=0,received;
 const result={isError:true,content:[{type:'text',text:'EXPLICIT_REMOTE_ERROR_42'}]};
 const app=await fixture(t,{names:['RemoteError','Missing'],
  async call(name){if(name==='RemoteError')return result;throw new Error('Synthetic missing second result');},
  async complete({messages}){if(++round===1)return {toolCalls:calls(['RemoteError','Missing'])};received=structuredClone(messages);return reply();},
 });
 const first=await app.run('first');assert.equal(first.runs[0].status,'interrupted');
 const receipt=first.tools.find(tool=>tool.callId==='RemoteError');assert.equal(receipt.status,'failed');
 await app.run('follow-up');
 assert.equal(received.find(message=>message.role==='tool'&&message.tool_call_id==='RemoteError').content,receipt.output);
 assert.deepEqual(JSON.parse(receipt.output),result);
});

test('previously persisted bare failed-tool history does not become a confirmed failure after restart',async t=>{
 let received;
 const app=await fixture(t,{names:[],call:async()=>assert.fail('No effects may be replayed'),complete:async({messages})=>{received=structuredClone(messages);return reply();}});
 await app.store.transaction('synthetic','one',state=>{
  state.entries.push({id:'prior-output',role:'assistant',runId:'prior',status:'interrupted',text:'',revision:1});
  state.runs.push({id:'prior',status:'interrupted',outputEntryId:'prior-output',approvals:[],tools:['lost']});
  state.tools.push({id:'lost',callId:'lost',runId:'prior',name:'LostResult',status:'failed',error:'Synthetic connection closed before result'});
  state.agentHistory=[
   {role:'assistant',content:'',tool_calls:[{id:'lost',type:'function',function:{name:'LostResult',arguments:'{}'}}]},
   {role:'tool',tool_call_id:'lost',content:JSON.stringify({error:'Synthetic connection closed before result'})},
  ];
 });
 await app.runtime.close();
 const restarted=await new HarnessStore({dataDir:app.dataDir}).init();
 const runtime=new GrokRuntime({store:restarted,baseUrl:'http://127.0.0.1:8999',model:{...ready,complete:async({messages})=>{received=structuredClone(messages);return reply();}}});
 t.after(()=>runtime.close());
 const accepted=await runtime.start('synthetic','one',{requestId:'after-restart',text:'Review prior unknown outcome'});
 await runtime.jobs.get(accepted.runId).promise;
 assert.equal(restarted.get('synthetic','one').runs.at(-1).status,'completed');
 const uncertain=received.find(message=>message.role==='tool'&&message.tool_call_id==='lost');
 assert.match(uncertain.content,/uncertain/i);
 assert.match(uncertain.content,/Do not assume success or automatically repeat/i);
});

test('uncertainty repair keeps an older confirmed receipt when a later run reuses its call ID',async t=>{
 let received;
 const app=await fixture(t,{names:[],call:async()=>assert.fail('No effects may be replayed'),complete:async({messages})=>{received=structuredClone(messages);return reply();}});
 const call={id:'reused',type:'function',function:{name:'Check',arguments:'{}'}};
 await app.store.transaction('synthetic','one',state=>{
  state.runs.push({id:'old',status:'completed',approvals:[],tools:[]},{id:'recent',status:'interrupted',approvals:[],tools:['lost']});
  state.tools.push({id:'lost',callId:'reused',runId:'recent',name:'Check',status:'failed',error:'Synthetic missing recent result'});
  state.agentHistory=[
   {role:'assistant',content:'',tool_calls:[call]},
   {role:'tool',tool_call_id:'reused',content:'OLDER_CONFIRMED_RECEIPT_42'},
   {role:'user',content:'Second task'},
   {role:'assistant',content:'',tool_calls:[call]},
   {role:'tool',tool_call_id:'reused',content:JSON.stringify({error:'Synthetic missing recent result'})},
  ];
 });
 await app.run('follow-up');
 const results=received.filter(message=>message.role==='tool'&&message.tool_call_id==='reused');
 assert.equal(results.length,2);assert.equal(results[0].content,'OLDER_CONFIRMED_RECEIPT_42');
 assert.match(results[1].content,/uncertain/i);
});

test('recovered missing-result cause stays bounded without losing its uncertainty warning',async t=>{
 let received;
 const app=await fixture(t,{names:[],call:async()=>assert.fail('No effects may be replayed'),complete:async({messages})=>{received=structuredClone(messages);return reply();}});
 await app.store.transaction('synthetic','one',state=>{
  state.runs.push({id:'prior',status:'interrupted',approvals:[],tools:['lost']});
  state.tools.push({id:'lost',callId:'lost',runId:'prior',name:'Check',status:'failed',error:'Synthetic large diagnostic '+'.'.repeat(10000)});
  state.agentHistory=[{role:'assistant',content:'',tool_calls:[{id:'lost',type:'function',function:{name:'Check',arguments:'{}'}}]}];
 });
 await app.run('follow-up');
 const content=JSON.parse(received.find(message=>message.role==='tool'&&message.tool_call_id==='lost').content);
 assert.match(content.error,/uncertain/i);assert.match(content.cause,/Synthetic large diagnostic/);
 assert.ok(content.cause.length<=2050);assert.match(content.cause,/truncated/);
});

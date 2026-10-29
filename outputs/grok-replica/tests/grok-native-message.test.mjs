import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {sendDefinition,validateArguments} from '../harness/grok-turns.mjs';

async function setup(t,complete){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-native-message-'));
 const store=await new HarnessStore({dataDir}).init();
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{status:async()=>({state:'ready'}),complete}});
 t.after(()=>runtime.close());return {store,runtime,dataDir};
}
async function finished(runtime,store,requestId='native-text'){
 const accepted=await runtime.start('fixture','one',{requestId,text:'Reply with synthetic text'});
 await runtime.jobs.get(accepted.runId).promise;return store.states.get('one');
}
const call=(id,args)=>({id,name:'SendMessage',arguments:args});

test('SendMessage advertises native nested text arguments',()=>{
 assert.equal(sendDefinition.inputSchema.oneOf.length,2);
 assert.doesNotThrow(()=>validateArguments(sendDefinition.inputSchema,{text:{content:'Hello'}}));
 assert.throws(()=>validateArguments(sendDefinition.inputSchema,{message:'legacy'}),{code:'INVALID_TOOL_ARGUMENTS'});
});

test('separate native text deliveries retain exact content and renderer text aggregation',async t=>{
 const args=[{text:{content:' First\nmessage '}},{text:{content:'Second 😀'}}];
 const {runtime,store,dataDir}=await setup(t,async()=>({toolCalls:args.map((args,i)=>call('answer-'+i,args))}));
 const state=await finished(runtime,store);
 assert.equal(state.runs[0].status,'completed');
 assert.equal(state.entries[1].text,' First\nmessage \n\nSecond 😀');
 assert.deepEqual(state.entries[1].messages.map(({id,createdAt,...message})=>{assert.match(id,/^[0-9a-f-]{36}$/);assert.ok(Number.isFinite(Date.parse(createdAt)));return message;}),args.map((args,i)=>({callId:'answer-'+i,type:'text',content:args.text.content})));
 assert.deepEqual(state.tools.map(tool=>tool.arguments),args);
 assert.equal(state.entries[1].delivery,'delivered');
 assert.equal(state.entries[1].streaming,false);
 const reloaded=(await new HarnessStore({dataDir}).init()).states.get('one');
 assert.deepEqual(reloaded.entries[1].messages,state.entries[1].messages);
 const c=runtime.connections.get('one');
 await assert.rejects(runtime.recordMessage(c,state.runs[0].id,call('answer-0',args[0])),{code:'MODEL_RESPONSE_INVALID'});
 assert.equal(store.states.get('one').entries[1].messages.length,2);
});

for(const [name,args]of Object.entries({legacy:{message:'legacy'},missing:{text:{}},wrongType:{text:{content:7}},extraText:{text:{content:'Hello',extra:true}},mixedLegacy:{text:{content:'Hello'},message:'legacy'},mixedAttachment:{text:{content:'Hello'},attachment:{url:'https://example.invalid/file'}},empty:{text:{content:' \n '}},oversized:{text:{content:'x'.repeat(131073)}}})){
 test('unsupported or invalid '+name+' cannot create a delivered receipt',async t=>{
  const {runtime,store}=await setup(t,async()=>({toolCalls:[call('rejected',args)]}));
  const state=await finished(runtime,store);
  assert.equal(state.runs[0].status,'failed');
  assert.equal(state.runs[0].error.code,'INVALID_TOOL_ARGUMENTS');
  assert.equal(state.tools.length,0);assert.equal(state.entries[1].text,'');
  assert.equal(state.entries[1].messages,undefined);assert.notEqual(state.entries[1].delivery,'delivered');
 });
}

test('persisted legacy SendMessage history remains readable with new native calls',async t=>{
 const oldCall={role:'assistant',content:'',tool_calls:[{id:'old',type:'function',function:{name:'SendMessage',arguments:JSON.stringify({message:'Prior answer'})}}]};
 const {runtime,store}=await setup(t,async({messages})=>{
  assert.deepEqual(messages.find(row=>row.role==='assistant'),oldCall);
  assert.ok(messages.some(row=>row.role==='tool'&&row.tool_call_id==='old'));
  return {toolCalls:[call('new',{text:{content:'Current answer'}})]};
 });
 await store.transaction('fixture','one',state=>{state.agentHistory=[oldCall,{role:'tool',tool_call_id:'old',content:'{"sent":true}'}];});
 assert.equal((await finished(runtime,store)).runs[0].status,'completed');
});

for(const outcome of ['failure','mismatch'])test('unconfirmed streamed '+outcome+' has no transcript message record',async t=>{
 const {runtime,store}=await setup(t,async({onEvent})=>{
  await onEvent({type:'message.delta',callId:'partial',text:'Partial'});
  if(outcome==='failure')throw new Error('synthetic stream failure');
  return {toolCalls:[call('partial',{text:{content:'Different'}})]};
 });
 const state=await finished(runtime,store);
 assert.equal(state.runs[0].status,'failed');assert.equal(state.entries[1].text,'Partial');
 assert.equal(state.entries[1].delivery,'partial');assert.equal(state.entries[1].messages,undefined);
 assert.equal(state.tools.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {claudeInput} from '../harness/claude-streaming.mjs';
import {xaiMessages} from '../harness/xai-envelope.mjs';
const png=await readFile(new URL('./fixtures/model-attachments/vision.png',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const image={type:'image',mimeType:'image/png',data:png.toString('base64')};
const send=id=>({toolCalls:[{id,name:'SendMessage',arguments:{text:{content:'Synthetic screenshot received'}}}]});
async function setup(t,{result,frame,definition={name:'Observe',serverId:'custom_fixture',inputSchema:{type:'object'}},inspect,observeAgain=false}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-tool-vision-'));let round=0,effects=0;
 const store=await new HarnessStore({dataDir}).init();
 const model={status:()=>({state:'ready'}),async complete({messages}){
  round++;if(round===1||observeAgain&&round===3)return {toolCalls:[{id:'observe-1',name:definition.name,arguments:{}}]};
  await inspect(messages,round);return send('answer-'+round);
 }};
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model,toolHostFactory:async()=>({getDefinitions:()=>[definition],call:async()=>{effects++;return result;},frame,close:async()=>{}})});
 t.after(async()=>{await runtime.close();await rm(dataDir,{recursive:true,force:true});});
 const run=async requestId=>{const accepted=await runtime.start('synthetic-owner','vision',{requestId,text:'Inspect the synthetic tool result.'});await runtime.jobs.get(accepted.runId).promise;return store.get('synthetic-owner','vision');};
 return {run,store,runtime,dataDir,effects:()=>effects,round:()=>round};
}
function toolMessage(messages){return messages.find(m=>m.role==='tool'&&m.tool_call_id==='observe-1');}
test('MCP image pixels reach both model adapters without leaking inline bytes into durable history',async t=>{
 const probe=await setup(t,{result:{content:[{type:'text',text:'Synthetic tool observation'},image],_meta:{fixture:true}},inspect(messages,round){
  const message=toolMessage(messages);
  if(round===2){
   assert.ok(Array.isArray(message.content),'tool image must be actual multimodal input');
   assert.equal(message.content.filter(p=>p.type==='image_url').length,1);
   const seat=JSON.parse(claudeInput(messages,[]));assert.equal(seat.message.content.filter(p=>p.type==='image').length,1);
   assert.equal(xaiMessages(messages,[])[1].content.filter(p=>p.type==='image_url').length,1);
  }else{assert.equal(typeof message.content,'string');assert.match(message.content,/image|pixels/i);}
 }});
 let state=await probe.run('first');assert.equal(state.runs[0].status,'completed');
 const receipt=state.tools.find(tool=>tool.callId==='observe-1').output;
 assert.ok(!receipt.includes(image.data));assert.ok(receipt.includes(sha(png)));assert.match(receipt,/Synthetic tool observation/);
 assert.ok(!JSON.stringify(state.agentHistory).includes(image.data));
 const persisted=await readFile(path.join(probe.dataDir,'conversation-vision.json'),'utf8');assert.ok(!persisted.includes(image.data));
 state=await probe.run('second');assert.equal(state.runs[1].status,'completed');assert.equal(probe.effects(),1);
});
test('owned browser capture supplies its exact retained frame to the next model step',async t=>{
 let reads=0;const probe=await setup(t,{result:{captureId:'owned-frame',pageUrl:'http://127.0.0.1:8999/preview'},definition:{name:'browser_screenshot',serverId:'grok_workspace',inputSchema:{type:'object'}},frame(id){reads++;assert.equal(id,'owned-frame');return {bytes:png,contentType:'image/png'};},inspect(messages){assert.ok(toolMessage(messages).content.some?.(p=>p.type==='image_url'),'owned frame pixels must reach model');}});
 assert.equal((await probe.run('first')).runs[0].status,'completed');assert.equal(reads,1);
});
test('a connector cannot claim an owned browser capture by returning its ID',async t=>{
 let reads=0;const probe=await setup(t,{result:{captureId:'owned-frame'},frame(){reads++;return {bytes:png,contentType:'image/png'};},inspect(messages){assert.equal(typeof toolMessage(messages).content,'string');}});
 assert.equal((await probe.run('first')).runs[0].status,'completed');assert.equal(reads,0);
});
test('invalid image stops inference without resending the already confirmed tool effect',async t=>{
 const probe=await setup(t,{result:{content:[{type:'image',mimeType:'image/png',data:'not a valid base64 image'}]},inspect(){assert.fail('invalid image must not reach next inference');}});
 const state=await probe.run('first');assert.equal(state.runs[0].status,'interrupted');assert.equal(state.runs[0].error.code,'TOOL_IMAGE_INVALID');
 assert.equal(probe.effects(),1);assert.equal(probe.round(),1);assert.equal(state.tools[0].status,'completed');
 assert.ok(!state.tools[0].output.includes('not a valid base64 image'));
});
test('expired owned browser pixels fail explicitly instead of pretending metadata is vision',async t=>{
 const probe=await setup(t,{result:{captureId:'expired'},definition:{name:'browser_screenshot',serverId:'grok_workspace',inputSchema:{type:'object'}},frame(){return undefined;},inspect(){assert.fail('missing frame must not silently reach inference');}});
 const state=await probe.run('first');assert.equal(state.runs[0].status,'interrupted');assert.equal(state.runs[0].error.code,'TOOL_IMAGE_UNAVAILABLE');assert.equal(probe.effects(),1);
});

test('reused call IDs in a later run never reattach current pixels to historical receipts',async t=>{
 const probe=await setup(t,{observeAgain:true,result:{content:[image]},inspect(messages,round){
  const observations=messages.filter(m=>m.role==='tool'&&m.tool_call_id==='observe-1');
  assert.equal(observations.filter(m=>Array.isArray(m.content)).length,1);
  if(round===4){assert.equal(observations.length,2);assert.equal(typeof observations[0].content,'string');}
 }});
 assert.equal((await probe.run('first')).runs[0].status,'completed');
 assert.equal((await probe.run('second')).runs[1].status,'completed');assert.equal(probe.effects(),2);
});
test('accumulated attachment-image history is rejected before inference or SendMessage delivery',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-image-budget-'));
 const store=await new HarnessStore({dataDir}).init();let inference=0;
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{status:()=>({state:'ready'}),complete:async()=>{inference++;return send('must-not-deliver');}}});
 t.after(async()=>{await runtime.close();await rm(dataDir,{recursive:true,force:true});});
 const part=size=>({type:'image_url',image_url:{url:'data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(size-png.length)]).toString('base64')}});
 const full=part(3*1024*1024),small=part(2.5*1024*1024);
 // Both earlier attachment messages individually fit the existing 20 MiB limit.
 await store.transaction('synthetic-owner','budget',s=>{s.agentHistory=[{role:'user',content:[full,full,full]},{role:'user',content:[full,full,full,small]}];});
 const accepted=await runtime.start('synthetic-owner','budget',{requestId:'new-turn',text:'Answer this new turn.'});
 await runtime.jobs.get(accepted.runId).promise;const state=store.get('synthetic-owner','budget');
 assert.equal(inference,0,'context limits must run before model inference and effect requests');
 assert.equal(state.runs[0].status,'failed');assert.equal(state.runs[0].error.code,'MODEL_CONTEXT_LIMIT');
 assert.equal(state.entries.at(-1).text,'');assert.equal(state.tools.length,0);
});
test('too many tool images preserve a confirmed effect receipt before refusing more inference',async t=>{
 const content=Array.from({length:11},(_,index)=>({type:'image',mimeType:'image/png',data:Buffer.concat([png,Buffer.from([index])]).toString('base64')}));
 const result={content,receiptId:'synthetic-confirmed-effect'};
 const probe=await setup(t,{result,inspect(){assert.fail('unsupported image set must not reach inference');}});
 const state=await probe.run('first');assert.equal(state.runs[0].status,'interrupted');assert.equal(state.runs[0].error.code,'TOOL_IMAGE_INVALID');
 assert.equal(probe.effects(),1);assert.equal(probe.round(),1);assert.equal(state.tools[0].status,'completed');
 assert.ok(state.tools[0].output);assert.match(state.tools[0].output,/withheld|omitted|overflow/i);
 assert.ok(state.tools[0].output.includes(sha(JSON.stringify(result))),'withheld unsupported output must keep an exact result digest');
 assert.ok(content.every(item=>!state.tools[0].output.includes(item.data)));
});

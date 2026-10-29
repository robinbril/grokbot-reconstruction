// Real production conversation SSE, queue and runtime; inference is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startHarness,collectQueueUntil} from './fixtures/harness-http.mjs';

async function enqueue(client,id,requestId,text){
 const result=await client.request('/conversations/'+id+'/queue',{method:'POST',body:{requestId,text}});
 assert.equal(result.status,202);return result.value.queueId;
}
test('conversation SSE distinguishes a live target queue from earlier completed replay and retains final run identity',{timeout:30000},async t=>{
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const app=await startHarness({model:{status:()=>({state:'ready',provider:'synthetic-queue-events'}),async complete({messages,signal}){
  const text=messages.findLast(message=>message.role==='user').content;
  if(text==='live-target'){
   entered.resolve();
   const abort=()=>gate.reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
   try{await gate.promise;}finally{signal.removeEventListener('abort',abort);}
  }
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'Event result: '+text}}}]};
 }}});
 t.after(()=>app.close());const client=await app.client(),id='queue-live-events';
 const first=await enqueue(client,id,'first','earlier-completion');
 const firstRow=await collectQueueUntil(client,id,first);assert.equal(firstRow.status,'completed');
 const second=await enqueue(client,id,'second','live-target');await entered.promise;
 const opened=Promise.withResolvers();
 const observer={async request(...args){const response=await client.request(...args);opened.resolve();return response;}};
 const waiting=collectQueueUntil(observer,id,second);await opened.promise;gate.resolve();
 const completed=await waiting;assert.equal(completed.id,second);assert.equal(completed.status,'completed');
 assert.notEqual(completed.runId,firstRow.runId);
 const state=(await client.request('/conversations/'+id)).value;
 assert.equal(state.runs.length,2);assert.deepEqual(state.queue.map(row=>row.status),['completed','completed']);
 assert.equal(state.runs.find(run=>run.id===completed.runId).status,'completed');
 assert.equal(state.entries.at(-1).text,'Event result: live-target');
 // A late subscriber must recover the same authoritative result from replay.
 assert.deepEqual(await collectQueueUntil(client,id,second),completed);
});

test('conversation SSE exposes blocked and cancelled queue outcomes without manufacturing completion or model work',{timeout:30000},async t=>{
 let calls=0;
 const app=await startHarness({model:{status:()=>({state:'unavailable'}),complete:async()=>{calls++;assert.fail('Offline work must not reach inference');}}});
 t.after(()=>app.close());const client=await app.client(),id='queue-terminal-events';
 const first=await enqueue(client,id,'blocked','offline payload');
 await assert.rejects(collectQueueUntil(client,id,first),/Queued execution blocked:.*MODEL_NOT_CONFIGURED/);
 const second=await enqueue(client,id,'cancelled','must never dispatch');
 const cancelled=await client.request('/conversations/'+id+'/queue/'+second+'/cancel',{method:'POST',body:{requestId:'cancel-second'}});
 assert.equal(cancelled.status,200);
 await assert.rejects(collectQueueUntil(client,id,second),/Queued execution cancelled/);
 const state=(await client.request('/conversations/'+id)).value;
 assert.deepEqual(state.queue.map(row=>row.status),['blocked','cancelled']);assert.equal(state.runs.length,0);assert.equal(calls,0);
});

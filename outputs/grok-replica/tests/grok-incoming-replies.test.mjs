import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {WorkflowEngine,normalizeWorkflowPayload} from '../harness/workflows.mjs';

async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-incoming-replies-'));
 const store=await new HarnessStore({dataDir}).init(),inputs=[];
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{status:async()=>({state:'ready'}),complete:async({messages})=>{
  inputs.push(structuredClone(messages));return {toolCalls:[{id:'answer-'+inputs.length,name:'SendMessage',arguments:{text:{content:'Synthetic reply'}}}]};
 }}});
 const workflows=await new WorkflowEngine({store,runtime,autoStart:false}).init();
 t.after(async()=>{await workflows.close();await runtime.close();});
 await store.transaction('fixture','one',s=>{
  s.entries.push({id:'first',role:'user',text:'Identical words',status:'completed'},{id:'second',role:'user',text:'Identical words',status:'completed'},
   {id:'pending',role:'assistant',text:'Unconfirmed',status:'running'},
   {id:'assistant-entry',role:'assistant',runId:'old-run',text:'Authoritative answer',status:'completed',messages:[{id:'delivered',callId:'old-send',type:'text',content:'Authoritative answer'}]});
  s.tools.push({id:'old-tool',runId:'old-run',callId:'old-send',name:'SendMessage',status:'completed'});
 });
 await store.transaction('fixture','other',s=>{s.entries.push({id:'foreign-message',role:'user',text:'Foreign',status:'completed'});});
 return {dataDir,store,runtime,workflows,inputs};
}
async function send(h,body){const accepted=await h.runtime.start('fixture','one',body);await h.runtime.jobs.get(accepted.runId)?.promise;return accepted;}

test('canonical reply identity survives equal source text, model context and restart',async t=>{
 const h=await setup(t),body={requestId:'reply',text:'Please explain',replyToId:'second',quote:'Forged caller context'};
 const accepted=await send(h,body),entry=h.store.states.get('one').entries.find(e=>e.id===accepted.inputEntryId);
 assert.deepEqual(entry.replyTo,{messageId:'second',entryId:'second',role:'user',text:'Identical words'});
 const user=h.inputs[0].findLast(m=>m.role==='user');assert.match(user.content,/"messageId":"second"/);assert.match(user.content,/Identical words/);
 assert.doesNotMatch(user.content,/Forged caller context/);
 const reloaded=await new HarnessStore({dataDir:h.dataDir}).init();assert.deepEqual(reloaded.states.get('one').entries.find(e=>e.id===entry.id).replyTo,entry.replyTo);
 assert.deepEqual(await h.runtime.start('fixture','one',body),accepted);
 await assert.rejects(h.runtime.start('fixture','one',{...body,replyToId:'first'}),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal(h.inputs.length,1);
});

test('assistant incoming replies use confirmed delivery UUID rather than aggregate entry',async t=>{
 const h=await setup(t),accepted=await send(h,{requestId:'reply',text:'Explain this answer',replyToId:'delivered'});
 assert.deepEqual(h.store.states.get('one').entries.find(e=>e.id===accepted.inputEntryId).replyTo,{messageId:'delivered',entryId:'assistant-entry',role:'assistant',text:'Authoritative answer'});
});

for(const replyToId of ['foreign-message','missing','pending','assistant-entry','',null,7,'bad id'])test('unconfirmed or invalid incoming reply '+String(replyToId)+' fails before admission',async t=>{
 const h=await setup(t);
 await assert.rejects(h.runtime.start('fixture','one',{requestId:'invalid-reply',text:'Do work',replyToId}),{code:'INVALID_REPLY_TARGET'});
 assert.equal(h.inputs.length,0);assert.equal(h.runtime.connections.size,0);assert.equal(h.store.states.get('one').runs.length,0);
});

test('normalization and queued execution retain exact canonical reply identity',async t=>{
 const h=await setup(t),payload={text:'Queued reply',replyToId:'second'};
 assert.deepEqual(normalizeWorkflowPayload(payload),payload);
 const ack=await h.workflows.enqueue('fixture','one',{requestId:'queued',...payload});
 const pump=h.workflows.pumps.get('one');if(pump)await pump;
 const row=h.store.states.get('one').queue.find(q=>q.id===ack.queueId);assert.equal(row.payload.replyToId,'second');
 const job=h.runtime.jobs.get(row.runId);if(job)await job.promise;
 assert.equal(h.store.states.get('one').entries.find(e=>e.runId===row.runId&&e.role==='user').replyTo.messageId,'second');
});

test('foreign queue and schedule replies are rejected without durable admission',async t=>{
 const h=await setup(t),payload={text:'Future reply',replyToId:'foreign-message'};
 await assert.rejects(h.workflows.enqueue('fixture','one',{requestId:'bad-queue',...payload}),{code:'INVALID_REPLY_TARGET'});
 await assert.rejects(h.workflows.createSchedule('fixture','one',{requestId:'bad-schedule',title:'Synthetic',enabled:false,rule:{kind:'daily',time:'09:00',timeZone:'UTC'},payload}),{code:'INVALID_REPLY_TARGET'});
 assert.equal(h.store.states.get('one').queue.length,0);assert.equal(h.store.states.get('one').schedules.length,0);assert.equal(h.inputs.length,0);
});

test('stored schedule reply identity survives editing and run-now',async t=>{
 const h=await setup(t),rule={kind:'daily',time:'09:00',timeZone:'UTC'};
 const created=await h.workflows.createSchedule('fixture','one',{requestId:'schedule',title:'Synthetic',enabled:false,rule,payload:{text:'Reply later',replyToId:'first'}});
 assert.equal(created.schedule.payload.replyToId,'first');
 const edited=await h.workflows.scheduleAction('fixture','one',created.schedule.id,'edit',{requestId:'edit',expectedRevision:1,title:'Edited',rule,payload:{text:'Reply later',replyToId:'second'}});
 assert.equal(edited.schedule.payload.replyToId,'second');
 const run=await h.workflows.scheduleAction('fixture','one',created.schedule.id,'run-now',{requestId:'now',expectedRevision:2});
 assert.equal(h.store.states.get('one').queue.find(q=>q.id===run.queueId).payload.replyToId,'second');
});

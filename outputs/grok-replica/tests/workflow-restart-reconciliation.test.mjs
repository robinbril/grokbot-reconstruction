// Persisted production store + workflow restart recovery; synthetic model receipts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {WorkflowEngine} from '../harness/workflows.mjs';

async function recovery(t,status,{foreign=false,revision=1,nextDueAt=null}={}) {
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-restart-reconciliation-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const initial=await new HarnessStore({dataDir}).init();
 const error=status==='failed'?{code:'SYNTHETIC_FAILURE',message:'Confirmed rejection',retryable:false}:undefined;
 await initial.transaction('synthetic','restart',s=>{
  s.queue=[{id:'queue',requestId:'accepted',nativeRequestId:'queue:queue',payloadHash:'immutable-hash',runId:'run',status:'running',source:{kind:'schedule',scheduleId:'schedule',scheduleRevision:1}}];
  s.schedules=[{id:'schedule',revision,rule:{kind:'once'},status:'enabled',enabled:true,nextDueAt}];
  s.runs=[{id:'run',approvals:[],requestId:'queue:queue',workflowQueueId:'queue',workflowPayloadHash:foreign?'other-hash':'immutable-hash',status,...(error?{error}:{})}];
 });
 const store=await new HarnessStore({dataDir}).init();
 let executions=0;
 const runtime={active:()=>false,startUnlocked:async()=>{executions++;throw Error('Recovery must never dispatch');}};
 const workflows=await new WorkflowEngine({store,runtime,autoStart:false}).init();
 t.after(()=>workflows.close());
 return {store,workflows,dataDir,error,get executions(){return executions;}};
}

for(const status of ['completed','failed','cancelled'])test('restart restores '+status+' schedule result from exact durable run receipt',async t=>{
 const h=await recovery(t,status),state=h.store.get('synthetic','restart');
 assert.equal(state.queue[0].status,status);
 assert.equal(state.schedules[0].lastRunId,'run');
 assert.equal(state.schedules[0].lastResult,status);
 assert.equal(state.schedules[0].status,'completed');
 assert.equal(state.schedules[0].enabled,false);
 if(h.error)assert.deepEqual(state.queue[0].error,h.error);
 assert.equal(state.workflow.hold,null);
 assert.equal(h.executions,0);
 await h.workflows.close();
 const disk=(await new HarnessStore({dataDir:h.dataDir}).init()).get('synthetic','restart');
 assert.deepEqual(disk.schedules,state.schedules);
 assert.deepEqual(disk.queue,state.queue);
});

test('foreign run payload never completes an unrelated schedule during restart',async t=>{
 const h=await recovery(t,'completed',{foreign:true}),state=h.store.get('synthetic','restart');
 assert.equal(state.queue[0].status,'interrupted');
 assert.equal(state.workflow.hold.code,'EXECUTION_UNCERTAIN');
 assert.equal(state.schedules[0].lastRunId,undefined);
 assert.equal(state.schedules[0].status,'enabled');
 assert.equal(h.executions,0);
});


test('recovered old occurrence retains result history without completing a newer future schedule',async t=>{
 const h=await recovery(t,'completed',{revision:2,nextDueAt:'2099-01-01T00:00:00.000Z'}),state=h.store.get('synthetic','restart');
 assert.equal(state.queue[0].status,'completed');
 assert.equal(state.schedules[0].revision,2);
 assert.equal(state.schedules[0].lastRunId,'run');
 assert.equal(state.schedules[0].lastResult,'completed');
 assert.equal(state.schedules[0].nextDueAt,'2099-01-01T00:00:00.000Z');
 assert.equal(state.schedules[0].status,'enabled');
 assert.equal(state.schedules[0].enabled,true);
 assert.equal(h.executions,0);
});

test('interrupted durable run remains held and cannot be dispatched by recovery',async t=>{
 const h=await recovery(t,'interrupted'),state=h.store.get('synthetic','restart');
 assert.equal(state.queue[0].status,'interrupted');
 assert.equal(state.queue[0].error.code,'EXECUTION_UNCERTAIN');
 assert.equal(state.workflow.hold.code,'EXECUTION_UNCERTAIN');
 assert.equal(state.workflow.hold.runId,'run');
 assert.equal(state.schedules[0].lastResult,'interrupted');
 assert.equal(h.executions,0);
});

test('live terminal reconciliation preserves the same future schedule and result history',async t=>{
 const h=await recovery(t,'completed',{revision:2,nextDueAt:'2099-01-01T00:00:00.000Z'});
 await h.store.transaction('synthetic','restart',s=>{s.queue[0].status='running';});
 await h.workflows.sync('restart');
 const state=h.store.get('synthetic','restart');
 assert.equal(state.queue[0].status,'completed');
 assert.equal(state.schedules[0].lastRunId,'run');
 assert.equal(state.schedules[0].nextDueAt,'2099-01-01T00:00:00.000Z');
 assert.equal(state.schedules[0].status,'enabled');
 assert.equal(h.executions,0);
});

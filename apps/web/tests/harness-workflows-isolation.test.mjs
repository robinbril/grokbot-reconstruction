// Independent production store/scheduler tests. Intentionally offline, no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,rename,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHarnessHandler} from '../harness/http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function boot(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-isolation-review-'));
 let current=new Date('2026-01-01T10:00:00Z');
 const app=await createHarnessHandler({root,dataDir,baseUrl:'http://127.0.0.1:29999',codexBinary:path.join(dataDir,'intentionally-offline'),workflowClock:()=>current,workflowAutoStart:false});
 t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 return {...app,dataDir,setDue(){current=new Date('2026-01-01T10:02:00Z');}};
}
const spec=requestId=>({requestId,title:requestId,enabled:true,payload:{text:'scheduled '+requestId},rule:{kind:'once',at:'2026-01-01T10:01:00Z',timeZone:'UTC'}});
test('full conversation defers visibly without starving another owners due work and retries after room returns',async t=>{
 const app=await boot(t),firstOwner='first-owner',secondOwner='second-owner';
 await app.workflows.createSchedule(firstOwner,'first-full',spec('first'));
 await app.workflows.createSchedule(secondOwner,'second-free',spec('second'));
 for(let i=0;i<50;i++)await app.workflows.enqueue(firstOwner,'first-full',{requestId:'q'+i,text:'manual '+i});
 app.setDue();
 await app.workflows.tick();
 let first=app.store.get(firstOwner,'first-full'),second=app.store.get(secondOwner,'second-free');
 assert.equal(first.queue.length,50);assert.equal(first.schedules[0].nextDueAt,'2026-01-01T10:01:00.000Z');
 assert.ok(JSON.stringify(app.store.snapshot(first)).includes('QUEUE_CAPACITY'),'public state exposes the deferred capacity reason');
 assert.equal(second.queue.length,1);assert.equal(second.queue[0].source.scheduleId,second.schedules[0].id);
 assert.equal(second.schedules[0].nextDueAt,null);
 const cancelled=first.queue.at(-1).id;
 await app.workflows.cancel(firstOwner,'first-full',cancelled,'release-room');
 await Promise.all([app.workflows.tick(),app.workflows.tick()]);
 first=app.store.get(firstOwner,'first-full');second=app.store.get(secondOwner,'second-free');
 assert.equal(first.queue.filter(q=>q.source.kind==='schedule').length,1);
 assert.equal(first.queue.filter(q=>!['completed','failed','cancelled','interrupted'].includes(q.status)).length,50);
 assert.equal(first.schedules[0].nextDueAt,null);assert.equal(second.queue.length,1);
});
test('one conversation JSON rename failure cannot stop another owners due admission',async t=>{
 const app=await boot(t),owner='first-owner',otherOwner='second-owner';
 await app.workflows.createSchedule(owner,'write-failed',spec('first'));
 await app.workflows.createSchedule(otherOwner,'write-healthy',spec('second'));
 const destination=path.join(app.dataDir,'conversation-write-failed.json'),backup=destination+'.review-backup';
 await rename(destination,backup);await mkdir(destination);
 app.setDue();
 try{
  await app.workflows.tick();
  assert.equal(app.store.get(owner,'write-failed').queue.length,0);
  assert.equal(app.store.get(owner,'write-failed').schedules[0].nextDueAt,'2026-01-01T10:01:00.000Z');
  assert.equal(app.store.get(otherOwner,'write-healthy').queue.length,1);
  const healthy=JSON.parse(await readFile(path.join(app.dataDir,'conversation-write-healthy.json'),'utf8'));
  assert.equal(healthy.queue.length,1,'healthy occurrence is genuinely durable');
 }finally{await rm(destination,{recursive:true,force:true});await rename(backup,destination);}
 await app.workflows.tick();
 assert.equal(app.store.get(owner,'write-failed').queue.length,1);
 assert.equal(app.store.get(otherOwner,'write-healthy').queue.length,1);
});

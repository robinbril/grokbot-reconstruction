// Local filesystem/production-handler tests; no provider or browser executes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {createHarnessHandler} from '../harness/http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),lockName='.dispatch-lock.json';
async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'workflow-lock-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const handler=dataDir=>createHarnessHandler({root,dataDir,baseUrl:'http://127.0.0.1:49151',codexBinary:path.join(dataDir,'missing-provider'),workflowAutoStart:false});
const record=(pid,token=randomUUID())=>({schema:1,pid,token,createdAt:new Date().toISOString()});
test('second live handler refuses same dataDir before any timer or provider and close releases',async t=>{
 const dir=await directory(t),first=await handler(dir);t.after(()=>first.close());let duplicate;
 await assert.rejects(async()=>{duplicate=await handler(dir);t.after(()=>duplicate.close());},e=>e.code==='DATA_DIR_LOCKED');assert.equal(first.runtime.connections.size,0);assert.equal(first.workflows.timer,undefined);
 await first.close();const reopened=await handler(dir);t.after(()=>reopened.close());assert.equal(reopened.runtime.connections.size,0);
});
test('lock with a proven dead PID recovers without dispatch and writes a new ownership token',async t=>{
 const dir=await directory(t),child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'}),pid=child.pid;await once(child,'exit');assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');const previous=record(pid);await writeFile(path.join(dir,lockName),JSON.stringify(previous));const app=await handler(dir);t.after(()=>app.close());const current=JSON.parse(await readFile(path.join(dir,lockName),'utf8'));assert.equal(current.pid,process.pid);assert.notEqual(current.token,previous.token);assert.equal(app.runtime.connections.size,0);await app.close();await assert.rejects(access(path.join(dir,lockName)),e=>e.code==='ENOENT');
});
test('live PID and ambiguous lock records are never stolen',async t=>{
 const dir=await directory(t);for(const current of [record(process.pid),{schema:1,token:'ambiguous-no-pid'},'not-json']){const bytes=typeof current==='string'?current:JSON.stringify(current);await writeFile(path.join(dir,lockName),bytes);let accidental;await assert.rejects(async()=>{accidental=await handler(dir);t.after(()=>accidental.close());},e=>['DATA_DIR_LOCKED','DATA_DIR_LOCK_UNCERTAIN'].includes(e.code));assert.equal(await readFile(path.join(dir,lockName),'utf8'),bytes);}
});
test('close releases only its own exact lock token',async t=>{
 const dir=await directory(t),app=await handler(dir);t.after(()=>app.close());const acquired=JSON.parse(await readFile(path.join(dir,lockName),'utf8'));assert.equal(acquired.pid,process.pid);assert.equal(typeof acquired.token,'string');assert.ok(acquired.token.length>=16);const replacement=record(process.pid,'replacement-token');await writeFile(path.join(dir,lockName),JSON.stringify(replacement));await app.close();assert.deepEqual(JSON.parse(await readFile(path.join(dir,lockName),'utf8')),replacement);
});
async function uploaded(app,id,text){const bytes=Buffer.from(text),sha256=createHash('sha256').update(bytes).digest('hex');const metadata=await app.attachments.reserve('owner',id,{requestId:'upload-'+randomUUID(),name:'frozen.txt',type:'text/plain',size:bytes.length,sha256});await app.attachments.put('owner',id,metadata.attachmentId,[bytes]);return {attachmentId:metadata.attachmentId,sha256,size:bytes.length};}
const scheduleBody=(requestId,refs)=>({requestId,title:'Frozen refs',payload:{text:'read frozen file',attachmentRefs:refs},rule:{kind:'once',at:'2099-01-01T10:00:00.000Z',timeZone:'UTC'},enabled:false});
test('accepted schedule-create receipt survives later blob corruption without revalidation or dispatch',async t=>{
 const dir=await directory(t),app=await handler(dir);t.after(()=>app.close());const id='receipt-create',ref=await uploaded(app,id,'unpredictable-'+randomUUID()),body=scheduleBody('create-receipt',[ref]),accepted=await app.workflows.createSchedule('owner',id,body);await writeFile(path.join(dir,'attachments',id,ref.attachmentId,'source'),'corrupt');assert.deepEqual(await app.workflows.createSchedule('owner',id,body),accepted);assert.equal(app.runtime.connections.size,0);
});
test('accepted schedule-edit receipt survives later corrupt bytes and never mutates frozen refs',async t=>{
 const dir=await directory(t),app=await handler(dir);t.after(()=>app.close());const id='receipt-edit',ref=await uploaded(app,id,'actual-'+randomUUID()),created=await app.workflows.createSchedule('owner',id,scheduleBody('create',[])),edit={requestId:'edit-receipt',expectedRevision:created.schedule.revision,title:'Edited frozen',payload:{text:'read edited frozen',attachmentRefs:[ref]},rule:created.schedule.rule},accepted=await app.workflows.scheduleAction('owner',id,created.schedule.id,'edit',edit);await writeFile(path.join(dir,'attachments',id,ref.attachmentId,'source'),'corrupt');assert.deepEqual(await app.workflows.scheduleAction('owner',id,created.schedule.id,'edit',edit),accepted);assert.equal(app.runtime.connections.size,0);assert.deepEqual(app.store.get('owner',id).schedules[0].payload.attachmentRefs,[ref]);
});

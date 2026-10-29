import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
async function setup(t){const dataDir=await mkdtemp(path.join(tmpdir(),'harness-store-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return {dataDir,store:await new HarnessStore({dataDir}).init()};}
test('concurrent durable transactions serialize without losing updates or event order',async t=>{
 const {store,dataDir}=await setup(t);await Promise.all(Array.from({length:24},(_,i)=>store.transaction('owner','ordered',(s,emit)=>{s.count=(s.count||0)+1;emit('probe',{value:i});})));const s=store.get('owner','ordered');assert.equal(s.count,24);assert.deepEqual(s.events.map(x=>x.seq),Array.from({length:24},(_,i)=>i+1));const disk=JSON.parse(await readFile(path.join(dataDir,'conversation-ordered.json'),'utf8'));assert.deepEqual(disk.events,s.events);assert.equal(disk.count,24);
});
test('failed mutator does not commit or publish and the following transaction still succeeds',async t=>{
 const {store}=await setup(t);await store.transaction('o','rollback',s=>{s.value=1;});const received=[];store.subscribe('rollback',e=>received.push(e));await assert.rejects(store.transaction('o','rollback',(s,emit)=>{s.value=2;emit('probe',{});throw Error('deliberate transaction refusal');}),/refusal/);assert.equal(store.get('o','rollback').value,1);assert.equal(received.length,0);await store.transaction('o','rollback',s=>{s.value=3;});assert.equal(store.get('o','rollback').value,3);
});
test('actual rename failure leaves prior state and event delivery unchanged',async t=>{
 const {store,dataDir}=await setup(t);await store.transaction('o','diskfailure',s=>{s.value='saved';});const file=path.join(dataDir,'conversation-diskfailure.json');await rename(file,file+'.saved');await mkdir(file);const received=[];store.subscribe('diskfailure',e=>received.push(e));await assert.rejects(store.transaction('o','diskfailure',(s,emit)=>{s.value='not saved';emit('probe',{});}));assert.equal(store.get('o','diskfailure').value,'saved');assert.equal(received.length,0);assert.equal(JSON.parse(await readFile(file+'.saved','utf8')).value,'saved');
});
test('restart preserves partial content while expiring work and approvals without replaying effects',async t=>{
 const {store,dataDir}=await setup(t);await store.transaction('o','restart',s=>{s.entries.push({id:'output',text:'real partial output',status:'streaming'});s.runs.push({id:'run',status:'running',outputEntryId:'output',approvals:[{id:'approval',status:'pending'}]});s.terminalSessions.push({id:'terminal',status:'running',stdout:'prior bytes'});});const restored=await new HarnessStore({dataDir}).init();const s=restored.get('o','restart');assert.equal(s.runs[0].status,'interrupted');assert.equal(s.runs[0].approvals[0].status,'expired');assert.equal(s.entries[0].text,'real partial output');assert.equal(s.terminalSessions[0].stdout,'prior bytes');assert.equal(s.terminalSessions[0].status,'interrupted');
});
test('snapshot excludes owner and internal effect/configuration maps and is detached',async t=>{
 const {store}=await setup(t);await store.transaction('o','snapshot',s=>{s.requests.private='internal';s.customServers.push({command:'/installed/tool'});s.entries.push({id:'message',text:'original'});});assert.throws(()=>store.get('different-owner','snapshot'),e=>e.status===404);const snap=store.snapshot(store.get('o','snapshot'));for(const k of ['owner','events','requests','customServers'])assert.equal(Object.hasOwn(snap,k),false);snap.entries[0].text='modified copy';assert.equal(store.get('o','snapshot').entries[0].text,'original');
});

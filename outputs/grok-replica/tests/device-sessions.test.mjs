import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DeviceSessions} from '../harness/device-sessions.mjs';
async function setup(t){const dataDir=await mkdtemp(path.join(tmpdir(),'grok-device-sessions-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));let clock=1000;const now=()=>clock;const sessions=await new DeviceSessions({dataDir,now}).init();return{sessions,dataDir,now,advance:ms=>{clock+=ms;}};}
test('two independent device cookies pair without exposing or merging old identities',async t=>{
 const {sessions,dataDir}=await setup(t),a=await sessions.resolve(null),b=await sessions.resolve(null);
 assert.notEqual(a.owner,b.owner);const code=await sessions.startPairing(a.token);
 assert.match(code.code,/^[A-Za-z0-9_-]{43}$/);assert.equal(Object.hasOwn(code,'owner'),false);
 const linked=await sessions.acceptPairing(b.token,code.code,{label:'Second device'});
 assert.equal(linked.owner,a.owner);assert.notEqual(linked.token,b.token);assert.notEqual(linked.token,a.token);
 const devices=await sessions.list(a.token);assert.equal(devices.devices.length,2);assert.equal(JSON.stringify(devices).includes(a.owner),false);assert.equal(JSON.stringify(devices).includes(linked.token),false);
 const old=await sessions.resolve(b.token);assert.notEqual(old.owner,a.owner);assert.notEqual(old.owner,b.owner);
 assert.equal((await sessions.resolve(linked.token)).owner,a.owner);
 assert.equal((await stat(path.join(dataDir,'device-sessions.json'))).mode&0o777,0o600);
});
test('legacy cookie retains its original owner and individual revocation survives restart',async t=>{
 const {sessions,dataDir,now}=await setup(t),legacy='L'.repeat(43),a=await sessions.resolve(legacy),b=await sessions.resolve(null);
 assert.equal(a.owner,legacy);const linked=await sessions.acceptPairing(b.token,(await sessions.startPairing(a.token)).code);
 await sessions.revoke(a.token,linked.deviceId);
 const restored=await new DeviceSessions({dataDir,now}).init();assert.equal((await restored.resolve(a.token)).owner,a.owner);
 const rejected=await restored.resolve(linked.token);assert.notEqual(rejected.owner,a.owner);assert.notEqual(rejected.token,linked.token);
 const disk=JSON.parse(await readFile(path.join(dataDir,'device-sessions.json'),'utf8'));assert.ok(disk.sessions.some(row=>row.deviceId===linked.deviceId&&row.revokedAt!==null));
});
test('pairing expires at the boundary and cannot be consumed twice even concurrently',async t=>{
 const {sessions,advance}=await setup(t),a=await sessions.resolve(null),b=await sessions.resolve(null),c=await sessions.resolve(null);
 const expired=await sessions.startPairing(a.token);advance(300000);await assert.rejects(sessions.acceptPairing(b.token,expired.code),e=>e.code==='PAIRING_INVALID');
 const code=await sessions.startPairing(a.token),results=await Promise.allSettled([sessions.acceptPairing(b.token,code.code),sessions.acceptPairing(c.token,code.code)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
 assert.equal((await sessions.list(a.token)).devices.length,2);
});
test('failed attempts are bounded and owner-scoped revocation cannot affect another account',async t=>{
 const {sessions,advance}=await setup(t),a=await sessions.resolve(null),b=await sessions.resolve(null);
 for(let i=0;i<8;i++)await assert.rejects(sessions.acceptPairing(b.token,'x'.repeat(43)),e=>e.code==='PAIRING_INVALID');
 await assert.rejects(sessions.acceptPairing(b.token,(await sessions.startPairing(a.token)).code),e=>e.code==='PAIRING_RATE_LIMITED');
 advance(300000);const linked=await sessions.acceptPairing(b.token,(await sessions.startPairing(a.token)).code);assert.equal(linked.owner,a.owner);
 const other=await sessions.resolve(null);await assert.rejects(sessions.revoke(other.token,a.deviceId),e=>e.code==='NOT_FOUND');assert.equal((await sessions.resolve(a.token)).owner,a.owner);
});
test('same-device acceptance retains the code and public device labels are bounded plain text',async t=>{
 const {sessions}=await setup(t),a=await sessions.resolve(null),b=await sessions.resolve(null),code=await sessions.startPairing(a.token);
 await assert.rejects(sessions.acceptPairing(a.token,code.code),e=>e.code==='PAIRING_SAME_DEVICE');
 await assert.rejects(sessions.acceptPairing(b.token,code.code,{label:'x'.repeat(81)}),e=>e.code==='INVALID_DEVICE');
 const linked=await sessions.acceptPairing(b.token,code.code,{label:' <Second> '});assert.equal((await sessions.list(linked.token)).devices.find(row=>row.current).label,'<Second>');
});
test('resource reservation and pairing serialize atomically without holding a long-running request',async t=>{
 const {sessions}=await setup(t),source=await sessions.resolve(null),joining=await sessions.resolve(null),code=await sessions.startPairing(source.token);
 await sessions.claimOwner(joining.token);
 await assert.rejects(sessions.acceptPairing(joining.token,code.code),error=>error.code==='DEVICE_HAS_HISTORY');
 const fresh=await sessions.resolve(null),linked=await sessions.acceptPairing(fresh.token,code.code);
 await assert.rejects(sessions.claimOwner(fresh.token),error=>error.code==='DEVICE_UNAUTHORIZED');
 assert.equal((await sessions.resolve(linked.token)).owner,source.owner);
});

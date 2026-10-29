import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {HarnessStore} from '../harness/store.mjs';

test('published resource receipt survives directory sync failure and blocks later mutation until confirmed',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-resource-commit-'));
 const store=await new HarnessStore({dataDir}).init(),open=fs.open;let deny=true,writes=0;
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(path.resolve(String(file))===dataDir&&args[0]==='r'&&deny)return {sync:async()=>{throw Error('directory sync unavailable');},close:()=>handle.close()};return handle;};syncBuiltinESMExports();
 t.after(async()=>{fs.open=open;syncBuiltinESMExports();await fs.rm(dataDir,{recursive:true,force:true});});
 const change=()=>store.resourceTransaction('owner','conversation',(state,emit)=>{const prior=state.requests['resource:create'];if(prior)return prior;const receipt={id:'original-resource',revision:1};state.resource=receipt;state.requests['resource:create']=receipt;writes++;emit('resource.created',{id:receipt.id});return receipt;});
 await assert.rejects(change(),/directory sync unavailable/);
 const disk=JSON.parse(await fs.readFile(path.join(dataDir,'conversation-conversation.json'),'utf8'));
 assert.deepEqual(store.get('owner','conversation').resource,disk.resource);
 await assert.rejects(store.resourceRead('owner','conversation',state=>state.resource),/directory sync unavailable/);
 let laterMutations=0;await assert.rejects(store.transaction('owner','conversation',state=>{laterMutations++;state.unrelated=true;}),/directory sync unavailable/);assert.equal(laterMutations,0);
 deny=false;assert.deepEqual(await change(),disk.requests['resource:create']);assert.equal(writes,1);
 const result=await store.resourceRead('owner','conversation',state=>state.resource);result.id='detached';assert.equal(store.get('owner','conversation').resource.id,'original-resource');
 await store.transaction('owner','conversation',state=>{state.unrelated=true;});assert.equal(store.get('owner','conversation').unrelated,true);
});

test('ordinary failed run commit keeps the preexisting acceptance contract',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-commit-')),store=await new HarnessStore({dataDir}).init();t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
 store.write=async()=>{throw Error('before publication');};await assert.rejects(store.transaction('owner','ordinary',state=>{state.runs.push({id:'run',status:'accepted'});}),/before publication/);assert.equal(store.get('owner','ordinary'),undefined);
});

test('resource cancellation during actual temporary file sync prevents publication and any receipt',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-resource-abort-')),store=await new HarnessStore({dataDir}).init(),open=fs.open,controller=new AbortController();
 let entered,release;const syncing=new Promise(resolve=>{entered=resolve;}),continueSync=new Promise(resolve=>{release=resolve;});
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).startsWith(dataDir)&&args[0]==='wx')return {writeFile:(...values)=>handle.writeFile(...values),sync:async()=>{await handle.sync();entered();await continueSync;},close:()=>handle.close()};return handle;};syncBuiltinESMExports();
 t.after(async()=>{release();fs.open=open;syncBuiltinESMExports();await fs.rm(dataDir,{recursive:true,force:true});});
 const pending=store.resourceTransaction('owner','cancelled',state=>{state.resource='must not publish';state.requests.create={id:'receipt'};},{signal:controller.signal});
 await syncing;controller.abort();release();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(store.get('owner','cancelled'),undefined);await assert.rejects(fs.readFile(path.join(dataDir,'conversation-cancelled.json')),{code:'ENOENT'});
 assert.deepEqual(await fs.readdir(dataDir),[]);
});

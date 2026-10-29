import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHarnessHandler} from '../harness/http.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';

const unavailable={status:()=>({state:'unavailable',reason:'Explicit test model'})};
async function directory(t){const dataDir=await mkdtemp(path.join(tmpdir(),'runtime-composition-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return dataDir;}
const settings=dataDir=>({root:path.resolve('.'),dataDir,baseUrl:'http://127.0.0.1:29999',model:unavailable,workflowAutoStart:false});

test('production composition ignores legacy binary options and never falls back from an unavailable model',async t=>{
 const app=await createHarnessHandler({...settings(await directory(t)),codexBinary:'/must-not-start-a-legacy-process'});t.after(()=>app.close());
 assert.ok(app.runtime instanceof GrokRuntime);assert.equal((await app.runtime.status()).adapter,'grok-bot-harness');
 await assert.rejects(app.runtime.start('synthetic-owner','no-fallback',{requestId:'first',text:'hello'}),{code:'MODEL_NOT_CONFIGURED'});
 assert.equal(app.runtime.connections.size,0);assert.equal(app.runtime.bridges.size,0);
});

test('only an explicit in-process runtime factory replaces the composition dependency',async t=>{
 let calls=0,selected;
 const app=await createHarnessHandler({...settings(await directory(t)),runtimeFactory:options=>{calls++;selected=new GrokRuntime({...options,maxChildren:2});return selected;}});t.after(()=>app.close());
 assert.equal(calls,1);assert.equal(app.runtime,selected);assert.equal(app.runtime.maxChildren,2);assert.equal(app.runtime.store,app.store);
});

for(const runtimeFactory of ['legacy',null,{}])test(`nonfunction runtime selector ${JSON.stringify(runtimeFactory)} is rejected and releases the directory lease`,async t=>{
 const options=settings(await directory(t));
 await assert.rejects(createHarnessHandler({...options,runtimeFactory}),/runtimeFactory must be a function/);
 const app=await createHarnessHandler(options);t.after(()=>app.close());assert.ok(app.runtime instanceof GrokRuntime);
});

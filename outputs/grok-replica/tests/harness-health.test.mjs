import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHarnessHandler} from '../harness/http.mjs';

async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-health-'));let modelReads=0;
 const app=await createHarnessHandler({root:path.resolve('.'),dataDir,workflowAutoStart:false,model:{status:()=>{modelReads++;return {state:'unavailable',reason:'Synthetic health model'};}}});
 const server=http.createServer(async(req,res)=>{if(!await app.handle(req,res))res.writeHead(404).end();});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();await rm(dataDir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port;
 async function request({route='/api/harness/health',method='GET',headers={}}={}){
  return new Promise((resolve,reject)=>{
   const req=http.request(origin+route,{method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,value:text?JSON.parse(text):null});});});
   req.once('error',reject);req.end();
  });
 }
 return {app,origin,request,get modelReads(){return modelReads;}};
}

test('desktop health identity is read-only and never creates owner or device sessions',async t=>{
 const f=await fixture(t),before=structuredClone(f.app.sessions.state);
 for(const headers of [{},{cookie:'grok_harness_owner=untrusted-probe'}]){
  const response=await f.request({headers});assert.equal(response.status,200);
  assert.deepEqual(response.value,{schema:1,application:'grokbot-reconstruction'});
  assert.equal(response.headers['set-cookie'],undefined);assert.equal(response.headers['cache-control'],'no-store');
 }
 assert.deepEqual(f.app.sessions.state,before);assert.equal(f.modelReads,0);
 assert.equal(f.app.store.states.size,0);assert.equal(f.app.runtime.connections.size,0);
});

test('health preserves Host and Origin boundaries without allocating a session',async t=>{
 const f=await fixture(t),before=structuredClone(f.app.sessions.state);
 for(const [headers,code] of [[{host:'unrelated.test'},'INVALID_HOST'],[{origin:'https://unrelated.test'},'INVALID_ORIGIN']]){
  const response=await f.request({headers});assert.equal(response.status,403);assert.equal(response.value.error.code,code);assert.equal(response.headers['set-cookie'],undefined);
 }
 assert.deepEqual(f.app.sessions.state,before);assert.equal(f.modelReads,0);
});

test('health rejects every non-GET method without cookies or state changes',async t=>{
 const f=await fixture(t),before=structuredClone(f.app.sessions.state);
 for(const method of ['POST','PUT','DELETE','OPTIONS','HEAD']){
  const response=await f.request({method,headers:{origin:f.origin}});assert.equal(response.status,405);assert.equal(response.headers['set-cookie'],undefined);
  if(method!=='HEAD')assert.equal(response.value.error.code,'METHOD_NOT_ALLOWED');
 }
 assert.deepEqual(f.app.sessions.state,before);assert.equal(f.modelReads,0);
});

test('normal status still creates the browser identity and does not expose it through health',async t=>{
 const f=await fixture(t),status=await f.request({route:'/api/harness/status'});
 assert.equal(status.status,200);assert.equal(status.headers['set-cookie'].length,1);assert.match(status.headers['set-cookie'][0],/^grok_harness_owner=/);
 assert.equal(typeof status.value.csrfToken,'string');assert.equal(f.app.sessions.state.sessions.length,1);
 const before=structuredClone(f.app.sessions.state),reads=f.modelReads,health=await f.request();
 assert.deepEqual(health.value,{schema:1,application:'grokbot-reconstruction'});assert.deepEqual(f.app.sessions.state,before);assert.equal(f.modelReads,reads);
});

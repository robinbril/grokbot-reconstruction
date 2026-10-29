// Production HTTP path, real bytes, native child remains absent. No provider invocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {startHarness} from './fixtures/harness-http.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function setup(t){const app=await startHarness();t.after(()=>app.close());return {app,client:await app.client()};}
const route=id=>'/conversations/'+id+'/attachments';
const metadata=(bytes,extra={})=>({requestId:randomUUID(),name:'upload.txt',type:'text/plain',size:bytes.length,sha256:sha(bytes),...extra});
async function upload(app,client,id,attachmentId,bytes,headers={}){
 // Node24 fetch replaces a custom Host. Use the raw HTTP transport for that
 // case so the existing 403 oracle exercises the actual hostile wire header.
 if(Object.keys(headers).some(name=>name.toLowerCase()==='host'))return new Promise((resolve,reject)=>{
  const request=http.request(app.baseUrl+'/api/harness'+route(id)+'/'+attachmentId+'/content',{method:'PUT',headers:{cookie:client.cookie,Origin:app.baseUrl,'x-harness-csrf':client.csrf,'Content-Type':'application/octet-stream',...headers}},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>{
    try{resolve({status:response.statusCode,value:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}
   });
  });request.once('error',reject);request.end(bytes);
 });
 const response=await fetch(app.baseUrl+'/api/harness'+route(id)+'/'+attachmentId+'/content',{method:'PUT',headers:{cookie:client.cookie,Origin:app.baseUrl,'x-harness-csrf':client.csrf,'Content-Type':'application/octet-stream',...headers},body:bytes});
 return {status:response.status,value:await response.json()};
}
async function staged(app,client,id,bytes,extra={}){
 const reserved=await client.request(route(id),{method:'POST',body:metadata(bytes,extra)});assert.equal(reserved.status,201,JSON.stringify(reserved.value));
 const uploaded=await upload(app,client,id,reserved.value.attachmentId,bytes);assert.equal(uploaded.status,200,JSON.stringify(uploaded.value));
 return uploaded.value;
}

test('real reserve/raw-upload/status/download preserves exact original bytes with inert response and no child',async t=>{
 const {app,client}=await setup(t),id='http-bytes',bytes=Buffer.from('<svg onload="throw 1">\u0000'+randomUUID()+'</svg>');
 const value=await staged(app,client,id,bytes,{name:'vector.svg',type:'image/svg+xml'});assert.equal(value.state,'ready');assert.equal(value.sha256,sha(bytes));
 const status=await client.request(route(id)+'/'+value.attachmentId);assert.equal(status.status,200);assert.equal(status.value.state,'ready');
 const response=await client.request(route(id)+'/'+value.attachmentId+'/download',{raw:true});assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(Number(response.headers.get('content-length')),bytes.length);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(app.handler.runtime.connections.size,0);assert.equal(app.handler.runtime.bridges.size,0);
 const snapshot=(await client.request('/conversations/'+id)).value;assert.equal(snapshot.runs.length,0);
 assert.equal(JSON.stringify(snapshot).includes(bytes.toString()),false);
});

test('HTTP lost reservation/upload ACK recovery keeps same ID and exact-byte retry while changed payload conflicts',async t=>{
 const {app,client}=await setup(t),id='http-retry',bytes=Buffer.from('lost ACK fixture '+randomUUID()),body=metadata(bytes);
 const first=await client.request(route(id),{method:'POST',body});assert.equal(first.status,201);
 const replay=await client.request(route(id),{method:'POST',body});assert.equal(replay.value.attachmentId,first.value.attachmentId);
 const changed=await client.request(route(id),{method:'POST',body:{...body,name:'different.txt'}});assert.equal(changed.status,409);
 assert.equal((await upload(app,client,id,first.value.attachmentId,bytes)).status,200);
 assert.equal((await client.request(route(id)+'/'+first.value.attachmentId)).value.state,'ready');
 assert.equal((await upload(app,client,id,first.value.attachmentId,bytes)).status,200);
 assert.equal((await upload(app,client,id,first.value.attachmentId,Buffer.from('wrong'))).status,422);
 assert.equal(app.handler.runtime.connections.size,0);
});

test('foreign owner and other conversation cannot observe metadata, mutate bytes or download originals',async t=>{
 const {app,client}=await setup(t),id='http-owner',bytes=Buffer.from('private synthetic original'),value=await staged(app,client,id,bytes),foreign=await app.client();
 for(const candidate of [foreign,client]){
  const otherId=candidate===client?'wrong-conversation':id;
  assert.equal((await candidate.request(route(otherId)+'/'+value.attachmentId)).status,404);
  assert.equal((await upload(app,candidate,otherId,value.attachmentId,bytes)).status,404);
  assert.equal((await candidate.request(route(otherId)+'/'+value.attachmentId+'/download',{raw:true})).status,404);
 }
});

test('raw upload requires existing Host Origin and CSRF controls and octet content type',async t=>{
 const {app,client}=await setup(t),id='http-csrf',bytes=Buffer.from('csrf bytes');
 const reserved=await client.request(route(id),{method:'POST',body:metadata(bytes)});assert.equal(reserved.status,201);
 for(const headers of [{'x-harness-csrf':'invalid'},{Origin:'https://foreign.invalid'},{host:'foreign.invalid'}])assert.equal((await upload(app,client,id,reserved.value.attachmentId,bytes,headers)).status,403);
 assert.equal((await upload(app,client,id,reserved.value.attachmentId,bytes,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await client.request(route(id)+'/'+reserved.value.attachmentId)).value.state,'reserved');
});

test('HTTP refuses guessed local file paths and streamed checksum mismatch before ready or model work',async t=>{
 const {app,client}=await setup(t),id='http-invalid',bytes=Buffer.from('actual bounded bytes');
 for(const field of ['fileURL','rawsecret','path','owner']){
  const rejected=await client.request(route(id),{method:'POST',body:metadata(bytes,{[field]:'/private/rawsecret'})});assert.equal(rejected.status,400);
 }
 const reserved=await client.request(route(id),{method:'POST',body:metadata(bytes)});assert.equal(reserved.status,201);
 const bad=await upload(app,client,id,reserved.value.attachmentId,Buffer.alloc(bytes.length,65));assert.equal(bad.status,422);
 assert.equal((await client.request(route(id)+'/'+reserved.value.attachmentId)).value.state,'reserved');
 assert.equal((await client.request(route(id)+'/'+reserved.value.attachmentId+'/download',{raw:true})).status,409);
 assert.equal(app.handler.runtime.connections.size,0);
});

test('reserved metadata survives restart and owner receipt recovers ready canonical download without child',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),id='http-restart',bytes=Buffer.from('durable HTTP '+randomUUID());
 const value=await staged(app,client,id,bytes),credentials={cookie:client.cookie,csrf:client.csrf};await app.close({keepData:true});
 const restored=await startHarness({dataDir:app.dataDir});t.after(async()=>{await restored.close();const {rm}=await import('node:fs/promises');await rm(app.dataDir,{recursive:true,force:true});});
 const resumed=await restored.client(credentials),status=await resumed.request(route(id)+'/'+value.attachmentId);assert.equal(status.status,200);assert.equal(status.value.state,'ready');
 const response=await resumed.request(route(id)+'/'+value.attachmentId+'/download',{raw:true});assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal(restored.handler.runtime.connections.size,0);
});

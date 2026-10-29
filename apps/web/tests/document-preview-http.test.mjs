import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {startHarness} from './fixtures/harness-http.mjs';
const type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
test('DOCX preview uses owner-scoped original and returns digest-bound JSON',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),foreign=await app.client(),id='docx-preview';
 const bytes=await readFile(new URL('./fixtures/model-attachments/facts.docx',import.meta.url)),sha256=createHash('sha256').update(bytes).digest('hex');
 const base='/conversations/'+id+'/attachments';
 const reserve=await client.request(base,{method:'POST',body:{requestId:randomUUID(),name:'facts.docx',type,size:bytes.length,sha256}});assert.equal(reserve.status,201);
 const route=base+'/'+reserve.value.attachmentId;
 const upload=await fetch(app.baseUrl+'/api/harness'+route+'/content',{method:'PUT',headers:{cookie:client.cookie,Origin:app.baseUrl,'x-harness-csrf':client.csrf,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(upload.status,200);
 const result=await client.request(route+'/preview');assert.equal(result.status,200);assert.equal(result.value.kind,'docx');assert.equal(result.value.sha256,sha256);assert.equal(result.value.size,bytes.length);assert.equal(result.value.attachmentId,reserve.value.attachmentId);assert.match(result.value.html,/DOCX_VERIFIED_NONCE_COBALT_7319/);
 assert.equal((await foreign.request(route+'/preview')).status,404);
 assert.equal((await client.request(route.replace(id,'wrong-conversation')+'/preview')).status,404);
 assert.equal(app.handler.runtime.connections.size,0);
});

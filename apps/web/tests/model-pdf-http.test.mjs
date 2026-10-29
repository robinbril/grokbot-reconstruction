import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startHarness,collectUntil,collectQueueUntil} from './fixtures/harness-http.mjs';
import {makePdfPages} from './fixtures/model-attachments/generate-pdf-pages.mjs';
async function upload(app,client,id,name){
 const bytes=await readFile(new URL('./fixtures/model-attachments/'+name,import.meta.url));
 return uploadBytes(app,client,id,name,bytes);
}
async function uploadBytes(app,client,id,name,bytes){
 const reserved=await client.request(`/conversations/${id}/attachments`,{method:'POST',body:{requestId:randomUUID(),name,type:'application/pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
 assert.equal(reserved.status,201);
 const ref={attachmentId:reserved.value.attachmentId,size:bytes.length,sha256:reserved.value.sha256};
 const put=await fetch(`${app.baseUrl}/api/harness/conversations/${id}/attachments/${ref.attachmentId}/content`,{method:'PUT',headers:{cookie:client.cookie,Origin:app.baseUrl,'x-harness-csrf':client.csrf,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(put.status,200);
 return {bytes,ref};
}
function model(calls){return {status:()=>({state:'ready',provider:'synthetic-pdf-transport'}),async complete(input){calls.push(input);return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'PDF model input received'}}}]};}};}
function parts(input){return input.messages.findLast(message=>message.role==='user').content;}
function assertPng(part){
 assert.equal(part.type,'image_url');assert.match(part.image_url.url,/^data:image\/png;base64,/);
 const bytes=Buffer.from(part.image_url.url.split(',')[1],'base64');assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.ok(bytes.readUInt32BE(16)>0);assert.ok(bytes.readUInt32BE(20)>0);
}
test('blank PDF page reaches actual run model input as pixels rather than unsupported empty text',async t=>{
 const calls=[],app=await startHarness({model:model(calls)});t.after(()=>app.close());const client=await app.client(),id='blank-pdf-pixels';
 const {ref,bytes}=await upload(app,client,id,'scan.pdf');
 const accepted=await client.request(`/conversations/${id}/runs`,{method:'POST',body:{requestId:randomUUID(),text:'Describe this PDF',attachmentRefs:[ref]}});
 assert.equal(accepted.status,202,JSON.stringify(accepted.value));await collectUntil(client,accepted.value.runId,event=>event.type==='run.completed');
 const images=parts(calls[0]).filter(part=>part.type==='image_url');assert.equal(images.length,1);assertPng(images[0]);
 const publicState=(await client.request('/conversations/'+id)).value;assert.equal(JSON.stringify(publicState).includes('data:image/'),false);
 const original=await client.request(`/conversations/${id}/attachments/${ref.attachmentId}/download`,{raw:true});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
});
test('mixed PDF text and scanned page pixels reach queued model execution with unchanged original bytes',async t=>{
 const calls=[],app=await startHarness({model:model(calls)});t.after(()=>app.close());const client=await app.client(),id='mixed-pdf-pixels';
 const {ref,bytes}=await upload(app,client,id,'mixed-pages.pdf');
 const accepted=await client.request(`/conversations/${id}/queue`,{method:'POST',body:{requestId:randomUUID(),text:'Describe both pages',attachmentRefs:[ref]}});assert.equal(accepted.status,202,JSON.stringify(accepted.value));
 // PDF worker phases are bounded separately. Only the actual queue-completion
 // event passes this check; reaching the overall deadline remains a failure.
 const completed=await collectQueueUntil(client,id,accepted.value.queueId,{timeout:60000});
 assert.equal(completed.status,'completed',JSON.stringify(completed.error));const input=parts(calls[0]),serialized=JSON.stringify(input.filter(part=>part.type==='text'));
 assert.match(serialized,/MIXED_TEXT_NONCE_AMBER_7392/);assert.match(serialized,/Page 2|page 2/);
 assert.equal(serialized.includes('PDF_PIXEL_NONCE_VIOLET_6281'),false,'scanned words must not be supplied as text hints');
 const images=input.filter(part=>part.type==='image_url');assert.equal(images.length,1);assertPng(images[0]);
 const publicState=(await client.request('/conversations/'+id)).value;assert.equal(JSON.stringify(publicState).includes('data:image/'),false);assert.equal(JSON.stringify(publicState).includes('MIXED_TEXT_NONCE_AMBER_7392'),false);
 const original=await client.request(`/conversations/${id}/attachments/${ref.attachmentId}/download`,{raw:true});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
});


test('undecodable and oversized embedded PDF images fail before run or queue acceptance',async t=>{
 const calls=[],app=await startHarness({model:model(calls)});t.after(()=>app.close());const client=await app.client(),id='invalid-pdf-images';
 for(const [route,bytes]of [['runs',makePdfPages({corruptImage:true})],['queue',makePdfPages({declaredWidth:6000,declaredHeight:6000})]]){
  const {ref}=await uploadBytes(app,client,id,'invalid-image.pdf',bytes),requestId=randomUUID();
  const result=await client.request(`/conversations/${id}/${route}`,{method:'POST',body:{requestId,text:'Read this PDF',attachmentRefs:[ref]}});
  assert.equal(result.status,422,JSON.stringify(result.value));assert.equal(result.value.error.code,'ATTACHMENT_CONTENT_INVALID');assert.equal(result.value.error.accepted,false);
  const state=(await client.request('/conversations/'+id)).value;assert.equal(state.runs.length,0);assert.equal(state.queue.length,0);assert.equal(state.entries.length,0);assert.equal(calls.length,0);
  const original=await client.request(`/conversations/${id}/attachments/${ref.attachmentId}/download`,{raw:true});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startHarness} from './fixtures/harness-http.mjs';

async function stage(app,client,id,bytes,name,type){
 const reserved=await client.request(`/conversations/${id}/attachments`,{method:'POST',body:{requestId:randomUUID(),name,type,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});assert.equal(reserved.status,201);
 const response=await fetch(`${app.baseUrl}/api/harness/conversations/${id}/attachments/${reserved.value.attachmentId}/content`,{method:'PUT',headers:{cookie:client.cookie,Origin:app.baseUrl,'x-harness-csrf':client.csrf,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(response.status,200);
 return {attachmentId:reserved.value.attachmentId,size:bytes.length,sha256:reserved.value.sha256};
}

test('unsupported or corrupt original attachment rejects HTTP run before acceptance, preserving the original and request ID',async t=>{
 let calls=0;const app=await startHarness({model:{status:()=>({state:'ready'}),complete:async()=>{calls++;throw Error('must not call model');}}});t.after(()=>app.close());const client=await app.client(),id='preflight-attachments';
 for(const [name,type,bytes,code]of[['x.zip','application/zip',Buffer.from('PK'),'ATTACHMENT_MODEL_UNSUPPORTED'],['x.pdf','application/pdf',Buffer.from('bad PDF'),'ATTACHMENT_CONTENT_INVALID']]){
  const ref=await stage(app,client,id,bytes,name,type),requestId=randomUUID();
  const response=await client.request(`/conversations/${id}/runs`,{method:'POST',body:{requestId,text:'Read the attachment',attachmentRefs:[ref]}});assert.equal(response.status,422);assert.equal(response.value.error.code,code);assert.equal(response.value.error.accepted,false);
  const snapshot=(await client.request('/conversations/'+id)).value;assert.equal(snapshot.runs.length,0);assert.equal(snapshot.entries.length,0);assert.equal(calls,0);assert.equal(app.handler.store.states.get(id)?.requests?.['model:'+requestId],undefined);
  const original=await client.request(`/conversations/${id}/attachments/${ref.attachmentId}/download`,{raw:true});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
 }
});

test('actual PDF bytes reach model user content; document text remains private in public state',async t=>{
 let received;const app=await startHarness({model:{status:()=>({state:'ready'}),complete:async input=>{received=input;return {text:'',toolCalls:[{id:'document-reply',name:'SendMessage',arguments:{text:{content:'Document read.'}}}]};}}});t.after(()=>app.close());const client=await app.client(),id='pdf-model-input';
 const bytes=await readFile(new URL('./fixtures/model-attachments/facts.pdf',import.meta.url)),ref=await stage(app,client,id,bytes,'facts.pdf','application/pdf');
 const response=await client.request(`/conversations/${id}/runs`,{method:'POST',body:{requestId:randomUUID(),text:'Read the attachment',attachmentRefs:[ref]}});assert.equal(response.status,202,JSON.stringify(response.value));
 for(let i=0;i<100&&!received;i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(received);assert.match(JSON.stringify(received.messages.findLast(message=>message.role==='user').content),/PDF_VERIFIED_NONCE_ORANGE_8294/);
 const snapshot=(await client.request('/conversations/'+id)).value;assert.equal(JSON.stringify(snapshot).includes('PDF_VERIFIED_NONCE_ORANGE_8294'),false);
});

test('unsupported queued attachments reject before consuming the queue intent',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),id='queue-preflight';
 const ref=await stage(app,client,id,Buffer.from('PK'),'blocked.zip','application/zip');
 const response=await client.request(`/conversations/${id}/queue`,{method:'POST',body:{requestId:randomUUID(),text:'Read this',attachmentRefs:[ref]}});
 assert.equal(response.status,422);assert.equal(response.value.error.accepted,false);
 assert.equal((await client.request('/conversations/'+id)).value.queue.length,0);
});

test('queued PDF attachments reach the model and complete through the same host',async t=>{
 let received;const app=await startHarness({model:{status:()=>({state:'ready'}),complete:async input=>{received=input;return {text:'',toolCalls:[{id:'queued-document',name:'SendMessage',arguments:{text:{content:'Queued document read.'}}}]};}}});
 t.after(()=>app.close());const client=await app.client(),id='queued-pdf-model';
 const bytes=await readFile(new URL('./fixtures/model-attachments/facts.pdf',import.meta.url)),ref=await stage(app,client,id,bytes,'facts.pdf','application/pdf');
 const accepted=await client.request(`/conversations/${id}/queue`,{method:'POST',body:{requestId:randomUUID(),text:'Read this',attachmentRefs:[ref]}});assert.equal(accepted.status,202);
 let state;for(let i=0;i<200;i++){state=app.handler.store.states.get(id);if(state?.queue[0]?.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(state.queue[0].status,'completed',JSON.stringify(state.queue[0]));assert.match(JSON.stringify(received.messages.findLast(message=>message.role==='user').content),/PDF_VERIFIED_NONCE_ORANGE_8294/);assert.equal(state.entries.at(-1).text,'Queued document read.');
});

test('public callers cannot forge internal queue request identifiers',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client();
 const result=await client.request('/conversations/queue-public/runs',{method:'POST',body:{requestId:'queue:forged',text:'Do not execute'}});
 assert.equal(result.status,400);assert.equal(result.value.error.code,'INVALID_REQUEST_ID');
 assert.equal(app.handler.runtime.jobs.size,0);
});

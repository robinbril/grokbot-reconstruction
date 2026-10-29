// Actual HTTP/store/runtime with explicit synthetic inference, no external provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {startHarness} from './fixtures/harness-http.mjs';
import {createWorkflowFixtureModel} from './fixtures/live-workflows-model.mjs';
test('accepted idle attachment run replays immutable receipt after corruption while changed requests still conflict',async t=>{
 const app=await startHarness({model:createWorkflowFixtureModel()});t.after(()=>app.close());
 const client=await app.client(),id='idle-attachment-receipt',bytes=Buffer.from('actual receipt fixture '+randomUUID());
 const reserved=await client.request('/conversations/'+id+'/attachments',{method:'POST',body:{requestId:'reserve',name:'proof.txt',type:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
 assert.equal(reserved.status,201);const attachment=reserved.value;
 const uploaded=await fetch(app.baseUrl+'/api/harness/conversations/'+id+'/attachments/'+attachment.attachmentId+'/content',{method:'PUT',headers:{cookie:client.cookie,Origin:app.baseUrl,'x-harness-csrf':client.csrf,'Content-Type':'application/octet-stream'},body:bytes});
 assert.equal(uploaded.status,200);await uploaded.arrayBuffer();
 const request={requestId:'accepted',text:'read the attached workspace file',attachmentRefs:[{attachmentId:attachment.attachmentId,size:attachment.size,sha256:attachment.sha256}]};
 const first=await client.request('/conversations/'+id+'/runs',{method:'POST',body:request});
 assert.equal(first.status,202);assert.equal(first.value.accepted,true);
 const deadline=Date.now()+5000;while(app.handler.store.states.get(id).runs[0].status!=='completed'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.equal(app.handler.store.states.get(id).runs[0].status,'completed');
 await writeFile(path.join(app.dataDir,'attachments',id,attachment.attachmentId,'source'),'corrupt later');
 const replay=await client.request('/conversations/'+id+'/runs',{method:'POST',body:structuredClone(request)});
 assert.equal(replay.status,202,'already accepted exact retry recovers receipt without requiring readable bytes');
 assert.deepEqual(replay.value,first.value);
 for(const body of [{...request,text:'different accepted text'},{...request,attachmentRefs:[{...request.attachmentRefs[0],sha256:'0'.repeat(64)}]}]){
  const changed=await client.request('/conversations/'+id+'/runs',{method:'POST',body});
  assert.equal(changed.status,409);assert.equal(changed.value.error.code,'IDEMPOTENCY_CONFLICT');
 }
 const fresh=await client.request('/conversations/'+id+'/runs',{method:'POST',body:{...request,requestId:'new-unavailable-admission'}});
 assert.equal(fresh.status,409);assert.equal(fresh.value.error.code,'ATTACHMENT_UNAVAILABLE');
 assert.equal(app.handler.store.states.get(id).runs.length,1,'receipt recovery and unavailable new admission never create another native run');
 assert.equal(app.handler.store.states.get(id).entries.filter(e=>e.role==='user').length,1);
});

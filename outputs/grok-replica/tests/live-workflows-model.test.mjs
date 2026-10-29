import test from 'node:test';
import assert from 'node:assert/strict';
import {queueRows,queueStatusLabel,scheduleHistory,liveDraftSignature,uploadIdentity,readyAttachmentRefs} from '../live-workflows-model.js';
import {normalizeLiveSnapshot,projectLiveMessages,liveActive} from '../live-harness-model.js';

test('pending queue is canonical acceptance order and excludes terminal history',()=>{
 const input=[{id:'later',enqueueSequence:2,status:'queued',createdAt:'2026-10-18T09:00:02Z'},{id:'done',enqueueSequence:0,status:'completed'},{id:'first',enqueueSequence:1,status:'running',createdAt:'2026-10-18T09:00:01Z'},{id:'cancel',enqueueSequence:3,status:'cancelled'}];
 assert.deepEqual(queueRows(input).map(row=>row.id),['first','later']);assert.equal(input[0].id,'later');
 assert.equal(queueStatusLabel('queued'),'In wachtrij');assert.equal(queueStatusLabel('blocked'),'Geblokkeerd');assert.equal(liveActive('queued'),false);
});

test('schedule history joins real run status and never fabricates completion from queue acceptance',()=>{
 const rows=[{id:'q1',status:'queued',runId:null,source:{kind:'schedule',scheduleId:'s1'}},{id:'q2',status:'running',runId:'r2',source:{kind:'schedule',scheduleId:'s1'}},{id:'q3',status:'completed',runId:'r3',source:{kind:'schedule',scheduleId:'other'}}];
 const history=scheduleHistory('s1',rows,[{id:'r2',status:'waiting_approval'}]);
 assert.deepEqual(history.map(row=>[row.id,row.executionStatus]),[['q1','queued'],['q2','waiting_approval']]);assert.equal(history[0].runId,null);
});

test('draft signature includes ordered exact browser file identities and context',()=>{
 const draft={text:'same text',attachments:[{id:'file-a',name:'same.txt',size:10}],quote:{text:'quote'},skillReferences:[{id:'skill'}]};
 assert.notEqual(liveDraftSignature(draft),liveDraftSignature({...draft,attachments:[{id:'file-b',name:'same.txt',size:10}]}));
 assert.notEqual(liveDraftSignature(draft),liveDraftSignature({...draft,quote:{text:'new quote'}}));
 assert.equal(liveDraftSignature(draft),liveDraftSignature(structuredClone(draft)));
});

test('upload identity scopes same browser blob to exact canonical conversation and ready refs preserve order',()=>{
 assert.notEqual(uploadIdentity('conversation-a','file-a'),uploadIdentity('conversation-b','file-a'));
 const ready={state:'ready',attachmentId:'server-file-a',sha256:'a'.repeat(64),size:10};
 const mappings={[uploadIdentity('conversation-a','file-a')]:ready,[uploadIdentity('conversation-a','file-b')]:{state:'reserved',attachmentId:'server-file-b',sha256:'b'.repeat(64),size:11}};
 assert.deepEqual(readyAttachmentRefs('conversation-a',[{id:'file-a'}],mappings),[{attachmentId:'server-file-a',sha256:'a'.repeat(64),size:10}]);
 assert.throws(()=>readyAttachmentRefs('conversation-a',[{id:'file-a'},{id:'file-b'}],mappings),/gereed|upload/i);
 assert.throws(()=>readyAttachmentRefs('conversation-b',[{id:'file-a'}],mappings),/gereed|upload/i);
});

test('canonical normalization preserves independent workflows and safe attachment metadata',()=>{
 const value={schema:1,conversationId:'owned',queue:[{id:'q',status:'queued'}],schedules:[{id:'s',revision:1,status:'paused'}],workflow:{hold:{code:'UNCERTAIN',queueId:'q'}},entries:[{id:'u',runId:'r',role:'user',text:'',attachments:[{attachmentId:'a',name:'proof.txt',size:10,sha256:'a'.repeat(64),downloadUrl:'/api/harness/conversations/owned/attachments/a/download'}],attachmentRefs:[{attachmentId:'a',size:10,sha256:'a'.repeat(64)}]}]};
 const normalized=normalizeLiveSnapshot(value,'owned');assert.equal(normalized.queue[0].id,'q');assert.equal(normalized.schedules[0].revision,1);assert.equal(normalized.workflow.hold.code,'UNCERTAIN');
 const message=projectLiveMessages(normalized)[0];assert.equal(message.attachments[0].attachmentId,'a');assert.equal(message.liveHarness.kind,'user');assert.equal(message.liveHarness.runId,'r');
});

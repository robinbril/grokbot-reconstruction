// Real filesystem/store evidence. No provider or model is invoked by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink,link,unlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {HarnessStore} from '../harness/store.mjs';

const owner='test-owner-a',conversation='attachment-conversation';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const meta=(bytes,extra={})=>({requestId:randomUUID(),name:'facts.txt',type:'text/plain',size:bytes.length,sha256:sha(bytes),...extra});
async function* chunks(bytes){for(let i=0;i<bytes.length;i+=7)yield bytes.subarray(i,i+7);}
async function setup(t,options={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-attachment-store-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const {AttachmentStore}=await import('../harness/attachments.mjs');
 const store=await new HarnessStore({dataDir}).init();
 const attachments=await new AttachmentStore({dataDir,store,...options}).init();
 return {dataDir,store,attachments,AttachmentStore};
}
async function ready(attachments,bytes,{ownerId=owner,id=conversation,...extra}={}){
 const reserved=await attachments.reserve(ownerId,id,meta(bytes,extra));
 const uploaded=await attachments.put(ownerId,id,reserved.attachmentId,chunks(bytes));
 return {reserved,uploaded,ref:{attachmentId:uploaded.attachmentId,sha256:uploaded.sha256,size:uploaded.size}};
}
const sourcePath=(dataDir,id,aid)=>path.join(dataDir,'attachments',id,aid,'source');
const code=expected=>error=>{assert.equal(error.code,expected,error.stack);return true;};

test('real streamed bytes are durable before ready, survive store reconstruction, and download exactly',async t=>{
 const {dataDir,store,attachments,AttachmentStore}=await setup(t);
 const bytes=Buffer.from('FIRST\nGreek Ω; 日本語; binary\u0000\nUNPREDICTABLE_FINAL_TAIL '+randomUUID());
 const {reserved,uploaded,ref}=await ready(attachments,bytes);
 assert.equal(reserved.state,'reserved');assert.equal(uploaded.state,'ready');
 assert.equal(uploaded.sha256,sha(bytes));assert.equal(uploaded.size,bytes.length);
 assert.deepEqual(await readFile(sourcePath(dataDir,conversation,ref.attachmentId)),bytes);
 assert.deepEqual((await attachments.download(owner,conversation,ref.attachmentId)).bytes,bytes);
 assert.equal((await attachments.validateReady(owner,conversation,[ref])).length,1);
 const saved=JSON.stringify(store.snapshot(store.get(owner,conversation)));
 assert.equal(saved.includes('UNPREDICTABLE_FINAL_TAIL'),false);assert.equal(saved.includes(dataDir),true,'existing workspaceRoot remains a deliberate snapshot field');
 const reconstructed=await new HarnessStore({dataDir}).init();
 const restored=await new AttachmentStore({dataDir,store:reconstructed}).init();
 assert.equal((await restored.metadata(owner,conversation,ref.attachmentId)).state,'ready');
 assert.deepEqual((await restored.download(owner,conversation,ref.attachmentId)).bytes,bytes);
});

test('lost reservation/upload ACK retries preserve one immutable attachment and reject changed request input',async t=>{
 const {store,attachments}=await setup(t),bytes=Buffer.from('exact retry original'),request=meta(bytes);
 const first=await attachments.reserve(owner,conversation,request),again=await attachments.reserve(owner,conversation,{...request});
 assert.equal(first.attachmentId,again.attachmentId);
 await assert.rejects(attachments.reserve(owner,conversation,{...request,name:'changed.txt'}),code('IDEMPOTENCY_CONFLICT'));
 const uploaded=await attachments.put(owner,conversation,first.attachmentId,chunks(bytes));
 assert.equal((await attachments.metadata(owner,conversation,first.attachmentId)).state,'ready');
 assert.deepEqual(await attachments.put(owner,conversation,first.attachmentId,chunks(bytes)),uploaded);
 await assert.rejects(attachments.put(owner,conversation,first.attachmentId,chunks(Buffer.from('different payload'))),code('UPLOAD_MISMATCH'));
 assert.deepEqual((await attachments.download(owner,conversation,first.attachmentId)).bytes,bytes);
 assert.equal(store.get(owner,conversation).attachments.length,1);
});

test('actual stream length, SHA and interrupted upload fail closed while safe retry keeps original reservation',async t=>{
 const {attachments}=await setup(t),bytes=Buffer.from('retryable actual bytes'),reserved=await attachments.reserve(owner,conversation,meta(bytes));
 await assert.rejects(attachments.put(owner,conversation,reserved.attachmentId,chunks(bytes.subarray(1))),code('UPLOAD_MISMATCH'));
 assert.equal((await attachments.metadata(owner,conversation,reserved.attachmentId)).state,'reserved');
 await assert.rejects(attachments.put(owner,conversation,reserved.attachmentId,chunks(Buffer.alloc(bytes.length,65))),code('UPLOAD_MISMATCH'));
 async function* broken(){yield bytes.subarray(0,3);throw new Error('synthetic disconnected upload');}
 await assert.rejects(attachments.put(owner,conversation,reserved.attachmentId,broken()),/synthetic disconnected upload/);
 assert.equal((await attachments.metadata(owner,conversation,reserved.attachmentId)).state,'reserved');
 assert.equal((await attachments.put(owner,conversation,reserved.attachmentId,chunks(bytes))).state,'ready');
});

test('concurrent same-ID streams never race publication and second upload is explicitly busy',async t=>{
 const {attachments}=await setup(t),bytes=Buffer.from('held-upload'),reserved=await attachments.reserve(owner,conversation,meta(bytes));
 let release,started;const held=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 async function* delayed(){started();await held;yield bytes;}
 const first=attachments.put(owner,conversation,reserved.attachmentId,delayed());await entered;
 try{await assert.rejects(attachments.put(owner,conversation,reserved.attachmentId,chunks(bytes)),code('UPLOAD_BUSY'));}finally{release();}
 assert.equal((await first).state,'ready');
});

test('per-file, owner and conversation quota reservations are bounded and same-request replay counts once',async t=>{
 const {attachments}=await setup(t,{limits:{fileBytes:16,conversationBytes:20,ownerBytes:32,payloadBytes:20,count:10}});
 const bytes=Buffer.alloc(12),request=meta(bytes),one=await attachments.reserve(owner,'quota-a',request);
 assert.equal((await attachments.reserve(owner,'quota-a',request)).attachmentId,one.attachmentId);
 await assert.rejects(attachments.reserve(owner,'quota-a',meta(Buffer.alloc(9))),code('ATTACHMENT_QUOTA_EXCEEDED'));
 await assert.rejects(attachments.reserve(owner,'quota-b',meta(Buffer.alloc(17))),code('ATTACHMENT_LIMIT'));
 await attachments.reserve(owner,'quota-b',meta(Buffer.alloc(12)));
 await assert.rejects(attachments.reserve(owner,'quota-c',meta(Buffer.alloc(9))),code('ATTACHMENT_QUOTA_EXCEEDED'));
 assert.equal((await attachments.reserve('independent-owner','quota-d',meta(Buffer.alloc(12)))).state,'reserved');
});

test('owner/conversation scoped refs, exact size/digest and list count forbid substitutions and duplicates',async t=>{
 const {attachments}=await setup(t),bytes=Buffer.from('scoped'),{ref}=await ready(attachments,bytes);
 for(const method of ['metadata','download']){
  await assert.rejects(attachments[method]('foreign-owner',conversation,ref.attachmentId),code('NOT_FOUND'));
  await assert.rejects(attachments[method](owner,'different-conversation',ref.attachmentId),code('NOT_FOUND'));
 }
 await assert.rejects(attachments.validateReady(owner,conversation,[{...ref,sha256:'0'.repeat(64)}]),code('INVALID_ATTACHMENT'));
 await assert.rejects(attachments.validateReady(owner,conversation,[{...ref,size:bytes.length+1}]),code('INVALID_ATTACHMENT'));
 await assert.rejects(attachments.validateReady(owner,conversation,[ref,ref]),code('INVALID_ATTACHMENT'));
 await assert.rejects(attachments.validateReady(owner,conversation,Array(11).fill(ref)),code('ATTACHMENT_LIMIT'));
});

test('unready and physically missing/corrupt originals cannot validate, materialize or download',async t=>{
 const {attachments,dataDir}=await setup(t),bytes=Buffer.from('immutable bytes'),reserved=await attachments.reserve(owner,conversation,meta(bytes));
 const ref={attachmentId:reserved.attachmentId,size:bytes.length,sha256:sha(bytes)};
 await assert.rejects(attachments.validateReady(owner,conversation,[ref]),code('ATTACHMENT_NOT_READY'));
 await attachments.put(owner,conversation,ref.attachmentId,chunks(bytes));
 await writeFile(sourcePath(dataDir,conversation,ref.attachmentId),'corrupt bytes');
 await assert.rejects(attachments.validateReady(owner,conversation,[ref]),code('ATTACHMENT_UNAVAILABLE'));
 assert.equal((await attachments.metadata(owner,conversation,ref.attachmentId)).state,'unavailable');
 await assert.rejects(attachments.download(owner,conversation,ref.attachmentId),code('ATTACHMENT_UNAVAILABLE'));
 await unlink(sourcePath(dataDir,conversation,ref.attachmentId));
 await assert.rejects(attachments.materialize(owner,conversation,[ref],{workspaceRoot:path.join(dataDir,'work'),runId:'test-run'}),code('ATTACHMENT_UNAVAILABLE'));
});

test('filename metadata never becomes a path and supplied filesystem/URL/secret fields are refused',async t=>{
 const {attachments}=await setup(t),bytes=Buffer.from('display name only');
 for(const field of ['path','sourcePath','fileURL','fileUrl','url','rawsecret','owner','workspaceRoot']){
  await assert.rejects(attachments.reserve(owner,conversation,meta(bytes,{[field]:'/private/secret'})),code('INVALID_ATTACHMENT'));
 }
 for(const name of ['a\r\nb','a\u0000b','x'.repeat(256)])await assert.rejects(attachments.reserve(owner,conversation,meta(bytes,{name})),code('INVALID_ATTACHMENT'));
 const {ref}=await ready(attachments,bytes,{name:'../../display-only.txt'});
 assert.deepEqual((await attachments.download(owner,conversation,ref.attachmentId)).bytes,bytes);
 await assert.rejects(attachments.metadata(owner,conversation,'../escape'),code('INVALID_ATTACHMENT'));
});

test('canonical symlink ancestors/final files and hardlinked originals are refused without reading external bytes',async t=>{
 const {attachments,dataDir}=await setup(t),bytes=Buffer.from('canonical'),{ref}=await ready(attachments,bytes);
 const canonical=sourcePath(dataDir,conversation,ref.attachmentId),external=path.join(dataDir,'external-secret');
 await writeFile(external,'NEVER READ THIS RAWSECRET');await unlink(canonical);await symlink(external,canonical);
 await assert.rejects(attachments.download(owner,conversation,ref.attachmentId),code('ATTACHMENT_UNAVAILABLE'));
 await unlink(canonical);await link(external,canonical);
 await assert.rejects(attachments.download(owner,conversation,ref.attachmentId),code('ATTACHMENT_UNAVAILABLE'));
 const next=await attachments.reserve(owner,'symlink-conversation',meta(bytes));
 await mkdir(path.join(dataDir,'outside'),{recursive:true});
 await rm(path.join(dataDir,'attachments','symlink-conversation'),{recursive:true,force:true});
 await symlink(path.join(dataDir,'outside'),path.join(dataDir,'attachments','symlink-conversation'));
 await assert.rejects(attachments.put(owner,'symlink-conversation',next.attachmentId,chunks(bytes)),code('ATTACHMENT_UNAVAILABLE'));
});

test('materialization reads actual complete bytes and isolated copies never mutate canonical downloads',async t=>{
 const {attachments,dataDir}=await setup(t),bytes=Buffer.from('header\n'+('actual UTF-8 Ω content\n'.repeat(17000))+'HIDDEN_FINAL_TAIL '+randomUUID());
 const {ref}=await ready(attachments,bytes),workspaceRoot=path.join(dataDir,'workspace');await mkdir(workspaceRoot);
 const result=await attachments.materialize(owner,conversation,[ref],{workspaceRoot,runId:'run-complete'});
 assert.deepEqual(result.input,[]);assert.equal(result.attachments.length,1);
 const generated='inputs/run-complete/'+ref.attachmentId+'/source.txt';assert.ok(result.text.includes(generated));assert.ok(result.text.includes(sha(bytes)));
 assert.deepEqual(await readFile(path.join(workspaceRoot,generated)),bytes);
 await writeFile(path.join(workspaceRoot,generated),'MODEL EDITED WORKSPACE COPY');
 assert.deepEqual((await attachments.download(owner,conversation,ref.attachmentId)).bytes,bytes);
});

test('materialization rejects workspace input symlinks and unsupported binaries retain honest file-only bytes',async t=>{
 const {attachments,dataDir}=await setup(t),bytes=Buffer.from('%PDF-1.7\n/Encrypt true\nnot a supported plaintext document');
 const {ref,uploaded}=await ready(attachments,bytes,{name:'encrypted.pdf',type:'application/pdf'});
 assert.equal(uploaded.contentAccess,'file-only');
 const workspaceRoot=path.join(dataDir,'workspace');await mkdir(workspaceRoot);await mkdir(path.join(dataDir,'outside'));await symlink(path.join(dataDir,'outside'),path.join(workspaceRoot,'inputs'));
 await assert.rejects(attachments.materialize(owner,conversation,[ref],{workspaceRoot,runId:'safe-run'}),code('ATTACHMENT_UNAVAILABLE'));
 assert.deepEqual((await attachments.download(owner,conversation,ref.attachmentId)).bytes,bytes);
});

test('real decodable PNG produces installed-schema localImage path; malformed image never masquerades as vision input',async t=>{
 const {attachments,dataDir}=await setup(t),bytes=await readFile(new URL('./fixtures/profile.png',import.meta.url));
 const {ref,uploaded}=await ready(attachments,bytes,{name:'profile.png',type:'image/png'});assert.equal(uploaded.contentAccess,'native-image');
 const workspaceRoot=path.join(dataDir,'workspace');await mkdir(workspaceRoot);
 const result=await attachments.materialize(owner,conversation,[ref],{workspaceRoot,runId:'run-image'});
 assert.equal(result.input.length,1);assert.equal(result.input[0].type,'localImage');assert.equal(path.isAbsolute(result.input[0].path),true);
 assert.deepEqual(await readFile(result.input[0].path),bytes);
 const schema=JSON.parse(await readFile(new URL('./fixtures/live-workflows-turn-start.schema.json',import.meta.url),'utf8'));
 const variant=schema.definitions.UserInput.oneOf.find(value=>value.title==='LocalImageUserInput');
 for(const required of variant.required)assert.ok(required in result.input[0]);
 assert.equal(variant.properties.type.enum.includes(result.input[0].type),true);
 assert.ok(Object.keys(result.input[0]).every(key=>key in variant.properties),'no guessed native protocol fields');
 const malformed=await ready(attachments,Buffer.from('PNG filename but actual plain text'),{name:'fake.png',type:'image/png'});
 assert.notEqual(malformed.uploaded.contentAccess,'native-image');
 assert.deepEqual((await attachments.materialize(owner,conversation,[malformed.ref],{workspaceRoot,runId:'run-fake'})).input,[]);
});

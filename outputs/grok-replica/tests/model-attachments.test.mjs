import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,unlink,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {HarnessStore} from '../harness/store.mjs';
import {AttachmentStore} from '../harness/attachments.mjs';
import {prepareModelAttachments,prepareModelAttachmentsBeforeAcceptance} from '../harness/model-attachment-input.mjs';
const owner='model-owner',id='model-input';
async function setup(t){const dataDir=await mkdtemp(path.join(tmpdir(),'grok-model-attachments-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));const store=await new HarnessStore({dataDir}).init();return {dataDir,store,attachments:await new AttachmentStore({dataDir,store}).init()};}
async function upload(attachments,bytes,name,type){const value=await attachments.reserve(owner,id,{requestId:randomUUID(),name,type,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});await attachments.put(owner,id,value.attachmentId,[bytes]);return {attachmentId:value.attachmentId,sha256:value.sha256,size:value.size};}
const fixture=name=>readFile(new URL('./fixtures/model-attachments/'+name,import.meta.url));
const code=value=>error=>error.code===value;

test('UTF-8 text, CSV, JSON and source content are actual model text and absent from public snapshots',async t=>{
 const {attachments,store}=await setup(t),nonce=randomUUID(),refs=[];
 for(const [name,type,value]of[['facts.txt','text/plain',nonce],['facts.csv','text/csv','candidate,total\nA,42'],['facts.json','application/json','{"total":42}'],['script.ts','application/octet-stream','const total: number = 42;']])refs.push(await upload(attachments,Buffer.from(value),name,type));
 const result=await prepareModelAttachments(attachments,owner,id,refs);assert.equal(result.contentParts.length,4);assert.match(JSON.stringify(result.contentParts),new RegExp(nonce));assert.match(result.contentParts[1].text,/candidate,total\nA,42/);assert.equal(JSON.stringify(store.snapshot(store.get(owner,id))).includes(nonce),false);
});

test('PDF and DOCX parse actual original document contents rather than filenames',async t=>{
 const {attachments}=await setup(t),refs=[];
 refs.push(await upload(attachments,await fixture('facts.pdf'),'document.pdf','application/pdf'));
 refs.push(await upload(attachments,await fixture('facts.docx'),'document.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
 const result=await prepareModelAttachments(attachments,owner,id,refs);
 assert.match(result.contentParts[0].text,/PDF_VERIFIED_NONCE_ORANGE_8294/);assert.match(result.contentParts[1].text,/DOCX_VERIFIED_NONCE_COBALT_7319/);assert.match(result.contentParts[1].text,/Amount: 42/);
});

test('native-decoded PNG, JPEG and WebP are actual canonical image data blocks',async t=>{
 const {attachments}=await setup(t);
 for(const format of ['png','jpeg','webp']){
  const bytes=await fixture('vision.'+format),ref=await upload(attachments,bytes,'vision.'+format,'image/'+format);
  const result=await prepareModelAttachments(attachments,owner,id,[ref]);assert.equal(result.contentParts[1].type,'image_url');const url=result.contentParts[1].image_url.url;
  if(format==='webp'){assert.ok(url.startsWith('data:image/png;base64,'));const png=Buffer.from(url.split(',')[1],'base64');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length<=5*1024*1024);assert.ok(png.readUInt32BE(16)<=10000);assert.ok(png.readUInt32BE(20)<=10000);}else assert.equal(url,'data:image/'+format+';base64,'+bytes.toString('base64'));
  const original=await attachments.download(owner,id,ref.attachmentId);assert.deepEqual(original.bytes,bytes);assert.equal(original.sha256,ref.sha256);
 }
});

test('blank scanned PDF supplies actual page pixels and oversized DOCX still rejects',async t=>{
 const {attachments}=await setup(t);
 const scan=await upload(attachments,await fixture('scan.pdf'),'scan.pdf','application/pdf');
 const result=await prepareModelAttachments(attachments,owner,id,[scan]);assert.ok(result.contentParts.some(part=>part.type==='image_url'));
 for(const [name,type,expected]of [['oversized.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','ATTACHMENT_CONTENT_INVALID']]){
  const ref=await upload(attachments,await fixture(name),name,type);await assert.rejects(prepareModelAttachments(attachments,owner,id,[ref]),code(expected));
 }
});

test('unsupported, corrupt, mislabeled images and non-UTF8 input fail explicitly',async t=>{
 const {attachments}=await setup(t);
 for(const [name,type,bytes,expected]of[['archive.zip','application/zip',Buffer.from('PK'),'ATTACHMENT_MODEL_UNSUPPORTED'],['bad.pdf','application/pdf',Buffer.from('broken'),'ATTACHMENT_CONTENT_INVALID'],['bad.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',Buffer.from('broken'),'ATTACHMENT_CONTENT_INVALID'],['bad.png','image/png',Buffer.from('not an image'),'ATTACHMENT_CONTENT_INVALID'],['bad.txt','text/plain',Buffer.from([255,0,254]),'ATTACHMENT_CONTENT_INVALID']]){
  const ref=await upload(attachments,bytes,name,type);await assert.rejects(prepareModelAttachments(attachments,owner,id,[ref]),code(expected));
 }
});

test('owner mismatch, changed original bytes, symlink substitution and expanded text limits fail closed',async t=>{
 const {attachments,dataDir}=await setup(t),ref=await upload(attachments,Buffer.from('owned nonce'),'a.txt','text/plain');
 await assert.rejects(prepareModelAttachments(attachments,'other-owner',id,[ref]),code('NOT_FOUND'));
 const source=path.join(dataDir,'attachments',id,ref.attachmentId,'source');await writeFile(source,'corrupt');await assert.rejects(prepareModelAttachments(attachments,owner,id,[ref]),code('ATTACHMENT_UNAVAILABLE'));
 await unlink(source);const outside=path.join(dataDir,'outside');await writeFile(outside,'owned nonce');await symlink(outside,source);await assert.rejects(prepareModelAttachments(attachments,owner,id,[ref]),code('ATTACHMENT_UNAVAILABLE'));
 const large=await upload(attachments,Buffer.alloc(1048577,65),'large.txt','text/plain');await assert.rejects(prepareModelAttachments(attachments,owner,id,[large]),code('ATTACHMENT_TEXT_LIMIT'));
});

test('model-only WebP conversion failure rejects before durable admission',async()=>{
 const bytes=Buffer.from('RIFFbroken WEBP bytes'),store={validateReady:async()=>[{attachmentId:'a'}],download:async()=>({name:'broken.webp',type:'image/webp',mediaType:'image/webp',contentAccess:'native-image',bytes})};
 await assert.rejects(prepareModelAttachmentsBeforeAcceptance(store,owner,id,[{attachmentId:'a'}]),error=>error.code==='ATTACHMENT_CONTENT_INVALID'&&error.accepted===false);
 assert.equal(bytes.toString(),'RIFFbroken WEBP bytes');
});
test('aggregate normalized image input and extracted text share a preacceptance 20 MiB budget',async()=>{
 const image=Buffer.alloc(4*1024*1024+1,1),files=Array.from({length:5},(_,i)=>({attachmentId:String(i),name:'already-validated-'+i+'.png',type:'image/png',mediaType:'image/png',contentAccess:'native-image',bytes:image}));
 const store={validateReady:async()=>files.map(file=>({attachmentId:file.attachmentId})),download:async(_owner,_id,attachmentId)=>files.find(file=>file.attachmentId===attachmentId)};
 await assert.rejects(prepareModelAttachmentsBeforeAcceptance(store,owner,id,[]),error=>error.code==='ATTACHMENT_MODEL_INPUT_LIMIT'&&error.status===413&&error.accepted===false);
 files.splice(0,files.length,...Array.from({length:4},(_,i)=>({attachmentId:String(i),name:'already-validated-'+i+'.png',type:'image/png',mediaType:'image/png',contentAccess:'native-image',bytes:Buffer.alloc(5*1024*1024-1024,1)})),{attachmentId:'text',name:'facts.txt',type:'text/plain',bytes:Buffer.alloc(8192,65)});
 await assert.rejects(prepareModelAttachmentsBeforeAcceptance(store,owner,id,[]),error=>error.code==='ATTACHMENT_MODEL_INPUT_LIMIT'&&error.accepted===false);
});

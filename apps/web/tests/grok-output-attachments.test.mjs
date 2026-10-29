import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {HarnessStore} from '../harness/store.mjs';
import {AttachmentStore} from '../harness/attachments.mjs';
const owner='output-owner',conversationId='output-conversation',baseUrl='http://127.0.0.1:3210';
const prefix=`/api/harness/conversations/${conversationId}`;
async function setup(t,limits){
 const dataDir=await fs.mkdtemp(path.join(tmpdir(),'grok-output-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
 const store=await new HarnessStore({dataDir}).init();await store.transaction(owner,conversationId,()=>{});
 const attachments=await new AttachmentStore({dataDir,store,limits}).init();
 const workspaceRoot=store.get(owner,conversationId).workspaceRoot;await fs.mkdir(workspaceRoot,{recursive:true});
 const module=await import('../harness/message-attachments.mjs').catch(()=>({}));
 return {store,attachments,workspaceRoot,resolve:options=>{assert.equal(typeof module.resolveMessageAttachment,'function','outgoing attachment resolver exists');return module.resolveMessageAttachment({attachments,owner,conversationId,workspaceRoot,baseUrl,requestId:'run-call-1',...options});}};
}
test('workspace delivery stores immutable exact bytes and idempotent request identity',async t=>{
 const ctx=await setup(t),bytes=Buffer.from('actual original Ω bytes');await fs.mkdir(path.join(ctx.workspaceRoot,'reports'));await fs.writeFile(path.join(ctx.workspaceRoot,'reports','result.txt'),bytes);
 const options={url:prefix+'/preview/reports%2Fresult.txt',alt:'Result report'};
 const first=await ctx.resolve(options);assert.equal(first.state,'ready');assert.equal(first.name,'result.txt');assert.equal(first.type,'text/plain');assert.equal(first.alt,'Result report');
 assert.deepEqual((await ctx.attachments.download(owner,conversationId,first.attachmentId)).bytes,bytes);
 assert.equal((await ctx.resolve(options)).attachmentId,first.attachmentId);
 await fs.writeFile(path.join(ctx.workspaceRoot,'reports','result.txt'),'changed');
 await assert.rejects(ctx.resolve(options),{code:'IDEMPOTENCY_CONFLICT'});
 assert.deepEqual((await ctx.attachments.download(owner,conversationId,first.attachmentId)).bytes,bytes);
});
test('owned download reference reuses original and refuses unavailable or foreign bytes',async t=>{
 const ctx=await setup(t);await fs.writeFile(path.join(ctx.workspaceRoot,'proof.bin'),Buffer.from([0,1,2,3]));
 const first=await ctx.resolve({url:prefix+'/preview/proof.bin'}),url=baseUrl+prefix+'/attachments/'+first.attachmentId+'/download';
 assert.equal((await ctx.resolve({url})).attachmentId,first.attachmentId);
 await assert.rejects(ctx.resolve({url:url.replace(conversationId,'foreign-conversation')}));
 await fs.writeFile(path.join(ctx.attachments.dataDir,'attachments',conversationId,first.attachmentId,'source'),'bad');
 await assert.rejects(ctx.resolve({url}),{code:'ATTACHMENT_UNAVAILABLE'});
});
test('URL grammar rejects network, normalization, traversal and unsupported forms without fetch',async t=>{
 const ctx=await setup(t);let calls=0;const original=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error('network forbidden');};t.after(()=>{globalThis.fetch=original;});
 const invalid=['https://example.com/a','//example.com/a',baseUrl.replace('http:','https:')+prefix+'/preview/x', 'http://user@127.0.0.1:3210'+prefix+'/preview/x',prefix+'/preview/a?x=1',prefix+'/preview/a#x',prefix+'/preview/../a',prefix+'/preview/%2e%2e/a',prefix+'/preview/a%2F..%2Fa',prefix+'/preview/.secret',prefix+'/preview/%252e%252e%252fa',prefix+'/preview/a\\b',prefix+'/preview/%00x',prefix+'/preview/%zz',prefix+'/preview/',prefix+'/attachments/x/download/',prefix+'/preview/a\n',prefix+'/preview/a?',prefix+'/preview/a#'];
 for(const url of invalid)await assert.rejects(ctx.resolve({url}),undefined,url);assert.equal(calls,0);assert.equal(ctx.store.get(owner,conversationId).attachments?.length??0,0);
});
test('unsafe files and quotas fail before ready import; cancellation never imports',async t=>{
 const ctx=await setup(t,{fileBytes:8,conversationBytes:10,ownerBytes:10});const outside=path.join(ctx.attachments.dataDir,'outside');await fs.writeFile(outside,'secret');
 await fs.symlink(outside,path.join(ctx.workspaceRoot,'linked'));await fs.link(outside,path.join(ctx.workspaceRoot,'hardlinked'));await fs.mkdir(path.join(ctx.workspaceRoot,'directory'));
 for(const name of ['linked','hardlinked','directory'])await assert.rejects(ctx.resolve({url:prefix+'/preview/'+name}));
 await fs.writeFile(path.join(ctx.workspaceRoot,'large'),'123456789');await assert.rejects(ctx.resolve({url:prefix+'/preview/large'}),{code:'ATTACHMENT_LIMIT'});
 await fs.writeFile(path.join(ctx.workspaceRoot,'small'),'123456');await ctx.resolve({url:prefix+'/preview/small'});
 await assert.rejects(ctx.resolve({url:prefix+'/preview/small',requestId:'second'}),{code:'ATTACHMENT_QUOTA_EXCEEDED'});
 const controller=new AbortController();controller.abort();await assert.rejects(ctx.resolve({url:prefix+'/preview/small',requestId:'cancelled',signal:controller.signal}),{name:'AbortError'});
 assert.equal(ctx.store.get(owner,conversationId).attachments.length,1);
});
test('ancestor replacement between path validation and open cannot read outside workspace',async t=>{
 const ctx=await setup(t),directory=path.join(ctx.workspaceRoot,'reports'),outside=path.join(ctx.attachments.dataDir,'outside-dir');
 await fs.mkdir(directory);await fs.mkdir(outside);await fs.writeFile(path.join(directory,'result.txt'),'owned');await fs.writeFile(path.join(outside,'result.txt'),'external secret');
 const originalOpen=fs.open,canonicalFile=await fs.realpath(path.join(directory,'result.txt'));let reads=0,swapped=false;
 fs.open=async function(filename,...args){
  if(filename===canonicalFile&&!swapped){swapped=true;await fs.rename(directory,directory+'-saved');await fs.symlink(outside,directory);const handle=await originalOpen.call(this,filename,...args),read=handle.read.bind(handle);handle.read=(...values)=>{reads++;return read(...values);};return handle;}
  return originalOpen.call(this,filename,...args);
 };
 try{await assert.rejects(ctx.resolve({url:prefix+'/preview/reports%2Fresult.txt'}),{code:'ATTACHMENT_UNAVAILABLE'});assert.equal(swapped,true);assert.equal(reads,0);assert.equal(ctx.store.get(owner,conversationId).attachments?.length??0,0);}
 finally{fs.open=originalOpen;}
});
test('root swap during canonicalization cannot import or read external bytes',async t=>{
 const ctx=await setup(t),outside=path.join(ctx.attachments.dataDir,'root-external');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'result.txt'),'EXTERNAL SECRET');await fs.writeFile(path.join(ctx.workspaceRoot,'result.txt'),'owned');
 const realpath=fs.realpath,open=fs.open;let swapped=false,reads=0;
 fs.realpath=async function(filename,...args){
  if(filename===ctx.workspaceRoot&&!swapped){swapped=true;await fs.rename(ctx.workspaceRoot,ctx.workspaceRoot+'-saved');await fs.symlink(outside,ctx.workspaceRoot);}
  return realpath.call(this,filename,...args);
 };
 fs.open=async function(...args){const handle=await open.apply(this,args),read=handle.read.bind(handle);handle.read=(...values)=>{reads++;return read(...values);};return handle;};
 try{await assert.rejects(ctx.resolve({url:prefix+'/preview/result.txt'}),{code:'ATTACHMENT_UNAVAILABLE'});assert.equal(swapped,true);assert.equal(reads,0);assert.equal(ctx.store.get(owner,conversationId).attachments?.length??0,0);}
 finally{fs.realpath=realpath;fs.open=open;}
});

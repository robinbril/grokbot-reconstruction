import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {harnessError,identifier} from './store.mjs';
import {resolveWorkspacePath,workspacePathParts} from './workspace-tools.mjs';

const invalid=()=>harnessError('INVALID_ATTACHMENT','Attachment URL must reference an owned file in this conversation',400);
const unsafe=()=>harnessError('ATTACHMENT_UNAVAILABLE','Attachment source is missing, changed, or unsafe',409);
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const types={'.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json','.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.zip':'application/zip'};
function reference(value,baseUrl,conversationId){
 if(!identifier(conversationId)||typeof value!=='string'||!value||value.length>4096||/[\s\\?#]/.test(value)||/%(?:2e|25|5c|00)/i.test(value))throw invalid();
 let base,url;
 try{base=new URL(baseUrl);url=new URL(value,base);}catch{throw invalid();}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||url.origin!==base.origin||url.username||url.password||url.search||url.hash)throw invalid();
 // Compare raw route before URL normalization can erase parent or dot segments.
 const raw=value.startsWith('/')?value:value.match(/^https?:\/\/[^/]+(\/.*)$/)?.[1];
 if(!raw||raw.startsWith('//')||raw!==url.pathname)throw invalid();
 const prefix='/api/harness/conversations/'+conversationId+'/';
 if(!raw.startsWith(prefix))throw invalid();const route=raw.slice(prefix.length);
 const download=/^attachments\/([A-Za-z0-9_-]+)\/download$/.exec(route);
 if(download&&identifier(download[1]))return {attachmentId:download[1]};
 if(!route.startsWith('preview/'))throw invalid();
 let relative;try{relative=decodeURIComponent(route.slice(8));if(!relative||!workspacePathParts(relative).length)throw invalid();}catch{throw invalid();}
 return {relative};
}
async function boundary(root,parts){
 const entries=[];let target=root;
 for(const part of ['',...parts.slice(0,-1)]){
  if(part)target=path.join(target,part);
  const info=await fs.lstat(target);
  if(!info.isDirectory()||info.isSymbolicLink()||await fs.realpath(target)!==target)throw unsafe();
  entries.push({target,info});
 }
 return entries;
}
async function suppliedBoundary(workspaceRoot){
 const absolute=path.resolve(workspaceRoot),entries=[];let target=path.parse(absolute).root;
 for(const part of absolute.slice(target.length).split(path.sep)){
  target=path.join(target,part);const info=await fs.lstat(target),real=await fs.realpath(target);
  if(!info.isDirectory()&&!info.isSymbolicLink())throw unsafe();
  entries.push({target,info,real});
 }
 return entries;
}
async function unchanged(entries){
 for(const {target,info,real} of entries){const current=await fs.lstat(target);if(current.isDirectory()!==info.isDirectory()||current.isSymbolicLink()!==info.isSymbolicLink()||!same(current,info)||await fs.realpath(target)!==(real??target))throw unsafe();}
}
async function workspaceBytes(workspaceRoot,relative,limit,signal){
 let handle;
 try{
  signal?.throwIfAborted();const supplied=await fs.lstat(workspaceRoot);if(!supplied.isDirectory()||supplied.isSymbolicLink())throw unsafe();
  const originalEntries=await suppliedBoundary(workspaceRoot),root=await fs.realpath(workspaceRoot),canonical=await fs.lstat(root);
  if(!same(supplied,canonical)||!canonical.isDirectory()||canonical.isSymbolicLink())throw unsafe();
  const parts=workspacePathParts(relative),entries=[...originalEntries,...await boundary(root,parts)];await unchanged(entries);
  const filename=await resolveWorkspacePath(root,relative),expected=await fs.lstat(filename);
  if(!expected.isFile()||expected.isSymbolicLink()||expected.nlink!==1)throw unsafe();
  if(expected.size>limit)throw harnessError('ATTACHMENT_LIMIT','Attachment exceeds the per-file byte limit',413);
  handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await handle.stat();
  if(!same(before,expected)||!before.isFile()||before.nlink!==1||before.size!==expected.size)throw unsafe();
  await unchanged(entries);signal?.throwIfAborted();
  const buffer=Buffer.alloc(before.size+1);let length=0;
  while(length<buffer.length){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;}
  const after=await handle.stat(),current=await fs.lstat(filename);await unchanged(entries);signal?.throwIfAborted();
  if(!same(before,after)||!same(before,current)||current.isSymbolicLink()||after.nlink!==1||current.nlink!==1||length!==before.size||after.size!==before.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw unsafe();
  return buffer.subarray(0,length);
 }catch(error){if(error.name==='AbortError'||error.code==='ATTACHMENT_LIMIT'||error.code==='ATTACHMENT_UNAVAILABLE')throw error;throw unsafe();}
 finally{await handle?.close();}
}
export async function resolveMessageAttachment({attachments,owner,conversationId,workspaceRoot,baseUrl,url,alt,requestId,signal}){
 signal?.throwIfAborted();const source=reference(url,baseUrl,conversationId);
 if(alt!==undefined&&(typeof alt!=='string'||alt.length>4096||alt.includes('\0')))throw invalid();
 attachments.store.get(owner,conversationId);let metadata;
 if(source.attachmentId){
  const {bytes,...record}=await attachments.download(owner,conversationId,source.attachmentId);
  await attachments.validateReady(owner,conversationId,[{attachmentId:record.attachmentId,size:record.size,sha256:record.sha256}]);metadata=record;
 }else{
  const bytes=await workspaceBytes(workspaceRoot,source.relative,attachments.limits.fileBytes,signal),name=path.basename(source.relative);
  signal?.throwIfAborted();metadata=await attachments.importBytes(owner,conversationId,{requestId,name,type:types[path.extname(name).toLowerCase()]??'application/octet-stream',bytes,signal});
 }
 signal?.throwIfAborted();return {...metadata,...(alt!==undefined?{alt}:{})};
}

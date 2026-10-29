import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,writeFile,lstat,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {harnessError} from './store.mjs';
const runFile=promisify(execFile),maximumBytes=5*1024*1024;
const invalid=()=>harnessError('ATTACHMENT_CONTENT_INVALID','The image could not be converted into bounded PNG model input; the message was not sent',422);
function verifyPng(bytes){
 if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.toString('ascii',12,16)!=='IHDR')throw invalid();
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width<1||height<1||width>10000||height>10000||width*height>25000000)throw invalid();
}
// Provider image compatibility is independent of the immutable original attachment.
export async function modelImageInput(file){
 if(file.mediaType!=='image/webp')return {mediaType:file.mediaType,bytes:file.bytes};
 let directory;
 try{
  directory=await mkdtemp(path.join(tmpdir(),'grok-model-image-'));await chmod(directory,0o700);
  const input=path.join(directory,'input.webp'),output=path.join(directory,'model.png');
  await writeFile(input,file.bytes,{flag:'wx',mode:0o600});
  await runFile('/usr/bin/sips',['-s','format','png',input,'--out',output],{timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:directory}});
  const stat=await lstat(output);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>maximumBytes)throw invalid();
  const bytes=await readFile(output);if(bytes.length!==stat.size||bytes.length>maximumBytes)throw invalid();verifyPng(bytes);
  return {mediaType:'image/png',bytes};
 }catch{throw invalid();}
 finally{if(directory)await rm(directory,{recursive:true,force:true});}
}

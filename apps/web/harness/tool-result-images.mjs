import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,writeFile,lstat,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bounded,harnessError} from './store.mjs';

const runFile=promisify(execFile);
const maximumBytes=5*1024*1024,maximumCallBytes=20*1024*1024,maximumCount=10;
const mediaTypes=new Set(['image/png','image/jpeg','image/webp']);
const invalid=()=>harnessError('TOOL_IMAGE_INVALID','Tool image bytes are invalid or exceed supported bounds. The tool effect already occurred; it was not repeated.',422,false);
const imageEntries=result=>Array.isArray(result?.content)?result.content.filter(item=>item?.type==='image'):[];
function encodedBytes(data){
 if(typeof data!=='string'||data.length===0||data.length>4*Math.ceil(maximumBytes/3)||data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw invalid();
 const bytes=Buffer.from(data,'base64');
 if(bytes.length>maximumBytes||bytes.toString('base64')!==data)throw invalid();
 return bytes;
}
function imageType(bytes){
 if(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR')return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
function dimensions(width,height){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>10000||height>10000||width*height>25000000)throw invalid();
}
function receiptImage(item){
 const mediaType=mediaTypes.has(item.mimeType)?item.mimeType:'unsupported';
 try{
  const bytes=encodedBytes(item.data),matching=imageType(bytes)===mediaType;
  return {type:'image',mediaType,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentAccess:matching?'pending-validation':'invalid'};
 }catch{return {type:'image',mediaType,contentAccess:'invalid'};}
}
// Receipts are safe to persist. They describe encoded originals and never assert
// successful visual access, which only the asynchronous decoder can establish.
function receiptPayloads(result){
 const pending=[{value:result}],payloads=new Set(),active=new WeakSet(),seen=new WeakSet();let hasImages=false;
 while(pending.length){
  const {value,exit}=pending.pop();if(!value||typeof value!=='object')continue;
  if(exit){active.delete(value);continue;}
  if(active.has(value))throw new TypeError('Converting circular structure to JSON');
  if(seen.has(value))continue;
  seen.add(value);active.add(value);pending.push({value,exit:true});
  if(value.type==='image'){hasImages=true;if(typeof value.data==='string'&&value.data.length)payloads.add(value.data);if(payloads.size>maximumCount)return {overflow:true};}
  for(const child of Object.values(value))pending.push({value:child});
 }
 return {payloads:[...payloads].sort((left,right)=>right.length-left.length),hasImages};
}
function scrubPayloads(value,payloads){
 for(const payload of payloads)value=value.replaceAll(payload,'[tool image payload omitted]');
 return value;
}
function scrubReceipt(result,payloads){
 const root={value:null},pending=[{value:result,target:root,key:'value'}],copies=new WeakMap();
 while(pending.length){
  const {value,target,key}=pending.pop();
  if(typeof value==='string'){
   target[key]=scrubPayloads(value,payloads);continue;
  }
  if(!value||typeof value!=='object'){target[key]=value;continue;}
  if(copies.has(value)){target[key]=copies.get(value);continue;}
  if(value.type==='image'){target[key]=receiptImage(value);copies.set(value,target[key]);continue;}
  const copy=Array.isArray(value)?[]:Object.create(null);target[key]=copy;copies.set(value,copy);
  for(const [childKey,child] of Object.entries(value))pending.push({value:child,target:copy,key:scrubPayloads(childKey,payloads)});
 }
 return root.value;
}
export function toolResultReceipt(result){
 const {payloads,hasImages,overflow}=receiptPayloads(result);
 if(overflow)return bounded({isError:result?.isError===true,contentAccess:'withheld',reason:'Tool result body withheld: image payload count exceeds the supported receipt limit',sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex')});
 return bounded(hasImages?scrubReceipt(result,payloads):result);
}
function validatedImages(result,frame){
 const entries=imageEntries(result);
 if(entries.length+(frame?1:0)>maximumCount)throw invalid();
 const images=entries.map(item=>({bytes:encodedBytes(item.data),mediaType:item.mimeType}));
 if(frame){if(!(frame.bytes instanceof Uint8Array)||frame.bytes.length>maximumBytes)throw invalid();images.push({bytes:Buffer.from(frame.bytes),mediaType:frame.contentType});}
 if(images.reduce((sum,image)=>sum+image.bytes.length,0)>maximumCallBytes)throw invalid();
 for(const image of images){
  if(!mediaTypes.has(image.mediaType)||imageType(image.bytes)!==image.mediaType)throw invalid();
  if(image.mediaType==='image/png')dimensions(image.bytes.readUInt32BE(16),image.bytes.readUInt32BE(20));
 }
 return images;
}
async function decodeImage(image,signal){
 let directory;
 try{
  signal?.throwIfAborted();
  directory=await mkdtemp(path.join(tmpdir(),'grok-tool-image-'));await chmod(directory,0o700);
  const input=path.join(directory,'source'),output=path.join(directory,'model.png');
  await writeFile(input,image.bytes,{flag:'wx',mode:0o600});signal?.throwIfAborted();
  const options={signal,timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:directory}};
  const query=await runFile('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',input],options);signal?.throwIfAborted();
  dimensions(Number(/pixelWidth:\s*(\d+)/.exec(query.stdout)?.[1]),Number(/pixelHeight:\s*(\d+)/.exec(query.stdout)?.[1]));
  // A header query alone is insufficient: a bounded actual conversion is required.
  await runFile('/usr/bin/sips',['-s','format','png',input,'--out',output],options);signal?.throwIfAborted();
  const stat=await lstat(output);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<33||stat.size>maximumBytes)throw invalid();
  await chmod(output,0o600);const bytes=await readFile(output);signal?.throwIfAborted();
  if(bytes.length!==stat.size||bytes.length>maximumBytes||imageType(bytes)!=='image/png')throw invalid();
  dimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20));return bytes;
 }catch{signal?.throwIfAborted();throw invalid();}
 finally{if(directory)await rm(directory,{recursive:true,force:true});}
}
// Only explicit MCP image content or an already owner-verified in-memory frame
// can cross this boundary. No URLs, workspace paths, or commands are accepted.
export async function toolResultImageParts(result,{signal,frame}={}){
 signal?.throwIfAborted();const images=validatedImages(result,frame),parts=[];let bytes=0;
 for(const image of images){
  signal?.throwIfAborted();const decoded=await decodeImage(image,signal);signal?.throwIfAborted();
  const supplied=image.mediaType==='image/webp'?{bytes:decoded,mediaType:'image/png'}:image;bytes+=supplied.bytes.length;
  if(bytes>maximumCallBytes)throw invalid();
  parts.push({type:'image_url',image_url:{url:'data:'+supplied.mediaType+';base64,'+supplied.bytes.toString('base64')}});
 }
 signal?.throwIfAborted();return {parts,bytes};
}

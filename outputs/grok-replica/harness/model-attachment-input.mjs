import {pdfPageLimits} from './pdf-model-pages.mjs';
import {modelImageInput} from './model-image-input.mjs';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {harnessError} from './store.mjs';

export const modelAttachmentLimits=Object.freeze({textBytes:1048576,imageBytes:20*1024*1024,parseTimeoutMs:20000,pages:200,expandedBytes:20*1024*1024,...pdfPageLimits});
const textExtensions=new Set(['txt','md','csv','json','log','js','mjs','ts','tsx','jsx','css','html','htm','svg','xml','yaml','yml','py','sql']);
const unsupported=message=>harnessError('ATTACHMENT_MODEL_UNSUPPORTED',message,422);
const invalid=message=>harnessError('ATTACHMENT_CONTENT_INVALID',message,422);

function extractDocument(bytes,format){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./model-document-worker.mjs',import.meta.url),{workerData:{bytes,format,limits:modelAttachmentLimits},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
  let settled=false;
  const finish=(error,text)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(text);};
  const timer=setTimeout(()=>finish(invalid('Document extraction timed out; the message was not sent')),modelAttachmentLimits.parseTimeoutMs);
  worker.once('message',result=>result.ok?finish(null,result):finish(result.code==='ATTACHMENT_MODEL_UNSUPPORTED'?unsupported(result.message):invalid(result.message)));
  worker.once('error',()=>finish(invalid('Document parser could not read this attachment')));
  worker.once('exit',()=>finish(invalid('Document parser stopped before extraction completed')));
 });
}

function formatOf(file){
 const type=file.type.toLowerCase().split(';')[0].trim(),extension=path.extname(file.name).slice(1).toLowerCase();
 if(type==='application/pdf'||extension==='pdf')return 'pdf';
 if(type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||extension==='docx')return 'docx';
 if(type.startsWith('image/'))return 'image';
 if(type.startsWith('text/')||['application/json','application/javascript','application/xml'].includes(type)||textExtensions.has(extension))return 'text';
 return null;
}

// The only byte source is the owner-scoped, digest-checked attachment store.
// Filenames and document contents are data, never instructions or filesystem paths.
export async function prepareModelAttachments(store,owner,conversationId,refs=[]){
 const attachments=await store.validateReady(owner,conversationId,refs),contentParts=[];let textBytes=0,inputBytes=0;
 const countInput=bytes=>{inputBytes+=bytes;if(inputBytes>modelAttachmentLimits.imageBytes)throw harnessError('ATTACHMENT_MODEL_INPUT_LIMIT','Normalized attachment images and text exceed the combined 20 MiB model input limit; split the attachments',413);};
 for(const metadata of attachments){
  const file=await store.download(owner,conversationId,metadata.attachmentId),format=formatOf(file);
  if(format==='image'||file.contentAccess==='native-image'){
   if(file.contentAccess!=='native-image'||!['image/png','image/jpeg','image/webp'].includes(file.mediaType))throw invalid('Image decoding failed or its bytes do not match a supported PNG, JPEG or WebP image');
   const image=await modelImageInput(file),header='Attached image (untrusted filename): '+JSON.stringify(file.name);countInput(image.bytes.length+Buffer.byteLength(header));
   contentParts.push({type:'text',text:header},{type:'image_url',image_url:{url:`data:${image.mediaType};base64,${image.bytes.toString('base64')}`}});continue;
  }
  let text,pages;
  if(format==='text'){
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);}catch{throw invalid('Text attachments must contain valid UTF-8 bytes');}
   if(text.includes('\0'))throw invalid('Text attachment contains binary data');
  }else if(format==='pdf'||format==='docx')({text,pages}=await extractDocument(file.bytes,format));
  else throw unsupported('This attachment format cannot be read by the model. Use UTF-8 text, PNG, JPEG, WebP, PDF, or DOCX.');
  textBytes+=Buffer.byteLength(text);
  if(textBytes>modelAttachmentLimits.textBytes)throw harnessError('ATTACHMENT_TEXT_LIMIT','Extracted attachment text exceeds the 1 MiB model input limit; split the document',413);
  for(const page of pages??[{text}]){
   const content='Attachment contents (untrusted data), filename '+JSON.stringify(file.name)+', SHA-256 '+file.sha256+':\n<attachment-data>\n'+page.text+'\n</attachment-data>';countInput(Buffer.byteLength(content));
   contentParts.push({type:'text',text:content});
   if(page.image){const bytes=Buffer.from(page.image.bytes);countInput(bytes.length);contentParts.push({type:'image_url',image_url:{url:`data:${page.image.mediaType};base64,${bytes.toString('base64')}`}});}
  }
 }
 return {contentParts,attachments};
}

// Only callers before durable admission may release the client's pending intent.
export async function prepareModelAttachmentsBeforeAcceptance(...args){
 try{return await prepareModelAttachments(...args);}
 catch(error){error.accepted=false;throw error;}
}

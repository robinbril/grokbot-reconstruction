import {parentPort,workerData} from 'node:worker_threads';
import {extractPdfModelPages} from './pdf-model-pages.mjs';

const {format,limits}=workerData,bytes=Buffer.from(workerData.bytes);
const failure=(message,code='ATTACHMENT_CONTENT_INVALID')=>Object.assign(new Error(message),{code});
function checkText(text){if(Buffer.byteLength(text)>limits.textBytes)throw failure('Document text exceeds the 1 MiB extraction limit');return text;}

async function checkZip(){
 const {default:yauzl}=await import('yauzl');
 await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
  if(error){reject(failure('DOCX is not a valid ZIP document'));return;}
  let count=0,total=0,main=false,settled=false;
  const stop=error=>{if(settled)return;settled=true;zip.close();error?reject(error):resolve();};
  zip.on('error',()=>stop(failure('DOCX archive is corrupt')));
  zip.on('end',()=>stop(main?null:failure('DOCX has no Word document content')));
  zip.on('entry',entry=>{
   if(++count>2000||entry.uncompressedSize>limits.expandedBytes||(entry.generalPurposeBitFlag&1))return stop(failure('DOCX archive exceeds safe limits or is encrypted'));
   if(entry.fileName==='word/document.xml')main=true;
   if(entry.fileName.endsWith('/')){zip.readEntry();return;}
   zip.openReadStream(entry,(error,stream)=>{
    if(error)return stop(failure('DOCX archive could not be expanded'));
    stream.on('data',chunk=>{total+=chunk.length;if(total>limits.expandedBytes){stream.destroy();stop(failure('DOCX expanded content exceeds 20 MiB'));}});
    stream.on('error',()=>stop(failure('DOCX archive is corrupt')));
    stream.on('end',()=>{if(!settled)zip.readEntry();});
   });
  });zip.readEntry();
 }));
}

async function docx(){
 await checkZip();const {default:mammoth}=await import('mammoth');
 const result=await mammoth.extractRawText({buffer:bytes},{externalFileAccess:false});
 return checkText(result.value);
}

try{parentPort.postMessage({ok:true,...(format==='pdf'?await extractPdfModelPages(bytes,limits):{text:await docx()})});}
catch(error){const expected=['ATTACHMENT_CONTENT_INVALID','ATTACHMENT_MODEL_UNSUPPORTED'].includes(error.code);parentPort.postMessage({ok:false,code:expected?error.code:'ATTACHMENT_CONTENT_INVALID',message:expected?error.message:'Document is corrupt, encrypted, or cannot be extracted'});}

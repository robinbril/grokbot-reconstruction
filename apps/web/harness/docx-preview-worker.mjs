import {parentPort,workerData} from 'node:worker_threads';
const bytes=Buffer.from(workerData.bytes),limits={expandedBytes:20*1024*1024};
const failure=message=>new Error(message);
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

try{
 await checkZip();const {default:mammoth}=await import('mammoth');
 const result=await mammoth.convertToHtml({buffer:bytes},{externalFileAccess:false});
 if(Buffer.byteLength(result.value)>1048576)throw failure('DOCX preview exceeds 1 MiB');
 parentPort.postMessage({ok:true,html:result.value});
}catch{parentPort.postMessage({ok:false});}

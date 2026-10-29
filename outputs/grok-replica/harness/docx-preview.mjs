import {Worker} from 'node:worker_threads';
import {harnessError} from './store.mjs';
const invalid=()=>harnessError('ATTACHMENT_PREVIEW_INVALID','DOCX preview is corrupt, unsupported, or exceeds safe limits',422);
export async function previewDocx(bytes,{signal}={}){
 signal?.throwIfAborted();
 if(!(bytes instanceof Uint8Array)||bytes.length>5*1024*1024||bytes.length<4||Buffer.from(bytes.subarray(0,4)).toString('hex')!=='504b0304')throw invalid();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./docx-preview-worker.mjs',import.meta.url),{workerData:{bytes},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
  let settled=false;
  const finish=(error,html)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(html);};
  const abort=()=>finish(signal.reason??new DOMException('Aborted','AbortError'));
  const timer=setTimeout(()=>finish(invalid()),20000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  worker.once('message',result=>result.ok?finish(null,result.html):finish(invalid()));
  worker.once('error',()=>finish(invalid()));worker.once('exit',()=>finish(invalid()));
 });
}

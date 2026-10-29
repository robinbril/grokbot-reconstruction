import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function startHarness({dataDir,model={status:()=>({state:'unavailable',reason:'Synthetic test: model unconfigured'})},runtimeFactory}={}){
 const owned=!dataDir;dataDir??=await mkdtemp(path.join(tmpdir(),'harness-http-'));
 let handler;const server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(handled=>{if(!handled&&!res.writableEnded)res.writeHead(404).end();}).catch(error=>{res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:error.message}}));}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl='http://127.0.0.1:'+server.address().port;
 try{const {createHarnessHandler}=await import('../../harness/http.mjs');handler=await createHarnessHandler({root,dataDir,baseUrl,model,...(runtimeFactory?{runtimeFactory}:{})});}catch(error){await new Promise(r=>server.close(r));if(owned)await rm(dataDir,{recursive:true,force:true});throw error;}
 async function client(existing={}){
  let cookie=existing.cookie||'',csrf=existing.csrf||'';
  async function request(route,{method='GET',body,headers={},raw=false,signal}={}){
   const res=await fetch(baseUrl+'/api/harness'+route,{method,signal,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json',Origin:baseUrl,'x-harness-csrf':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const set=res.headers.get('set-cookie');if(set)cookie=set.split(';',1)[0];if(raw)return res;let value;try{value=await res.json();}catch{value=null;}if(value?.csrfToken)csrf=value.csrfToken;return {status:res.status,value};
  }
  const status=await request('/status');assert.equal(status.status,200,JSON.stringify(status.value));
  return {request,get cookie(){return cookie;},get csrf(){return csrf;},status:status.value};
 }
 let closed=false;
 return {baseUrl,dataDir,handler,client,async close({keepData=false}={}){if(closed)return;closed=true;await handler.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(owned&&!keepData)await rm(dataDir,{recursive:true,force:true});}};
}
async function collectEvents(client,route,predicate,{after=0,timeout=10000}={}){
 const controller=new AbortController(),decoder=new TextDecoder(),events=[];let reader,buffer='';
 const timer=setTimeout(()=>controller.abort(new Error('Test event deadline exceeded')),timeout);
 try{
  const response=await client.request(route+'?after='+after,{raw:true,signal:controller.signal});assert.equal(response.status,200);
  reader=response.body.getReader();
  for(;;){
   const {value,done}=await reader.read();if(done)throw new Error('Event stream ended before expected event');
   buffer+=decoder.decode(value,{stream:true});let index;
   while((index=buffer.indexOf('\n\n'))>=0){
    const part=buffer.slice(0,index);buffer=buffer.slice(index+2);
    const data=part.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
    if(!data)continue;
    const event=JSON.parse(data);events.push(event);if(predicate(event,events))return events;
   }
  }
 }catch(error){
  if(controller.signal.aborted)throw new Error('Test event deadline exceeded; received types: '+events.map(event=>event.type).slice(-20).join(', '),{cause:error});
  throw error;
 }finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
}
export function collectUntil(client,runId,predicate,options){
 return collectEvents(client,'/runs/'+runId+'/events',predicate,options);
}
export async function collectQueueUntil(client,conversationId,queueId,options){
 let completed;
 await collectEvents(client,'/conversations/'+conversationId+'/events',event=>{
  if(event.type!=='queue.changed')return false;
  const row=event.data.queue.find(item=>item.id===queueId);if(!row)return false;
  if(['failed','cancelled','interrupted','blocked'].includes(row.status))throw new Error('Queued execution '+row.status+': '+JSON.stringify(row.error??{}));
  if(row.status!=='completed')return false;
  completed=row;return true;
 },options);
 return completed;
}

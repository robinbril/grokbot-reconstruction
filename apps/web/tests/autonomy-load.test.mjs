// Real HTTP, runtime, durable writes and timers. Inference and tool selection are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,appendFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHarnessHandler} from '../harness/http.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const schema={type:'object',properties:{key:{type:'string'},step:{type:'integer'},delay:{type:'integer'},mode:{type:'string'}},required:['key','step','delay','mode'],additionalProperties:false};
const body=(key,{steps=3,delay=20,mode='normal'}={})=>({requestId:key,text:JSON.stringify({key,steps,delay,mode})});
const terminal=new Set(['completed','failed','cancelled','interrupted']);
function fixture(dataDir){
 const control={offline:false,failConnection:false,failModel:true,effects:[],active:0,peak:0};
 const model={status:()=>({state:control.offline?'unavailable':'ready',provider:'synthetic-load-selection'}),async complete({messages}){
  const index=messages.findLastIndex(message=>message.role==='user'),spec=JSON.parse(messages[index].content);
  if(spec.mode==='model-failure'&&control.failModel){control.failModel=false;throw Error('Injected provider unavailable before effect');}
  const completed=messages.slice(index+1).filter(message=>message.role==='tool').length;
  if(completed>=spec.steps)return {toolCalls:[{id:spec.key+'-reply',name:'SendMessage',arguments:{text:{content:'Confirmed '+spec.key}}}]};
  return {toolCalls:[{id:spec.key+'-'+completed,name:spec.mode==='denial'?'GuardedWrite':'AppendReceipt',arguments:{key:spec.key,step:completed,delay:spec.delay,mode:spec.mode}}]};
 }};
 const toolHostFactory=async()=>{
  if(control.failConnection){control.failConnection=false;throw Object.assign(Error('Injected tool host unavailable'),{code:'TOOL_HOST_UNAVAILABLE',status:503});}
  return {getDefinitions:()=>['AppendReceipt','GuardedWrite'].map(name=>({name,inputSchema:schema,requiresApproval:name==='GuardedWrite'})),async call(name,args,{signal}){
   control.active++;control.peak=Math.max(control.peak,control.active);
   try{
    await appendFile(path.join(dataDir,'actual-effects.ndjson'),JSON.stringify({name,...args})+'\n');control.effects.push({name,...args});
    if(args.mode==='uncertain')await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    else await delay(args.delay,undefined,{signal});
    return {executed:true,key:args.key,step:args.step};
   }finally{control.active--;}
  },close:async()=>{}};
 };
 return {control,model,toolHostFactory};
}
async function boot(t,{dataDir,auth,source}={}){
 dataDir??=await mkdtemp(path.join(tmpdir(),'autonomy-load-'));source??=fixture(dataDir);let handler,closed=false;
 const server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(done=>{if(!done)res.writeHead(404).end();}).catch(()=>res.writeHead(500).end()));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl='http://127.0.0.1:'+server.address().port;
 handler=await createHarnessHandler({root,dataDir,baseUrl,model:source.model,toolHostFactory:source.toolHostFactory,workflowAutoStart:false});
 let cookie=auth?.cookie??'',csrf=auth?.csrf??'';
 const request=async(route,{method='GET',body}={})=>{
  const res=await fetch(baseUrl+'/api/harness'+route,{method,headers:{cookie,...(method==='GET'?{}:{Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  const value=await res.json();if(value.csrfToken)csrf=value.csrfToken;return {status:res.status,value};
 };
 assert.equal((await request('/status')).status,200);
 const writeDurations=[],write=handler.store.write.bind(handler.store);
 handler.store.write=async(...args)=>{const start=performance.now();try{return await write(...args);}finally{writeDurations.push(performance.now()-start);}};
 const app={handler,dataDir,source,request,writeDurations,get auth(){return {cookie,csrf};},async close(keep=false){if(closed)return;closed=true;await handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!keep)await rm(dataDir,{recursive:true,force:true});}};
 t.after(()=>app.close());return app;
}
const post=(app,id,route,payload)=>app.request('/conversations/'+id+'/'+route,{method:'POST',body:payload});
const state=async(app,id)=>(await app.request('/conversations/'+id)).value;
async function until(app,id,predicate,label,timeout=30000){
 const deadline=Date.now()+timeout;let snapshot;
 do{snapshot=await state(app,id);if(predicate(snapshot))return snapshot;await delay(20);}while(Date.now()<deadline);
 assert.fail(label+' '+JSON.stringify({queue:snapshot?.queue?.map(row=>({id:row.id,status:row.status})),runs:snapshot?.runs?.map(run=>run.status),tools:snapshot?.tools?.length}));
}
async function enqueue(app,id,payload){
 const result=await post(app,id,'queue',payload);assert.equal(result.status,202,JSON.stringify(result));return result.value;
}
async function effects(app){
 try{return (await readFile(path.join(app.dataDir,'actual-effects.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){if(error.code==='ENOENT')return [];throw error;}
}

test('four active conversations drain concurrent HTTP queue admissions exactly once in durable FIFO order',async t=>{
 const app=await boot(t),started=Date.now(),conversations=Array.from({length:4},(_,i)=>'load-'+i);
 await Promise.all(conversations.map(async id=>{
  const receipts=await Promise.all(Array.from({length:10},async(_,i)=>{
   const payload=body(id+'-'+i,{steps:3,delay:80}),[first,replay]=await Promise.all([enqueue(app,id,payload),enqueue(app,id,payload)]);
   assert.deepEqual(first,replay);return first;
  }));
  const snapshot=await until(app,id,s=>s.queue?.length===10&&s.queue.every(row=>terminal.has(row.status)),'queue drainage',180000);
  assert.ok(snapshot.queue.every(row=>row.status==='completed'));
  assert.equal(snapshot.runs.length,10);assert.equal(new Set(snapshot.runs.map(run=>run.requestId)).size,10);
  assert.deepEqual(snapshot.entries.filter(entry=>entry.role==='user').map(entry=>JSON.parse(entry.text).key),snapshot.queue.map(row=>row.payload.text).map(text=>JSON.parse(text).key));
  assert.deepEqual(new Set(snapshot.queue.map(row=>row.id)),new Set(receipts.map(receipt=>receipt.queueId)));
  const disk=JSON.parse(await readFile(path.join(app.dataDir,'conversation-'+id+'.json'),'utf8'));
  assert.equal(disk.runs.filter(run=>run.status==='completed').length,10);
 }));
 const actual=await effects(app);assert.equal(actual.length,120);assert.equal(new Set(actual.map(row=>row.key+':'+row.step)).size,120);
 assert.ok(app.source.control.peak>=2);assert.equal(app.source.control.active,0);
 const elapsedMs=Date.now()-started,writes=[...app.writeDurations].sort((a,b)=>a-b);
 t.diagnostic(JSON.stringify({elapsedMs,runsPerSecond:40/(elapsedMs/1000),conversations:4,httpAdmissions:80,uniqueRuns:40,actualDiskEffects:120,peakToolConcurrency:app.source.control.peak,durableWriteCount:writes.length,durableWriteMs:{median:writes[Math.floor(writes.length/2)],p95:writes[Math.floor(writes.length*.95)],max:writes.at(-1)}}));
});

test('a real thirty-second autonomous tool loop remains observable and persists each confirmed step',async t=>{
 const app=await boot(t),started=Date.now(),id='wall-clock',payload=body('thirty-second-task',{steps:30,delay:1000});
 const receipt=await enqueue(app,id,payload);
 const running=await until(app,id,s=>s.tools?.some(tool=>tool.status==='running'),'real tool start');
 assert.equal(running.queue[0].id,receipt.queueId);assert.equal(running.runs.length,1);
 const snapshot=await until(app,id,s=>s.queue?.[0]?.status==='completed','long task complete',90000),elapsedMs=Date.now()-started;
 assert.ok(elapsedMs>=30000);assert.equal(snapshot.tools.filter(tool=>tool.name==='AppendReceipt'&&tool.status==='completed').length,30);
 assert.equal(snapshot.entries.at(-1).text,'Confirmed thirty-second-task');assert.equal((await effects(app)).length,30);
 const disk=JSON.parse(await readFile(path.join(app.dataDir,'conversation-'+id+'.json'),'utf8'));
 assert.equal(disk.runs[0].status,'completed');assert.equal(disk.tools.filter(tool=>tool.name==='AppendReceipt').length,30);assert.equal(disk.tools.filter(tool=>tool.name==='SendMessage').length,1);
 t.diagnostic(JSON.stringify({elapsedMs,confirmedSteps:30,model:'synthetic',tool:'actual local append and real one-second timer'}));
});

test('connection retry denial model failure and interruption preserve effects and queue boundaries',async t=>{
 const app=await boot(t);app.source.control.failConnection=true;
 const blocked=await enqueue(app,'retry',body('retry-once'));
 await until(app,'retry',s=>s.queue?.[0]?.status==='blocked','host failure blocked');assert.equal((await effects(app)).length,0);
 assert.equal((await post(app,'retry','queue/'+blocked.queueId+'/retry',{requestId:'retry-click'})).status,200);
 await until(app,'retry',s=>s.queue?.[0]?.status==='completed','retry completion');assert.equal((await effects(app)).length,3);
 await enqueue(app,'denial',body('denied-effect',{steps:1,mode:'denial'}));
 const pending=await until(app,'denial',s=>s.runs?.[0]?.status==='waiting_approval','pending approval'),run=pending.runs[0];
 assert.equal((await app.request('/runs/'+run.id+'/approvals/'+run.approvals[0].id+'/decision',{method:'POST',body:{requestId:'decline',decision:'reject'}})).status,200);
 const denied=await until(app,'denial',s=>s.queue?.[0]?.status==='completed','confirmed denial completion');
 assert.equal(JSON.parse(denied.tools[0].output).structuredContent.executed,false);assert.equal((await effects(app)).filter(row=>row.key==='denied-effect').length,0);
 await enqueue(app,'provider',body('failed-provider',{mode:'model-failure'}));await enqueue(app,'provider',body('after-failure',{steps:1}));
 const recovered=await until(app,'provider',s=>s.queue?.[1]?.status==='completed','provider failure advances');assert.deepEqual(recovered.queue.map(row=>row.status),['failed','completed']);
 await enqueue(app,'uncertain',body('uncertain-effect',{mode:'uncertain'}));
 await until(app,'uncertain',s=>s.tools?.some(tool=>tool.status==='running'),'effect in flight');
 await enqueue(app,'uncertain',body('after-review',{steps:1}));await app.handler.runtime.drop('uncertain');
 const held=await until(app,'uncertain',s=>s.workflow?.hold&&s.queue?.[0]?.status==='interrupted','uncertainty hold');
 assert.equal(held.queue[1].status,'queued');assert.equal((await effects(app)).filter(row=>row.key==='uncertain-effect').length,1);
 assert.equal((await post(app,'uncertain','queue/resume',{requestId:'reviewed'})).status,200);
 await until(app,'uncertain',s=>s.queue?.[1]?.status==='completed','explicit continuation');
 assert.equal((await effects(app)).filter(row=>row.key==='uncertain-effect').length,1);
});

test('offline accepted work survives a real handler restart and dispatches exactly once after reconnect',async t=>{
 const app=await boot(t);app.source.control.offline=true;
 const payloads=Array.from({length:8},(_,i)=>body('restart-'+i,{steps:1}));
 const receipts=await Promise.all(payloads.map(payload=>enqueue(app,'restart',payload)));
 await until(app,'restart',s=>s.queue?.[0]?.status==='blocked','offline head');
 assert.equal((await effects(app)).length,0);const auth=app.auth;
 await app.close(true);app.source.control.offline=false;
 const restored=await boot(t,{dataDir:app.dataDir,auth,source:app.source});
 for(const [index,payload]of payloads.entries())assert.deepEqual(await enqueue(restored,'restart',payload),receipts[index]);
 const before=await state(restored,'restart');
 if(before.queue[0].status==='blocked')await post(restored,'restart','queue/'+before.queue[0].id+'/retry',{requestId:'reconnect'});
 await until(restored,'restart',s=>s.queue?.length===8&&s.queue.every(row=>row.status==='completed'),'restored queue drainage');
 const actual=await effects(restored);assert.equal(actual.length,8);assert.equal(new Set(actual.map(row=>row.key)).size,8);
});

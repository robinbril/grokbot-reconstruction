import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

async function startProcess(t,dataDir,mode){
 const child=fork(new URL('./fixtures/restart-process.mjs',import.meta.url),[dataDir,mode],{stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=once(child,'exit');
 t.after(async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.send('close');
  const grace=AbortSignal.timeout(5000);
  try{await once(child,'exit',{signal:grace});}catch{child.kill('SIGKILL');await exited;}
 });
 const ready=await Promise.race([
  once(child,'message',{signal:AbortSignal.timeout(10000)}).then(([message])=>message),
  exited.then(()=>{throw Error('Synthetic server exited before ready: '+stderr);}),
 ]);
 assert.equal(ready.ready,true);
 return {child,exited,baseUrl:ready.baseUrl};
}
async function client(baseUrl,cookie=''){
 let csrf='';
 async function request(route,{method='GET',body}={}){
  const response=await fetch(baseUrl+'/api/harness'+route,{
   method,headers:{cookie,...(method==='POST'?{'Content-Type':'application/json',Origin:baseUrl,'x-harness-csrf':csrf}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000),
  });
  const issued=response.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];
  const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
  return {status:response.status,value};
 }
 assert.equal((await request('/status')).status,200);
 return {request,get cookie(){return cookie;}};
}
async function waitForState(client,predicate){
 for(let attempt=0;attempt<200;attempt++){
  const response=await client.request('/conversations/crash-proof');assert.equal(response.status,200);
  if(predicate(response.value))return response.value;
  await delay(10);
 }
 assert.fail('Expected synthetic state was not reached');
}

test('actual process crash preserves confirmed effects, interrupts uncertain tools and holds queued work until reviewed',{timeout:30000},async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-process-restart-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const before=await startProcess(t,dataDir,'before'),original=await client(before.baseUrl);
 const started=await original.request('/conversations/crash-proof/runs',{method:'POST',body:{requestId:'first',text:'Synthetic two-effect test'}});
 assert.equal(started.status,202);
 await waitForState(original,state=>state.tools.some(tool=>tool.callId==='uncertain-call'&&tool.status==='running'));
 const marker=path.join(dataDir,'synthetic-effects.txt');
 for(let attempt=0;attempt<200;attempt++){
  if((await readFile(marker,'utf8')).includes('UncertainEffect'))break;
  await delay(10);
 }
 const effects=await readFile(marker,'utf8');assert.equal(effects,'ConfirmedEffect\nUncertainEffect\n');
 const queued=await original.request('/conversations/crash-proof/queue',{method:'POST',body:{requestId:'followup',text:'Report prior confirmed and uncertain effects without repeating them'}});
 assert.equal(queued.status,202);
 // Crash only the child created above, after the actual effect and durable call journal.
 assert.equal(before.child.kill('SIGKILL'),true);await before.exited;
 const after=await startProcess(t,dataDir,'after'),restored=await client(after.baseUrl,original.cookie);
 const recovered=(await restored.request('/conversations/crash-proof')).value;
 assert.equal(recovered.runs[0].status,'interrupted');
 assert.equal(recovered.tools.find(tool=>tool.callId==='confirmed-call').status,'completed');
 const uncertain=recovered.tools.find(tool=>tool.callId==='uncertain-call');
 assert.equal(uncertain.status,'interrupted');assert.equal(uncertain.error.code,'SERVER_RESTART');
 assert.equal(uncertain.output,undefined);
 assert.equal(recovered.queue[0].status,'queued');assert.equal(recovered.workflow.hold.code,'EXECUTION_UNCERTAIN');
 assert.equal(recovered.runs.length,1);assert.equal(await readFile(marker,'utf8'),effects);
 const resumed=await restored.request('/conversations/crash-proof/queue/resume',{method:'POST',body:{requestId:'reviewed'}});
 assert.equal(resumed.status,200);
 const completed=await waitForState(restored,state=>state.queue[0].status==='completed');
 assert.equal(completed.runs.length,2);
 assert.ok(completed.entries.some(entry=>entry.text==='RECOVERED_UNCERTAIN_NO_REPLAY'));
 assert.equal(await readFile(marker,'utf8'),effects);
 assert.equal(completed.tools.filter(tool=>tool.callId==='uncertain-call').length,1);
});

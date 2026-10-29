// Opt-in real provider verification. No fixture inference, tool host, clock or executor.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHarnessHandler} from '../harness/http.mjs';
import {createModelProvider} from '../harness/model-provider.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const marker='AUTONOMY_60S_CONFIRMED';
const command='/bin/zsh -f -c \'for step in {1..12}; do /bin/sleep 5; printf "AUTONOMY_HEARTBEAT_%02d\\n" "$step"; done; printf "AUTONOMY_60S_CONFIRMED\\n"\'';
const expectedOperation={name:'Terminal',arguments:{command}};
const prompt=[
 'Run a bounded autonomous verification using exactly one Terminal host request, then exactly one SendMessage host request.',
 'Terminal arguments must be exactly this JSON object, with no extra properties: '+JSON.stringify({command}),
 'Do not call workspace, browser, MCP, scheduling or other tools. Do not change the command, shorten the sleeps, or simulate output.',
 'Wait for the confirmed Terminal result. Only then use SendMessage to report the confirmed stdout sentinel AUTONOMY_60S_CONFIRMED and actual exit code.',
 'If the tool fails, report the real failure with SendMessage; never claim success without its result.'
].join('\n');

async function start(){
 const dataDir=await mkdtemp(path.join(tmpdir(),'live-autonomy-'));let handler,closed=false;
 const server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(done=>{if(!done)res.writeHead(404).end();}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();}));
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl='http://127.0.0.1:'+server.address().port;
  const model=createModelProvider({env:{...process.env,GROK_MODEL_PROVIDER:'claude-seat',CLAUDE_MODEL:'claude-sonnet-5-5'}});
  handler=await createHarnessHandler({root,dataDir,baseUrl,model,maxChildren:1,workflowAutoStart:false});
  let cookie='',csrf='';
  const request=async(route,{method='GET',body}={})=>{
   const response=await fetch(baseUrl+'/api/harness'+route,{method,headers:{cookie,...(method==='GET'?{}:{Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
   assert.ok(response.ok,'HTTP '+response.status+' '+(value.error?.code??route));return value;
  };
  await request('/status');
  return {handler,request,async close(){if(closed)return;closed=true;try{await handler.close();}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}}};
 }catch(error){if(handler)await handler.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});throw error;}
}
async function decide(app,run,approval,approved){
 return app.request('/runs/'+run.id+'/approvals/'+approval.id+'/decision',{method:'POST',body:{requestId:'decision-'+approval.id,decision:approved?'approve':'reject'}});
}
function verify(snapshot,run,elapsedMs){
 assert.equal(run.status,'completed','Run did not complete: '+(run.error?.code??run.status));
 const tools=snapshot.tools.filter(tool=>tool.runId===run.id),terminals=tools.filter(tool=>tool.name==='Terminal');
 assert.equal(terminals.length,1,'Exactly one Terminal receipt required');
 assert.ok(tools.every(tool=>['Terminal','SendMessage'].includes(tool.name)),'Unexpected tool executed');
 assert.deepEqual(terminals[0].arguments,expectedOperation.arguments);assert.equal(terminals[0].status,'completed');
 const terminal=terminals[0],result=JSON.parse(terminal.output);
 assert.equal(result.exitCode,0);assert.equal(result.stderr,'');
 assert.equal(result.stdout,Array.from({length:12},(_,i)=>'AUTONOMY_HEARTBEAT_'+String(i+1).padStart(2,'0')).join('\n')+'\n'+marker+'\n');
 const terminalElapsedMs=Date.parse(terminal.finishedAt)-Date.parse(terminal.startedAt);
 assert.ok(terminalElapsedMs>=60000,'Terminal finished before its twelve real five-second sleeps');
 const entry=snapshot.entries.find(entry=>entry.id===run.outputEntryId);
 assert.equal(entry.status,'completed');assert.match(entry.text,/AUTONOMY_60S_CONFIRMED/);assert.match(entry.text,/\b0\b/);
 assert.equal(tools.filter(tool=>tool.name==='SendMessage').length,1);
 return {state:'verified',provider:'claude-seat',model:'claude-sonnet-5-5',elapsedMs,terminalElapsedMs,terminalReceipts:1,heartbeatLines:12,exitCode:result.exitCode,confirmedSentinel:marker,delivery:entry.delivery,runStatus:run.status};
}
async function run(){
 const app=await start(),conversation='live-autonomy',started=Date.now(),approved=new Set();let accepted;
 const stop=()=>{if(accepted)app.handler.runtime.cancel((app.handler.store.states.get(conversation)).owner,accepted.runId).catch(()=>{});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  accepted=await app.request('/conversations/'+conversation+'/runs',{method:'POST',body:{requestId:'live-autonomy-60s',text:prompt}});
  const deadline=Date.now()+360000;
  while(Date.now()<deadline){
   const snapshot=await app.request('/conversations/'+conversation),current=snapshot.runs.find(run=>run.id===accepted.runId);
   for(const approval of current.approvals.filter(item=>item.status==='pending'&&!approved.has(item.id))){
    const exact=approved.size===0&&approval.kind==='tool.execution'&&approval.operation.name===expectedOperation.name;
    let matches=false;try{assert.deepEqual(approval.operation,expectedOperation);matches=exact;}catch{}
    await decide(app,current,approval,matches);approved.add(approval.id);
    assert.ok(matches,'Unexpected approval was rejected');
    console.log(JSON.stringify({state:'approved-exact-terminal',afterMs:Date.now()-started}));
   }
   if(!['accepted','starting','running','waiting_approval','cancelling'].includes(current.status))return verify(snapshot,current,Date.now()-started);
   assert.ok(snapshot.tools.filter(tool=>tool.runId===current.id).every(tool=>['Terminal','SendMessage'].includes(tool.name)),'Unexpected tool receipt');
   await delay(250);
  }
  throw Error('Live autonomy verification exceeded its bounded six-minute deadline');
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await app.close();}
}
if(!process.argv.includes('--run')){
 console.log('Opt-in: node scripts/verify-live-autonomy.mjs --run');
 console.log('Uses the authorized Claude subscription seat and one approved 60-second sandboxed Terminal command. No network command, account changes or private-file reads.');
}else{
 try{console.log(JSON.stringify(await run()));}
 catch(error){console.error(JSON.stringify({state:'unverified',code:error.code??'LIVE_AUTONOMY_FAILED',message:error.message}));process.exitCode=1;}
}

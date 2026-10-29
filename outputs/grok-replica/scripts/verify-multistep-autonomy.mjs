// Opt-in real-provider check; production code, clock and executor are untouched.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHarnessHandler} from '../harness/http.mjs';
import {sendMessageArguments} from '../harness/send-message.mjs';
import {createModelProvider} from '../harness/model-provider.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const conversation='synthetic-multistep-20261027';
const markers=[1,2,3].map(n=>'AUTONOMY_STEP_'+n+'_60S_CONFIRMED');
const commands=markers.map((marker,n)=>'/bin/zsh -f -c \'for beat in {1..12}; do /bin/sleep 5; printf "AUTONOMY_STEP_'+(n+1)+'_HEARTBEAT_%02d\\n" "$beat"; done; printf "'+marker+'\\n"\'');
const operations=commands.map(command=>({name:'Terminal',arguments:{command}}));
const prompt=[
 'Perform exactly three sequential Terminal calls, followed by exactly one SendMessage. One tool call per model response.',
 'After each Terminal call wait for its confirmed successful result before deciding and requesting the next call.',
 'Use these Terminal argument objects exactly, in order, with no extra keys:',
 ...commands.map((command,n)=>String(n+1)+': '+JSON.stringify({command})),
 'Do not use any other tools, read files, access networks, alter commands or sleeps, simulate output, or send intermediate messages.',
 'Only after all three confirmed results, SendMessage once, including all three exact success sentinels and the actual exit code 0 for each.',
 'If anything fails, do not claim success. Report the actual failure with SendMessage.'
].join('\n');
// Task-scoped pre-execution envelope validator, not production guard behavior.
// Real inference/options/events remain unchanged; no fabricated decisions or results.
function currentInput(options){
 const context=options.messages.findLast(entry=>entry.role==='system'&&typeof entry.content==='string'&&entry.content.startsWith('Local delivery context:\n'));
 assert.ok(context,'Missing authoritative delivery context');
 const id=JSON.parse(context.content.slice('Local delivery context:\n'.length)).current_input_message_id;
 assert.equal(typeof id,'string');assert.ok(id);return id;
}
function validateProvider(provider){
 const guarded=Object.fromEntries(Object.entries(provider).map(([key,value])=>[key,typeof value==='function'?value.bind(provider):value]));
 let next=0;const seen=new Set();
 guarded.complete=async options=>{
  const response=await provider.complete(options),call=response?.toolCalls?.[0];let reason='single-call';
  try{
   assert.ok(Array.isArray(response?.toolCalls));assert.equal(response.toolCalls.length,1);
   reason='unique-call-id';assert.equal(typeof call.id,'string');assert.ok(call.id&&!seen.has(call.id));
   if(next<3){reason='exact-next-terminal';assert.deepEqual({name:call.name,arguments:call.arguments},operations[next]);}
   else{
    reason='final-sendmessage';assert.equal(next,3);assert.equal(call.name,'SendMessage');
    reason='native-text-shape';sendMessageArguments(call.arguments);assert.ok(Object.hasOwn(call.arguments,'text'));assert.ok(!Object.hasOwn(call.arguments,'attachment'));
    reason='authoritative-reply';if(Object.hasOwn(call.arguments,'reply_to'))assert.equal(call.arguments.reply_to,currentInput(options));
    reason='confirmed-markers';markers.forEach(marker=>assert.ok(call.arguments.text.content.includes(marker)));assert.match(call.arguments.text.content,/\b0\b/);
   }
  }catch{
   const content=typeof call?.arguments?.text?.content==='string'?call.arguments.text.content:'';
   console.log(JSON.stringify({state:'envelope-rejected',nextStep:next+1,reason,toolName:typeof call?.name==='string'?call.name.slice(0,80):null,argKeys:Object.keys(call?.arguments??{}).slice(0,8).map(key=>key.slice(0,80)),textKeys:Object.keys(call?.arguments?.text??{}).slice(0,8).map(key=>key.slice(0,80)),markerMatches:markers.map(marker=>content.includes(marker)),exitZeroMatch:/\b0\b/.test(content),duplicate:seen.has(call?.id)}));
   throw Object.assign(new Error('Task-scoped envelope rejected: '+reason),{code:'VERIFIER_ENVELOPE_REJECTED'});
  }
  seen.add(call.id);next++;return response;
 };
 return guarded;
}
async function start(){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-multistep-'));let handler,closed=false;
 const server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(done=>{if(!done)res.writeHead(404).end();}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();}));
 const close=async()=>{if(closed)return;closed=true;try{await handler?.close();}finally{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}};
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl='http://127.0.0.1:'+server.address().port;
  const model=validateProvider(createModelProvider({env:{...process.env,GROK_MODEL_PROVIDER:'claude-seat',CLAUDE_MODEL:'claude-sonnet-5-5'}}));
  handler=await createHarnessHandler({root,dataDir,baseUrl,model,maxChildren:1,workflowAutoStart:false});
  let cookie='',csrf='';
  const request=async(route,{method='GET',body}={})=>{
   const response=await fetch(baseUrl+'/api/harness'+route,{method,signal:AbortSignal.timeout(15000),headers:{cookie,...(method==='GET'?{}:{Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
   assert.ok(response.ok,'HTTP '+response.status+' '+(value.error?.code??route));return value;
  };
  await request('/status');return {handler,request,close};
 }catch(error){await close();throw error;}
}
function historyCalls(app){
 return app.handler.store.states.get(conversation).agentHistory.filter(entry=>entry.role==='assistant'&&entry.tool_calls?.length).map(entry=>entry.tool_calls);
}
function exactApproval(app,current,approval,index,snapshot){
 assert.ok(index<3,'Additional Terminal approval');
 assert.equal(approval.kind,'tool.execution');assert.deepEqual(approval.operation,operations[index]);
 const calls=historyCalls(app);assert.equal(calls.length,index+1);
 calls.forEach((group,n)=>{assert.equal(group.length,1,'Batched model calls');assert.equal(group[0].function.name,'Terminal');assert.deepEqual(JSON.parse(group[0].function.arguments),operations[n].arguments);});
 const prior=snapshot.tools.filter(tool=>tool.runId===current.id&&tool.name==='Terminal'&&tool.status==='completed');
 assert.equal(prior.length,index,'Next approval preceded confirmed prior result');
 prior.forEach((tool,n)=>verifyTerminal(tool,n));
}
function expectedStdout(n){return Array.from({length:12},(_,i)=>'AUTONOMY_STEP_'+(n+1)+'_HEARTBEAT_'+String(i+1).padStart(2,'0')).join('\n')+'\n'+markers[n]+'\n';}
function verifyTerminal(tool,n){
 assert.deepEqual(tool.arguments,operations[n].arguments);assert.equal(tool.status,'completed');
 const result=JSON.parse(tool.output);assert.equal(result.exitCode,0);assert.equal(result.stderr,'');
 assert.equal(result.stdout,expectedStdout(n));
 const elapsedMs=Date.parse(tool.finishedAt)-Date.parse(tool.startedAt);
 assert.ok(elapsedMs>=60000&&elapsedMs<120000,'Terminal duration outside unchanged native limit');return elapsedMs;
}
function verify(app,snapshot,current,elapsedMs,approvalCount){
 assert.equal(current.status,'completed','Run did not complete: '+(current.error?.code??current.status));assert.equal(approvalCount,3);
 const tools=snapshot.tools.filter(tool=>tool.runId===current.id);
 assert.deepEqual(tools.map(tool=>tool.name),['Terminal','Terminal','Terminal','SendMessage']);
 assert.equal(new Set(tools.map(tool=>tool.id)).size,4);assert.equal(new Set(tools.map(tool=>tool.callId)).size,4);
 const terminals=tools.slice(0,3),durations=terminals.map(verifyTerminal);
 terminals.forEach((tool,n)=>{if(n)assert.ok(Date.parse(tool.startedAt)>=Date.parse(terminals[n-1].finishedAt),'Effects overlap or order reversed');});
 assert.ok(elapsedMs>=180000);assert.ok(durations.reduce((a,b)=>a+b,0)>=180000);
 const calls=historyCalls(app);assert.equal(calls.length,4);calls.forEach(group=>assert.equal(group.length,1));
 assert.deepEqual(calls.map(group=>group[0].function.name),['Terminal','Terminal','Terminal','SendMessage']);
 assert.equal(tools[3].status,'completed');assert.ok(Date.parse(tools[3].startedAt)>=Date.parse(terminals[2].finishedAt));
 const entry=snapshot.entries.find(entry=>entry.id===current.outputEntryId);
 assert.equal(entry.status,'completed');assert.equal(entry.delivery,'delivered');
 markers.forEach(marker=>assert.ok(entry.text.includes(marker)));assert.match(entry.text,/\b0\b/);
 return {state:'verified',provider:'claude-seat',model:'claude-sonnet-5-5',elapsedMs,terminalElapsedMs:durations,terminalReceipts:3,distinctTerminalReceiptIds:new Set(terminals.map(tool=>tool.id)).size,heartbeatLines:36,exitCodes:[0,0,0],confirmedSentinels:markers,independentModelToolTurns:4,delivery:entry.delivery,runStatus:current.status,nativeTimeoutMs:120000};
}
function snapshotSummary(app,runId){
 const state=app.handler.store.states.get(conversation),current=state?.runs.find(item=>item.id===runId);
 if(!current)return {state:'final-snapshot',runFound:false};
 const tools=state.tools.filter(tool=>tool.runId===runId),entry=state.entries.find(item=>item.id===current.outputEntryId);
 const terminals=tools.filter(tool=>tool.name==='Terminal').map((tool,n)=>{
  let result;try{result=JSON.parse(tool.output);}catch{}
  return {step:n+1,status:tool.status,durationMs:tool.finishedAt?Date.parse(tool.finishedAt)-Date.parse(tool.startedAt):null,exitCode:result?.exitCode??null,expectedCommandMatch:tool.arguments?.command===commands[n],expectedStdoutMatch:result?.stdout===expectedStdout(n),stderrEmpty:result?.stderr==='',sentinelMatch:result?.stdout?.includes(markers[n])??false};
 });
 return {state:'final-snapshot',runStatus:current.status,runError:current.error?{code:current.error.code,message:String(current.error.message).slice(0,240)}:null,terminalReceipts:terminals.length,terminals,modelToolTurns:historyCalls(app).length,sendMessageReceipts:tools.filter(tool=>tool.name==='SendMessage').length,finalMessageDelivered:entry?.delivery==='delivered'};
}
async function run(){
 const started=Date.now(),app=await start(),approved=new Set();let accepted,interrupted=false;
 const cancel=async()=>{const state=app.handler.store.states.get(conversation);if(accepted&&state)await app.handler.runtime.cancel(state.owner,accepted.runId);};
 const stop=()=>{interrupted=true;cancel().catch(()=>{});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 const watchdog=setTimeout(stop,540000);
 try{
  accepted=await app.request('/conversations/'+conversation+'/runs',{method:'POST',body:{requestId:'synthetic-three-60s',text:prompt}});
  while(Date.now()-started<540000&&!interrupted){
   const snapshot=await app.request('/conversations/'+conversation),current=snapshot.runs.find(item=>item.id===accepted.runId);
   for(const approval of current.approvals.filter(item=>item.status==='pending'&&!approved.has(item.id))){
    let matches=false;try{exactApproval(app,current,approval,approved.size,snapshot);matches=true;}catch{}
    await app.request('/runs/'+current.id+'/approvals/'+approval.id+'/decision',{method:'POST',body:{requestId:'decision-'+approval.id,decision:matches?'approve':'reject'}});
    assert.ok(matches,'Unexpected, duplicate or out-of-order approval rejected');approved.add(approval.id);
    console.log(JSON.stringify({state:'approved-exact-terminal',step:approved.size,afterMs:Date.now()-started}));
   }
   assert.ok(snapshot.tools.filter(tool=>tool.runId===current.id).every(tool=>['Terminal','SendMessage'].includes(tool.name)),'Unexpected tool receipt');
   if(!['accepted','starting','running','waiting_approval','cancelling'].includes(current.status))return verify(app,snapshot,current,Date.now()-started,approved.size);
   await delay(250);
  }
  throw Error('Interrupted or exceeded bounded nine-minute execution deadline');
 }finally{
  clearTimeout(watchdog);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  try{await cancel();}finally{try{console.log(JSON.stringify(snapshotSummary(app,accepted?.runId)));}finally{await app.close();}}
 }
}
async function validatorSmoke(){
 const content=markers.join(' ')+' exit code 0',options={messages:[{role:'system',content:'Local delivery context:\n'+JSON.stringify({current_input_message_id:'synthetic_input_1'})}]};
 const check=async(args,accepted)=>{
  const decisions=[...operations.map((operation,n)=>({toolCalls:[{id:'terminal_'+n,...operation}]})),{toolCalls:[{id:'final',name:'SendMessage',arguments:args}]}];
  const guard=validateProvider({complete:async()=>decisions.shift(),status:()=>({fixture:true})});
  for(let n=0;n<3;n++)await guard.complete(options);
  if(accepted)assert.equal((await guard.complete(options)).toolCalls[0].arguments,args);
  else await assert.rejects(()=>guard.complete(options));
 };
 await check({text:{content},reply_to:'synthetic_input_1'},true);
 await check({text:{content}},true);
 await check({text:{content},reply_to:'foreign_input'},false);
 await check({attachment:{url:'synthetic.txt'}},false);
 const bad=validateProvider({complete:async()=>({toolCalls:[{id:'unsafe',name:'workspace_write',arguments:{}}]})});
 await assert.rejects(()=>bad.complete(options));
 const batch=validateProvider({complete:async()=>({toolCalls:[{id:'a',...operations[0]},{id:'b',...operations[1]}]})});
 await assert.rejects(()=>batch.complete(options));
 const order=validateProvider({complete:async()=>({toolCalls:[{id:'a',...operations[1]}]})});
 await assert.rejects(()=>order.complete(options));
 const duplicate=validateProvider({complete:async()=>({toolCalls:[{id:'reused',...operations[0]}]})});
 await duplicate.complete(options);await assert.rejects(()=>duplicate.complete(options));
 console.log(JSON.stringify({state:'validator-smoke-passed',cases:8,modelInference:false,toolExecution:false}));
}
if(process.argv.includes('--validator-smoke'))await validatorSmoke();
else if(!process.argv.includes('--run'))console.log('NO RUN: opt-in --run uses existing claude-seat sonnet-5-5, three exact 60s sandboxed commands, unchanged 120s per-terminal cap, isolated owned resources, nine-minute execution deadline.');
else try{console.log(JSON.stringify(await run()));}catch(error){console.error(JSON.stringify({state:'unverified',code:error.code??'LIVE_AUTONOMY_FAILED',message:error.message}));process.exitCode=1;}

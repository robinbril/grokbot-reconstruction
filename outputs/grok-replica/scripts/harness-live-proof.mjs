import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startHarness,collectUntil} from '../tests/fixtures/harness-http.mjs';
import {DEFAULT_CODEX_BINARY} from '../harness/codex-rpc.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const receiptPath=path.join(root,'.run/live-harness-proof.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const requestId=()=>randomUUID();
const marker=randomUUID().replaceAll('-','');
const conversationId='liveproof_'+marker;
const receipt={schema:1,proof:'installed-provider-live',startedAt:new Date().toISOString(),status:'running',checks:{},approvals:[]};
let app,client,runId;

async function sourceHashes(){
 const files=['scripts/harness-live-proof.mjs','tests/fixtures/harness-http.mjs','package.json','package-lock.json',...(await readdir(path.join(root,'harness'))).filter(f=>f.endsWith('.mjs')).map(f=>'harness/'+f)].sort();
 return Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(path.join(root,file)))])));
}
async function snapshot(){
 const response=await client.request('/conversations/'+conversationId);
 assert.equal(response.status,200,'Conversation snapshot must remain available');
 return response.value;
}
async function poll(check,{timeout=30000,label='condition'}={}){
 const until=Date.now()+timeout;
 while(Date.now()<until){const result=await check();if(result)return result;await delay(100);}
 throw new Error('Deadline exceeded: '+label);
}
async function post(route,body,status=200){
 const response=await client.request(route,{method:'POST',body:{requestId:requestId(),...body}});
 assert.equal(response.status,status,route+': '+JSON.stringify(response.value));
 return response.value;
}
async function terminal(command){return post('/conversations/'+conversationId+'/terminal',{command},202);}
async function endedTerminal(id){return poll(async()=>{const t=(await snapshot()).terminalSessions.find(t=>t.id===id);return t&&t.status!=='running'?t:null;},{label:'terminal '+id});}

function allowedApproval(approval,allowed){
 if(approval.kind!=='mcpServer/elicitation/request')return false;
 const operation=approval.operation;
 return operation?.server==='grok_workspace'&&allowed.has(operation.tool)
  &&JSON.stringify(operation.arguments)===JSON.stringify(allowed.get(operation.tool));
}

try{
 receipt.sourceHashes=await sourceHashes();
 app=await startHarness({codexBinary:DEFAULT_CODEX_BINARY});
 client=await app.client();
 const connected=await post('/conversations/'+conversationId+'/connect',{});
 const runtime=connected.runtime;
 assert.equal(runtime.adapter,'codex-app-server');
 assert.equal(runtime.state,'connected');
 assert.equal(runtime.provider,'openai');
 assert.equal(runtime.modelExecution,'cloud');
 assert.equal(typeof runtime.model,'string');assert.ok(runtime.model.length>0);
 const connection=app.handler.runtime.connections.get(conversationId);
 assert.equal(connection.rpc.proc.spawnfile,DEFAULT_CODEX_BINARY,'Must execute the installed CLI, never fixtureCLI');
 assert.equal(connection.rpc.proc.spawnargs.includes('app-server'),true);
 const {config}=await connection.rpc.request('config/read',{includeLayers:false,cwd:runtime.workspaceRoot});
 let configuredModel=config.model;
 if(!configuredModel){const catalog=await connection.rpc.request('model/list',{includeHidden:false,limit:100});configuredModel=catalog.data.find(m=>m.isDefault)?.model;}
 assert.equal(runtime.model,configuredModel,'Runtime must preserve the actual configured default model');
 const enabled=Object.entries(config.mcp_servers??{}).filter(([,s])=>s.enabled!==false).map(([name])=>name).sort();
 assert.deepEqual(enabled,['grok_workspace']);
 receipt.runtime={adapter:runtime.adapter,provider:runtime.provider,model:runtime.model,modelExecution:runtime.modelExecution,toolHost:runtime.toolHost,installedBinary:DEFAULT_CODEX_BINARY,enabledMcpServers:enabled};
 receipt.checks.installedProvider=true;
 const inventory=connected.servers.find(s=>s.id==='grok_workspace');
 assert.equal(inventory?.state,'connected');
 const required=['workspace_read','browser_open','browser_fill','browser_click','browser_snapshot','browser_screenshot'];
 for(const name of required)assert.ok(inventory.tools.some(t=>t.name===name),'Missing real MCP tool '+name);
 receipt.discoveredTools=inventory.tools.map(t=>t.name).sort();

 const outside=path.join(app.dataDir,'outside-workspace-'+marker+'.txt');
 const stdout='LIVE_STDOUT_'+marker,stderr='LIVE_STDERR_'+marker;
 const manualCode=`const fs=require('node:fs');if(fs.realpathSync(process.cwd())!==fs.realpathSync(${JSON.stringify(runtime.workspaceRoot)}))throw Error('wrong cwd');fs.writeFileSync('manual-proof.txt',${JSON.stringify(marker)});process.stdout.write(${JSON.stringify(stdout+'\n')});process.stderr.write(${JSON.stringify(stderr+'\n')});try{fs.writeFileSync(${JSON.stringify(outside)},'must be blocked');process.stdout.write('OUTSIDE_WRITE_ALLOWED\\n')}catch(e){process.stdout.write('OUTSIDE_WRITE_'+e.code+'\\n')}process.exit(7)`;
 const manual=await terminal(quote(process.execPath)+' -e '+quote(manualCode));
 const manualResult=await endedTerminal(manual.id);
 assert.equal(manualResult.status,'failed');assert.equal(manualResult.exitCode,7,'Manual terminal output: '+JSON.stringify({stdout:manualResult.stdout,stderr:manualResult.stderr}));
 assert.ok(manualResult.stdout.includes(stdout));assert.ok(manualResult.stderr.includes(stderr));
 assert.match(manualResult.stdout,/OUTSIDE_WRITE_EPERM/);assert.doesNotMatch(manualResult.stdout,/OUTSIDE_WRITE_ALLOWED/);
 await assert.rejects(access(outside),e=>e.code==='ENOENT');
 assert.equal(await readFile(path.join(runtime.workspaceRoot,'manual-proof.txt'),'utf8'),marker);
 receipt.checks.manualTerminal={stdout:true,stderr:true,exitCode:manualResult.exitCode,workspaceWrite:true,outsideWrite:'EPERM'};

 const ready='LONG_COMMAND_READY_'+marker;
 const long=await terminal(quote(process.execPath)+' -e '+quote(`console.log(${JSON.stringify(ready)});setInterval(()=>{},1000)`));
 await poll(async()=>{const t=(await snapshot()).terminalSessions.find(t=>t.id===long.id);return t?.stdout.includes(ready);},{label:'long command actual stdout'});
 await post('/conversations/'+conversationId+'/terminal/'+long.id+'/stop',{});
 const stopped=await endedTerminal(long.id);assert.equal(stopped.status,'interrupted');
 assert.equal((await client.request('/status')).status,200);
 const afterStop=await terminal(quote(process.execPath)+' -e '+quote("console.log('SERVER_STILL_ALIVE')"));
 const afterStopResult=await endedTerminal(afterStop.id);
 assert.equal(afterStopResult.exitCode,0);assert.match(afterStopResult.stdout,/SERVER_STILL_ALIVE/);
 receipt.checks.stopTerminal={status:stopped.status,serverAlive:true,subsequentCommand:true};
 process.stdout.write('PASS installed provider, actual terminal streams/exit, sandbox EPERM and stop\n');

 const inputValue='filled_'+marker,domMarker='DOM_LIVE_'+marker+':'+inputValue;
 const html='<!doctype html><html><head><meta charset="utf-8"><title>Live Harness Proof</title></head><body><h1>Live Harness Proof</h1><label>Proof value<input id="proof-input"></label><button id="proof-apply" onclick="document.getElementById(\'proof-output\').textContent=\'DOM_LIVE_'+marker+':\'+document.getElementById(\'proof-input\').value">Apply proof</button><p id="proof-output">Before interaction</p></body></html>';
 const nativeCommand=quote(process.execPath)+' -e '+quote(`require('node:fs').writeFileSync('index.html',${JSON.stringify(html)});console.log('NATIVE_HTML_WRITTEN_${marker}')`);
 const preview=app.baseUrl+'/api/harness/conversations/'+conversationId+'/preview/index.html';
 const allowed=new Map([
  ['workspace_read',{path:'index.html'}],['browser_open',{url:preview}],
  ['browser_fill',{selector:'#proof-input',value:inputValue}],['browser_click',{selector:'#proof-apply'}],
  ['browser_snapshot',{}],['browser_screenshot',{}],
 ]);
 const prompt=`Execute this precise real integration proof now. Do not merely describe it. Use your native sandboxed terminal to run exactly this command once: ${nativeCommand}\nThen use ONLY the grok_workspace MCP server, in this order: workspace_read with {"path":"index.html"}; browser_open with ${JSON.stringify({url:preview})}; browser_fill with ${JSON.stringify(allowed.get('browser_fill'))}; browser_click with {"selector":"#proof-apply"}; browser_snapshot with {}; browser_screenshot with {}. Confirm the snapshot contains ${domMarker}. Do not start a server, request extra permissions, use other tools, change any other file, or call workspace_write. Finish briefly after all actual tool outputs arrive.`;
 const accepted=await post('/conversations/'+conversationId+'/runs',{text:prompt},202);runId=accepted.runId;
 const deadline=Date.now()+240000;let after=0,finished=false;const events=[];
 while(!finished){
  const remaining=deadline-Date.now();assert.ok(remaining>0,'Actual model proof exceeded 240 seconds');
  const batch=await collectUntil(client,runId,event=>event.runId===runId&&(event.type==='approval.requested'||/^run\.(completed|failed|cancelled|interrupted)$/.test(event.type)),{after,timeout:remaining});
  events.push(...batch);after=batch.at(-1).seq;
  const event=batch.at(-1);
  if(event.type==='approval.requested'){
   const a=event.data.approval;const approved=allowedApproval(a,allowed);
   receipt.approvals.push({kind:a.kind,tool:a.operation?.tool??null,decision:approved?'approve':'reject',exactOwnedArguments:approved});
   await post('/runs/'+runId+'/approvals/'+a.id+'/decision',{decision:approved?'approve':'reject'});
   assert.ok(approved,'Unexpected approval or permission expansion was rejected');
  }else{assert.equal(event.type,'run.completed','Actual model run failed: '+JSON.stringify(event.data.run?.error??event.type));finished=true;}
 }
 const state=await snapshot(),run=state.runs.find(r=>r.id===runId);
 assert.equal(run.status,'completed');
 const native=state.tools.filter(t=>t.runId===runId&&t.source==='codex-app-server'&&t.itemType==='commandExecution'&&t.status==='completed');
 assert.ok(native.some(t=>t.output?.includes('NATIVE_HTML_WRITTEN_'+marker)),'Actual model must execute native terminal');
 assert.equal(await readFile(path.join(runtime.workspaceRoot,'index.html'),'utf8'),html);
 const nativeMcp=state.tools.filter(t=>t.runId===runId&&t.source==='codex-app-server'&&t.itemType==='mcpToolCall'&&t.serverId==='grok_workspace'&&t.status==='completed');
 const bridge=state.tools.filter(t=>t.runId===runId&&!t.source&&t.serverId==='grok_workspace'&&t.status==='completed');
 for(const [name,args] of allowed){
  assert.ok(nativeMcp.some(t=>t.name===name&&JSON.stringify(t.arguments)===JSON.stringify(args)),'No actual app-server MCP call: '+name);
  assert.ok(bridge.some(t=>t.name===name&&JSON.stringify(t.arguments)===JSON.stringify(args)),'No executed scoped bridge call: '+name);
 }
 const dom=bridge.filter(t=>t.name==='browser_snapshot').map(t=>JSON.parse(t.output)).find(output=>output.text?.includes(domMarker));
 assert.ok(dom,'Actual DOM must contain the unique marker produced by fill + click');
 const screenshot=JSON.parse(bridge.findLast(t=>t.name==='browser_screenshot').output);
 const frame=await client.request('/conversations/'+conversationId+'/browser/frames/'+screenshot.captureId,{raw:true});
 assert.equal(frame.status,200);assert.match(frame.headers.get('content-type'),/^image\/png/);
 const png=Buffer.from(await frame.arrayBuffer());assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(png.length>1000);
 assert.equal(screenshot.pageUrl,preview);assert.equal(dom.pageUrl,preview);
 const replayAfter=events.findLastIndex(e=>e.type==='run.completed')-1;
 const replay=await collectUntil(client,runId,e=>e.type==='run.completed',{after:events[replayAfter]?.seq??0,timeout:10000});
 assert.deepEqual(replay,events.filter(e=>e.seq>(events[replayAfter]?.seq??0)));
 receipt.checks.modelRun={status:run.status,nativeTerminal:true,ownedHtmlSha256:sha(html),actualMcpTools:[...allowed.keys()],actualDomMarker:true,ownedPreview:true,sseReplay:true};
 receipt.toolReceipts=bridge.map(t=>({tool:t.name,status:t.status,arguments:t.arguments}));
 receipt.screenshot={contentType:'image/png',bytes:png.length,sha256:sha(png)};
 const beforeReconnect=await snapshot();
 const priorConnection=app.handler.runtime.connections.get(conversationId);
 assert.equal(beforeReconnect.threadId,priorConnection.threadId);
 await app.handler.runtime.drop(conversationId);
 assert.equal(app.handler.runtime.connections.has(conversationId),false);
 const reconnected=await post('/conversations/'+conversationId+'/connect',{});
 const resumedConnection=app.handler.runtime.connections.get(conversationId);
 assert.ok(resumedConnection);assert.notEqual(resumedConnection.rpc,priorConnection.rpc);
 assert.equal(reconnected.threadId,beforeReconnect.threadId,'Completed model thread must resume with the persisted thread ID');
 assert.equal(resumedConnection.threadId,beforeReconnect.threadId);
 assert.equal(reconnected.workspaceRoot,beforeReconnect.workspaceRoot);
 assert.equal(reconnected.runtime.workspaceRoot,beforeReconnect.workspaceRoot);
 const afterReconnect=await snapshot();
 assert.deepEqual(afterReconnect.entries,beforeReconnect.entries,'Reconnect must preserve actual model entries');
 assert.deepEqual(afterReconnect.runs,beforeReconnect.runs,'Metadata reconnect must neither change nor add a model run');
 assert.equal(afterReconnect.runs.find(r=>r.id===runId).status,'completed');
 receipt.checks.completedThreadResume={sameThread:true,sameWorkspace:true,newRuntimeProcess:true,entriesPreserved:true,runsPreserved:true,noExtraModelRun:true};
 assert.deepEqual(await sourceHashes(),receipt.sourceHashes,'Harness source changed during proof; rerun against the final source');
 receipt.status='passed';
 process.stdout.write('PASS actual model native terminal + six real MCP tools + DOM marker + PNG + SSE replay + completed thread reconnect\n');
}catch(error){
 receipt.status='failed';receipt.error={name:error.name,message:String(error.message).slice(0,2000)};
 process.stderr.write('FAIL live harness proof: '+receipt.error.message+'\n');process.exitCode=1;
}finally{
 if(runId&&client){try{const r=await client.request('/runs/'+runId);if(['accepted','starting','running','waiting_approval','cancelling'].includes(r.value?.status))await post('/runs/'+runId+'/cancel',{});}catch{}}
 try{await app?.close();receipt.cleanup={ownServerClosed:true};}catch(error){receipt.cleanup={ownServerClosed:false};receipt.status='failed';process.exitCode=1;process.stderr.write('FAIL own harness cleanup: '+error.message+'\n');}
 receipt.finishedAt=new Date().toISOString();await mkdir(path.dirname(receiptPath),{recursive:true});
 await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 process.stdout.write('Receipt: '+receiptPath+'\n');
}

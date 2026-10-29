// Installed-seat acceptance. This intentionally has no fixture/default-provider switch.
// Run only under the parent test lease; see the workflow provider-proof README.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,readdir,rm,realpath} from 'node:fs/promises';
import {randomUUID,randomInt,randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHarnessHandler} from '../harness/http.mjs';
import {DEFAULT_CODEX_BINARY} from '../harness/codex-rpc.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const schemaRoot=path.join(root,'tests/fixtures/live-workflows-schema');
const attempt='attempt-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const output=path.resolve(process.env.LIVE_WORKFLOWS_PROOF_DIR||path.join(root,'.run/live-workflows-proofs',attempt));
const dataDir=path.join(output,'private-runtime');
const conversationId='workflowproof_'+randomUUID().replaceAll('-','');
const baseRoute='/conversations/'+conversationId;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const nodeCommand=code=>quote(process.execPath)+' -e '+quote(code);
const terminal=new Set(['completed','failed','cancelled','interrupted']);
const receipt={schema:1,proof:'installed-provider-workflows',status:'running',startedAt:new Date().toISOString(),conversationId,checks:{},approvals:[],limitations:['Local Node scheduler only; server and Mac must remain awake.','No PDF/Office parser or OS/cloud scheduler claim.','Browser setup and upload are setup effects; provider content evidence is independently asserted.']};
let handler,server,baseUrl,cookie='',csrf='',connection;
const turns=[],notifications=[],httpReceipts=[],allowedCommands=new Set(),decided=new Set(),snapshots=[];

async function artifact(name,value){await writeFile(path.join(output,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});}
async function sourceHashes(){
 const files=['scripts/live-workflows-proof.mjs','package.json','package-lock.json',...(await readdir(schemaRoot)).map(n=>'tests/fixtures/live-workflows-schema/'+n),...(await readdir(path.join(root,'harness'))).filter(n=>n.endsWith('.mjs')).map(n=>'harness/'+n)].sort();
 return Object.fromEntries(await Promise.all(files.map(async name=>[name,sha(await readFile(path.join(root,name)))])));
}
async function request(route,{method='GET',body,bytes,raw=false}={}){
 const response=await fetch(baseUrl+'/api/harness'+route,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':bytes?'application/octet-stream':'application/json'}:{})},...(bytes?{body:bytes}:body!==undefined?{body:JSON.stringify(body)}:{})});
 const set=response.headers.get('set-cookie');if(set)cookie=set.split(';',1)[0];
 if(raw)return response;
 const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
 // Deliberately omit the cookie, CSRF token, response headers and secret config.
 const safe=value.csrfToken?{schema:value.schema,runtime:value.runtime,capabilities:value.capabilities}:value;
 httpReceipts.push({at:new Date().toISOString(),method,route,status:response.status,...(body?{body}:{}),response:safe});
 return {status:response.status,value};
}
async function post(route,body,status=200){const result=await request(route,{method:'POST',body:{requestId:randomUUID(),...body}});assert.equal(result.status,status,route+': '+JSON.stringify(result.value));return result.value;}
async function snapshot(label){const result=await request(baseRoute);assert.equal(result.status,200);if(label){await artifact(label+'.json',result.value);snapshots.push(label+'.json');}return result.value;}
async function poll(fn,{timeout=360000,label='condition'}={}){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(150);}throw Error('Timed out: '+label);}
function commandApprovalIsExact(approval,workspace){
 if(approval.kind!=='item/commandExecution/requestApproval')return false;
 const op=approval.operation??{};
 // No escalation or filesystem/network permission overlay is ever auto-approved.
 if(op.cwd!==workspace||op.additionalPermissions!=null)return false;
 return typeof op.command==='string'&&allowedCommands.has(op.command);
}
async function serviceApprovals(state){
 for(const run of state.runs)for(const approval of run.approvals??[]){
  if(approval.status!=='pending'||decided.has(approval.id))continue;
  decided.add(approval.id);
  const approved=commandApprovalIsExact(approval,state.workspaceRoot);
  receipt.approvals.push({id:approval.id,runId:run.id,kind:approval.kind,operation:approval.operation,decision:approved?'approve':'reject',exactOwnedCommand:approved});
  await post('/runs/'+run.id+'/approvals/'+approval.id+'/decision',{decision:approved?'approve':'reject'});
  assert.ok(approved,'Rejected unexpected approval; acceptance proof stops rather than widening permission');
 }
}
async function completed(runId){return poll(async()=>{const state=await snapshot();await serviceApprovals(state);const run=state.runs.find(r=>r.id===runId);if(!run||!terminal.has(run.status))return null;assert.equal(run.status,'completed','Native run failed: '+JSON.stringify(run));return {state,run,answer:state.entries.find(e=>e.id===run.outputEntryId)?.text??''};},{label:'completed native run '+runId});}
function boundFinalMessage(messages,run,canonicalText){
 assert.equal(typeof run.threadId,'string');assert.ok(run.threadId.length);assert.equal(typeof run.turnId,'string');assert.ok(run.turnId.length);
 const finals=messages.filter(message=>message.method==='item/completed'&&message.params?.threadId===run.threadId&&message.params?.turnId===run.turnId&&message.params?.item?.type==='agentMessage'&&message.params?.item?.phase==='final_answer');
 assert.equal(finals.length,1,'Exactly one installed final_answer item must bind the exact second native thread and turn');
 const final=finals[0];assert.equal(typeof final.params.item.text,'string');assert.ok(final.params.item.text.trim().length);assert.ok(canonicalText.includes(final.params.item.text),'Canonical assistant output must contain the exact installed final answer');
 return final;
}
async function upload(name,type,bytes){
 const meta={requestId:randomUUID(),name,type,size:bytes.length,sha256:sha(bytes)};
 const reserved=await post(baseRoute+'/attachments',meta,201);
 const replay=await post(baseRoute+'/attachments',meta,201);assert.deepEqual(replay,reserved);
 const result=await request(baseRoute+'/attachments/'+reserved.attachmentId+'/content',{method:'PUT',bytes});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.state,'ready');
 const download=await request(baseRoute+'/attachments/'+reserved.attachmentId+'/download',{raw:true});assert.equal(download.status,200);assert.match(download.headers.get('content-type'),/^application\/octet-stream/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');
 const original=Buffer.from(await download.arrayBuffer());assert.deepEqual(original,bytes);
 return {ref:{attachmentId:reserved.attachmentId,size:meta.size,sha256:meta.sha256},ready:result.value,download:{bytes:original.length,sha256:sha(original)}};
}
function nativeCommands(state,runId){return state.tools.filter(t=>t.runId===runId&&t.source==='codex-app-server'&&t.itemType==='commandExecution'&&t.status==='completed');}
function installWireObservation(c){
 const original=c.rpc.request.bind(c.rpc);
 c.rpc.request=async(method,params={},timeout)=>{
  const observed=method==='turn/start'?{at:new Date().toISOString(),method,params:structuredClone(params),response:null}:null;
  if(observed)turns.push(observed);
  try{const response=await original(method,params,timeout);if(observed)observed.response=structuredClone(response);return response;}catch(error){if(observed)observed.error={code:error.code,message:error.message};throw error;}
 };
 const listener=line=>{try{const message=JSON.parse(line);if(message.method&&['turn/started','turn/completed','item/started','item/completed','error'].includes(message.method))notifications.push(message);}catch{}};
 c.rpc.lines.on('line',listener);
}

try{
 await mkdir(output,{recursive:true,mode:0o700});await mkdir(dataDir,{mode:0o700});
 receipt.sourceHashes=await sourceHashes();
 await artifact('source-hashes.json',receipt.sourceHashes);
 const provenance=JSON.parse(await readFile(path.join(schemaRoot,'provenance.json'),'utf8'));receipt.schemaProvenance=[];
 for(const source of provenance.files){const bytes=await readFile(path.join(schemaRoot,source.file));assert.equal(sha(bytes),source.sha256,'Version-bound schema copy drift');const target='schema-'+source.file;await artifact(target,bytes);receipt.schemaProvenance.push({...source,artifact:target});}
 await artifact('schema-provenance.json',provenance);
 assert.ok((await readFile(path.join(schemaRoot,'TurnStartParams.json'),'utf8')).includes('localImage'),'Installed schema must declare localImage');
 const version=await promisify(execFile)(DEFAULT_CODEX_BINARY,['--version'],{timeout:15000,maxBuffer:65536});receipt.installedBinary={path:DEFAULT_CODEX_BINARY,version:version.stdout.trim(),sha256:sha(await readFile(DEFAULT_CODEX_BINARY))};
 server=http.createServer((req,res)=>Promise.resolve(handler.handle(req,res)).then(handled=>{if(!handled&&!res.writableEnded)res.writeHead(404).end();}).catch(error=>{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});baseUrl='http://127.0.0.1:'+server.address().port;
 handler=await createHarnessHandler({root,dataDir,baseUrl,codexBinary:DEFAULT_CODEX_BINARY});
 const status=await request('/status');assert.equal(status.status,200);assert.equal(status.value.capabilities.attachments,true);assert.equal(status.value.capabilities.queue,true);assert.equal(status.value.capabilities.schedules,true);
 const connected=await post(baseRoute+'/connect',{});const runtime=connected.runtime;
 assert.equal(runtime.adapter,'codex-app-server');assert.equal(runtime.provider,'openai');assert.equal(runtime.state,'connected');assert.equal(runtime.modelExecution,'cloud');
 connection=handler.runtime.connections.get(conversationId);assert.equal(connection.rpc.proc.spawnfile,DEFAULT_CODEX_BINARY);assert.ok(connection.rpc.proc.spawnargs.includes('app-server'));
 const {config}=await connection.rpc.request('config/read',{includeLayers:false,cwd:runtime.workspaceRoot});let defaultModel=config.model;
 if(!defaultModel){const catalog=await connection.rpc.request('model/list',{includeHidden:false,limit:100});defaultModel=catalog.data.find(model=>model.isDefault)?.model;}
 assert.ok(defaultModel);assert.equal(runtime.model,defaultModel);
 const enabled=Object.entries(config.mcp_servers??{}).filter(([,value])=>value.enabled!==false).map(([name])=>name).sort();assert.deepEqual(enabled,['grok_workspace']);
 receipt.runtime={adapter:runtime.adapter,provider:runtime.provider,model:runtime.model,modelExecution:runtime.modelExecution,enabledMcpServers:enabled,workspaceRoot:runtime.workspaceRoot};
 installWireObservation(connection);

 // This SVG-free HTML is setup only. The uploaded raster is an actual Chromium
 // screenshot, not a generated fake PNG and not an image filename/text oracle.
 const colors=['red','blue','green','purple'];const circleColor=colors[randomInt(colors.length)];const squareColor=colors.filter(c=>c!==circleColor)[randomInt(3)];
 const circleCount=randomInt(2,6),squareCount=randomInt(2,6),label=randomBytes(4).toString('hex').toUpperCase();
 const imageOracle={circleCount,circleColor,squareCount,squareColor,label};
 const shape=(kind,color,count)=>Array.from({length:count},()=>`<span style="display:inline-block;width:95px;height:95px;margin:18px;background:${color};${kind==='circle'?'border-radius:50%;':''}"></span>`).join('');
 const html='<!doctype html><meta charset="utf-8"><title>Raster fixture</title><body style="margin:40px;background:white;color:black;font:60px monospace"><div style="white-space:nowrap;width:900px;height:150px">'+shape('circle',circleColor,circleCount)+'</div><div style="white-space:nowrap;width:900px;height:150px">'+shape('square',squareColor,squareCount)+'</div><p style="margin:65px 0 0;line-height:80px">'+label+'</p></body>';
 const fixturePath=path.join(runtime.workspaceRoot,'raster-setup.html');await writeFile(fixturePath,html,{mode:0o600});await artifact('raster-setup.html',html);
 const preview=baseUrl+'/api/harness'+baseRoute+'/preview/raster-setup.html';
 const browserOpen=await post(baseRoute+'/browser',{action:'browser_open',arguments:{url:preview}});const captureId=browserOpen.result.captureId;assert.ok(captureId);
 const frame=await request(baseRoute+'/browser/frames/'+captureId,{raw:true});assert.equal(frame.status,200);assert.match(frame.headers.get('content-type'),/^image\/png/);
 const png=Buffer.from(await frame.arrayBuffer());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length>1000);await artifact('uploaded-original.png',png);
 await rm(fixturePath);await connection.tools.close();receipt.browserClosedAt=new Date().toISOString();
 // browserState is the last captured metadata and intentionally persists after
 // close; successful close() above is the actual browser lifecycle evidence.
 assert.equal(connection.tools.browserState()?.pageUrl,preview);
 const nonce=randomBytes(24).toString('hex'),amount=randomInt(100000,999999),rows=10001;
 const csv=Buffer.from('key,value\n'+Array.from({length:rows-1},(_,i)=>'record_'+String(i).padStart(5,'0')+','+'padding_'.repeat(6)).join('\n')+'\nTAIL_'+nonce+','+amount+'\n');
 assert.ok(csv.length>256*1024);await artifact('uploaded-original.csv',csv);
 const csvOracle={tailNonce:nonce,tailAmount:amount,rows,sha256:sha(csv)};
 await artifact('oracle.json',{csv:csvOracle,image:imageOracle,notes:'Expected facts are generated freshly outside model workspace; never included in user prompt. HTML setup was removed before model turns.'});
 const csvUpload=await upload('records.csv','text/csv',csv),imageUpload=await upload('picture.png','image/png',png);assert.equal(csvUpload.ready.contentAccess,'workspace-file');assert.equal(imageUpload.ready.contentAccess,'native-image');
 receipt.uploads={csv:csvUpload,image:imageUpload};
 assert.equal((await snapshot()).runs.length,0,'Setup/upload must not create any provider turn');assert.equal(turns.length,0);

 const firstMarker='FIRST_DONE_'+randomUUID().replaceAll('-','');
 const firstCommand=nodeCommand(`console.log('OWNED_FIRST_STARTED');setTimeout(()=>console.log(${JSON.stringify(firstMarker)}),20000)`);allowedCommands.add(firstCommand);
 const firstPrompt='Run this precise sandboxed native terminal command exactly once and wait until it exits: '+firstCommand+'\nDo not use other tools or request extra permissions. Then reply only '+firstMarker+'.';
 const first=await post(baseRoute+'/runs',{text:firstPrompt},202);receipt.first=first;
 await poll(async()=>{const s=await snapshot();await serviceApprovals(s);const r=s.runs.find(r=>r.id===first.runId);assert.ok(!r||!terminal.has(r.status),'First run ended before busy enqueue was observed');return s.tools.some(t=>t.runId===first.runId&&t.source==='codex-app-server'&&t.itemType==='commandExecution'&&t.status==='running');},{timeout:180000,label:'actual native terminal occupied first run'});
 const csvCode=`const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto');const matches=fs.readdirSync('inputs').map(r=>p.join('inputs',r,${JSON.stringify(csvUpload.ref.attachmentId)},'source.csv')).filter(f=>fs.existsSync(f));if(matches.length!==1)throw Error('expected one owned CSV');const bytes=fs.readFileSync(matches[0]);const rows=bytes.toString('utf8').trimEnd().split('\\n').slice(1).map(row=>row.split(','));const last=rows.at(-1);console.log(JSON.stringify({tailNonce:last[0].replace(/^TAIL_/,''),tailAmount:Number(last[1]),rows:rows.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))`;
 const csvCommand=nodeCommand(csvCode);allowedCommands.add(csvCommand);
 const secondPrompt='Read the actual uploaded CSV with this exact sandboxed native terminal command once: '+csvCommand+'\nIndependently inspect the attached native image. Count circles and squares, identify each shape color using a single English color word, and transcribe the large eight-character label. Do not read other files, run another command, use browser/MCP tools, or derive visual facts from file metadata. Reply only JSON with {"csv":{"tailNonce":string,"tailAmount":number,"rows":number,"sha256":string},"image":{"circleCount":number,"circleColor":string,"squareCount":number,"squareColor":string,"label":string}}. Use only actual read output and visible pixels.';
 for(const hidden of [nonce,String(amount),label])assert.ok(!secondPrompt.includes(hidden),'Hidden oracle leaked into user prompt');
 const secondBody={requestId:randomUUID(),text:secondPrompt,attachmentRefs:[csvUpload.ref,imageUpload.ref]};
 const second=await post(baseRoute+'/queue',secondBody,202);assert.deepEqual(await post(baseRoute+'/queue',secondBody,202),second);receipt.second=second;
 const during=await snapshot('busy-queue-accepted');assert.ok(!terminal.has(during.runs.find(r=>r.id===first.runId).status));assert.equal(during.queue.find(q=>q.id===second.queueId).status,'queued');assert.ok(!during.queue.find(q=>q.id===second.queueId).runId);
 const cancelled=await post(baseRoute+'/queue',{text:'Reply CANCELLED_ITEM_MUST_NEVER_EXECUTE'},202);await post(baseRoute+'/queue/'+cancelled.queueId+'/cancel',{});receipt.cancelled=cancelled;
 const firstResult=await completed(first.runId);assert.ok(firstResult.answer.includes(firstMarker));assert.ok(nativeCommands(firstResult.state,first.runId).some(t=>String(t.output).includes(firstMarker)),'Normal run must actually execute its native terminal command');
 const secondRunId=await poll(async()=>{const s=await snapshot();await serviceApprovals(s);const q=s.queue.find(q=>q.id===second.queueId);assert.ok(!['blocked','failed','interrupted'].includes(q?.status),JSON.stringify(q));return q?.runId;},{label:'FIFO second links its real run'});
 const secondResult=await completed(secondRunId);await artifact('second-answer.txt',secondResult.answer);
 const secondFinal=boundFinalMessage(notifications,secondResult.run,secondResult.answer);await artifact('second-final-notification.json',secondFinal);await artifact('second-final-answer.txt',secondFinal.params.item.text);
 assert.deepEqual(JSON.parse(secondFinal.params.item.text.trim()),{csv:csvOracle,image:imageOracle});
 const csvTool=nativeCommands(secondResult.state,secondRunId).find(t=>String(t.output).includes(nonce)&&String(t.output).includes(csvOracle.sha256));assert.ok(csvTool,'Hidden final-tail answer requires an actual successful native file read and digest');
 const secondTurn=turns.find(t=>t.response?.turn?.id===secondResult.run.turnId);assert.ok(secondTurn,'Must record actual installed turn/start exchange');assert.equal(secondTurn.params.input.length,2);assert.equal(secondTurn.params.input[0].type,'text');assert.equal(secondTurn.params.input[1].type,'localImage');
 const imagePath=secondTurn.params.input[1].path;assert.equal(await realpath(imagePath),imagePath);assert.equal(sha(await readFile(imagePath)),sha(png));assert.ok(imagePath.startsWith(path.join(runtime.workspaceRoot,'inputs',secondRunId)+path.sep));
 assert.ok(!secondTurn.params.input[0].text.includes(nonce));assert.ok(!secondTurn.params.input[0].text.includes(label));
 const ordered=await snapshot('fifo-completed');assert.equal(ordered.runs.length,2);assert.equal(ordered.runs.filter(r=>r.workflowQueueId===second.queueId).length,1);assert.ok(Date.parse(secondResult.run.startedAt)>=Date.parse(firstResult.run.finishedAt));assert.equal(ordered.queue.find(q=>q.id===cancelled.queueId).status,'cancelled');assert.ok(!ordered.queue.find(q=>q.id===cancelled.queueId).runId);
 receipt.checks.fifo={firstRunId:first.runId,secondRunId,busyAcceptance:true,idempotentAdmission:true,exactlyOneSecondRun:true,ordered:true,cancelledNeverSent:true};
 receipt.checks.attachments={actualCsvReadToolId:csvTool.id,hiddenFinalTail:true,fullFileDigest:true,nativeLocalImage:true,actualImageAnswer:true,imageInputSha256:sha(png),finalMessageId:secondFinal.params.item.id,finalMessagePhase:secondFinal.params.item.phase,finalThreadId:secondFinal.params.threadId,finalTurnId:secondFinal.params.turnId,canonicalContainsExactFinal:true};

 // No browser page exists now. Only production server's real wall-clock timer
 // admits this one-off occurrence; there is no injected clock or manual tick.
 const scheduleMarker='SCHEDULE_DONE_'+randomUUID().replaceAll('-','');const scheduleCommand=nodeCommand('console.log('+JSON.stringify(scheduleMarker)+')');allowedCommands.add(scheduleCommand);
 const dueAt=new Date(Date.now()+10000).toISOString();
 const scheduleBody={requestId:randomUUID(),title:'Owned wall-clock acceptance',enabled:true,rule:{kind:'once',at:dueAt,timeZone:'Europe/Amsterdam'},payload:{text:'Execute exactly this native terminal command once: '+scheduleCommand+'\nUse no other tools or permissions. Then reply only '+scheduleMarker+'.'}};
 const schedule=await post(baseRoute+'/schedules',scheduleBody,201);assert.deepEqual(await post(baseRoute+'/schedules',scheduleBody,201),schedule);receipt.schedule={...schedule,dueAt,noUiPage:true,clock:'production wall clock'};
 const preDue=await snapshot('schedule-before-due');assert.equal(preDue.runs.length,2);assert.ok(!preDue.queue.some(q=>q.source.scheduleId===schedule.schedule.id));
 const dueQueue=await poll(async()=>{const s=await snapshot();await serviceApprovals(s);const matches=s.queue.filter(q=>q.source.scheduleId===schedule.schedule.id);assert.ok(matches.length<=1);if(!matches.length)return null;assert.ok(Date.now()>=Date.parse(dueAt));assert.ok(Date.parse(matches[0].createdAt)>=Date.parse(dueAt));assert.ok(!['blocked','failed','interrupted'].includes(matches[0].status),JSON.stringify(matches[0]));return matches[0].runId?matches[0]:null;},{label:'server timer admits and dispatches one actual due occurrence'});
 const dueResult=await completed(dueQueue.runId);assert.ok(dueResult.answer.includes(scheduleMarker));assert.ok(nativeCommands(dueResult.state,dueQueue.runId).some(t=>String(t.output).includes(scheduleMarker)));
 await poll(async()=>{const s=await snapshot();return s.schedules.find(x=>x.id===schedule.schedule.id)?.lastResult==='completed';},{timeout:10000,label:'actual schedule result history'});
 await delay(2200);const final=await snapshot('final-canonical');const persistedSchedule=final.schedules.find(x=>x.id===schedule.schedule.id);assert.equal(persistedSchedule.status,'completed');assert.equal(persistedSchedule.lastRunId,dueQueue.runId);assert.equal(final.runs.length,3);assert.equal(turns.length,3);assert.equal(final.queue.filter(q=>q.source.scheduleId===schedule.schedule.id).length,1);assert.equal(final.runs.filter(r=>r.workflowQueueId===dueQueue.id).length,1);
 receipt.checks.scheduler={dueAt,admittedAt:dueQueue.createdAt,runId:dueQueue.runId,occurrenceKey:dueQueue.source.occurrenceKey,noBrowserPage:true,realWallClock:true,exactlyOneOccurrence:true,actualNativeEffect:true,completedHistory:true};
 receipt.runIds=final.runs.map(r=>r.id);
 // Snapshot the durable production record without publishing its raw owner token.
 const internal=[...handler.store.states.values()].find(s=>s.conversationId===conversationId);const {owner:ignoredOwner,...durable}=internal;await artifact('durable-state-owner-redacted.json',durable);
 assert.deepEqual(await sourceHashes(),receipt.sourceHashes,'Production source changed during installed proof; repeat against final frozen source');
 receipt.status='passed';process.stdout.write('PASS installed default model: real busy FIFO, hidden CSV tail + digest, native image pixels, wall-clock schedule with browser closed\n');
}catch(error){receipt.status='failed';receipt.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;process.stderr.write('FAIL installed workflows proof: '+error.message+'\n');}
finally{
 if(handler){try{await snapshot('before-cleanup');const internal=[...handler.store.states.values()].find(s=>s.conversationId===conversationId);if(internal){const {owner:ignoredOwner,...durable}=internal;await artifact('durable-state-owner-redacted.json',durable);}}catch(error){receipt.finalEvidenceError=error.message;}}
 if(handler){try{const s=[...handler.store.states.values()].find(s=>s.conversationId===conversationId);for(const run of s?.runs??[])if(!terminal.has(run.status))await handler.runtime.cancel(s.owner,run.id);}catch(error){receipt.cancelCleanupError=error.message;}}
 try{await handler?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}receipt.cleanup={ownedServerClosed:true,ownedRuntimeChildrenClosed:true,ownedBrowserClosed:true};}catch(error){receipt.cleanup={error:error.message};receipt.status='failed';process.exitCode=1;}
 receipt.finishedAt=new Date().toISOString();receipt.artifacts={snapshots,turns:'native-turn-start.json',notifications:'native-notifications.json',http:'http-receipts.json',durableState:'durable-state-owner-redacted.json',privateRuntime:'private-runtime (contains local ownership secret; retain privately, never publish)'};
 await mkdir(output,{recursive:true,mode:0o700});await artifact('native-turn-start.json',turns);await artifact('native-notifications.json',notifications);await artifact('http-receipts.json',httpReceipts);await artifact('receipt.json',receipt);process.stdout.write('Receipt: '+path.join(output,'receipt.json')+'\n');
}

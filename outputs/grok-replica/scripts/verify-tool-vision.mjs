// Run explicitly with node --env-file-if-exists=.env scripts/verify-tool-vision.mjs.
// Uses real runtime, MCP, owned Chromium and configured provider. Never reads .env.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {createModelProvider} from '../harness/model-provider.mjs';
import {createHarnessHandler} from '../harness/http.mjs';
import {createGrokToolHost} from '../harness/grok-tool-host.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=fileURLToPath(new URL('../tests/fixtures/tool-image-mcp.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const records=new Map();
let stage='initialization',firstFailure;
function noteFailure(error){
 const match=/verify-tool-vision\.mjs:(\d+):(\d+)/.exec(error?.stack??'');
 firstFailure??={sourceLine:match?Number(match[1]):null,code:/^[A-Z0-9_]+$/.test(error?.code??'')?error.code:'TOOL_VISION_PROBE_FAILED'};
}
function failureProof(error){
 noteFailure(error);
 return {status:'failed',stage,...firstFailure,records:[...records].map(([id,row])=>({id,effects:row.effects,rounds:row.rounds,messages:row.messages,nativePixels:row.nativePixels===true,...(row.runStatus?{runStatus:row.runStatus}:{}),...(row.runCode?{runCode:row.runCode}:{}),...(row.answerChecks?{answerChecks:row.answerChecks}:{})})),message:'Real tool vision proof did not pass. Provider responses, canvas words and credentials are withheld.'};
}
function canvasDocument(text){
 const codes=[...text].map(char=>char.charCodeAt(0));
 return `<!doctype html><meta charset="utf-8"><title>Observation</title><style>html,body{margin:0;background:blue}canvas{display:block}</style><canvas width="1280" height="800"></canvas><script>const c=document.querySelector('canvas').getContext('2d');c.fillStyle='blue';c.fillRect(0,0,1280,800);c.fillStyle='white';c.font='bold 64px Arial';c.fillText(String.fromCharCode(${codes.join(',')}),60,400);document.currentScript.remove();</script>`;
}
async function restrictedHost(options){
 const record=records.get(options.conversationId);assert.ok(record,'Only probe conversations may connect');
 const host=await createGrokToolHost({...options,customServers:record.kind==='mcp'?[{id:'observation',runtimeId:'custom_observation',command:process.execPath,args:[fixture]}]:[],accountServers:[]});
 try{
  assert.ok(!host.getDefinitions().some(tool=>tool.name==='Terminal'));
  const definition=host.getDefinitions().find(tool=>record.kind==='mcp'?tool.serverId==='custom_observation':tool.name==='browser_screenshot');
  assert.ok(definition,'Real tool discovery must succeed');assert.ok(!definition.requiresApproval);
  record.toolName=definition.name;
  if(record.kind==='browser'){
   await writeFile(path.join(options.workspace,'observation.html'),canvasDocument(record.expected));
   const url=options.baseUrl+'observation.html';
   const denied=await fetch(url);assert.equal(denied.status,404,'Owned preview requires the real bridge identity');
   const opened=await host.call('browser_open',{url});record.preloadCaptureId=opened.captureId;
   const snapshot=await host.call('browser_snapshot',{});
   assert.ok(!JSON.stringify(snapshot).includes(record.expected),'Canvas words must not appear in DOM snapshot');
   assert.equal(snapshot.text,'');record.domTextAbsent=true;
  }
  return {getDefinitions:()=>[structuredClone(definition)],inventory:()=>[{id:definition.serverId,state:'connected',tools:[structuredClone(definition)]}],
   async call(name,args,callOptions){
    try{
    assert.equal(name,record.toolName);assert.deepEqual(args,{});assert.equal(++record.effects,1,'Exactly one observation effect is allowed');
    const result=await host.call(name,args,callOptions);
    if(record.kind==='browser'){
     assert.notEqual(result.captureId,record.preloadCaptureId);record.captureId=result.captureId;
     const frame=host.frame(result.captureId);assert.equal(frame?.contentType,'image/png');assert.ok(frame.bytes.length>100);record.pixelSha=sha(frame.bytes);
    }
    return result;
    }catch(error){noteFailure(error);throw error;}
   },frame:host.frame,browserState:host.browserState,close:()=>host.close()};
 }catch(error){noteFailure(error);await host.close();throw error;}
}
function checkedProvider(provider){
 return {status:()=>provider.status(),async complete(input){
  try{
  const record=[...records.values()].find(row=>row.active);assert.ok(record);
  assert.deepEqual(input.tools.map(tool=>tool.name).sort(),['SendMessage',record.toolName].sort());
  const imageParts=input.messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(part=>part.type==='image_url'):[]);
  if(!record.rounds)assert.ok(!JSON.stringify(input.messages).includes(record.expected),'Expected words must never be supplied as context');
  if(record.effects){
   assert.equal(imageParts.length,1,'Actual tool pixels must reach the next provider request');
   const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageParts[0].image_url?.url??'');assert.ok(match);assert.equal(match[1],record.mediaType);
   assert.equal(sha(Buffer.from(match[2],'base64')),record.pixelSha,'Provider must receive the exact observed frame bytes');record.nativePixels=true;
  }
  const response=await provider.complete({...input,signal:AbortSignal.any([input.signal,AbortSignal.timeout(120000)])});
  record.rounds++;
  for(const call of response.toolCalls??[]){
   assert.ok([record.toolName,'SendMessage'].includes(call.name));
   if(call.name==='SendMessage'){assert.equal(record.effects,1);assert.equal(++record.messages,1);}
  }
  return response;
  }catch(error){noteFailure(error);throw error;}
 }};
}
async function startOwnedHarness(provider){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-tool-vision-live-'));let handler;
 const server=http.createServer((req,res)=>{
  Promise.resolve(handler?.handle(req,res)).then(handled=>{if(!handled&&!res.writableEnded)res.writeHead(404).end();}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
 });
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl='http://127.0.0.1:'+server.address().port;
  handler=await createHarnessHandler({root,dataDir,baseUrl,model:checkedProvider(provider),executor:{},workflowAutoStart:false,toolHostFactory:restrictedHost});
  const status=await fetch(baseUrl+'/api/harness/status'),cookie=status.headers.get('set-cookie').split(';')[0],csrf=(await status.json()).csrfToken;
  const owner=cookie.slice('grok_harness_owner='.length);
  async function post(route,body){
   const response=await fetch(baseUrl+'/api/harness'+route,{method:'POST',headers:{cookie,Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(response.status,202,'Real harness must accept the run');return response.json();
  }
  return {handler,dataDir,owner,post,async close(){
   try{await handler.close();}finally{server.closeAllConnections();try{await new Promise(resolve=>server.close(resolve));}finally{await rm(dataDir,{recursive:true,force:true});}}
  }};
 }catch(error){
  try{await handler?.close();}finally{server.closeAllConnections();try{await new Promise(resolve=>server.close(resolve));}finally{await rm(dataDir,{recursive:true,force:true});}}
  throw error;
 }
}
async function runProbe(app,id,record){
 stage=id+':before-connect';record.active=true;const started=performance.now();
 const c=await app.handler.runtime.connect(app.owner,id);stage=id+':after-connect';
 const prompt=`Call ${record.toolName} exactly once with empty arguments. Read the returned image pixels. Use exactly one SendMessage with text only containing exactly two lines: line 1 is the exact visible text from the pixels; line 2 is BACKGROUND=<English color in lowercase>, for example BACKGROUND=red for a red image. Do not include blank lines, Markdown, code fences, labels, or commentary. Do not guess from metadata. No other tools or actions.`;
 assert.ok(!prompt.includes(record.expected));
 stage=id+':before-post';
 const accepted=await app.post('/conversations/'+id+'/runs',{requestId:id,text:prompt});
 stage=id+':after-post';
 const job=app.handler.runtime.jobs.get(accepted.runId);assert.ok(job);
 const timer=setTimeout(()=>job.controller.abort(),120000);
 stage=id+':before-job';
 try{await job.promise;}finally{clearTimeout(timer);record.active=false;}
 stage=id+':after-job';
 const state=app.handler.store.get(app.owner,id),run=state.runs.find(row=>row.id===accepted.runId);
 record.runStatus=run.status;if(/^[A-Z0-9_]+$/.test(run.error?.code??''))record.runCode=run.error.code;
 stage=id+':check-completed';
 assert.equal(run.status,'completed','Real model task must finish');
 stage=id+':check-tool-counts';
 const tools=state.tools.filter(tool=>tool.runId===run.id);assert.equal(tools.length,2);
 assert.equal(tools.filter(tool=>tool.name===record.toolName&&tool.status==='completed').length,1);
 const delivery=tools.find(tool=>tool.name==='SendMessage');assert.equal(delivery?.status,'completed');
 stage=id+':check-answer';
 const answer=record.expected+'\nBACKGROUND=blue',rawAnswer=delivery.arguments.text.content;
 const lines=rawAnswer.split(/\r?\n/),nonempty=lines.filter(line=>line.trim());
 record.answerChecks={exactVisibleText:new RegExp('(?:^|[^A-Za-z0-9])'+record.expected+'(?:$|[^A-Za-z0-9])').test(rawAnswer),expectedFirstNonemptyLine:nonempty[0]===record.expected,backgroundBlueCaseInsensitive:nonempty.some(line=>/^BACKGROUND=blue$/i.test(line)),exactTwoNonemptyLines:nonempty.length===2,exactRawFormat:rawAnswer===answer,blanklineCount:lines.length-nonempty.length,allASCII:/^[\x00-\x7f]*$/.test(rawAnswer)};
 assert.equal(rawAnswer.trim(),answer);
 const entry=state.entries.find(row=>row.id===run.outputEntryId);assert.equal(entry.text.trim(),answer);assert.equal(entry.messages.length,1);assert.equal(entry.messages[0].content.trim(),answer);
 assert.equal(record.effects,1);assert.equal(record.messages,1);assert.equal(record.rounds,2);assert.equal(record.nativePixels,true);
 stage=id+':check-durable';
 const disk=await readFile(path.join(app.dataDir,'conversation-'+id+'.json'),'utf8');
 for(const durable of [JSON.stringify(state.agentHistory),JSON.stringify(state.tools),disk])assert.ok(!/data:image\/|"type":"image_url"|"data":"[A-Za-z0-9+/]{100}/.test(durable),'No inline pixel bytes may enter durable receipts/history');
 if(record.kind==='browser'){assert.ok(c.host.frame(record.captureId));assert.equal(record.domTextAbsent,true);}
 stage=id+':after-checks';
 return {kind:record.kind,mediaType:record.mediaType,toolEffects:record.effects,sendMessages:record.messages,modelRequests:record.rounds,nativePixels:true,pixelSha256:record.pixelSha,answerSha256:sha(answer),durationMs:Math.round(performance.now()-started),...(record.kind==='browser'?{actualOwnedChromiumFrame:true,canvasWordsAbsentFromDOM:true,previewBridgeAuthenticated:true}:{actualStdioMcp:true})};
}
async function main(){
 const provider=createModelProvider(),status=await provider.status();
 if(status.state!=='ready')throw Object.assign(new Error('Provider unavailable'),{code:'MODEL_NOT_CONFIGURED'});
 const jpeg=await readFile(new URL('../tests/fixtures/model-attachments/vision.jpeg',import.meta.url));
 records.set('probe-mcp',{kind:'mcp',mediaType:'image/jpeg',expected:'BLUE FOX 472',pixelSha:sha(jpeg),effects:0,messages:0,rounds:0});
 records.set('probe-browser',{kind:'browser',mediaType:'image/png',expected:'CANVAS '+randomBytes(4).toString('hex').toUpperCase(),effects:0,messages:0,rounds:0});
 const app=await startOwnedHarness(provider);
 try{
  const proofs=[];for(const [id,record]of records)proofs.push(await runProbe(app,id,record));
  console.log(JSON.stringify({status:'passed',scriptedModel:false,provider:status.provider,model:status.model,rawPixelsPersisted:false,proofs},null,2));
 }finally{await app.close();}
}
try{await main();}catch(error){console.error(JSON.stringify(failureProof(error)));process.exitCode=1;}

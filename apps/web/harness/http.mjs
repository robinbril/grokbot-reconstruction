import {transcriptWindowContext} from './transcript-window.mjs';
import {DeviceSessions} from './device-sessions.mjs';
import {createDeviceSessionsHandler} from './device-sessions-http.mjs';
import {createConversationHistory} from './conversation-history.mjs';
import {createConversationHistoryHandler} from './conversation-history-http.mjs';
import {SkillRegistry} from './skills.mjs';
import {CanvasStore} from './canvas-store.mjs';
import {createCanvasHandler} from './canvas-http.mjs';
import {resolveIncomingReply} from './incoming-replies.mjs';
import {OAuthAccounts} from './identity/oauth-accounts.mjs';
import {AccessControl} from './access/index.mjs';
import {createAccountProxy} from './account-proxy.mjs';
import {createIdentityHandler} from './identity-http.mjs';
import {bindConversationBot,revalidateBoundConnections,invalidateBotConnections} from './runtime-accounts.mjs';
import {validateMcpServer} from './mcp-server-validation.mjs';
import path from 'node:path';
import { readFile, stat, mkdir, open } from 'node:fs/promises';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { HarnessStore, harnessError, identifier } from './store.mjs';
import {GrokRuntime,requestReceipt} from './grok-runtime.mjs';
import {createModelProvider} from './model-provider.mjs';
import {createGrokToolHost} from './grok-tool-host.mjs';
import {createGrokExecutor} from './grok-executor.mjs';
import { resolveWorkspacePath } from './workspace-tools.mjs';
import {browserToolDefinitions} from './browser-tools.mjs';
import {validateArguments} from './grok-turns.mjs';
import {AttachmentStore} from './attachments.mjs';
import {prepareModelAttachmentsBeforeAcceptance as prepareModelAttachments} from './model-attachment-input.mjs';
import {createAttachmentHandler} from './attachment-http.mjs';
import {WorkflowEngine,normalizeWorkflowPayload} from './workflows.mjs';
import {createWorkflowHandler} from './workflow-http.mjs';
import {openEventStream} from './event-stream.mjs';
import {acquireDataDirLock} from './data-dir-lock.mjs';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const safeEqual=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}
async function body(req,maxBytes=131072){const chunks=[];let bytes=0;if(req.headers['content-type']?.split(';')[0]!=='application/json')throw harnessError('INVALID_CONTENT_TYPE','Use application/json',415);for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBytes)throw harnessError('BODY_TOO_LARGE',maxBytes===131072?'Request body exceeds 128 KiB':'Skill import body exceeds 8 MiB',413);chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw harnessError('INVALID_JSON','Expected a JSON object');}}
const requestId=b=>{if(!identifier(b.requestId))throw harnessError('INVALID_REQUEST_ID','A bounded requestId is required');};
function validId(id){if(!identifier(id))throw harnessError('INVALID_ID','Invalid identifier');return id;}
export async function createHarnessHandler(options={}) {
 const {root}=options;if(!root)throw Error('root is required');
 const dataDir=path.resolve(options.dataDir??process.env.HARNESS_DATA_DIR??path.join(root,'.harness-runtime'));
 const lease=await acquireDataDirLock(dataDir);
 try{const handler=await createUnlockedHarnessHandler({...options,dataDir});let closing;const close=handler.close;
 handler.close=()=>closing??=(async()=>{try{await close();}finally{await lease.release();}})();return handler;
 }catch(e){await lease.release();throw e;}
}
async function createUnlockedHarnessHandler({root,dataDir,baseUrl,model,toolHostFactory,executor,providerEnv,maxChildren,idleMs,workflowClock,workflowAutoStart=true,runtimeFactory=options=>new GrokRuntime(options)}={}) {
 if(typeof runtimeFactory!=='function')throw new TypeError('runtimeFactory must be a function');
 if(!root)throw Error('root is required');root=path.resolve(root);dataDir=path.resolve(dataDir);await mkdir(dataDir,{recursive:true,mode:0o700});let secret;try{secret=await readFile(path.join(dataDir,'owner-secret'));}catch(e){if(e.code!=='ENOENT')throw e;secret=randomBytes(32);const f=await open(path.join(dataDir,'owner-secret'),'wx',0o600);try{await f.writeFile(secret);await f.sync();}finally{await f.close();}}
 const store=await new HarnessStore({dataDir}).init();let origin=baseUrl?new URL(baseUrl).origin:null;const runtime=runtimeFactory({root,store,baseUrl:origin,model:model??createModelProvider(),executor:executor??createGrokExecutor(),maxChildren,idleMs,toolHostFactory:toolHostFactory??(options=>createGrokToolHost(options))});const attachments=await new AttachmentStore({dataDir,store}).init();runtime.attachments=attachments;const skills=await new SkillRegistry({dataDir}).init();runtime.skills=skills;const workflows=await new WorkflowEngine({store,runtime,attachments,clock:workflowClock,autoStart:false}).init();const attachmentHandle=createAttachmentHandler({attachments}),workflowHandle=createWorkflowHandler({workflows,store,json,body});if(workflowAutoStart){workflows.autoStart=true;workflows.timer=setInterval(()=>workflows.tick().catch(()=>{}),1000);workflows.timer.unref();setImmediate(()=>workflows.tick().catch(()=>{}));}const canvases=new CanvasStore({store}),canvasHandle=createCanvasHandler({canvases,json,body});const streams=new Set();const csrf=owner=>createHmac('sha256',secret).update(owner).digest('hex');
 const sessions=await new DeviceSessions({dataDir}).init(),history=createConversationHistory({store});
 const setDeviceCookie=(res,token)=>res.setHeader('Set-Cookie',`grok_harness_owner=${token}; HttpOnly; SameSite=Strict; Path=/api/harness${origin?.startsWith('https:')?'; Secure':''}`);
 const deviceHandle=createDeviceSessionsHandler({sessions,json,body,setCookie:setDeviceCookie,csrf,canReplaceOwner:async owner=>{if([...store.states.values()].some(state=>state.owner===owner)||skills.list(owner).skills.length)return false;const identity=await identities(),access=await identity.access.overview(owner);return !identity.accounts.list(owner).length&&!identity.accounts.storage.data.flows.some(flow=>flow.owner===owner)&&!access.teams.length&&!access.bots.length;},onRevoke:()=>{for(const stream of [...streams])stream.end();}});
 const historyHandle=createConversationHistoryHandler({history,json,body,decoratePage:(page,owner,id)=>({...page,context:transcriptWindowContext(store.get(owner,id),page.entries)})});

 let identityReady;
 async function identities(){
  return identityReady??=(async()=>{
   const accounts=await new OAuthAccounts({dataDir,baseUrl:origin,providerEnv}).init();
   const access=await new AccessControl({dataDir,accountLookup:async id=>{try{return accounts.getInternalAccount(id);}catch(e){if(e.status===404)return undefined;throw e;}}}).init();
   const proxy=createAccountProxy({accounts,access,runtime});
   const identityHttp=createIdentityHandler({accounts,access,proxy,json,body,baseUrl:origin,revalidate:()=>revalidateBoundConnections(runtime),invalidateBot:id=>invalidateBotConnections(runtime,id)});
   return {accounts,access,proxy,...identityHttp};
  })();
 }
 runtime.resolveAccounts=async(owner,state)=>state.botId?(await identities()).access.botBindings(owner,state.botId):[];
 async function identity(req,res){const raw=(req.headers.cookie??'').split(';').map(value=>value.trim()).find(value=>value.startsWith('grok_harness_owner='))?.slice(19);const session=await sessions.resolve(raw);if(session.changed)setDeviceCookie(res,session.token);return session;}
 async function handle(req,res){let url;try{url=new URL(req.url??'/','http://127.0.0.1');}catch{return false;}if(!url.pathname.startsWith('/api/harness'))return false;try{const host=req.headers.host;const address=req.socket.localAddress;if(!origin){if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))throw harnessError('INVALID_HOST','Localhost is required',403);origin=`http://127.0.0.1:${req.socket.localPort}`;runtime.baseUrl=origin;}if(host!==new URL(origin).host)throw harnessError('INVALID_HOST','Unexpected Host header',403);const previewRequest=url.pathname.match(/^\/api\/harness\/conversations\/([A-Za-z0-9_-]+)\/preview\//);const previewAuthorized=previewRequest&&[...runtime.bridges.values()].some(c=>c.id===previewRequest[1]&&safeEqual(req.headers['x-harness-bridge'],c.token));if(req.headers.origin&&req.headers.origin!==origin&&!previewAuthorized&&!(req.method==='GET'&&url.pathname==='/api/harness/oauth/callback'))throw harnessError('INVALID_ORIGIN','Same origin is required',403);
 if(url.pathname==='/api/harness/health'){
  if(req.method!=='GET')throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);
  json(res,200,{schema:1,application:'grokbot-reconstruction'});return true;
 }
 if(req.method==='GET'&&url.pathname==='/api/harness/oauth/callback')return (await identities()).callback(req,res,url);
 if(/^\/api\/harness\/internal\/[^/]+\/accounts\//.test(url.pathname))return (await identities()).proxy.handle(req,res,url);
 const internal=url.pathname.match(/^\/api\/harness\/internal\/([A-Za-z0-9_-]+)\/tools\/(list|call)$/);if(internal){const c=runtime.bridges.get(internal[1]);if(!c||!safeEqual(req.headers.authorization,`Bearer ${c.token}`))throw harnessError('UNAUTHORIZED','Bridge authorization required',401);if(internal[2]==='list'&&req.method==='GET'){json(res,200,{schema:1,tools:c.tools.listTools()});return true;}if(internal[2]==='call'&&req.method==='POST'){const controller=new AbortController();req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});const b=await body(req);if(typeof b.name!=='string'||!b.arguments||typeof b.arguments!=='object')throw harnessError('INVALID_TOOL_CALL','Tool name and arguments required');json(res,200,{schema:1,result:await runtime.callTool(c,b.name,b.arguments,{signal:controller.signal})});return true;}throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);}
 const session=await identity(req,res),owner=session.owner;const mutation=!['GET','HEAD'].includes(req.method);if(mutation){if(req.headers.origin!==origin)throw harnessError('INVALID_ORIGIN','Same origin is required',403);if(!safeEqual(req.headers['x-harness-csrf'],csrf(owner)))throw harnessError('INVALID_CSRF','Valid CSRF token required',403);}
 if(await deviceHandle(req,res,{session,url}))return true;
 if(mutation)await sessions.claimOwner(session.token);
 if(req.method==='GET'&&url.pathname==='/api/harness/conversations'){json(res,200,{...await history.catalog(owner),...sessions.publicSession(session),csrfToken:csrf(owner)});return true;}
 const skillRoute=url.pathname.match(/^\/api\/harness\/skills(?:\/([^/]+))?$/);if(skillRoute){if(req.method==='GET'&&!skillRoute[1]){json(res,200,skills.list(owner));return true;}if(req.method==='POST'){const importing=skillRoute[1]==='import',input=await body(req,importing?8*1024*1024:131072);json(res,importing||!skillRoute[1]?201:200,importing?await skills.import(owner,input):skillRoute[1]?await skills.update(owner,skillRoute[1],input):await skills.create(owner,input));return true;}throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);}
 if(/^\/api\/harness\/(accounts|access|bots|teams)(\/|$)/.test(url.pathname)&&await (await identities()).handle(req,res,{owner,url}))return true;
 if(req.method==='GET'&&url.pathname==='/api/harness/status'){json(res,200,{schema:1,...sessions.publicSession(session),csrfToken:csrf(owner),runtime:await runtime.status(),capabilities:{chat:true,approvals:true,cancel:true,history:true,terminalOutput:true,browserFrames:true,mcpInventory:true,queue:true,schedules:true,attachments:true,canvases:true,cloudHistory:true,devicePairing:true}});return true;}
 let m=url.pathname.match(/^\/api\/harness\/conversations\/([^/]+)(?:\/(.*))?$/);if(m){const id=validId(m[1]);const route=m[2]??'';const previewMatch=route.match(/^preview\/(.*)$/);const previewConnection=previewMatch?[...runtime.bridges.values()].find(c=>c.id===id&&safeEqual(req.headers['x-harness-bridge'],c.token)):null;const s=previewConnection?store.states.get(id):store.get(owner,id);if(previewMatch&&req.method==='GET'){const c=runtime.connections.get(id)??[...runtime.bridges.values()].find(c=>c.id===id);const bridgeOK=c&&safeEqual(req.headers['x-harness-bridge'],c.token);if(!bridgeOK&&!s)throw harnessError('NOT_FOUND','Workspace not found',404);const state=bridgeOK?store.states.get(id):s;if(!state)throw harnessError('NOT_FOUND','Workspace not found',404);let target;try{target=await resolveWorkspacePath(state.workspaceRoot,decodeURIComponent(previewMatch[1]||'index.html'));}catch{throw harnessError('NOT_FOUND','Preview file not found',404);}const type=types[path.extname(target).toLowerCase()];const info=await stat(target);if(!type||!info.isFile()||info.size>4*1024*1024)throw harnessError('NOT_FOUND','Preview file not found',404);res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"});res.end(await readFile(target));return true;}
 if(await historyHandle(req,res,{owner,conversationId:id,route,url}))return true;
 if(await canvasHandle(req,res,{owner,conversationId:id,route}))return true;
 if(await attachmentHandle(req,res,{owner,conversationId:id,route}))return true;
 if(await workflowHandle(req,res,{owner,conversationId:id,route}))return true;
 if(req.method==='GET'&&route===''){await runtime.refreshInventory(owner,id);const current=store.get(owner,id);const result=current?store.snapshot(current):{schema:1,conversationId:id,workspaceRoot:path.join(dataDir,'workspaces',id),entries:[],runs:[],tools:[],browserSessions:[],terminalSessions:[],queue:[],schedules:[],workflow:{nextSequence:0,hold:null},lastSeq:0,persistedAt:null};if(current&&url.searchParams.has('historyLimit')){const page=await history.page(owner,id,{limit:Number(url.searchParams.get('historyLimit')),...(url.searchParams.has('unreadAfterSeq')?{unreadAfterSeq:Number(url.searchParams.get('unreadAfterSeq'))}:{})});result.entries=page.entries;Object.assign(result,transcriptWindowContext(current,page.entries));const {entries,...metadata}=page;result.historyPage=metadata;}json(res,200,result);return true;}
 if(req.method==='GET'&&route==='tools'){await runtime.refreshInventory(owner,id);json(res,200,{schema:1,servers:store.get(owner,id)?.servers??[]});return true;}
 const frame=route.match(/^browser\/frames\/([^/]+)$/);if(frame&&req.method==='GET'){if(!s)throw harnessError('NOT_FOUND','Conversation not found',404);const c=runtime.connections.get(id);const result=c?.tools.frame(validId(frame[1]));if(!result)throw harnessError('NOT_FOUND','Frame expired or unavailable; capture a new frame',404);res.writeHead(200,{'Content-Type':result.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(result.bytes);return true;}
 if(req.method==='POST'){const b=await body(req);requestId(b);if(route==='bot'){const result=await bindConversationBot(runtime,owner,id,b);json(res,200,result);return true;}if(route==='connect'){const c=await runtime.reconnect(owner,id);json(res,200,{...store.snapshot(store.get(owner,id)),runtime:c.metadata});return true;}
 if(route==='runs'){if((b.attachments&&(!Array.isArray(b.attachments)||b.attachments.length))||b.files)throw harnessError('ATTACHMENTS_UNSUPPORTED','Live v1 does not accept attachments. Keep the attachment and draft.',422);normalizeWorkflowPayload(b);if(typeof b.text!=='string'||(!b.text.trim()&&!b.attachmentRefs?.length&&!b.skillRefs?.length)||b.text.length>32768)throw harnessError('INVALID_TEXT','Prompt must contain text or ready attachments');if(b.quote!==undefined&&typeof b.quote!=='string')throw harnessError('INVALID_CONTEXT','Quote must be text');if(b.skillReferences!==undefined&&(!Array.isArray(b.skillReferences)||b.skillReferences.length>20||b.skillReferences.some(v=>typeof v!=='string'||v.length>2000)))throw harnessError('INVALID_CONTEXT','Skill references must be bounded text');if(requestReceipt(store.get(owner,id),'model',b.requestId)){json(res,202,await runtime.start(owner,id,b));return true;}resolveIncomingReply(store.get(owner,id),b.replyToId);if(b.attachmentRefs!==undefined)b.attachmentMetadata=(await prepareModelAttachments(attachments,owner,id,b.attachmentRefs)).attachments;json(res,202,await runtime.start(owner,id,b));return true;}
 if(route==='terminal'){if(typeof b.command!=='string'||!b.command.trim()||b.command.length>16384)throw harnessError('INVALID_COMMAND','Command must contain 1–16384 characters');json(res,202,await runtime.terminal(owner,id,b.command,b.requestId));return true;}
 const stop=route.match(/^terminal\/([^/]+)\/stop$/);if(stop){json(res,200,await runtime.stopTerminal(owner,id,validId(stop[1])));return true;}
 if(route==='browser'){const definition=browserToolDefinitions.find(tool=>tool.name===b.action);if(!definition||!b.arguments||typeof b.arguments!=='object'||Array.isArray(b.arguments))throw harnessError('INVALID_BROWSER_ACTION','Use a supported browser tool and arguments');validateArguments(definition.inputSchema,b.arguments);const c=await runtime.connect(owner,id);const key='browser:'+b.requestId,hash=JSON.stringify({action:b.action,arguments:b.arguments});let prior;await store.transaction(owner,id,s=>{prior=requestReceipt(s,'browser',b.requestId);if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Browser request differs',409);return;}s.requests[key]={hash,status:'pending'};});if(prior){if(prior.response){json(res,200,prior.response);return true;}throw harnessError('EFFECT_UNCERTAIN','Prior browser action has no confirmed receipt; it was not resent',409);}let result;try{result=await runtime.callTool(c,b.action,b.arguments);}catch(e){throw harnessError('BROWSER_TOOL_FAILED',String(e.message).slice(0,2000),422);}const response={schema:1,result,session:c.tools.browserState()};await store.transaction(owner,id,s=>{s.requests[key]={hash,status:'completed',response};});json(res,200,response);return true;}
 if(route==='mcp-servers'){json(res,200,await runtime.register(owner,id,await validateMcpServer(b.server),b.requestId));return true;}
 const connector=route.match(/^mcp-servers\/([^/]+)\/(permissions|state)$/);if(connector){const runtimeId=validId(connector[1]);const payload=connector[2]==='state'?{enabled:b.enabled}:{disabledTools:b.disabledTools};json(res,200,await runtime.configureMcp(owner,id,runtimeId,connector[2],payload,b.requestId));return true;}
 }
 throw harnessError('NOT_FOUND','Endpoint not found',404);}
 m=url.pathname.match(/^\/api\/harness\/runs\/([^/]+)(?:\/(.*))?$/);if(m){const runId=validId(m[1]);const {state,run}=store.lookupRun(owner,runId);const route=m[2]??'';if(req.method==='GET'&&route===''){json(res,200,{schema:1,...run});return true;}if(req.method==='GET'&&route==='events'){const offset=Number(url.searchParams.get('after')??req.headers['last-event-id']??0);if(!Number.isSafeInteger(offset)||offset<0||offset>state.lastSeq)throw harnessError('INVALID_OFFSET','Invalid event replay offset');openEventStream({store,owner,conversationId:state.conversationId,res,after:offset,streams});return true;}if(req.method==='POST'){const b=await body(req);requestId(b);if(route==='cancel'){json(res,200,await runtime.cancel(owner,runId));return true;}const a=route.match(/^approvals\/([^/]+)\/decision$/);if(a){if(!['approve','reject'].includes(b.decision))throw harnessError('INVALID_DECISION','Expected approve or reject');json(res,200,await runtime.decide(owner,runId,validId(a[1]),b.decision));return true;}}}
 throw harnessError('NOT_FOUND','Endpoint not found',404);
 }catch(e){if(!res.headersSent)json(res,e.status??500,{error:{code:e.code??'INTERNAL_ERROR',message:e.status?e.message:'Harness operation failed',retryable:Boolean(e.retryable),...(e.accepted===false?{accepted:false}:{})}});else res.end();return true;}}
 return {handle,store,runtime,attachments,skills,canvases,workflows,identities,sessions,history,async close(){if(identityReady)(await identityReady).proxy.abortAll();for(const res of streams)res.end();await workflows.close();await runtime.close();await skills.tail;}};
}

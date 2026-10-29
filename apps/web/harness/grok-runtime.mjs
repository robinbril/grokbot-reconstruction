import {validateCanvasInput,resolveCanvasInput,pinnedCanvasInput,saveCanvasInput,canvasInputKey} from './canvas-context.mjs';
import {normalizeRichText,legacyRichTextReferences} from './rich-text.mjs';
import {validateMcpReferences} from './mcp-references.mjs';
import {normalizeSkillRefs} from './skills.mjs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {harnessError,identifier,activeStatuses,now,bounded,disconnectServers} from './store.mjs';
import {resolveAccountBindings,accountServers,verifyRuntimeAccounts,bindConversationBot,revalidateBoundConnections,invalidateBotConnections} from './runtime-accounts.mjs';
import {prepareModelAttachmentsBeforeAcceptance as prepareModelAttachments} from './model-attachment-input.mjs';
import {executeTurn,finishRun,validateArguments,deniedToolResult} from './grok-turns.mjs';
import {recordMessageDelivery} from './message-delivery.mjs';
import {toolResultReceipt} from './tool-result-images.mjs';
import {incomingReplyId,resolveIncomingReply} from './incoming-replies.mjs';
import {isBrowserInteractionApproval} from './browser-tools.mjs';
const uid=()=>randomUUID();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptyHost=()=>({getDefinitions:()=>[],call:async()=>{throw harnessError('UNKNOWN_TOOL','No tool host is configured',422);},close:async()=>{}});
function recordToolDenial(state,emit,approval,definition){
 const tool={id:uid(),callId:approval.callId,runId:approval.runId,name:approval.operation.name,arguments:approval.operation.arguments,source:'grok-bot-harness',serverId:definition?.serverId??'grok_workspace',approvalId:approval.id,status:'failed',output:toolResultReceipt(deniedToolResult(approval)),startedAt:approval.createdAt,finishedAt:now()};
 const running=approval.kind==='browser.interaction'&&state.tools.findLast(item=>item.runId===approval.runId&&item.callId===approval.callId&&item.name===tool.name&&item.status==='running');
 if(running){Object.assign(running,{approvalId:tool.approvalId,status:tool.status,output:tool.output,finishedAt:tool.finishedAt});emit('tool.failed',{tool:running},approval.runId);}
 else{state.tools.push(tool);state.runs.find(run=>run.id===approval.runId).tools.push(tool.id);emit('tool.failed',{tool},approval.runId);}
}
export class GrokRuntime{
 constructor({root,store,baseUrl,model,toolHostFactory,executor,skills,maxSteps=64,maxChildren=6,idleMs=900000}={}){
  Object.assign(this,{root,store,baseUrl,model,toolHostFactory,executor,skills,maxSteps,maxChildren,idleMs});if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>128)throw new Error('maxSteps must be between 1 and 128');
  this.browserCalls=new WeakMap();this.connections=new Map();this.connecting=new Map();this.dropping=new Map();this.bridges=new Map();this.lifecycle=new Map();this.jobs=new Map();this.closed=false;this.capacityReservations=new Set();this.capacityTail=Promise.resolve();
  if(!Number.isInteger(maxChildren)||maxChildren<1)throw new Error('maxChildren must be positive');
  this.reaper=setInterval(()=>this.reapIdle().catch(()=>{}),Math.min(30000,Math.max(1000,idleMs)));this.reaper.unref();
 }
 active(id){return this.store.states.get(id)?.runs.find(r=>activeStatuses.has(r.status));}
 async status(){const metadata=this.model?.status?await this.model.status():{state:'unavailable',reason:'Configure a model provider on the server'};return {adapter:'grok-bot-harness',toolHost:'local',modelExecution:'cloud',...metadata};}
 async withLifecycle(id,fn){const prior=this.lifecycle.get(id)??Promise.resolve(),task=prior.catch(()=>{}).then(fn);this.lifecycle.set(id,task);try{return await task;}finally{if(this.lifecycle.get(id)===task)this.lifecycle.delete(id);}}
 async verify(c){return verifyRuntimeAccounts(this,c.owner,c.id,c);}
 async connect(owner,id){
  this.store.get(owner,id);if(this.closed)throw harnessError('RUNTIME_DISCONNECTED','Runtime is closed',503);
  if(this.dropping.has(id))await this.dropping.get(id);if(this.connections.has(id)){const c=this.connections.get(id);await this.verify(c);c.lastUsed=Date.now();return c;}if(this.connecting.has(id))return this.connecting.get(id);
  const job=this.initialize(owner,id);this.connecting.set(id,job);try{return await job;}finally{this.connecting.delete(id);}
 }
 idleConnection(c,{ignoreLifecycle=false}={}){return this.connections.get(c.id)===c&&!c.cleanupPromise&&!this.active(c.id)&&!this.connecting.has(c.id)&&(!this.lifecycle.has(c.id)||ignoreLifecycle)&&!c.toolControllers.size&&!c.terminals.size&&!c.pendingApprovals.size&&!c.configuringMcp&&!c.materializing&&!this.store.states.get(c.id)?.terminalSessions.some(t=>t.status==='running');}
 async evictIdle(c,{expired=false}={}){return this.withLifecycle(c.id,async()=>{if(!this.idleConnection(c,{ignoreLifecycle:true})||(expired&&Date.now()-c.lastUsed<this.idleMs))return false;await this.drop(c.id,c);return true;});}
 async reapIdle(){for(const c of this.connections.values())if(this.idleConnection(c)&&Date.now()-c.lastUsed>=this.idleMs)await this.evictIdle(c,{expired:true});}
 async reserveCapacity(id){const task=this.capacityTail.catch(()=>{}).then(async()=>{while(new Set([...this.connections.keys(),...this.capacityReservations]).size>=this.maxChildren){const candidates=[...this.connections.values()].filter(c=>c.id!==id&&this.idleConnection(c)).sort((a,b)=>a.lastUsed-b.lastUsed);let evicted=false;for(const c of candidates)if(await this.evictIdle(c)){evicted=true;break;}if(!evicted)throw harnessError('RUNTIME_CAPACITY','All runtime slots are busy with active work',503,true);}this.capacityReservations.add(id);});this.capacityTail=task.catch(()=>{});return task;}
 async initialize(owner,id){await this.reserveCapacity(id);try{return await this.initializeReserved(owner,id);}finally{this.capacityReservations.delete(id);}}
 async initializeReserved(owner,id){
  await this.store.transaction(owner,id,()=>{});const state=this.store.get(owner,id);await mkdir(path.join(state.workspaceRoot,'.tmp'),{recursive:true,mode:0o700});
  const c={owner,id,handle:randomBytes(24).toString('hex'),token:randomBytes(32).toString('hex'),lastUsed:Date.now(),pendingApprovals:new Map(),decisionJobs:new Map(),toolControllers:new Map(),terminals:new Map(),queue:Promise.resolve()};
  c.accountBindings=await resolveAccountBindings(this,owner,state);c.accountServers=accountServers(this,c,c.accountBindings);c.accountIds=c.accountBindings.map(binding=>binding.accountId);this.bridges.set(c.handle,c);
  try{
   const preview=`${this.baseUrl}/api/harness/conversations/${id}/preview/`;
   const authorizeLocalUrl=value=>{try{const target=new URL(value),allowed=new URL(preview);return target.origin===allowed.origin&&target.pathname.startsWith(allowed.pathname)?{headers:{'x-harness-bridge':c.token}}:false;}catch{return false;}};
   c.host=this.toolHostFactory?await this.toolHostFactory({runtime:this,c,state,owner,conversationId:id,workspace:state.workspaceRoot,baseUrl:preview,authorizeLocalUrl,connection:c,customServers:state.customServers??[],accountServers:c.accountServers,authorizeInteraction:op=>this.interactionApproval(c,op),emit:(type,data)=>this.toolEmit(c,type,data)}):emptyHost();
   if(!c.host||typeof c.host.getDefinitions!=='function'||typeof c.host.call!=='function')throw harnessError('TOOL_HOST_INVALID','Tool host is unavailable',503);
   c.definitions=await c.host.getDefinitions();c.tools={listTools:()=>structuredClone(c.definitions),callTool:(name,args,options)=>c.host.call(name,args,options),frame:id=>c.host.frame?.(id),browserState:()=>c.host.browserState?.()??null,close:()=>c.host.close?.()};
   c.metadata={...await this.status(),state:'connected',workspaceRoot:state.workspaceRoot};this.connections.set(id,c);await this.refreshInventory(owner,id);return c;
  }catch(error){this.connections.delete(id);this.bridges.delete(c.handle);await c.host?.close?.();throw error;}
 }
 async reconnect(owner,id){return this.withLifecycle(id,async()=>{if(this.active(id))return this.connect(owner,id);await this.drop(id);return this.connect(owner,id);});}
 async refreshInventory(owner,id){const c=this.connections.get(id);if(!c)return this.store.get(owner,id)?.servers??[];await this.verify(c);const tools=await c.host.getDefinitions();c.definitions=tools;const servers=c.host.inventory?await c.host.inventory():[{id:'grok_workspace',name:'Grok tools',state:'connected',tools}];await this.store.transaction(owner,id,(s,emit)=>{s.servers=servers;emit('tools.changed',{servers});});return servers;}
 async start(owner,id,body){return this.withLifecycle(id,()=>this.startUnlocked(owner,id,body));}
 async startUnlocked(owner,id,body,{queueId,queuePayloadHash}={}){
  const queue=queueId?this.store.get(owner,id)?.queue?.find(row=>row.id===queueId):null;
  const {requestId,attachmentMetadata,...payload}=body;
  const internalQueue=queue&&identifier(queueId)&&queue.nativeRequestId===requestId&&queue.payloadHash===queuePayloadHash&&hash(payload)===queuePayloadHash;
  if(!identifier(body.requestId)&&!internalQueue)throw harnessError('INVALID_REQUEST_ID','Valid requestId required');
  if(queueId&&!internalQueue)throw harnessError('QUEUE_BINDING_CONFLICT','Queued execution must bind the exact stored payload',409);
  const skillRefs=normalizeSkillRefs(body.skillRefs);
  body={...body,...(skillRefs!==undefined?{skillRefs}:{})};
  if(typeof body.text!=='string'||body.text.length>32768||(!body.text.trim()&&!body.attachmentRefs?.length&&!skillRefs?.length))throw harnessError('INVALID_TEXT','Prompt text, attachments or selected skills required',422);
  if(body.quote!==undefined&&typeof body.quote!=='string')throw harnessError('INVALID_CONTEXT','Quote must be text',422);
  if(body.skillReferences!==undefined&&(!Array.isArray(body.skillReferences)||body.skillReferences.length>20||body.skillReferences.some(value=>typeof value!=='string'||value.length>2000)))throw harnessError('INVALID_CONTEXT','Skill references must be bounded text',422);
  const richText=normalizeRichText(body),legacySkillReferences=legacyRichTextReferences(body);
  const replyToId=incomingReplyId(body.replyToId);
  const digest=hash({text:body.text,...(richText!==undefined?{richText}:{}),quote:body.quote??null,skillReferences:body.skillReferences??null,...(skillRefs!==undefined?{skillRefs}:{}),...(body.attachmentRefs?.length?{attachmentRefs:body.attachmentRefs}:{}),...(replyToId!==undefined?{replyToId}:{})}),prior=requestReceipt(this.store.get(owner,id),'model',body.requestId);
  if(prior){if(prior.hash!==digest)throw harnessError('IDEMPOTENCY_CONFLICT','Request identifier already used for different input',409);return structuredClone(prior.response);}
  await validateMcpReferences(this,owner,id,richText);
  if(!internalQueue)await validateCanvasInput(this.store,owner,id,richText);
  if(skillRefs?.length){if(!this.skills)throw harnessError('SKILLS_UNAVAILABLE','Skill registry unavailable',503);this.skills.resolve(owner,skillRefs);}
  resolveIncomingReply(this.store.get(owner,id),replyToId);
  if((await this.status()).state!=='ready')throw harnessError('MODEL_NOT_CONFIGURED','Configure an available model provider on the server before sending a message',503,true);
  if(body.attachmentRefs?.length){if(!this.attachments)throw harnessError('ATTACHMENTS_UNAVAILABLE','Attachment store unavailable',503);await prepareModelAttachments(this.attachments,owner,id,body.attachmentRefs);}
  const c=await this.connect(owner,id);await this.verify(c);let response,run;
  await this.store.transaction(owner,id,async(s,emit)=>{
   await validateMcpReferences(this,owner,id,richText,s);
   if(this.active(id))throw harnessError('RUN_BUSY','A run is already active in this conversation',409);
   const replyTo=resolveIncomingReply(s,replyToId);
   const canvasInput=internalQueue?pinnedCanvasInput(s,canvasInputKey('queue',queueId),richText):resolveCanvasInput(s,richText);
   const createdAt=now(),inputEntryId=uid(),outputEntryId=uid(),runId=uid();run={id:runId,requestId:body.requestId,status:'accepted',inputEntryId,outputEntryId,tools:[],approvals:[],...(queueId?{workflowQueueId:queueId,workflowPayloadHash:queuePayloadHash}:{}),...(body.attachmentRefs?.length?{attachmentRefs:structuredClone(body.attachmentRefs)}:{})};
   saveCanvasInput(s,canvasInputKey('run',runId),canvasInput);
   s.entries.push({id:inputEntryId,role:'user',runId,text:body.text,...(richText!==undefined?{richText}:{}),...(legacySkillReferences.length?{legacySkillReferences}:{}),...(skillRefs?.length?{skillRefs,skills:this.skills.resolve(owner,skillRefs).map(({id,revision,name,description})=>({id,revision,name,description}))}:{}),revision:1,status:'completed',createdAt,...(replyTo?{replyTo}:{}),...(body.attachmentRefs?.length?{attachmentRefs:structuredClone(body.attachmentRefs),attachments:structuredClone(body.attachmentMetadata??[])}:{})},{id:outputEntryId,role:'assistant',runId,text:'',revision:0,status:'accepted',createdAt});s.runs.push(run);emit('run.accepted',{run},runId);
   response={schema:1,accepted:true,requestId:body.requestId,conversationId:id,runId,inputEntryId,outputEntryId,lastSeq:s.lastSeq,persistedAt:createdAt};s.requests['model:'+body.requestId]={hash:digest,response};
  });
  const controller=new AbortController(),job={controller,run,c};this.jobs.set(run.id,job);job.promise=new Promise(resolve=>setImmediate(resolve)).then(()=>executeTurn(this,c,run,body,controller)).finally(()=>this.jobs.delete(run.id));return response;
 }
 async streamMessage(c,runId,event){
  if(event?.type!=='message.delta'||typeof event.callId!=='string'||!event.callId||event.callId.length>200||typeof event.text!=='string'||!event.text)return;
  await this.store.transaction(c.owner,c.id,(s,emit)=>{const run=s.runs.find(r=>r.id===runId);if(!run||!activeStatuses.has(run.status)||run.cancelRequested)throw harnessError('MODEL_CANCELLED','Run no longer accepts output',499);const entry=s.entries.find(e=>e.id===run.outputEntryId);run.messageDrafts??=[];let draft=run.messageDrafts.find(d=>d.callId===event.callId);if(!draft){draft={callId:event.callId,text:'',status:'streaming'};run.messageDrafts.push(draft);}if(draft.status!=='streaming'||draft.text.length+event.text.length>131072)throw harnessError('MODEL_RESPONSE_INVALID','Invalid visible model stream',502);draft.text+=event.text;entry.messageDrafts=structuredClone(run.messageDrafts);entry.text=run.messageDrafts.map(d=>d.text).join('\n\n');entry.streaming=true;entry.delivery='partial';entry.revision++;emit('entry.updated',{entry},runId);});
 }
 async recordMessage(c,runId,call,options){return recordMessageDelivery(this,c,runId,call,options);}
 async callTool(c,name,args,{signal,runId=this.active(c.id)?.id??null,callId=uid(),definition}={}){
  await this.verify(c);c.lastUsed=Date.now();definition??=(await c.host.getDefinitions()).find(tool=>tool.name===name);if(!definition)throw harnessError('UNKNOWN_TOOL','Tool is not registered',422);validateArguments(definition.inputSchema,args);
  if(definition.requiresApproval&&!(await this.requestApproval(c,{runId,callId,kind:'tool.execution',operation:{name,arguments:args},signal})))throw harnessError('TOOL_DENIED','Tool execution was declined',403);
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;combined.throwIfAborted();const tool={id:uid(),callId,runId,name,arguments:args,source:'grok-bot-harness',serverId:definition.serverId??'grok_workspace',status:'running',startedAt:now()};c.toolControllers.set(controller,runId);
  await this.store.transaction(c.owner,c.id,(s,emit)=>{s.tools.push(tool);if(runId)s.runs.find(r=>r.id===runId).tools.push(tool.id);emit('tool.started',{tool},runId);});
  this.browserCalls.set(combined,{c,tool});
  try{const result=await c.host.call(name,args,{signal:combined,runId,callId});await this.store.transaction(c.owner,c.id,(s,emit)=>{const saved=s.tools.find(t=>t.id===tool.id);saved.status=result?.isError?'failed':'completed';saved.output=toolResultReceipt(result??null);saved.finishedAt=now();emit(saved.status==='failed'?'tool.failed':'tool.completed',{tool:saved},runId);});return result;}
  catch(error){await this.store.transaction(c.owner,c.id,(s,emit)=>{const saved=s.tools.find(t=>t.id===tool.id);saved.status='failed';saved.error=bounded(error.message,2000);saved.finishedAt=now();emit('tool.failed',{tool:saved},runId);});throw error;}finally{this.browserCalls.delete(combined);c.toolControllers.delete(controller);}
 }
 async requestApproval(c,{runId,callId,kind,operation,signal}){
  if(!runId||this.active(c.id)?.id!==runId)throw harnessError('APPROVAL_REQUIRED','An active run and explicit approval are required',409);
  const approval={id:uid(),runId,callId,kind,operation,status:'pending',createdAt:now()};let resolve;const decision=new Promise(r=>{resolve=r;});c.pendingApprovals.set(approval.id,{runId,resolve});
  await this.store.transaction(c.owner,c.id,(s,emit)=>{const run=s.runs.find(r=>r.id===runId);run.approvals.push(approval);run.status='waiting_approval';emit('approval.requested',{approval,run},runId);});
  const abort=()=>resolve(false);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await decision;}finally{signal?.removeEventListener('abort',abort);c.pendingApprovals.delete(approval.id);}
 }
 interactionApproval(c,op){
  const bound=this.browserCalls.get(op.signal),tool=bound?.tool;
  if(!isBrowserInteractionApproval(op)||bound?.c!==c||tool.name!==op.action||JSON.stringify(tool.arguments)!==JSON.stringify(op.arguments))throw harnessError('APPROVAL_REQUIRED','Browser approval must belong to the executing interaction',409);
  return this.requestApproval(c,{runId:tool.runId,callId:tool.callId,kind:'browser.interaction',operation:{name:tool.name,action:op.action,arguments:tool.arguments,pageUrl:op.pageUrl},signal:op.signal});
 }
 async decide(owner,runId,approvalId,decision){
  if(!['approve','reject'].includes(decision))throw harnessError('INVALID_DECISION','Invalid approval decision');const {state,run}=this.store.lookupRun(owner,runId),approval=run.approvals.find(a=>a.id===approvalId);
  if(approval?.status==='resolved'){if(approval.decision!==decision)throw harnessError('IDEMPOTENCY_CONFLICT','Approval decision differs',409);return {schema:1,acknowledged:true,approval};}
  const c=this.connections.get(state.conversationId),pending=c?.pendingApprovals.get(approvalId);if(!pending||approval?.status!=='pending'||!activeStatuses.has(run.status))throw harnessError('STALE_APPROVAL','Approval is no longer pending',409);
  const existing=c.decisionJobs.get(approvalId);if(existing){if(existing.decision!==decision)throw harnessError('IDEMPOTENCY_CONFLICT','Approval decision differs',409);return existing.promise;}
  const job={decision};c.decisionJobs.set(approvalId,job);job.promise=(async()=>{await this.store.transaction(owner,state.conversationId,(s,emit)=>{const saved=s.runs.find(r=>r.id===runId),a=saved.approvals.find(a=>a.id===approvalId);if(a.status!=='pending'||!activeStatuses.has(saved.status))throw harnessError('STALE_APPROVAL','Approval is no longer pending',409);a.status='resolved';a.decision=decision;a.resolvedAt=now();saved.status='running';if(decision==='reject'&&['tool.execution','browser.interaction'].includes(a.kind))recordToolDenial(s,emit,a,c.definitions.find(tool=>tool.name===a.operation.name));emit('approval.resolved',{approval:a},runId);});pending.resolve(decision==='approve');return {schema:1,acknowledged:true,approvalId};})();return job.promise;
 }
 async cancel(owner,runId){const {run}=this.store.lookupRun(owner,runId);if(!activeStatuses.has(run.status))return {schema:1,acknowledged:true,run};const job=this.jobs.get(runId);if(!job)throw harnessError('CANCEL_UNCONFIRMED','No active execution handle',409);job.run.cancelRequested=true;await this.store.transaction(owner,job.c.id,(s,emit)=>{const saved=s.runs.find(r=>r.id===runId);saved.cancelRequested=true;saved.status='cancelling';emit('run.cancel.requested',{run:saved},runId);});job.controller.abort();for(const [controller,bound]of job.c.toolControllers)if(bound===runId)controller.abort();return {schema:1,acknowledged:true,runId};}
 async toolEmit(c,type,data){if(type!=='browser.frame')return;await this.store.transaction(c.owner,c.id,(s,emit)=>{const session={id:data.id??'browser',...data,frameUrl:data.captureId?`/api/harness/conversations/${c.id}/browser/frames/${data.captureId}`:undefined};s.browserSessions=[session];emit(type,{session},this.active(c.id)?.id??null);});}
 async terminal(owner,id,command,requestId){
  if(!this.executor?.start)throw harnessError('TERMINAL_UNAVAILABLE','Independent sandboxed terminal executor is not configured',503);if(!identifier(requestId))throw harnessError('INVALID_REQUEST_ID','Valid requestId required');return this.withLifecycle(id,()=>this.startTerminal(owner,id,command,requestId));
 }
 async startTerminal(owner,id,command,requestId){
  const c=await this.connect(owner,id),prior=this.store.get(owner,id).terminalSessions.find(t=>t.requestId===requestId);if(prior){if(prior.command!==command)throw harnessError('IDEMPOTENCY_CONFLICT','Terminal request differs',409);return {schema:1,...prior};}
  const session={id:uid(),requestId,command,cwd:this.store.get(owner,id).workspaceRoot,status:'running',stdout:'',stderr:'',startedAt:now()},controller=new AbortController();await this.store.transaction(owner,id,(s,emit)=>{s.terminalSessions.push(session);emit('terminal.started',{session});});c.terminals.set(session.id,controller);
  const onOutput=async({stream='stdout',text=''})=>{await this.store.transaction(owner,id,(s,emit)=>{const saved=s.terminalSessions.find(t=>t.id===session.id),field=stream==='stderr'?'stderr':'stdout';saved[field]=bounded(saved[field]+text);emit('terminal.output',{session:saved});});};
  Promise.resolve().then(()=>this.executor.start({workspace:session.cwd,command,signal:controller.signal,onOutput})).then(result=>this.store.transaction(owner,id,(s,emit)=>{const saved=s.terminalSessions.find(t=>t.id===session.id);saved.stdout=bounded(result.stdout??saved.stdout);saved.stderr=bounded(result.stderr??saved.stderr);saved.exitCode=result.exitCode;saved.status=controller.signal.aborted?'interrupted':result.exitCode===0?'completed':'failed';saved.finishedAt=now();emit('terminal.exited',{session:saved});})).catch(error=>this.store.transaction(owner,id,(s,emit)=>{const saved=s.terminalSessions.find(t=>t.id===session.id);saved.status='interrupted';saved.error={code:error.code??'EXECUTION_UNCERTAIN',message:bounded(error.message,1000)};saved.finishedAt=now();emit('terminal.exited',{session:saved});})).finally(()=>c.terminals.delete(session.id));return {schema:1,...session};
 }
 async stopTerminal(owner,id,sessionId){const state=this.store.get(owner,id),session=state?.terminalSessions.find(t=>t.id===sessionId);if(!session)throw harnessError('NOT_FOUND','Terminal session not found',404);if(session.status!=='running')return {schema:1,acknowledged:true,session};const controller=this.connections.get(id)?.terminals.get(sessionId);if(!controller)throw harnessError('STOP_UNCONFIRMED','Process handle unavailable',409);controller.abort();await this.executor.stop?.(sessionId);return {schema:1,acknowledged:true,sessionId};}
 async register(owner,id,server,requestId){return this.changeConnector(owner,id,requestId,{server});}
 async configureMcp(owner,id,runtimeId,action,payload,requestId){return this.changeConnector(owner,id,requestId,{runtimeId,action,payload});}
 async changeConnector(owner,id,requestId,change){return this.withLifecycle(id,async()=>{
  if(!identifier(requestId))throw harnessError('INVALID_REQUEST_ID','Valid requestId required');if(this.active(id)||this.connections.get(id)?.toolControllers.size||this.store.get(owner,id)?.terminalSessions.some(t=>t.status==='running'))throw harnessError('MCP_CONFIG_BUSY','Wait for active work before changing connectors',409);
  const state=this.store.get(owner,id),key='connector:'+requestId,digest=hash(change),prior=state?.requests[key];if(prior){if(prior.hash!==digest)throw harnessError('IDEMPOTENCY_CONFLICT','Connector request differs',409);return this.store.snapshot(state);}
  if(state?.runs.length)throw harnessError('MCP_CONFIG_LOCKED','Start a new conversation to change connectors after a model run',409);
  await this.drop(id);await this.store.transaction(owner,id,(s,emit)=>{if(change.server){if(s.customServers.some(server=>server.id===change.server.id))throw harnessError('MCP_CONFIG_COLLISION','Connector already exists',409);s.customServers.push({...change.server,runtimeId:'custom_'+change.server.id,enabled:true,disabledTools:[]});}else{const server=s.customServers.find(server=>server.runtimeId===change.runtimeId);if(!server)throw harnessError('NOT_FOUND','Connector not found',404);if(change.action==='state'){if(typeof change.payload.enabled!=='boolean')throw harnessError('INVALID_MCP_CONFIG','Expected enabled boolean');server.enabled=change.payload.enabled;}else if(change.action==='permissions'){if(!Array.isArray(change.payload.disabledTools)||change.payload.disabledTools.some(v=>typeof v!=='string'))throw harnessError('INVALID_MCP_CONFIG','Expected tool names');server.disabledTools=change.payload.disabledTools;}else throw harnessError('INVALID_MCP_CONFIG','Unknown connector mutation');}s.requests[key]={hash:digest,status:'configured'};s.servers=[];emit('tools.changed',{servers:[]});});await this.connect(owner,id);return this.store.snapshot(this.store.get(owner,id));
 });}
 bindConversationBot(owner,id,input){return bindConversationBot(this,owner,id,input);}
 revalidateBoundConnections(options){return revalidateBoundConnections(this,options);}
 invalidateBotConnections(id){return invalidateBotConnections(this,id);}
 async drop(id,connection){
  const c=connection??this.connections.get(id);if(!c)return this.dropping.get(id);if(c.cleanupPromise)return c.cleanupPromise;this.connections.delete(id);
  c.cleanupPromise=(async()=>{for(const job of this.jobs.values())if(job.c===c)job.controller.abort();for(const controller of c.toolControllers.keys())controller.abort();for(const pending of c.pendingApprovals.values())pending.resolve(false);for(const controller of c.terminals.values())controller.abort();await c.host.close?.();this.bridges.delete(c.handle);for(const run of this.store.get(c.owner,id)?.runs??[])if(activeStatuses.has(run.status))await finishRun(this,c,run.id,'interrupted',harnessError('RUNTIME_DISCONNECTED','Runtime disconnected; effects may be incomplete',503));await this.store.transaction(c.owner,id,(s,emit)=>disconnectServers(s,emit,'Runtime disconnected; reconnect to discover tools'));})();this.dropping.set(id,c.cleanupPromise);try{await c.cleanupPromise;}finally{this.dropping.delete(id);}
 }
 async close(){this.closed=true;clearInterval(this.reaper);await Promise.allSettled([...this.connecting.values()]);await Promise.allSettled([...this.connections.keys()].map(id=>this.drop(id)));await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));await this.executor?.close?.();await this.store.tail;}
}
export {GrokRuntime as HarnessRuntime};

export function requestReceipt(state,kind,requestId){
 const requests=state?.requests;if(!requests)return;const key=kind+':'+requestId;if(Object.hasOwn(requests,key))return requests[key];
 const legacy=Object.hasOwn(requests,kind==='model'?requestId:'browser_'+requestId)?requests[kind==='model'?requestId:'browser_'+requestId]:undefined;if(!legacy)return;
 if(kind==='model'){const r=legacy.response;return /^[a-f0-9]{64}$/.test(legacy.hash)&&r?.schema===1&&r.accepted===true&&r.requestId===requestId&&r.conversationId===state.conversationId&&state.runs.some(run=>run.id===r.runId&&run.requestId===requestId)?legacy:undefined;}
 try{const payload=JSON.parse(legacy.hash);if(['pending','completed'].includes(legacy.status)&&/^browser_(open|snapshot|screenshot|click|fill)$/.test(payload?.action)&&payload.arguments&&typeof payload.arguments==='object'&&!Array.isArray(payload.arguments))return legacy;}catch{}
}

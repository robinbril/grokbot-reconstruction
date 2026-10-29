import { mkdir, readFile, open, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const activeStatuses = new Set(['accepted','starting','running','waiting_approval','cancelling']);
export const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
export const now = () => new Date().toISOString();
export function harnessError(code,message,status=400,retryable=false) { return Object.assign(new Error(message),{code,status,retryable}); }
export function bounded(value, cap=131072) { const text=typeof value==='string'?value:JSON.stringify(value);return text.length>cap?text.slice(0,cap)+'\n[output truncated]':text; }
function appendEvent(state,type,data,runId=null) { const event={schema:1,id:`${state.conversationId}:${++state.lastSeq}`,seq:state.lastSeq,conversationId:state.conversationId,runId,at:now(),type,data:structuredClone(data)};state.events.push(event);return event; }
export function disconnectServers(state,emit,reason) { let changed=false;for(const server of state.servers??[])if(server.state==='connected'){server.state='disconnected';server.reason=reason;changed=true;}if(changed)emit('tools.changed',{servers:state.servers});return changed; }
function recoverRun(state,run) {
 run.status='interrupted';run.finishedAt=now();run.error={code:'SERVER_RESTART',message:'Server restarted; prior effects may be incomplete. No work was resent.'};
 const unfinished=run.messageDrafts?.filter(draft=>draft.status==='streaming')??[];
 for(const draft of unfinished)draft.status='interrupted';
 const entry=state.entries.find(value=>value.id===run.outputEntryId);
 if(entry){entry.status='interrupted';if(entry.streaming||unfinished.length)entry.delivery='partial';entry.streaming=false;entry.revision=(entry.revision??0)+1;appendEvent(state,'entry.updated',{entry},run.id);}
 appendEvent(state,'run.interrupted',{run},run.id);
}
function recoverTool(state,tool) {
 tool.status='interrupted';tool.finishedAt=now();
 tool.error={code:'SERVER_RESTART',message:'Server restarted during tool execution; outcome is uncertain. Prior effects may be incomplete. No work was resent.'};
 appendEvent(state,'tool.interrupted',{tool},tool.runId??null);
}
export class HarnessStore {
 constructor({dataDir}) { this.dataDir=path.resolve(dataDir);this.states=new Map();this.tail=Promise.resolve();this.listeners=new Map(); }
 async init() { await mkdir(this.dataDir,{recursive:true,mode:0o700});for(const file of await readdir(this.dataDir)) { if(!/^conversation-.*\.json$/.test(file))continue;const s=JSON.parse(await readFile(path.join(this.dataDir,file),'utf8'));let changed=false;for(const r of s.runs)if(activeStatuses.has(r.status)){recoverRun(s,r);changed=true;}for(const tool of s.tools)if(tool.status==='running'){recoverTool(s,tool);changed=true;}for(const t of s.terminalSessions)if(t.status==='running'){t.status='interrupted';t.finishedAt=now();changed=true;}for(const a of s.runs.flatMap(r=>r.approvals))if(a.status==='pending'){a.status='expired';changed=true;}changed=disconnectServers(s,(...args)=>appendEvent(s,...args),'Server restarted; reconnect to rediscover tools')||changed;this.states.set(s.conversationId,s);if(changed){s.persistedAt=now();await this.write(s);} }return this; }
 async write(state,{onPublished,signal}={}) { const filename=path.join(this.dataDir,`conversation-${state.conversationId}.json`);const temp=filename+'.'+randomUUID()+'.tmp';try{const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(state));await f.sync();}finally{await f.close();}signal?.throwIfAborted();await rename(temp,filename);onPublished?.();const dir=await open(this.dataDir,'r');try{await dir.sync();}finally{await dir.close();}}finally{await rm(temp,{force:true});} }
 get(owner,id) { if(!identifier(id))throw harnessError('INVALID_ID','Invalid conversation identifier');const s=this.states.get(id);if(s&&s.owner!==owner)throw harnessError('NOT_FOUND','Conversation not found',404);return s; }
 async transaction(owner,id,mutate,{resource=false,signal}={}) { const task=this.tail.then(async()=>{await this.syncResourceDirectory();const previous=this.get(owner,id);const s=previous?structuredClone(previous):{schema:1,owner,conversationId:id,workspaceRoot:path.join(this.dataDir,'workspaces',id),entries:[],runs:[],tools:[],browserSessions:[],terminalSessions:[],servers:[],customServers:[],events:[],requests:{},queue:[],schedules:[],workflow:{nextSequence:0,hold:null},lastSeq:0,persistedAt:now()};const emitted=[];const emit=(...args)=>{emitted.push(appendEvent(s,...args));};const result=await mutate(s,emit);s.persistedAt=now();await this.write(s,resource?{signal,onPublished:()=>{this.resourceDirectorySyncPending=true;this.states.set(id,s);}}:undefined);if(resource)this.resourceDirectorySyncPending=false;this.states.set(id,s);for(const event of emitted)for(const fn of this.listeners.get(id)??[])fn(event);return result;});this.tail=task.catch(()=>{});return task; }
 // Resource writes have no associated execution job. Retain their published
 // receipt after rename so an uncertain ACK cannot create a second resource.
 async syncResourceDirectory() {
  if(!this.resourceDirectorySyncPending)return;
  const directory=await open(this.dataDir,'r');
  try{await directory.sync();this.resourceDirectorySyncPending=false;}finally{await directory.close();}
 }
 resourceTransaction(owner,id,mutate,{signal}={}) { return this.transaction(owner,id,mutate,{resource:true,signal}); }
 resourceRead(owner,id,project) {
  const task=this.tail.then(async()=>{await this.syncResourceDirectory();return structuredClone(project(this.get(owner,id)));});
  this.tail=task.catch(()=>{});return task;
 }
 lookupRun(owner,id) { if(!identifier(id))throw harnessError('INVALID_ID','Invalid run identifier');for(const s of this.states.values()){const run=s.runs.find(r=>r.id===id);if(run){if(s.owner!==owner)break;return {state:s,run};}}throw harnessError('NOT_FOUND','Run not found',404); }
 subscribe(id,fn) { const set=this.listeners.get(id)??new Set();set.add(fn);this.listeners.set(id,set);return()=>{set.delete(fn);if(!set.size)this.listeners.delete(id);}; }
 snapshot(s) { if(!s)return null;const {owner,events,requests,customServers,historyState,agentHistory,canvasHistory,canvases,canvasInputs,...snapshot}=s;if(canvases!==undefined)snapshot.canvases=canvases.map(({source,...canvas})=>canvas);const workflowError=this.workflowErrors?.get(s.conversationId);return structuredClone(workflowError?{...snapshot,workflow:{...snapshot.workflow,error:workflowError}}:snapshot); }
}

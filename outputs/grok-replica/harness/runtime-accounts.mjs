import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {harnessError,identifier} from './store.mjs';

export async function resolveAccountBindings(runtime,owner,state){
 if(!state?.botId)return [];
 if(typeof runtime.resolveAccounts!=='function')throw harnessError('ACCOUNT_ACCESS_UNAVAILABLE','Account authorization is unavailable',503);
 const bindings=await runtime.resolveAccounts(owner,state);
 if(!Array.isArray(bindings)||bindings.length>50)throw harnessError('ACCOUNT_ACCESS_INVALID','Invalid account binding inventory',503);
 const ids=new Set();return bindings.map(binding=>{
  if(!binding||!identifier(binding.accountId)||ids.has(binding.accountId)||typeof binding.name!=='string'||!binding.name||binding.name.length>100||typeof binding.resourceUrl!=='string')throw harnessError('ACCOUNT_ACCESS_INVALID','Invalid account binding metadata',503);
  ids.add(binding.accountId);const disabledTools=binding.disabledTools??[];
  if(!Array.isArray(disabledTools)||disabledTools.length>200||disabledTools.some(name=>typeof name!=='string'||!name||name.length>200))throw harnessError('ACCOUNT_ACCESS_INVALID','Invalid account tool policy',503);
  return {accountId:binding.accountId,name:binding.name,resourceUrl:binding.resourceUrl,disabledTools:[...new Set(disabledTools)].sort()};
 }).sort((a,b)=>a.accountId.localeCompare(b.accountId));
}
export function accountServers(runtime,c,bindings){
 return bindings.map(binding=>({id:'account_'+createHash('sha256').update(binding.accountId).digest('hex').slice(0,32),runtimeId:'account_'+createHash('sha256').update(binding.accountId).digest('hex').slice(0,32),accountId:binding.accountId,name:binding.name,url:`${runtime.baseUrl}/api/harness/internal/${c.handle}/accounts/${binding.accountId}/mcp`,enabled:true,disabledTools:binding.disabledTools,bearer_token_env_var:'HARNESS_MCP_TOKEN'}));
}
export async function verifyRuntimeAccounts(runtime,owner,id,c){
 try{
  const state=runtime.store.get(owner,id),bindings=await resolveAccountBindings(runtime,owner,state);
  if(c?.accountBindings&&!isDeepStrictEqual(c.accountBindings,bindings))throw harnessError('MCP_ACCOUNT_CHANGED','Account bindings changed; reconnect to discover the authorized tools',409,true);
  if(c&&(c.cleanupPromise||c.rpc?.closed))throw harnessError('RUNTIME_DISCONNECTED','Runtime connection is no longer active',503,true);
  return bindings;
 }catch(error){if(c)await runtime.drop(id,c);throw error;}
}
function assertIdle(runtime,state,id){
 const c=runtime.connections.get(id);
 if(runtime.active(id)||state?.terminalSessions.some(t=>t.status==='running')||c?.toolControllers.size||c?.materializing||c?.configuringMcp||runtime.connecting.has(id))throw harnessError('MCP_CONFIG_BUSY','Wait for running model, terminal and tool work before changing the Bot binding',409);
 if(state?.runs.length)throw harnessError('MCP_CONFIG_LOCKED','Start a new conversation to change the Bot after a model run',409);
}
export async function bindConversationBot(runtime,owner,id,input){
 if(!input||!identifier(input.requestId)||!identifier(input.botId))throw harnessError('INVALID_BOT_BINDING','Valid requestId and Bot identifier are required');
 return runtime.withLifecycle(id,async()=>{
  const state=runtime.store.get(owner,id),key='bot-binding:'+input.requestId,hash=createHash('sha256').update(input.botId).digest('hex'),prior=state?.requests[key];
  if(prior&&prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Bot binding request identifier was reused with different input',409);
  await resolveAccountBindings(runtime,owner,{...state,botId:input.botId});
  if(prior){await runtime.connect(owner,id);return runtime.store.snapshot(runtime.store.get(owner,id));}
  assertIdle(runtime,state,id);const c=runtime.connections.get(id);if(c)c.configuringMcp=true;
  try{await runtime.drop(id);}catch(error){if(c)delete c.configuringMcp;throw error;}
  await runtime.store.transaction(owner,id,(s,emit)=>{assertIdle(runtime,s,id);s.botId=input.botId;delete s.threadId;s.servers=[];s.requests[key]={hash,status:'configured'};emit('tools.changed',{servers:s.servers});});
  await runtime.connect(owner,id);return runtime.store.snapshot(runtime.store.get(owner,id));
 });
}
export async function revalidateBoundConnections(runtime,{botId,accountId,force=false}={}){
 let dropped=0;const connections=[...new Set([...runtime.connections.values(),...runtime.bridges.values()])];
 for(const c of connections){
  const state=runtime.store.get(c.owner,c.id);if(!state?.botId||(botId&&state.botId!==botId)||(accountId&&!c.accountIds?.includes(accountId)))continue;
  if(force){await runtime.drop(c.id,c);dropped++;continue;}
  try{await verifyRuntimeAccounts(runtime,c.owner,c.id,c);}catch{dropped++;}
 }
 return {dropped};
}
export const invalidateBotConnections=(runtime,botId)=>revalidateBoundConnections(runtime,{botId,force:true});

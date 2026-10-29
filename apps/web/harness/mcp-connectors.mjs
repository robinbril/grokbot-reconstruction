import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {harnessError,identifier} from './store.mjs';
import {inheritedServerNames} from './codex-rpc.mjs';

export {validateMcpServer} from './mcp-server-validation.mjs';

export const connectorConfiguration=server=>({transport:server.url?'http':'stdio',...(server.url?{url:server.url}:{}),enabled:server.enabled!==false,disabledTools:server.disabledTools??[]});
export function mcpConfigEntries(server){
 const prefix=`mcp_servers.${server.id}.`,entries=[`${prefix}enabled=${server.enabled!==false}`];
 for(const key of ['url','command','args','env_vars','bearer_token_env_var'])if(server[key]!==undefined)entries.push(`${prefix}${key}=${JSON.stringify(server[key])}`);
 if(server.disabledTools?.length)entries.push(`${prefix}disabled_tools=${JSON.stringify(server.disabledTools)}`);
 return entries;
}
export function verifyConnectorConfig(custom,actual){
 for(const server of custom){
  const configured=actual.mcp_servers?.[server.runtimeId];
  if(!configured||(configured.enabled===false)!==(server.enabled===false)||(server.url&&configured.url!==server.url)||(server.bearer_token_env_var&&configured.bearer_token_env_var!==server.bearer_token_env_var)||!isDeepStrictEqual([...(configured.disabled_tools??[])].sort(),[...(server.disabledTools??[])].sort()))throw harnessError('MCP_POLICY_UNVERIFIED','Native MCP configuration did not confirm connector policy',503);
 }
}

function assertIdle(runtime,state,id){
 const connection=runtime.connections.get(id);
 if(runtime.active(id)||state?.terminalSessions.some(t=>t.status==='running')||connection?.toolControllers.size||connection?.materializing||runtime.connecting.has(id))throw harnessError('MCP_CONFIG_BUSY','Wait for running model, terminal and tool work before changing MCP configuration',409);
 if(state?.runs.length)throw harnessError('MCP_CONFIG_LOCKED','Start a new conversation to change MCP configuration after a model run',409);
}
function changeServer(state,runtimeId,action,payload){
 const server=state?.customServers.find(s=>s.runtimeId===runtimeId);
 if(!server)throw harnessError('NOT_FOUND','MCP connector not found',404);
 if(action==='state'){
  if(typeof payload.enabled!=='boolean')throw harnessError('INVALID_MCP_POLICY','Expected enabled boolean');
  server.enabled=payload.enabled;
 }else{
  const names=payload.disabledTools,known=new Set([...(state.servers.find(s=>s.id===runtimeId)?.tools??[]).map(t=>t.name),...(server.disabledTools??[])]);
  if(!Array.isArray(names)||names.length>200||names.some(n=>typeof n!=='string'||!n.length||n.length>200||!known.has(n)))throw harnessError('INVALID_MCP_POLICY','Disabled tools must be discovered tool names');
  server.disabledTools=[...new Set(names)].sort();
 }
 return server;
}
export async function mutateConnector(runtime,owner,id,{server,runtimeId,action,payload,requestId}){
 const state=runtime.store.get(owner,id),key='connector:'+requestId;
 const hash=createHash('sha256').update(JSON.stringify(server?{action:'register',server}:{action,runtimeId,payload})).digest('hex');
 const prior=state?.requests[key];
 if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Connector request identifier was reused with different input',409);await runtime.connect(owner,id);return runtime.store.snapshot(runtime.store.get(owner,id));}
 assertIdle(runtime,state,id);
 // Validate policy/identity against a clone before dropping any live child.
 if(!server)changeServer(structuredClone(state),runtimeId,action,payload);
 const existing=server&&state?.customServers.find(s=>s.id===server.id);
 if(existing){const old={id:existing.id,name:existing.name,...(existing.url?{url:existing.url}:{command:existing.command,args:existing.args})};if(!isDeepStrictEqual(old,server))throw harnessError('IDEMPOTENCY_CONFLICT','MCP server identifier already registered',409);}
 if(server&&!existing){
  const cwd=state?.workspaceRoot??path.join(runtime.store.dataDir,'workspaces',id);await mkdir(cwd,{recursive:true,mode:0o700});
  const inherited=await inheritedServerNames({binary:runtime.codexBinary,cwd});
  if(inherited.includes('custom_'+server.id))throw harnessError('MCP_CONFIG_COLLISION','Custom MCP identifier collides with inherited configuration; choose another identifier',503);
  assertIdle(runtime,runtime.store.get(owner,id),id);
 }
 const connection=runtime.connections.get(id);if(connection)connection.configuringMcp=true;
 try{await runtime.drop(id);}catch(error){if(connection)delete connection.configuringMcp;throw error;}
 await runtime.store.transaction(owner,id,(s,emit)=>{
  if(s.runs.length)throw harnessError('MCP_CONFIG_LOCKED','Start a new conversation to change MCP configuration after a model run',409);
  let configured;
  if(server){configured=s.customServers.find(x=>x.id===server.id);if(!configured){configured={...server,runtimeId:'custom_'+server.id,requestId,enabled:true,disabledTools:[]};s.customServers.push(configured);}}
  else configured=changeServer(s,runtimeId,action,payload);
  const row=s.servers.find(x=>x.id===configured.runtimeId),configuration=connectorConfiguration(configured);
  if(row)Object.assign(row,{configuration,state:configuration.enabled?'disconnected':'disabled',reason:'Reconnect to verify configured MCP policy'});
  else s.servers.push({id:configured.runtimeId,name:configured.name,configuration,state:'disconnected',reason:'Connection not yet verified',tools:[]});
  s.requests[key]={hash,status:'configured'};delete s.threadId;
  emit('tools.changed',{servers:s.servers});
 });
 await runtime.connect(owner,id);
 return runtime.store.snapshot(runtime.store.get(owner,id));
}

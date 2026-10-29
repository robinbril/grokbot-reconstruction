import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/client/validators/ajv';
import {createHash} from 'node:crypto';

const validator=new AjvJsonSchemaValidator();
function waitForCall(operation,signal){
 if(!signal)return operation;
 let abort;
 const cancelled=new Promise((_,reject)=>{
  abort=()=>reject(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
 });
 return Promise.race([operation,cancelled]).finally(()=>signal.removeEventListener('abort',abort));
}
export function grokToolName(serverId,name){
 const digest=createHash('sha256').update(JSON.stringify([serverId,name])).digest('hex').slice(0,16);
 return `mcp_${serverId}_${name}`.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,47)+'_'+digest;
}
function stdioEnvironment(server,workspace){
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:workspace,USER:'',LOGNAME:'',SHELL:'/bin/zsh',TERM:'dumb'};
 for(const key of server.env_vars??[]){
  if(typeof key!=='string'||!/^[A-Z_][A-Z0-9_]*$/.test(key)||/TOKEN|SECRET|PASSWORD|OAUTH|API_KEY|CREDENTIAL|COOKIE/i.test(key))throw new Error('Credential environment forwarding is forbidden');
  if(process.env[key]!==undefined)env[key]=process.env[key];
 }
 return env;
}
function transportFor(server,{workspace,token}){
 if(!server.url)return new StdioClientTransport({command:server.command,args:server.args??[],env:stdioEnvironment(server,workspace),cwd:workspace,stderr:'ignore'});
 const url=new URL(server.url);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid MCP URL');
 const headers=server.accountId?{Authorization:`Bearer ${token}`}:{ };
 if(server.accountId&&!token)throw new Error('Owned account bridge token is missing');
 return new StreamableHTTPClientTransport(url,{requestInit:{headers,redirect:'error'},reconnectionOptions:{maxRetries:0}});
}
export async function connectGrokMcp(server,options){
 const client=new Client({name:'grok-bot-owned-harness',version:'1.0.0'},{capabilities:{}});
 const transport=transportFor(server,options),id=server.runtimeId??server.id;
 let closed=false,tail=Promise.resolve();
 client.onclose=()=>{closed=true;options.onClose?.();};
 const close=async()=>{closed=true;await client.close();};
 try{
  await client.connect(transport,{timeout:15000});
  const {tools}=await client.listTools(undefined,{timeout:15000});
  const entries=tools.map(tool=>({definition:{...tool,name:grokToolName(id,tool.name),serverId:id,requiresApproval:tool.annotations?.readOnlyHint!==true},original:tool.name,validate:validator.getValidator(tool.inputSchema)}));
  return {entries,close,async call(entry,args,{signal}={}){
   const operation=tail.then(async()=>{
    if(closed)throw new Error('MCP connection is closed');
    signal?.throwIfAborted();
    if(server.enabled===false||server.disabledTools?.includes(entry.original))throw new Error('MCP tool is disabled');
    if(!entry.validate(args).valid)throw new Error('Invalid MCP tool arguments');
    const abort=()=>{void close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{return await client.callTool({name:entry.original,arguments:args},{signal,timeout:120000});}
    finally{signal?.removeEventListener('abort',abort);}
   });
   // Cancelling a waiting caller must not release the serialized transport queue.
   tail=operation.catch(()=>{});return waitForCall(operation,signal);
  }};
 }catch(error){await close().catch(()=>{});throw error;}
}

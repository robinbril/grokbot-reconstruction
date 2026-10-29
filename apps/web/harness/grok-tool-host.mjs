import {createWorkspaceTools} from './workspace-tools.mjs';
import {connectGrokMcp} from './grok-mcp-client.mjs';
import {createCanvasTools} from './canvas-tools.mjs';
import {canvasId} from './canvas-store.mjs';

export async function createGrokToolHost(options={}){
 const {runtime,c=options.connection??{},state={},workspace=state.workspaceRoot}=options;
 const native=createWorkspaceTools({...options,workspace});
 const canvas=runtime?.store&&typeof c.owner==='string'&&canvasId(c.id)?createCanvasTools({store:runtime.store,owner:c.owner,conversationId:c.id}):null;
 const executor=options.executor??runtime?.executor;
 const definitions=native.listTools().map(tool=>({...tool,serverId:'grok_workspace'}));
 const terminals=new Set(),routes=new Map(),clients=[],servers=[{id:'grok_workspace',name:'Grok workspace',state:'connected',tools:native.listTools()}];
 if(canvas){const tools=canvas.listTools();definitions.push(...tools);servers.push({id:'grok_canvas',name:'Local React canvases',state:'connected',tools});}
 if(executor?.start){
  const terminal={name:'Terminal',description:'Run a command in this task workspace through the native sandbox. Requires approval of the exact command.',serverId:'grok_taskbox',requiresApproval:true,inputSchema:{type:'object',properties:{command:{type:'string',minLength:1,maxLength:16384}},required:['command'],additionalProperties:false}};
  definitions.push(terminal);servers.push({id:'grok_taskbox',name:'Grok Taskbox terminal',state:'connected',tools:[terminal]});
 }
 let closed=false;
 const custom=options.customServers??state.customServers??[];
 const accounts=options.accountServers??c.accountServers??[];
 for(const server of [...custom,...accounts]){
  const id=server.runtimeId??server.id;
  const row={id,name:server.name??id,state:server.enabled===false?'disabled':'connecting',tools:[],configuration:{transport:server.url?'http':'stdio',enabled:server.enabled!==false,disabledTools:server.disabledTools??[],...(server.url?{url:server.url}:{}),...(server.accountId?{readOnly:true}:{})}};
  servers.push(row);
  if(server.enabled===false)continue;
  try{
   const client=await connectGrokMcp(server,{workspace,token:c.token,onClose:()=>{if(row.state==='connected'){row.state='disconnected';row.reason='MCP connection closed; reconnect required';}}});clients.push(client);
   row.tools=client.entries.map(entry=>({...entry.definition,name:entry.original}));row.state='connected';
   for(const entry of client.entries){
    if(server.disabledTools?.includes(entry.original))continue;
    definitions.push(entry.definition);routes.set(entry.definition.name,{client,entry,row});
   }
  }catch{row.state='failed';row.reason='MCP initialization or tool discovery failed';}
 }
 async function call(name,args={},callOptions={}){
  if(closed)throw new Error('Grok tool host is closed');
  callOptions.signal?.throwIfAborted();
  if(name==='Terminal'&&executor?.start){
   if(!args||typeof args.command!=='string'||!args.command.trim()||args.command.length>16384||Object.keys(args).some(key=>key!=='command'))throw new Error('Invalid Terminal arguments');
   const controller=new AbortController();terminals.add(controller);
   const signal=callOptions.signal?AbortSignal.any([callOptions.signal,controller.signal]):controller.signal;
   try{return await executor.start({workspace,command:args.command,signal});}finally{terminals.delete(controller);}
  }
  if(canvas?.listTools().some(tool=>tool.name===name))return canvas.callTool(name,args,callOptions);
  const route=routes.get(name);
  if(route)return route.client.call(route.entry,args,callOptions);
  if(!definitions.some(tool=>tool.serverId==='grok_workspace'&&tool.name===name))throw new Error('Unknown Grok tool');
  return native.callTool(name,args,callOptions);
 }
 return {getDefinitions:()=>structuredClone(definitions.filter(tool=>!closed&&(!routes.has(tool.name)||routes.get(tool.name).row.state==='connected'))),listTools:()=>structuredClone(definitions.filter(tool=>!closed&&(!routes.has(tool.name)||routes.get(tool.name).row.state==='connected'))),call,callTool:call,
  inventory:()=>structuredClone(servers),frame:native.frame,browserState:native.browserState,
  async close(){closed=true;for(const controller of terminals)controller.abort(new Error('Grok tool host is closed'));for(const row of servers)if(row.state==='connected')row.state='disconnected';await Promise.allSettled([native.close(),...clients.map(client=>client.close())]);},
 };
}

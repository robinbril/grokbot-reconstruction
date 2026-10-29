#!/usr/bin/env node
// Controllable protocol fixture. It does not run a real model or external MCP.
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('./harness-codex-fixture.mjs',import.meta.url)),...process.argv.slice(2)],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});
const enabled=new Map();
for(const argument of process.argv.slice(2)){const match=argument.match(/^mcp_servers\.([A-Za-z0-9_-]+)\.enabled=(true|false)$/);if(match)enabled.set(match[1],match[2]==='true');}
const names=[...enabled].filter(([,value])=>value).map(([name])=>name),methods=[],inventoryRequests=[],waiting=[],held=[];
let control={},closing=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const stats=()=>({pid:process.pid,childPid:child.pid,methods,inventoryRequests});
const reply=(id,result)=>send({id,result});
const sumSchema={type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false};
function inventory(params){
 const data=names.filter(name=>!control.omit?.includes(name)&&(!params.serverName||params.serverName===name)).map(name=>({name,runtimeStatus:Object.hasOwn(control.statuses||{},name)?control.statuses[name]:'connected',toolsError:control.errors?.[name]??null,authStatus:'unsupported',resources:[],resourceTemplates:[],tools:name==='grok_workspace'?{workspace_list:{name:'workspace_list',description:'Fixture catalog only',inputSchema:{type:'object'}}}:{sum:{name:'sum',description:'Cached sum schema for protocol health regression',inputSchema:sumSchema}}}));
 if(!control.pages)return {data,nextCursor:null};
 return params.cursor==='health-page-1'?{data:data.filter(server=>server.name!=='grok_workspace'),nextCursor:null}:{data:data.filter(server=>server.name==='grok_workspace'),nextCursor:data.some(server=>server.name!=='grok_workspace')?'health-page-1':null};
}
readline.createInterface({input:child.stdout}).on('line',line=>process.stdout.write(line+'\n'));
child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let message;try{message=JSON.parse(line);}catch{return;}
 const {id,method,params={}}=message;
 if(method)methods.push(method);
 if(method==='test/health/stats'){reply(id,stats());return;}
 if(method==='test/health/set'){control=structuredClone(params);reply(id,stats());return;}
 if(method==='test/health/release'){control.hold=false;control.mode=undefined;for(const result of held.splice(0))send(result);reply(id,stats());return;}
 if(method==='test/health/wait'){if(inventoryRequests.length>(params.after??0))reply(id,stats());else waiting.push({id,after:params.after??0});return;}
 if(method==='mcpServerStatus/list'){
  inventoryRequests.push(structuredClone(params));
  for(let index=waiting.length-1;index>=0;index--)if(inventoryRequests.length>waiting[index].after){reply(waiting[index].id,stats());waiting.splice(index,1);}
  const result=control.mode==='error'?{id,error:{code:-32000,message:'Controlled native inventory discovery failure'}}:{id,result:inventory(params)};
  if(control.hold||control.mode==='hang')held.push(result);else send(result);
  return;
 }
 child.stdin.write(line+'\n');
});
function close(){if(closing)return;closing=true;child.kill('SIGTERM');}
process.stdin.on('end',close);process.on('SIGTERM',close);
child.on('exit',(code,signal)=>{if(signal||closing)process.exit(0);process.exit(code??1);});

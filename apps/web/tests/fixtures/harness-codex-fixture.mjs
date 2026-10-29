#!/usr/bin/env node
// Protocol fixture only. Live provider/tool execution is proved separately.
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const servers={inherited_probe:{enabled:true,command:process.execPath,args:[]}};
const features={};
for(const arg of process.argv.slice(2)){const m=arg.match(/^mcp_servers\.([A-Za-z0-9_-]+)\.enabled=(true|false)$/);if(m)servers[m[1]]={enabled:m[2]==='true',command:process.execPath,args:[]};const f=arg.match(/^features\.([A-Za-z0-9_-]+)=(true|false)$/);if(f)features[f[1]]=f[2]==='true';}
const turns=new Map(), approvals=new Map(), processes=new Map();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const reply=(id,result)=>send({id,result});
const note=(method,params)=>send({method,params});
const turn=(id,status,items=[])=>({id,status,items});
function complete(threadId,text,status='completed'){
 const active=turns.get(threadId);if(!active||active.done)return;active.done=true;
 if(text){const item={id:active.itemId,type:'agentMessage',text};note('item/started',{threadId,turnId:active.id,item:{...item,text:''}});note('item/agentMessage/delta',{threadId,turnId:active.id,itemId:item.id,delta:text});note('item/completed',{threadId,turnId:active.id,item});}
 note('turn/completed',{threadId,turn:turn(active.id,status)});
}
readline.createInterface({input:process.stdin}).on('line',async line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(!m.method){const a=approvals.get(m.id);if(a){approvals.delete(m.id);complete(a.threadId,'Protocol fixture decision: '+String(m.result?.decision));}return;}
 const p=m.params||{};
 try{switch(m.method){
 case 'initialize':reply(m.id,{userAgent:'protocol-fixture',platformOs:process.platform});break;
 case 'initialized':break;
 case 'config/read':reply(m.id,{config:{model:'protocol-fixture-model',model_provider:'openai',mcp_servers:servers,features},origins:{},layers:[]});break;
 case 'account/read':reply(m.id,{account:{type:'chatgpt'},requiresOpenaiAuth:true});break;
 case 'model/list':reply(m.id,{data:[{id:'protocol-fixture-model',model:'protocol-fixture-model',isDefault:true}],nextCursor:null});break;
 case 'thread/start':case 'thread/resume':{
  const id=p.threadId||randomUUID();reply(m.id,{thread:{id,turns:[],cwd:process.cwd(),status:{type:'idle'}},model:'protocol-fixture-model',modelProvider:'openai',cwd:process.cwd(),approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:{type:'workspaceWrite',writableRoots:[process.cwd()],networkAccess:false}});break;
 }
 case 'thread/read':reply(m.id,{thread:{id:p.threadId,turns:[],status:{type:'idle'}}});break;
 case 'mcpServerStatus/list':reply(m.id,{data:Object.entries(servers).filter(([,s])=>s.enabled!==false).map(([name])=>({name,authStatus:'unsupported',runtimeStatus:'ready',tools:{workspace_list:{name:'workspace_list',description:'Fixture catalog only',inputSchema:{type:'object'}}},resources:[],resourceTemplates:[],toolsError:null})),nextCursor:null});break;
 case 'turn/start':{
  const id=randomUUID(),itemId=randomUUID(),text=(p.input||[]).map(x=>x.text||'').join('');turns.set(p.threadId,{id,itemId,done:false});reply(m.id,{turn:turn(id,'inProgress')});note('turn/started',{threadId:p.threadId,turn:turn(id,'inProgress')});
  if(text.includes('FIXTURE_APPROVAL')){const aid='approval-'+randomUUID();approvals.set(aid,{threadId:p.threadId});send({id:aid,method:'item/commandExecution/requestApproval',params:{threadId:p.threadId,turnId:id,itemId,command:'printf approval-fixture',cwd:process.cwd(),reason:'Protocol fixture requires a decision',availableDecisions:['accept','decline','cancel']}});}
  else if(!text.includes('FIXTURE_DEFER'))setImmediate(()=>complete(p.threadId,'Protocol fixture output: '+text,text.includes('FIXTURE_FAIL')?'failed':'completed'));
  break;
 }
 case 'turn/interrupt':reply(m.id,{});complete(p.threadId,'','interrupted');break;
 case 'command/exec':{
  const id=p.processId||randomUUID(),child=spawn(p.command[0],p.command.slice(1),{cwd:p.cwd,env:process.env});processes.set(id,child);let stdout='',stderr='';
  for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{if(stream==='stdout')stdout+=chunk;else stderr+=chunk;if(p.streamStdoutStderr)note('command/exec/outputDelta',{processId:id,stream,deltaBase64:chunk.toString('base64'),capReached:false});});
  child.on('error',error=>{processes.delete(id);send({id:m.id,error:{code:-32000,message:error.message}});});
  child.on('close',(code,sig)=>{processes.delete(id);reply(m.id,{exitCode:code??(sig?137:1),stdout:p.streamStdoutStderr?'':stdout,stderr:p.streamStdoutStderr?'':stderr});});break;
 }
 case 'command/exec/terminate':{processes.get(p.processId)?.kill('SIGTERM');reply(m.id,{});break;}
 default:if(m.id!==undefined)send({id:m.id,error:{code:-32601,message:'Fixture does not implement '+m.method}});
 }}catch(error){if(m.id!==undefined)send({id:m.id,error:{code:-32000,message:error.message}});}
});
function close(){for(const p of processes.values())p.kill('SIGTERM');process.exit(0);}
process.stdin.on('end',close);process.on('SIGTERM',close);

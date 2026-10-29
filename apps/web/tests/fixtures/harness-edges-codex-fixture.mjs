#!/usr/bin/env node
// Native item envelopes match the saved schema; explicit protocol fixture.
// This fixture does not establish installed-provider or model execution.
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('./harness-codex-fixture.mjs',import.meta.url)),...process.argv.slice(2)],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});
const turnStarts=[],operations=[],tracked=new Map(),approvals=new Map();let closing=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const context=record=>({threadId:record.threadId,turnId:record.turnId});
const item=(record,status)=>record.type==='fileChange'?{id:record.itemId,type:record.type,status,changes:record.changes}:{id:record.itemId,type:record.type,status,command:record.command,commandActions:[],cwd:process.cwd(),aggregatedOutput:record.output,exitCode:record.exitCode};
function finish(record,status){record.finished=true;record.nativeCompletion=item(record,status);send({method:'item/completed',params:{...context(record),completedAtMs:Date.now(),item:record.nativeCompletion}});send({method:'turn/completed',params:{threadId:record.threadId,turn:{id:record.turnId,status:'completed',items:[]}}});}
const program=record=>record.mode==='declined'?"require('node:fs').writeFileSync("+JSON.stringify(record.markerPath)+",'Authorized fixture command');": "process.stdout.write('EDGE_STDOUT_"+record.mode+"\\n');process.stderr.write('EDGE_STDERR_"+record.mode+"\\n');process.exit("+(record.mode==='failed'?7:0)+");";
function execute(record){
 record.executed=true;
 if(record.type==='fileChange'){writeFile(record.markerPath,'Authorized fixture file change').then(()=>finish(record,'completed'));return;}

 const owned=spawn(process.execPath,['-e',program(record)],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});record.child=owned;record.pid=owned.pid;record.output='';record.stdout='';record.stderr='';
 for(const stream of ['stdout','stderr'])owned[stream].on('data',bytes=>{const chunk=bytes.toString('utf8');record[stream]+=chunk;record.output+=chunk;send({method:'item/commandExecution/outputDelta',params:{...context(record),itemId:record.itemId,delta:chunk}});});
 owned.on('close',(code,signal)=>{record.signal=signal;record.exitCode=code;finish(record,code===0?'completed':'failed');});
}
function start(record,turnId){
 Object.assign(record,{turnId,itemId:'edge-item-'+randomUUID(),executed:false,finished:false,pid:null,signal:null,output:null,exitCode:null});
 record.markerPath=path.join(process.cwd(),'declined-'+record.type+'.marker');record.command=process.execPath+' -e '+JSON.stringify(program(record));record.changes=[{path:record.markerPath,kind:{type:'add'},diff:'+Authorized fixture file change'}];operations.push(record);
 send({method:'item/started',params:{...context(record),startedAtMs:Date.now(),item:item(record,'inProgress')}});
 if(record.mode!=='declined'){execute(record);return;}
 const approvalId='edge-approval-'+randomUUID();approvals.set(approvalId,record);
 send({id:approvalId,method:record.type==='fileChange'?'item/fileChange/requestApproval':'item/commandExecution/requestApproval',params:{...context(record),itemId:record.itemId,startedAtMs:Date.now(),reason:'Explicit fixture authorization required',...(record.type==='fileChange'?{grantRoot:process.cwd()}:{command:record.command,commandActions:[],cwd:process.cwd(),availableDecisions:['accept','decline','cancel']})}});
}
readline.createInterface({input:child.stdout}).on('line',line=>{
 process.stdout.write(line+'\n');let message;try{message=JSON.parse(line);}catch{return;}
 if(message.method==='turn/started'){const record=tracked.get(message.params.threadId);if(record&&!record.itemId)start(record,message.params.turn.id);}
});
child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let message;try{message=JSON.parse(line);}catch{return;}
 if(message.method==='test/edges/state'){send({id:message.id,result:{turnStarts,operations:operations.map(({child,...record})=>record)}});return;}
 if(!message.method&&approvals.has(message.id)){const record=approvals.get(message.id);approvals.delete(message.id);record.decision=message.result?.decision;if(record.decision==='decline')finish(record,'declined');else execute(record);return;}
 if(message.method==='turn/start'){
  turnStarts.push(structuredClone(message.params));const match=message.params.input.map(entry=>entry.text||'').join('').match(/EDGE_ITEM:(commandExecution|fileChange):(declined|completed|failed)/);
  if(match)tracked.set(message.params.threadId,{threadId:message.params.threadId,type:match[1],mode:match[2]});
 }
 child.stdin.write(line+'\n');
});
function close(){if(closing)return;closing=true;for(const record of operations)if(record.child&&!record.finished)record.child.kill('SIGTERM');child.kill('SIGTERM');}
process.stdin.on('end',close);process.on('SIGTERM',close);child.on('exit',()=>process.exit(0));

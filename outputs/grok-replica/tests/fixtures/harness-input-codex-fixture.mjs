#!/usr/bin/env node
// Transparent protocol capture only. No real model/provider execution claim.
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('./harness-codex-fixture.mjs',import.meta.url)),...process.argv.slice(2)],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});
const turns=[],waiters=[];let closing=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:child.stdout}).on('line',line=>process.stdout.write(line+'\n'));
child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let message;try{message=JSON.parse(line);}catch{return;}
 if(message.method==='test/input/captured'){send({id:message.id,result:{turns}});return;}
 if(message.method==='test/input/wait'){
  if(turns.length>=(message.params?.count??1))send({id:message.id,result:{turns}});
  else waiters.push({id:message.id,count:message.params?.count??1});
  return;
 }
 if(message.method==='turn/start'){
  turns.push(structuredClone(message.params));
  for(let index=waiters.length-1;index>=0;index--)if(turns.length>=waiters[index].count){send({id:waiters[index].id,result:{turns}});waiters.splice(index,1);}
 }
 child.stdin.write(line+'\n'); // The production native request is forwarded byte-for-byte.
});
function close(){if(closing)return;closing=true;child.kill('SIGTERM');}
process.stdin.on('end',close);process.on('SIGTERM',close);
child.on('exit',(code,signal)=>process.exit(closing||signal?0:code??1));

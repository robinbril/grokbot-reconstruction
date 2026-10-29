#!/usr/bin/env node
// Explicit protocol fixture only; no installed-provider or model completion claim.
// Wrap unchanged owned-command fixture, holding an actual start response when asked.
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('./harness-edges-codex-fixture.mjs',import.meta.url)),...process.argv.slice(2)],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});
const turnStarts=[],heldRequests=[],notifications=[];let closing=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
function notify(message){
 // Item timestamps are required by the saved native v2 JSON schemas.
 if(message.method==='item/started')message.params.startedAtMs??=Date.now();
 if(message.method==='item/completed')message.params.completedAtMs??=Date.now();
 notifications.push(structuredClone(message));send(message);
}
readline.createInterface({input:child.stdout}).on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}if(message.method&&message.id===undefined)notify(message);else send(message);});
child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let message;try{message=JSON.parse(line);}catch{return;}
 if(message.method==='test/turn-binding/state'){send({id:message.id,result:{turnStarts,heldRequests,notifications}});return;}
 if(message.method==='test/turn-binding/emit'){for(const notification of message.params.notifications)notify(notification);send({id:message.id,result:{emitted:message.params.notifications.length}});return;}
 if(message.method==='turn/start'){turnStarts.push(structuredClone(message.params));if(message.params.input.some(input=>input.text?.includes('F81_HOLD_START'))){heldRequests.push(structuredClone(message));return;}}
 child.stdin.write(line+'\n');
});
function close(){if(closing)return;closing=true;child.kill('SIGTERM');}
process.stdin.on('end',close);process.on('SIGTERM',close);child.on('exit',()=>process.exit(0));

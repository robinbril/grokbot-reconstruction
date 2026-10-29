import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClaudeSeatModel} from '../harness/claude-seat-model.mjs';

const messages=[{role:'user',content:'private synthetic request'}];
const tools=[{name:'SendMessage',description:'Send visible answer',inputSchema:{type:'object'}}];
async function fixture(t,mode={}){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'grok-seat-test-'));
 t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const binary=path.join(home,'claude');
 await fs.writeFile(path.join(home,'mode.json'),JSON.stringify(mode));
 await fs.writeFile(binary,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const home=process.env.HOME,mode=JSON.parse(fs.readFileSync(path.join(home,'mode.json')));
const args=process.argv.slice(2);fs.appendFileSync(path.join(home,'calls.jsonl'),JSON.stringify({args,env:process.env,cwd:process.cwd(),pid:process.pid})+'\\n');
if(args.includes('auth')){console.log(JSON.stringify(mode.auth||{loggedIn:true,apiProvider:'firstParty',authMethod:'claude.ai'}));process.exit(0);}
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
 fs.writeFileSync(path.join(home,'prompt.json'),input);
 if(mode.hang){
  if(mode.descendant){require('node:child_process').spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});const fs=require('node:fs'),file=process.argv[1];if(process.argv[2]==='partial'){fs.writeFileSync(file,'');const publication=setInterval(()=>{if(fs.existsSync(file+'.observed')){fs.writeFileSync(file,String(process.pid));clearInterval(publication)}},10)}else fs.writeFileSync(file,String(process.pid));setInterval(()=>{},1000)\",path.join(home,'descendant.pid'),mode.partialDescendantPid?'partial':'complete'],{stdio:'ignore'});}
  setInterval(()=>{},1000);return;}
 if(mode.flood){process.stdout.write('x'.repeat(1100000));return;}
 if(mode.schemaTurnBudget&&Number(args[args.indexOf('--max-turns')+1])<2){console.log(JSON.stringify({type:'result',subtype:'error_max_turns',num_turns:2,is_error:true,errors:['synthetic structured output turn limit']}));process.exitCode=1;return;}
 if(mode.error){console.error('fixture-secret never expose');process.exit(1);}
 if(mode.raw){console.log(mode.raw);return;}
 console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:mode.envelope||{text:'Internal plan',toolCalls:[{id:'one',name:'SendMessage',arguments:{text:{content:'Hello'}}}]}}));
});
`);
 await fs.chmod(binary,0o700);
 const env={PATH:process.env.PATH,HOME:home,GROK_MODEL_PROVIDER:'claude-seat',CLAUDE_MODEL:'claude-sonnet-5-5',CLAUDE_BINARY:binary,ANTHROPIC_API_KEY:'fixture-secret',ANTHROPIC_BASE_URL:'https://bad.invalid',HTTP_PROXY:'https://bad.invalid',NODE_OPTIONS:'--no-warnings',CLAUDE_CODE_USE_BEDROCK:'1'};
 return {home,binary,env,calls:async()=>JSON.parse('['+(await fs.readFile(path.join(home,'calls.jsonl'),'utf8')).trim().split('\n').join(',')+']')};
}
test('requires explicit seat provider, model and executable without exposing config',async t=>{
 const f=await fixture(t);const model=createClaudeSeatModel({env:f.env});
 assert.equal(model.status().provider,'claude-seat');assert.equal(model.status().adapter,'grok-bot-harness');assert.equal(model.status().authentication,'unchecked');
 assert.equal(createClaudeSeatModel({env:{}}).status().state,'unavailable');
 await assert.rejects(createClaudeSeatModel({env:{}}).complete({messages,tools}),{code:'MODEL_NOT_CONFIGURED'});
 assert.equal(createClaudeSeatModel({env:{...f.env,CLAUDE_BINARY:'/missing-fixture'}}).status().state,'unavailable');
});
test('seat performs inference only with private stdin, isolated config and validated envelope',async t=>{
 const f=await fixture(t),model=createClaudeSeatModel({env:f.env});
 assert.deepEqual(await model.complete({messages,tools}),{text:'Internal plan',toolCalls:[{id:'one',name:'SendMessage',arguments:{text:{content:'Hello'}}}]});
 const calls=await f.calls();assert.equal(calls.length,2);const run=calls[1];
 for(const [name,value] of [['--tools',''],['--setting-sources',''],['--max-turns','2'],['--output-format','json'],['--mcp-config','{"mcpServers":{}}']])assert.equal(run.args[run.args.indexOf(name)+1],value);
 for(const flag of ['--strict-mcp-config','--no-session-persistence','--safe-mode','--disable-slash-commands','--json-schema'])assert.ok(run.args.includes(flag));
 assert.ok(!run.args.join(' ').includes('private synthetic'));assert.ok(!run.cwd.startsWith(process.cwd()));
 for(const name of ['ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','HTTP_PROXY','NODE_OPTIONS','CLAUDE_CODE_USE_BEDROCK'])assert.equal(run.env[name],undefined);
 const prompt=JSON.parse(await fs.readFile(path.join(f.home,'prompt.json'),'utf8'));assert.deepEqual(prompt.messages,messages);assert.deepEqual(prompt.tools,tools);
 assert.equal(model.status().authentication,'verified');await assert.rejects(fs.stat(run.cwd),{code:'ENOENT'});
});
test('subscription guard refuses non-seat auth before inference',async t=>{
 const f=await fixture(t,{auth:{loggedIn:true,apiProvider:'firstParty',authMethod:'api_key',apiKeySource:'fixture-secret'}});
 await assert.rejects(createClaudeSeatModel({env:f.env}).complete({messages,tools}),e=>e.code==='MODEL_AUTH_REQUIRED'&&!e.message.includes('fixture-secret'));
 assert.equal((await f.calls()).length,1);
});
test('uses private configured seat-token file without putting it in arguments',async t=>{
 const f=await fixture(t,{auth:{loggedIn:true,apiProvider:'firstParty',authMethod:'oauth_token'}}),file=path.join(f.home,'seat-token');
 await fs.writeFile(file,'fixture-seat-token',{mode:0o600});f.env.GROK_CLAUDE_SEAT_TOKEN_FILE=file;
 await createClaudeSeatModel({env:f.env}).complete({messages,tools});
 const calls=await f.calls();assert.equal(calls[1].env.CLAUDE_CODE_OAUTH_TOKEN,'fixture-seat-token');assert.ok(!calls[1].args.join().includes('fixture-seat-token'));
 await fs.chmod(file,0o644);await assert.rejects(createClaudeSeatModel({env:f.env}).complete({messages,tools}),{code:'MODEL_AUTH_REQUIRED'});
});
for(const [label,envelope] of Object.entries({duplicate:{text:'',toolCalls:[{id:'x',name:'SendMessage',arguments:{}},{id:'x',name:'SendMessage',arguments:{}}]},unknown:{text:'',toolCalls:[{id:'x',name:'Bash',arguments:{}}]},arrayArguments:{text:'',toolCalls:[{id:'x',name:'SendMessage',arguments:[]}]},wrongText:{text:[],toolCalls:[]},missing:{text:''}})){
 test('rejects invalid output: '+label,async t=>{const f=await fixture(t,{envelope});await assert.rejects(createClaudeSeatModel({env:f.env}).complete({messages,tools}),{code:'MODEL_RESPONSE_INVALID'});});
}
test('provider failure, malformed JSON and bounded stdout hide raw diagnostics',async t=>{
 for(const mode of [{error:true},{raw:'not JSON fixture-secret'},{flood:true}]){const f=await fixture(t,mode);await assert.rejects(createClaudeSeatModel({env:f.env}).complete({messages,tools}),e=>['MODEL_PROVIDER_UNAVAILABLE','MODEL_RESPONSE_INVALID','MODEL_OUTPUT_LIMIT'].includes(e.code)&&!e.message.includes('fixture-secret'));}
});
test('abort and timeout terminate inference process and clean neutral working directory',async t=>{
 for(const abort of [true,false]){
  const f=await fixture(t),controller=new AbortController(),timeoutMs=abort?15000:5000;
  // Keep deadline coverage independent of two Node fixture startup times under load.
  await fs.writeFile(f.binary,`#!/bin/sh
for arg do
 if [ "$arg" = auth ]; then
  printf '%s\\n' '{"loggedIn":true,"apiProvider":"firstParty","authMethod":"claude.ai"}'
  exit 0
 fi
done
printf '%s\\n%s\\n' "$$" "$PWD" > "$HOME/inference"
exec /bin/sleep 60
`);
  const started=Date.now(),running=createClaudeSeatModel({env:f.env,timeoutMs}).complete({messages,tools,signal:controller.signal});
  const settled=running.catch(()=>{});
  try{
   let last;const readyBy=Date.now()+10000;
   while(Date.now()<readyBy){
    try{const lines=(await fs.readFile(path.join(f.home,'inference'),'utf8')).split('\n');if(lines.length===3&&lines[0]&&lines[1]){last={pid:Number(lines[0]),cwd:lines[1]};break;}}catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.ok(last,'inference fixture must report readiness before cancellation or timeout');assert.ok(Number.isSafeInteger(last.pid)&&last.pid>0);assert.ok(!last.cwd.startsWith(process.cwd()));
   if(abort)controller.abort();
   await assert.rejects(running,{code:abort?'MODEL_CANCELLED':'MODEL_TIMEOUT'});if(!abort)assert.ok(Date.now()-started>=timeoutMs,'timeout must wait for the configured deadline');
   assert.throws(()=>process.kill(last.pid,0),{code:'ESRCH'});await assert.rejects(fs.stat(last.cwd),{code:'ENOENT'});
  }finally{controller.abort();await settled;}
 }
});

test('cancellation reaps a TERM-resistant descendant after its parent exits',async t=>{
 const f=await fixture(t,{hang:true,descendant:true,partialDescendantPid:true}),controller=new AbortController();
 const running=createClaudeSeatModel({env:f.env,timeoutMs:5000}).complete({messages,tools,signal:controller.signal}),settled=running.catch(()=>{});
 try{
  const file=path.join(f.home,'descendant.pid');let pid,observedEmpty=false;
  for(let i=0;i<200;i++){
   try{const raw=await fs.readFile(file,'utf8');if(raw===''){observedEmpty=true;await fs.writeFile(file+'.observed','ready');}const candidate=Number(raw);if(Number.isSafeInteger(candidate)&&candidate>0){pid=candidate;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(observedEmpty,true,'the real descendant must expose its empty publication window');
  assert.ok(pid);controller.abort();await assert.rejects(running,{code:'MODEL_CANCELLED'});
  for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{return;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail('owned descendant survived cancellation');
 }finally{controller.abort();await settled;}
});

test('structured schema output has the two CLI turns observed in the real subscription failure',async t=>{
 const f=await fixture(t,{schemaTurnBudget:true});
 const result=await createClaudeSeatModel({env:f.env}).complete({messages,tools});
 assert.equal(result.toolCalls[0].name,'SendMessage');
 const args=(await f.calls())[1].args;assert.equal(args[args.indexOf('--max-turns')+1],'2');
 assert.equal(args[args.indexOf('--tools')+1],'');
});
test('required host delivery sets minimum one envelope call and rejects streaming and nonstream private-only output',async t=>{
 const f=await fixture(t,{envelope:{text:'private only',toolCalls:[]}}),model=createClaudeSeatModel({env:f.env});
 for(const onEvent of [undefined,()=>{}]){
  await assert.rejects(model.complete({messages,tools,requireToolCall:true,onEvent}),{code:'MODEL_RESPONSE_INVALID'});
  const args=(await f.calls()).at(-1).args,schema=JSON.parse(args[args.indexOf('--json-schema')+1]);assert.equal(schema.properties.toolCalls.minItems,1);
  assert.deepEqual(await model.complete({messages,tools,requireToolCall:false,onEvent}),{text:'private only',toolCalls:[]});
 }
});
test('CLI contract distinguishes the native StructuredOutput formatter from encoded host delivery',async t=>{
 const f=await fixture(t);await createClaudeSeatModel({env:f.env}).complete({messages,tools,requireToolCall:true});
 const args=(await f.calls())[1].args,instruction=args[args.indexOf('--system-prompt')+1];
 assert.match(instruction,/StructuredOutput is the only native CLI tool/);assert.match(instruction,/Never call SendMessage or any listed host capability as a native CLI tool/);
 assert.ok(instruction.includes('{"text":"Internal planning","toolCalls":[{"id":"call-1","name":"SendMessage","arguments":{"text":{"content":"Hello"}}}]}'));
 assert.ok(!instruction.includes('"arguments":{"message":'));
 assert.match(instruction,/no tools.*no effect requests/i);assert.match(instruction,/still encode SendMessage/i);
 assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--max-turns')+1],'2');for(const flag of ['--strict-mcp-config','--safe-mode','--setting-sources'])assert.ok(args.includes(flag));assert.equal(args[args.indexOf('--settings')+1],'{"disableAllHooks":true}');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createClaudeSeatModel} from '../harness/claude-seat-model.mjs';
async function fixture(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'seat-stream-test-')),binary=path.join(home,'claude');t.after(()=>fs.rm(home,{recursive:true,force:true}));
 await fs.writeFile(binary,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),home=process.env.HOME;
if(args.includes('auth')){console.log(JSON.stringify({loggedIn:true,apiProvider:'firstParty',authMethod:'claude.ai'}));process.exit(0);}
fs.writeFileSync(path.join(home,'args.json'),JSON.stringify(args));
const emit=value=>console.log(JSON.stringify(value));let input='';process.stdin.on('data',value=>input+=value);process.stdin.on('end',()=>{
 fs.writeFileSync(path.join(home,'input.json'),input);
 emit({type:'stream_event',event:{type:'message_start'}});
 emit({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'tool_use',name:'StructuredOutput'}}});
 emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({text:'private planning',toolCalls:[{id:'a',name:'SendMessage',arguments:{text:{content:'Hello'}}}]}).slice(0,-6)}}});
 const timer=setInterval(()=>{if(!fs.existsSync(path.join(home,'release')))return;clearInterval(timer);
  emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'!"}}}]}'}}});
  emit({type:'result',subtype:'success',is_error:false,structured_output:{text:'private planning',toolCalls:[{id:'a',name:'SendMessage',arguments:{text:{content:'Hello!'}}}]}});
 },5);
});
`);await fs.chmod(binary,0o700);
 return {home,model:createClaudeSeatModel({env:{PATH:process.env.PATH,HOME:home,GROK_MODEL_PROVIDER:'claude-seat',CLAUDE_MODEL:'synthetic',CLAUDE_BINARY:binary}})};
}
test('seat subprocess streams before exit with isolated flags and genuine multimodal input',{timeout:30000},async t=>{
 const {home,model}=await fixture(t);let completed=false,firstDelta;const events=[],controller=new AbortController();
 const visible=new Promise(resolve=>{firstDelta=resolve;});
 const running=model.complete({messages:[{role:'user',content:[{type:'text',text:'inspect'},{type:'image_url',image_url:{url:'data:image/png;base64,YWJj'}}]}],tools:[{name:'SendMessage'}],signal:AbortSignal.any([controller.signal,t.signal]),onEvent:event=>{events.push(event);if(event.type==='message.delta'&&event.text)firstDelta();}}).then(value=>{completed=true;return value;});
 try{
  // The child must deliver visible text while its release gate still prevents exit.
  await Promise.race([visible,running.then(()=>{throw new Error('Seat completed before a nonempty streaming delta');})]);
  assert.equal(completed,false);assert.equal(events.map(e=>e.text).join(''),'Hello');
  const args=JSON.parse(await fs.readFile(path.join(home,'args.json'),'utf8'));for(const flag of ['--verbose','--include-partial-messages','--safe-mode','--strict-mcp-config','--disable-slash-commands'])assert.ok(args.includes(flag));assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--max-turns')+1],'2');assert.equal(args[args.indexOf('--output-format')+1],'stream-json');assert.equal(args[args.indexOf('--input-format')+1],'stream-json');
  const input=JSON.parse(await fs.readFile(path.join(home,'input.json'),'utf8'));assert.equal(input.message.content[1].type,'image');assert.equal(input.message.content[1].source.data,'YWJj');
  await fs.writeFile(path.join(home,'release'),'yes');const result=await running;assert.equal(result.toolCalls[0].arguments.text.content,'Hello!');assert.equal(events.map(e=>e.text).join(''),'Hello!');
 }finally{
  controller.abort();await running.catch(()=>{});
 }
});

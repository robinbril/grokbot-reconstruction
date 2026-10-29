import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrokModel} from '../harness/grok-model.mjs';
import {jsonPrefix,visibleStream,readXaiStream} from '../harness/model-streaming.mjs';
import {claudeStream,claudeInput} from '../harness/claude-streaming.mjs';
const tools=[{name:'SendMessage',inputSchema:{type:'object'}}];
const frame=delta=>'data: '+JSON.stringify({choices:[{delta}]})+'\n\n';
const end='data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
const model=body=>createGrokModel({env:{XAI_API_KEY:'synthetic',XAI_MODEL:'synthetic'},fetchImpl:async(_url,options)=>{assert.equal(JSON.parse(options.body).stream,true);return new Response(body);}});
test('synthetic xAI structured-content SSE fragments publish SendMessage before stream closes and never private text',async()=>{
 let writer,finished=false;const stream=new ReadableStream({start(c){writer=c;}}),events=[];
 const running=model(stream).complete({messages:[],tools,onEvent:event=>events.push(event)}).then(value=>{finished=true;return value;});
 writer.enqueue(new TextEncoder().encode(frame({content:'{"text":"hidden planning","toolCalls":[{"id":"call","name":"SendMessage","arguments":{"text":{"content":"Hello '})));
 for(let i=0;i<100&&!events.length;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(finished,false);assert.deepEqual(events,[{type:'message.delta',callId:'call',text:'Hello '}]);
 const ending=frame({content:'🌍\\n\\"ok\\""}}}]}'})+end;
 for(const byte of new TextEncoder().encode(ending))writer.enqueue(new Uint8Array([byte]));writer.close();
 const result=await running;assert.equal(result.toolCalls[0].arguments.text.content,'Hello 🌍\n"ok"');assert.equal(events.map(e=>e.text).join(''),'Hello 🌍\n"ok"');assert.equal(result.text,'hidden planning');
});
test('stream JSON handles partial escapes, Unicode and ignores other tool fields',async()=>{
 assert.equal(jsonPrefix('{"text":{"content":"A\\uD83D').text.content,'A\uD83D');const events=[],visible=visibleStream(e=>events.push(e));
 await visible.envelope(jsonPrefix('{"text":"private","toolCalls":[{"id":"a","name":"SendMessage","arguments":{"text":{"content":"A\\uD83D'));
 assert.deepEqual(events,[{type:'message.delta',callId:'a',text:'A'}]);
 await visible.envelope(jsonPrefix('{"toolCalls":[{"arguments":{"text":{"content":"A\\uD83D\\uDE00"}},"id":"a","name":"SendMessage"}]}'));
 assert.equal(events.map(e=>e.text).join(''),'A😀');
 assert.throws(()=>visible.reconcile({toolCalls:[]}),{code:'MODEL_RESPONSE_INVALID'});
});
test('xAI rejects malformed stream, invalid UTF8, incomplete finish, and final argument revision',async()=>{
 for(const raw of [frame({tool_calls:[{index:0,id:'a',function:{name:'SendMessage',arguments:'{"text":{"content":"hello"'}}]})+end, 'data: {bad}\n\n',frame({content:'private'}),new Uint8Array([0xff,10])]){
  const body=typeof raw==='string'?new TextEncoder().encode(raw):raw;
  await assert.rejects(model(body).complete({messages:[],tools,onEvent:()=>{}}),{code:'MODEL_RESPONSE_INVALID'});
 }
});
test('aborting an open SSE cancels its stream without a completed response',async()=>{
 let cancelled=false;const controller=new AbortController(),stream=new ReadableStream({cancel(){cancelled=true;}});
 const running=model(stream).complete({messages:[],tools,signal:controller.signal,onEvent:()=>{}});controller.abort();await assert.rejects(running,{code:'MODEL_CANCELLED'});assert.equal(cancelled,true);
});
test('Claude only streams the StructuredOutput SendMessage envelope and validates final result',async()=>{
 const events=[],stream=claudeStream(e=>events.push(e));const emit=value=>stream.line(JSON.stringify(value));
 await emit({type:'stream_event',event:{type:'message_start'}});
 await emit({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text'}}});
 await emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'private reasoning'}}});
 await emit({type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'tool_use',name:'StructuredOutput'}}});
 await emit({type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"text":"private","toolCalls":[{"id":"a","name":"SendMessage","arguments":{"text":{"content":"Hi'}}});
 assert.deepEqual(events,[{type:'message.delta',callId:'a',text:'Hi'}]);
 await emit({type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'!"}}}]}'}}});
 await emit({type:'result',structured_output:{text:'private',toolCalls:[{id:'a',name:'SendMessage',arguments:{text:{content:'Hi!'}}}]}});
 assert.equal(stream.finish(value=>value.structured_output).toolCalls[0].arguments.text.content,'Hi!');assert.equal(events.map(e=>e.text).join(''),'Hi!');
});
test('Claude canonical images become actual native image blocks outside serialized conversation',()=>{
 const value=JSON.parse(claudeInput([{role:'user',content:[{type:'text',text:'inspect'},{type:'image_url',image_url:{url:'data:image/png;base64,YWJj'}}]}],tools));
 assert.equal(value.message.content[1].type,'image');assert.equal(value.message.content[1].source.data,'YWJj');assert.equal(value.message.content[1].source.media_type,'image/png');assert.ok(!value.message.content[0].text.includes('YWJj'));
});
test('prototype-shaped JSON never promotes unrelated fields into visible SendMessage arguments',async()=>{
 const events=[],visible=visibleStream(event=>events.push(event));
 const source='{"toolCalls":[{"id":"a","name":"SendMessage","arguments":{"__proto__":{"text":{"content":"PRIVATE_OTHER_FIELD"}}}}]}';
 await visible.envelope(jsonPrefix(source));assert.deepEqual(events,[]);
 await visible.envelope({toolCalls:[{id:'b',name:'SendMessage',arguments:Object.create({text:{content:'PRIVATE_INHERITED'}})}]});assert.deepEqual(events,[]);
 await visible.envelope(Object.create({toolCalls:[{id:'c',name:'SendMessage',arguments:{text:{content:'PRIVATE_INHERITED_CALLS'}}}]}));assert.deepEqual(events,[]);
 const parsed=jsonPrefix('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');assert.equal(Object.getPrototypeOf(parsed),null);assert.equal(Object.hasOwn(parsed,'__proto__'),true);assert.equal({}.polluted,undefined);
});

test('native whole tool-call chunks cannot masquerade as progressive structured-content output',async()=>{
 const events=[],raw=frame({tool_calls:[{index:0,id:'a',function:{name:'SendMessage',arguments:'{"text":{"content":"complete native chunk"}}'}}]})+end;
 await assert.rejects(model(raw).complete({messages:[],tools,onEvent:event=>events.push(event)}),{code:'MODEL_RESPONSE_INVALID'});assert.deepEqual(events,[]);
});
test('unordered partial metadata waits for complete id and name strings before visibility',async()=>{
 let writer;const stream=new ReadableStream({start(controller){writer=controller;}}),events=[];
 const running=model(stream).complete({messages:[],tools,onEvent:event=>events.push(event)});
 writer.enqueue(new TextEncoder().encode(frame({content:'{"toolCalls":[{"arguments":{"text":{"content":"Hello"}},"id":"partial'})));
 await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(events,[]);
 writer.enqueue(new TextEncoder().encode(frame({content:'-id","name":"SendMessage'})));await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(events,[]);
 writer.enqueue(new TextEncoder().encode(frame({content:'"}],"text":"private"}'})+end));writer.close();await running;assert.deepEqual(events,[{type:'message.delta',callId:'partial-id',text:'Hello'}]);
});
test('legacy synthetic function-call parser retains fragmented-argument coverage but is not production streaming',async()=>{
 const events=[],raw=frame({tool_calls:[{index:0,id:'legacy',function:{name:'SendMessage',arguments:'{"text":{"content":"Hel'}}]})+frame({tool_calls:[{index:0,function:{arguments:'lo"}}'}}]})+end.replace('"stop"','"tool_calls"');
 const result=await readXaiStream(new Response(raw),{onEvent:event=>events.push(event),decode:value=>({text:value.content,toolCalls:value.tool_calls.map(call=>({id:call.id,name:call.function.name,arguments:JSON.parse(call.function.arguments)}))})});assert.equal(result.toolCalls[0].arguments.text.content,'Hello');assert.equal(events.map(event=>event.text).join(''),'Hello');
});

test('synthetic structured xAI refusal, native finish, over-limit calls and final mismatch fail closed',async()=>{
 const answer={text:'private',toolCalls:[{id:'a',name:'SendMessage',arguments:{text:{content:'visible'}}}]};
 const cases=[frame({refusal:'cannot answer'})+end,frame({content:JSON.stringify(answer)})+end.replace('"stop"','"tool_calls"'),frame({content:JSON.stringify({...answer,toolCalls:Array.from({length:33},(_,index)=>({id:String(index),name:'SendMessage',arguments:{text:{content:'x'}}}))})})+end,frame({content:'{"text":"private","toolCalls":[{"id":"a","name":"SendMessage","arguments":{"text":{"content":"visible"}},"name":"Other"}]}'})+end];
 for(const raw of cases)await assert.rejects(model(raw).complete({messages:[],tools,onEvent:()=>{}}),{code:'MODEL_RESPONSE_INVALID'});
});

test('only the own native text.content branch is eligible for visible prefixes',async()=>{
 const events=[],visible=visibleStream(event=>events.push(event));
 const invalidArguments=[{message:'LEGACY_PRIVATE'},{attachment:{url:'PRIVATE_URL'}},{text:{content:'PRIVATE'},reply_to:'invalid id'},{text:{content:'PRIVATE'},attachment:{url:'PRIVATE_URL'}},{text:'PRIVATE'},{text:null},{text:[]},{text:{}},{text:{content:42}},{text:{content:'PRIVATE',other:'PRIVATE_OTHER'}},{text:Object.create({content:'PRIVATE_INHERITED_CONTENT'})}];
 for(const args of invalidArguments)await visible.envelope({text:'PRIVATE_PLANNING',toolCalls:[{id:'a',name:'SendMessage',arguments:args}]});
 await visible.envelope({toolCalls:[{id:'other',name:'OtherTool',arguments:{text:{content:'PRIVATE_TOOL'}}}]});
 assert.deepEqual(events,[]);
 await visible.envelope(jsonPrefix('{"toolCalls":[{"id":"a","name":"SendMessage","arguments":{"text":{"content":"He'));
 assert.deepEqual(events,[{type:'message.delta',callId:'a',text:'He'}]);
 await visible.envelope(jsonPrefix('{"toolCalls":[{"id":"a","name":"SendMessage","arguments":{"text":{"content":"Hello"}}}]}'));
 assert.equal(events.map(event=>event.text).join(''),'Hello');
 assert.equal(visible.reconcile({toolCalls:[{id:'a',name:'SendMessage',arguments:{text:{content:'Hello'}}}]}).toolCalls[0].id,'a');
 for(const args of [...invalidArguments,{text:{content:'different'}}])assert.throws(()=>visible.reconcile({toolCalls:[{id:'a',name:'SendMessage',arguments:args}]}),{code:'MODEL_RESPONSE_INVALID'});
});
test('prefix bounds and nested escape fragments fail closed without leaking another field',async()=>{
 const events=[],visible=visibleStream(event=>events.push(event));
 const prefix='{"text":"PRIVATE","toolCalls":[{"id":"a","name":"SendMessage","arguments":{"text":{"content":"A';
 await visible.envelope(jsonPrefix(prefix+'\\uD8'));assert.equal(events.map(event=>event.text).join(''),'A');
 await visible.envelope(jsonPrefix(prefix+'\\uD83D'));assert.equal(events.map(event=>event.text).join(''),'A');
 await visible.envelope(jsonPrefix(prefix+'\\uD83D\\uDE00\\'));assert.equal(events.map(event=>event.text).join(''),'A😀');
 await visible.envelope(jsonPrefix(prefix+'\\uD83D\\uDE00\\nB"}}}]}'));assert.equal(events.map(event=>event.text).join(''),'A😀\nB');
 assert.throws(()=>jsonPrefix('{"text":'+ '['.repeat(33)),{code:'MODEL_RESPONSE_INVALID'});
 const raw=frame({tool_calls:[{index:0,id:'a',function:{name:'SendMessage',arguments:'{"text":{"content":"'+ 'x'.repeat(131073)}}]})+end;
 await assert.rejects(readXaiStream(new Response(raw),{onEvent:()=>{},decode:value=>value}),{code:'MODEL_RESPONSE_INVALID'});
});

test('reply text streams in either field order while attachment fields stay private',async()=>{
 for(const prefix of ['{"reply_to":"user-1","text":{"content":"Hel','{"text":{"content":"Hel']){
  const events=[],visible=visibleStream(event=>events.push(event));
  const envelope=argumentsPrefix=>jsonPrefix('{"toolCalls":[{"id":"reply","name":"SendMessage","arguments":'+argumentsPrefix);
  await visible.envelope(envelope(prefix));
  assert.deepEqual(events,[{type:'message.delta',callId:'reply',text:'Hel'}]);
  const args={text:{content:'Hello'},reply_to:'user-1'};
  await visible.envelope({toolCalls:[{id:'reply',name:'SendMessage',arguments:args}]});
  assert.equal(events.map(event=>event.text).join(''),'Hello');
  assert.equal(visible.reconcile({toolCalls:[{id:'reply',name:'SendMessage',arguments:args}]}).toolCalls[0].id,'reply');
 }
 const events=[],visible=visibleStream(event=>events.push(event));
 await visible.envelope({toolCalls:[{id:'file',name:'SendMessage',arguments:{attachment:{url:'PRIVATE_URL',alt:'PRIVATE_ALT'},reply_to:'user-1'}}]});
 assert.deepEqual(events,[]);
});

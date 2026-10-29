import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrokModel} from '../harness/grok-model.mjs';
test('the independent model adapter requires explicit provider credentials and model without a coding CLI',async()=>{
 const model=createGrokModel({env:{}});assert.equal(model.status().state,'unavailable');assert.equal(model.status().adapter,'grok-bot-harness');
 await assert.rejects(()=>model.complete({messages:[],tools:[]}),{code:'MODEL_NOT_CONFIGURED'});
});
test('the model supplies structured tool requests while the host owns execution',async()=>{
 let sent;const model=createGrokModel({env:{XAI_API_KEY:'fixture-key',XAI_MODEL:'fixture-model'},fetchImpl:async(url,options)=>{sent={url,options};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'Internal plan',toolCalls:[{id:'call-1',name:'SendMessage',arguments:{message:'Actual answer'}}]})}}]});}});
 const result=await model.complete({messages:[{role:'user',content:'Hello'}],tools:[{name:'SendMessage',description:'Deliver a message',inputSchema:{type:'object'}}]});
 assert.equal(result.text,'Internal plan');assert.deepEqual(result.toolCalls,[{id:'call-1',name:'SendMessage',arguments:{message:'Actual answer'}}]);
 const body=JSON.parse(sent.options.body);assert.equal(body.tools,undefined);assert.equal(body.parallel_tool_calls,undefined);assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.schema.properties.toolCalls.items.properties.arguments.additionalProperties,true);assert.match(body.messages[0].content,/inference/);assert.equal(JSON.parse(body.messages[1].content[0].text).tools[0].name,'SendMessage');assert.equal(body.model,'fixture-model');assert.equal(body.stream,false);assert.equal(sent.options.headers.Authorization,'Bearer fixture-key');assert.ok(!JSON.stringify(model.status()).includes('fixture-key'));
});
test('provider errors and malformed tool requests never expose credentials or execute tools',async()=>{
 const env={XAI_API_KEY:'fixture-secret',XAI_MODEL:'fixture-model'};
 const denied=createGrokModel({env,fetchImpl:async()=>new Response('fixture-secret',{status:401})});await assert.rejects(()=>denied.complete({messages:[],tools:[]}),error=>error.code==='MODEL_AUTH_REQUIRED'&&!error.message.includes('fixture-secret'));
 const invalid=createGrokModel({env,fetchImpl:async()=>Response.json({choices:[{message:{tool_calls:[{id:'a',function:{name:'SendMessage',arguments:'not-json'}}]}}]})});await assert.rejects(()=>invalid.complete({messages:[],tools:[]}),{code:'MODEL_RESPONSE_INVALID'});
});

test('canonical images remain native image blocks outside serialized inference context',async()=>{
 let body;const model=createGrokModel({env:{XAI_API_KEY:'synthetic',XAI_MODEL:'synthetic'},fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'private',toolCalls:[]})}}]});}});
 const image={type:'image_url',image_url:{url:'data:image/png;base64,YWJj'}};await model.complete({messages:[{role:'user',content:[{type:'text',text:'inspect'},image]}],tools:[]});
 assert.deepEqual(body.messages[1].content[1],image);assert.equal(body.messages[1].content[0].text.includes('YWJj'),false);assert.match(body.messages[1].content[0].text,/Image 1/);
});
test('strict envelope rejects unknown names, duplicate IDs, extra fields, invalid arguments and provider refusal without fallback',async()=>{
 const base={text:'private',toolCalls:[{id:'a',name:'SendMessage',arguments:{message:'answer'}}]};
 for(const envelope of [{...base,extra:'bad'},{...base,toolCalls:[{...base.toolCalls[0],name:'Unknown'}]},{...base,toolCalls:[base.toolCalls[0],base.toolCalls[0]]},{...base,toolCalls:[{...base.toolCalls[0],arguments:[]}]},{...base,toolCalls:[{...base.toolCalls[0],extra:'bad'}]}]){
  const model=createGrokModel({env:{XAI_API_KEY:'synthetic',XAI_MODEL:'synthetic'},fetchImpl:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(envelope)}}]})});await assert.rejects(model.complete({messages:[],tools:[{name:'SendMessage'}]}),{code:'MODEL_RESPONSE_INVALID'});
 }
 let calls=0;const model=createGrokModel({env:{XAI_API_KEY:'synthetic',XAI_MODEL:'synthetic'},fetchImpl:async()=>{calls++;return new Response('unsupported response schema with private diagnostics',{status:400});}});await assert.rejects(model.complete({messages:[],tools:[]}),{code:'MODEL_PROVIDER_UNAVAILABLE'});assert.equal(calls,1);
});
test('required host delivery constrains streaming and nonstream envelopes without exposing private text',async()=>{
 let sent;const model=createGrokModel({env:{XAI_API_KEY:'synthetic',XAI_MODEL:'synthetic'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);const content=JSON.stringify({text:'private only',toolCalls:[]});return sent.stream?new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'):Response.json({choices:[{finish_reason:'stop',message:{content}}]});}});
 for(const onEvent of [undefined,()=>{}]){
  await assert.rejects(model.complete({messages:[],tools:[{name:'SendMessage'}],requireToolCall:true,onEvent}),{code:'MODEL_RESPONSE_INVALID'});assert.equal(sent.response_format.json_schema.schema.properties.toolCalls.minItems,1);
  assert.deepEqual(await model.complete({messages:[],tools:[{name:'SendMessage'}],requireToolCall:false,onEvent}),{text:'private only',toolCalls:[]});
 }
});

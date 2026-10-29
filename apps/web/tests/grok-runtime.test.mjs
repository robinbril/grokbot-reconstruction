import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
const ready={status:async()=>({state:'ready',provider:'fixture',model:'fixture'})};
async function setup(t,options={}){const store=await new HarnessStore({dataDir:await mkdtemp(path.join(tmpdir(),'grok-core-'))}).init();const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',...options});t.after(()=>runtime.close());return {store,runtime};}
async function finished(store,id='one'){for(let i=0;i<300;i++){const state=store.states.get(id);if(state?.runs.length&&!['accepted','starting','running','waiting_approval','cancelling'].includes(state.runs.at(-1).status))return state;await new Promise(r=>setTimeout(r,10));}assert.fail('run did not finish');}

test('missing model fails before accepting work',async t=>{const {runtime,store}=await setup(t);await assert.rejects(runtime.start('a','one',{requestId:'first',text:'hello'}),{code:'MODEL_NOT_CONFIGURED'});assert.equal(store.states.get('one')?.runs.length??0,0);});

test('independent loop performs real file effect, feeds exact result back and exposes only SendMessage',async t=>{
 let rounds=0;const model={...ready,complete:async({messages})=>{rounds++;if(rounds===1)return {text:'private planning',toolCalls:[{id:'call-1',name:'WriteFile',arguments:{content:'actual bytes'}}]};assert.ok(JSON.stringify(messages).includes('written'));return {text:'internal final',toolCalls:[{id:'call-2',name:'SendMessage',arguments:{text:{content:'Done with actual bytes'}}}]};}};
 const {runtime,store}=await setup(t,{model,toolHostFactory:async({workspace})=>({getDefinitions:()=>[{name:'WriteFile',inputSchema:{type:'object',properties:{content:{type:'string'}},required:['content'],additionalProperties:false}}],call:async(name,args)=>{assert.equal(name,'WriteFile');await writeFile(path.join(workspace,'proof.txt'),args.content);return {written:true};},close:async()=>{}})});
 const input={requestId:'first',text:'write a file'},accepted=await runtime.start('a','one',input);assert.deepEqual(await runtime.start('a','one',input),accepted);const state=await finished(store);assert.equal(state.runs[0].status,'completed');assert.equal(state.entries[1].text,'Done with actual bytes');assert.equal(await readFile(path.join(state.workspaceRoot,'proof.txt'),'utf8'),'actual bytes');assert.equal(rounds,2);assert.equal(state.tools[0].status,'completed');await assert.rejects(runtime.start('a','one',{...input,text:'different'}),{code:'IDEMPOTENCY_CONFLICT'});await assert.rejects(runtime.cancel('other',accepted.runId),{code:'NOT_FOUND'});
});

test('unknown tools and repeated tool call identifiers cannot execute effects',async t=>{
 let effects=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async()=>({toolCalls:[{id:'repeat',name:'Unknown',arguments:{}}]})},toolHostFactory:async()=>({getDefinitions:()=>[],call:async()=>effects++,close:async()=>{}})});await runtime.start('a','one',{requestId:'first',text:'bad'});const state=await finished(store);assert.equal(state.runs[0].status,'failed');assert.equal(effects,0);assert.equal(state.runs[0].error.code,'UNKNOWN_TOOL');
});

test('terminal fails closed without independent executor',async t=>{const {runtime}=await setup(t);await assert.rejects(runtime.terminal('a','one','pwd','terminal-one'),{code:'TERMINAL_UNAVAILABLE'});});

test('private model text stays out of visible entries and no SendMessage fails explicitly',async t=>{
 const {runtime,store}=await setup(t,{model:{...ready,complete:async()=>({text:'private-only-content',toolCalls:[]})}});await runtime.start('a','one',{requestId:'first',text:'hi'});const state=await finished(store);assert.equal(state.runs[0].status,'failed');assert.equal(state.runs[0].error.code,'MODEL_MESSAGE_REQUIRED');assert.equal(state.entries[1].text,'');
});

test('exact tool approval blocks effect and rejects cross-owner decisions',async t=>{
 let effects=0,round=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async()=>++round===1?{toolCalls:[{id:'approved-call',name:'Danger',arguments:{value:'exact'}}]}:{toolCalls:[{id:'reply',name:'SendMessage',arguments:{text:{content:'Effect confirmed'}}}]}},toolHostFactory:async()=>({getDefinitions:()=>[{name:'Danger',requiresApproval:true,inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}],call:async()=>{effects++;return {done:true};},close:async()=>{}})});
 const accepted=await runtime.start('a','one',{requestId:'first',text:'perform approved effect'});let approval;
 for(let i=0;i<100&&!approval;i++){approval=store.states.get('one')?.runs[0].approvals[0];if(!approval)await new Promise(r=>setTimeout(r,10));}assert.ok(approval);assert.equal(effects,0);assert.deepEqual(approval.operation.arguments,{value:'exact'});
 await assert.rejects(runtime.decide('other',accepted.runId,approval.id,'approve'),{code:'NOT_FOUND'});await runtime.decide('a',accepted.runId,approval.id,'approve');assert.equal((await finished(store)).runs[0].status,'completed');assert.equal(effects,1);
});

test('cancel during pending approval produces cancelled run and no effect',async t=>{
 let effects=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async()=>({toolCalls:[{id:'blocked',name:'Danger',arguments:{}}]})},toolHostFactory:async()=>({getDefinitions:()=>[{name:'Danger',requiresApproval:true,inputSchema:{type:'object',properties:{}}}],call:async()=>effects++,close:async()=>{}})});
 const accepted=await runtime.start('a','one',{requestId:'first',text:'wait'});for(let i=0;i<100&&!store.states.get('one')?.runs[0].approvals.length;i++)await new Promise(r=>setTimeout(r,10));await runtime.cancel('a',accepted.runId);const state=await finished(store);assert.equal(state.runs[0].status,'cancelled');assert.equal(effects,0);
});

test('repeated call ID is rejected before a second effect',async t=>{
 let effects=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async()=>({toolCalls:[{id:'duplicate',name:'Count',arguments:{}}]})},toolHostFactory:async()=>({getDefinitions:()=>[{name:'Count',inputSchema:{type:'object',properties:{}}}],call:async()=>({effects:++effects}),close:async()=>{}})});await runtime.start('a','one',{requestId:'first',text:'count'});const state=await finished(store);assert.equal(state.runs[0].status,'interrupted');assert.equal(state.runs[0].error.code,'MODEL_TOOL_ID_INVALID');assert.equal(effects,1);
});

test('internal transcript preserves actual tool results across completed runs without replaying work',async t=>{
 let round=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async({messages})=>{round++;if(round===1)return {text:'internal reasoning',toolCalls:[{id:'effect-1',name:'Check',arguments:{}}]};if(round===3)assert.ok(messages.some(message=>message.role==='tool'&&message.content.includes('actual-result')));return {toolCalls:[{id:'reply-'+round,name:'SendMessage',arguments:{text:{content:'Visible reply'}}}]};}},toolHostFactory:async()=>({getDefinitions:()=>[{name:'Check',inputSchema:{type:'object',properties:{}}}],call:async()=>({value:'actual-result'}),close:async()=>{}})});
 await runtime.start('a','one',{requestId:'first',text:'check'});await finished(store);assert.ok(store.states.get('one').agentHistory);await runtime.start('a','one',{requestId:'second',text:'remember result'});assert.equal((await finished(store)).runs[1].status,'completed');assert.equal(round,3);
});

test('concurrent contradictory approval decisions cannot authorize twice',async t=>{
 let effects=0,round=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async()=>++round===1?{toolCalls:[{id:'approval-call',name:'Danger',arguments:{}}]}:{toolCalls:[{id:'message',name:'SendMessage',arguments:{text:{content:'done'}}}]}},toolHostFactory:async()=>({getDefinitions:()=>[{name:'Danger',requiresApproval:true,inputSchema:{type:'object'}}],call:async()=>({effects:++effects}),close:async()=>{}})});const accepted=await runtime.start('a','one',{requestId:'first',text:'approve'});
 let approval;for(let i=0;i<100&&!approval;i++){approval=store.states.get('one')?.runs[0].approvals[0];if(!approval)await new Promise(r=>setTimeout(r,10));}
 const decisions=await Promise.allSettled([runtime.decide('a',accepted.runId,approval.id,'approve'),runtime.decide('a',accepted.runId,approval.id,'reject')]);assert.equal(decisions[0].status,'fulfilled');assert.equal(decisions[1].status,'rejected');assert.equal(decisions[1].reason.code,'IDEMPOTENCY_CONFLICT');await finished(store);assert.equal(effects,1);
});

test('only configured independent connector data is saved and duplicated registration is idempotent',async t=>{
 const {runtime,store}=await setup(t);await runtime.register('a','one',{id:'docs',name:'Docs',url:'https://example.com/mcp'},'register-one');const s=store.states.get('one');assert.equal(s.customServers[0].runtimeId,'custom_docs');await runtime.register('a','one',{id:'docs',name:'Docs',url:'https://example.com/mcp'},'register-one');assert.equal(store.states.get('one').customServers.length,1);await runtime.configureMcp('a','one','custom_docs','state',{enabled:false},'disable-one');assert.equal(store.states.get('one').customServers[0].enabled,false);
});

test('seventh conversation reclaims oldest idle connection and updates usage on reuse',async t=>{
 const {runtime}=await setup(t,{maxChildren:6});for(let i=0;i<6;i++)await runtime.connect('a','idle-'+i);const first=runtime.connections.get('idle-0');first.lastUsed=1;await runtime.connect('a','idle-1');await runtime.connect('a','idle-6');assert.equal(runtime.connections.size,6);assert.equal(runtime.connections.has('idle-0'),false);assert.equal(runtime.connections.has('idle-1'),true);
});

test('capacity never evicts active model/tool/terminal/configuration connections',async t=>{
 const {runtime}=await setup(t,{maxChildren:1});const c=await runtime.connect('a','busy');for(const block of ['tool','terminal','config','lifecycle']){
  if(block==='tool')c.toolControllers.set(new AbortController(),null);if(block==='terminal')c.terminals.set('running',new AbortController());if(block==='config')c.configuringMcp=true;if(block==='lifecycle')runtime.lifecycle.set('busy',new Promise(()=>{}));
  await assert.rejects(runtime.connect('a','blocked-'+block),{code:'RUNTIME_CAPACITY'});assert.equal(runtime.connections.get('busy'),c);c.toolControllers.clear();c.terminals.clear();delete c.configuringMcp;runtime.lifecycle.delete('busy');
 }
});

test('tool JSON Schema accepts unions and rejects pattern/range/composition violations',async t=>{
 let effects=0;const schema={type:'object',properties:{value:{type:['string','null'],pattern:'^[A-Z]+$'},amount:{anyOf:[{type:'integer',minimum:1,maximum:3},{const:null}]}},required:['value','amount'],additionalProperties:false};
 const {runtime}=await setup(t,{toolHostFactory:async()=>({getDefinitions:()=>[{name:'Constrained',inputSchema:schema}],call:async()=>({effects:++effects}),close:async()=>{}})});const c=await runtime.connect('a','schema');
 assert.deepEqual(await runtime.callTool(c,'Constrained',{value:null,amount:2}),{effects:1});for(const args of [{value:'lower',amount:2},{value:'ABC',amount:7},{value:'ABC',amount:'2'}])await assert.rejects(runtime.callTool(c,'Constrained',args),{code:'INVALID_TOOL_ARGUMENTS'});assert.equal(effects,1);
});

test('confirmed first effect survives later failed call in internal history',async t=>{
 let round=0;const {runtime,store}=await setup(t,{model:{...ready,complete:async({messages})=>{if(++round===1)return {toolCalls:[{id:'a',name:'First',arguments:{}},{id:'b',name:'Second',arguments:{}}]};assert.ok(messages.some(m=>m.role==='tool'&&m.content.includes('confirmed-first-effect')));return {toolCalls:[{id:'reply',name:'SendMessage',arguments:{text:{content:'Prior effect remembered'}}}]};}},toolHostFactory:async()=>({getDefinitions:()=>['First','Second'].map(name=>({name,inputSchema:{type:'object'}})),call:async name=>{if(name==='First')return {value:'confirmed-first-effect'};throw new Error('second failed');},close:async()=>{}})});
 await runtime.start('a','one',{requestId:'first',text:'two effects'});assert.equal((await finished(store)).runs[0].status,'interrupted');await runtime.start('a','one',{requestId:'second',text:'what happened'});assert.equal((await finished(store)).runs[1].status,'completed');
});

test('restart repairs a dangling second call without replaying or losing confirmed result',async t=>{
 const {runtime,store}=await setup(t,{model:{...ready,complete:async({messages})=>{const result=messages.find(m=>m.role==='tool'&&m.tool_call_id==='pending');assert.ok(result);assert.match(result.content,/uncertain|interrupted/i);assert.ok(messages.some(m=>m.role==='tool'&&m.content.includes('first-confirmed')));return {toolCalls:[{id:'after-restart',name:'SendMessage',arguments:{text:{content:'State reconciled'}}}]};}}});
 await store.transaction('a','one',s=>{s.agentHistory=[{role:'user',content:'old task'},{role:'assistant',content:'',tool_calls:[{id:'first',type:'function',function:{name:'First',arguments:'{}'}},{id:'pending',type:'function',function:{name:'Second',arguments:'{}'}}]},{role:'tool',tool_call_id:'first',content:'first-confirmed'}];});
 await runtime.start('a','one',{requestId:'new-task',text:'continue safely'});assert.equal((await finished(store)).runs[0].status,'completed');
});
test('current turn requires a host call until delivery then permits a mixed-step end',async t=>{
 const required=[];let step=0;
 const {runtime,store}=await setup(t,{model:{...ready,complete:async({requireToolCall})=>{required.push(requireToolCall);if(++step===1)return {toolCalls:[{id:'delivery',name:'SendMessage',arguments:{text:{content:'Visible answer'}}},{id:'check',name:'Check',arguments:{}}]};return {text:'private ending',toolCalls:[]};}},toolHostFactory:async()=>({getDefinitions:()=>[{name:'Check',inputSchema:{type:'object'}}],call:async()=>({checked:true}),close:async()=>{}})});
 await runtime.start('a','one',{requestId:'first',text:'hi'});assert.equal((await finished(store)).runs[0].status,'completed');assert.deepEqual(required,[true,false]);
 required.length=0;await runtime.start('a','one',{requestId:'second',text:'new turn'});assert.equal((await finished(store)).runs[1].status,'failed');assert.deepEqual(required,[true]);assert.equal(store.states.get('one').runs[1].error.code,'MODEL_MESSAGE_REQUIRED');
});

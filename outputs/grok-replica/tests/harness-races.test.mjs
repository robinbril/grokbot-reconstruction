// Historical protocol adapter coverage, not current product-provider execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startLegacyHarness as startHarness} from './fixtures/legacy-runtime.mjs';

test('two concurrent same-ID browser writes dispatch one effect, then replay the same receipt',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),owner=client.cookie.split('=')[1],id='browser-race',requestId=randomUUID(),store=app.handler.store,runtime=app.handler.runtime;
 await store.transaction(owner,id,()=>{});runtime.connect=async()=>({id,tools:{browserState:()=>undefined}});let effects=0;runtime.callTool=async()=>({actualEffect:++effects});
 // Hold the first fsync until both HTTP handlers have queued their reservation.
 // An atomic reservation still permits only one dispatch; an outside prior-read does not.
 const originalTransaction=store.transaction.bind(store),originalWrite=store.write.bind(store);let reservations=0,release;const barrier=new Promise(r=>{release=r;});let first=true;
 store.transaction=(...args)=>{if(++reservations===2)release();return originalTransaction(...args);};
 store.write=async state=>{if(first){first=false;await barrier;}return originalWrite(state);};
 const body={requestId,action:'browser_click',arguments:{selector:'#increment'}};
 const responses=await Promise.all([client.request('/conversations/'+id+'/browser',{method:'POST',body}),client.request('/conversations/'+id+'/browser',{method:'POST',body})]);
 assert.equal(effects,1,'same accepted requestId must never execute a second browser effect');assert.ok(responses.every(r=>[200,409].includes(r.status)));assert.ok(responses.some(r=>r.status===200));
 const replay=await client.request('/conversations/'+id+'/browser',{method:'POST',body});assert.equal(replay.status,200);assert.equal(effects,1);assert.equal(replay.value.result.actualEffect,1);
});

test('MCP registration cannot cross a first-run acceptance while awaiting connection shutdown',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),owner=client.cookie.split('=')[1],id='registration-race',store=app.handler.store,runtime=app.handler.runtime;
 await store.transaction(owner,id,s=>{s.threadId='existing-thread';});let entered,release;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});runtime.drop=async()=>{entered();await gate;};let connections=0;runtime.connect=async()=>{connections++;return {};};
 const pending=runtime.register(owner,id,{id:'newserver',name:'New server',command:process.execPath,args:[]},randomUUID());await waiting;
 await store.transaction(owner,id,s=>{s.runs.push({id:'accepted-run',status:'running',approvals:[],tools:[]});});release();
 await assert.rejects(pending,error=>error.code==='MCP_CONFIG_LOCKED');assert.equal(connections,0);const saved=store.get(owner,id);assert.equal(saved.customServers.length,0);assert.equal(saved.threadId,'existing-thread');assert.equal(saved.runs[0].status,'running');
});

test('file-change approval preserves exact bound changed paths, diffs and grant root',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),owner=client.cookie.split('=')[1],id='approval-binding',store=app.handler.store,runtime=app.handler.runtime;
 await store.transaction(owner,id,s=>{s.entries.push({id:'entry',role:'assistant',revision:0,text:''});s.runs.push({id:'run',status:'running',turnId:'turn',approvals:[],tools:[],outputEntryId:'entry'});});
 const denied=[];const c={id,owner,threadId:'thread',pendingApprovals:new Map(),queue:Promise.resolve(),rpc:{respondError:(...args)=>denied.push(args)}};
 const changes=[{path:'/synthetic/outside.txt',kind:{type:'update'},diff:'-old\n+new'}];await runtime.notification(c,'item/started',{threadId:'thread',turnId:'turn',item:{id:'change',type:'fileChange',status:'inProgress',changes}});
 await runtime.approval(c,{id:99,method:'item/fileChange/requestApproval',params:{threadId:'thread',turnId:'turn',itemId:'change',startedAtMs:Date.now(),grantRoot:'/synthetic',reason:null}});
 const approval=store.get(owner,id).runs[0].approvals[0];assert.ok(approval,'schema-valid bound file change must offer a concrete approval');assert.equal(approval.threadId,'thread');assert.equal(approval.turnId,'turn');assert.equal(approval.itemId,'change');assert.equal(approval.operation.grantRoot,'/synthetic');assert.deepEqual(approval.operation.changes,changes);assert.equal(denied.length,0);
 const before=store.get(owner,id).runs[0].approvals.length;await runtime.approval(c,{id:100,method:'item/fileChange/requestApproval',params:{threadId:'thread',turnId:'turn',itemId:'unknown-change',grantRoot:'/synthetic',reason:null}});assert.equal(store.get(owner,id).runs[0].approvals.length,before);assert.equal(denied.length,1,'unbound operation must not present an empty approval');
});

test('ambiguous MCP consent never presents a guessed operation or grants either call',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),owner=client.cookie.split('=')[1],id='ambiguous-consent',store=app.handler.store,runtime=app.handler.runtime;
 await store.transaction(owner,id,s=>{s.entries.push({id:'out',role:'assistant',revision:0,text:''});s.runs.push({id:'run',threadId:'thread',turnId:'turn',status:'running',approvals:[],tools:[],outputEntryId:'out'});s.servers=[{id:'custom_fixture',tools:[]}];});
 const denied=[],c={id,owner,threadId:'thread',queue:Promise.resolve(),pendingApprovals:new Map(),rpc:{respondError:(...args)=>denied.push(args)}};
 for(const [itemId,tool] of [['delete-call','delete_file'],['stat-call','stat_file']])await runtime.notification(c,'item/started',{threadId:'thread',turnId:'turn',item:{id:itemId,type:'mcpToolCall',server:'custom_fixture',tool,arguments:{path:'synthetic.txt'}}});
 await runtime.approval(c,{id:800,method:'mcpServer/elicitation/request',params:{threadId:'thread',turnId:'turn',serverName:'custom_fixture',mode:'form',message:'Harmless label must not identify the operation',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{path:'synthetic.txt'}}}});
 assert.equal(denied.length,1);assert.equal(c.pendingApprovals.size,0);assert.equal(store.get(owner,id).runs[0].approvals.length,0);
});

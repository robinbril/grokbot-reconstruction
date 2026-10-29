import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {WorkflowEngine} from '../harness/workflows.mjs';
const owner='synthetic-owner';
const configured={id:'synthetic',runtimeId:'custom_synthetic',name:'Synthetic MCP',command:'/synthetic/unexecuted',args:[],enabled:false,disabledTools:['SyntheticEffect']};
const payload=(server='custom_synthetic',label='Synthetic MCP')=>({text:'@'+label+' ',richText:JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'workflowReference',attrs:{id:'mcp:'+server,label,iconId:null,iconUrl:null}},{type:'text',text:' '}]}]})});
const answer=()=>({toolCalls:[{id:'reply',name:'SendMessage',arguments:{text:{content:'SYNTHETIC_MCP_REFERENCE_OK'}}}]});
async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'mcp-reference-')),store=await new HarnessStore({dataDir}).init(),seen=[];let connections=0;
 const runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{status:()=>({state:'ready'}),complete:async request=>{seen.push(request);return answer();}},toolHostFactory:async()=>{connections++;return {getDefinitions:()=>[],inventory:()=>[],call:async()=>{throw Error('No MCP tool should be invoked');},close:async()=>{}};}});
 await store.transaction(owner,'one',s=>{s.customServers=[structuredClone(configured)];});
 const engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};
 t.after(async()=>{await engine.close();await runtime.close();});return {dataDir,store,runtime,engine,seen,connections:()=>connections};
}
async function completed(app,id='one'){
 const run=app.store.get(owner,id).runs.at(-1);await app.runtime.jobs.get(run.id)?.promise;
 assert.equal(app.store.get(owner,id).runs.at(-1).status,'completed');return app.store.get(owner,id);
}
const schedule=(body,requestId='schedule')=>({requestId,title:'Synthetic reference schedule',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload:body});

test('configured disabled MCP reference is durable presentation only and creates no selected skill context',async t=>{
 const app=await setup(t),body={requestId:'direct',...payload()},receipt=await app.runtime.start(owner,'one',body),state=await completed(app);
 assert.equal(state.entries[0].richText,body.richText);assert.equal(state.entries[0].text,body.text);assert.equal(state.entries[0].skillRefs,undefined);assert.equal(state.entries[0].legacySkillReferences,undefined);
 assert.equal(app.seen[0].messages.findLast(message=>message.role==='user').content,body.text);assert.deepEqual(app.seen[0].tools.map(tool=>tool.name),['SendMessage']);
 await app.store.transaction(owner,'one',s=>{s.customServers=[];});assert.deepEqual(await app.runtime.start(owner,'one',body),receipt);assert.equal(app.connections(),1);assert.equal(app.seen.length,1);
});
test('unknown, builtin, cross-conversation and foreign-owner IDs reject before connection or acceptance',async t=>{
 const app=await setup(t);
 for(const server of ['custom_missing','grok_workspace','grok_taskbox'])await assert.rejects(app.runtime.start(owner,'one',{requestId:'bad-'+server,...payload(server)}),{code:'INVALID_MCP_REFERENCE'});
 await assert.rejects(app.runtime.start(owner,'two',{requestId:'cross',...payload()}),{code:'INVALID_MCP_REFERENCE'});
 await assert.rejects(app.runtime.start('foreign','one',{requestId:'foreign',...payload()}),{code:'NOT_FOUND'});
 assert.equal(app.connections(),0);assert.equal(app.store.get(owner,'one').runs.length,0);assert.equal(app.store.states.has('two'),false);
});
test('actual owner-bound account server ID resolves independently of a stale client inventory',async t=>{
 const app=await setup(t),accountId='synthetic-account',serverId='account_'+createHash('sha256').update(accountId).digest('hex').slice(0,32);let allowed=true;
 app.runtime.resolveAccounts=async requestedOwner=>{assert.equal(requestedOwner,owner);return allowed?[{accountId,name:'Synthetic account',resourceUrl:'https://example.invalid'}]:[];};
 await app.store.transaction(owner,'one',s=>{s.botId='synthetic-bot';s.servers=[{id:'account_forged',name:'Forged',configuration:{},state:'connected'}];});
 await assert.rejects(app.runtime.start(owner,'one',{requestId:'forged',...payload('account_forged')}),{code:'INVALID_MCP_REFERENCE'});
 await app.runtime.start(owner,'one',{requestId:'valid-account',...payload(serverId)});await completed(app);allowed=false;
 await assert.rejects(app.runtime.start(owner,'one',{requestId:'revoked',...payload(serverId)}),{code:'INVALID_MCP_REFERENCE'});
 assert.equal(app.seen.length,1);
});
test('queue and schedule retain rich bytes and original receipts across restart and config removal',async t=>{
 const app=await setup(t),body={requestId:'queued',...payload()},queued=await app.engine.enqueue(owner,'one',body),scheduled=await app.engine.createSchedule(owner,'one',schedule(payload()));
 const before=structuredClone(app.store.get(owner,'one').queue[0]);assert.equal(before.payload.richText,body.richText);assert.equal(scheduled.schedule.payload.richText,body.richText);
 await app.engine.close();await app.runtime.close();const store=await new HarnessStore({dataDir:app.dataDir}).init();
 const runtime=new GrokRuntime({store,model:{status:()=>({state:'ready'}),complete:answer}}),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};t.after(async()=>{await engine.close();await runtime.close();});
 await store.transaction(owner,'one',s=>{s.customServers=[];});assert.deepEqual(await engine.enqueue(owner,'one',body),queued);assert.deepEqual(await engine.createSchedule(owner,'one',schedule(payload())),scheduled);
 await engine.pump('one');const after=store.get(owner,'one');assert.equal(after.queue[0].status,'blocked');assert.equal(after.queue[0].error.code,'INVALID_MCP_REFERENCE');assert.equal(after.queue[0].payloadHash,before.payloadHash);assert.equal(after.runs.length,0);
});
test('fresh queue and schedule create/edit/run-now reject references outside current canonical config',async t=>{
 const app=await setup(t);
 await assert.rejects(app.engine.enqueue(owner,'one',{requestId:'unknown-queue',...payload('custom_missing')}),{code:'INVALID_MCP_REFERENCE'});
 await assert.rejects(app.engine.createSchedule(owner,'one',schedule(payload('custom_missing'))),{code:'INVALID_MCP_REFERENCE'});
 const saved=await app.engine.createSchedule(owner,'one',schedule(payload()));await app.store.transaction(owner,'one',s=>{s.customServers=[];});
 for(const kind of ['run-now','enable'])await assert.rejects(app.engine.scheduleAction(owner,'one',saved.schedule.id,kind,{requestId:'action-'+kind,expectedRevision:saved.schedule.revision}),{code:'INVALID_MCP_REFERENCE'});
 await assert.rejects(app.engine.scheduleAction(owner,'one',saved.schedule.id,'edit',{requestId:'edit',expectedRevision:saved.schedule.revision,title:'Edited',payload:payload(),rule:{kind:'once',at:'2099-02-01T00:00:00.000Z',timeZone:'UTC'}}),{code:'INVALID_MCP_REFERENCE'});
 assert.equal(app.store.get(owner,'one').queue.length,0);assert.equal(app.store.get(owner,'one').schedules[0].revision,1);
});

test('queue commit rechecks canonical configuration after preparation changes it',async t=>{
 const app=await setup(t),prepare=app.engine.prepare.bind(app.engine);
 app.engine.prepare=async(...args)=>{const prepared=await prepare(...args);await app.store.transaction(owner,'one',s=>{s.customServers=[];});return prepared;};
 await assert.rejects(app.engine.enqueue(owner,'one',{requestId:'racing-queue',...payload()}),{code:'INVALID_MCP_REFERENCE'});
 assert.equal(app.store.get(owner,'one').queue.length,0);assert.equal(app.connections(),0);
});
test('fresh account admission rechecks owner authorization inside the queue transaction',async t=>{
 const app=await setup(t),accountId='synthetic-account',serverId='account_'+createHash('sha256').update(accountId).digest('hex').slice(0,32);let resolutions=0;
 app.runtime.resolveAccounts=async()=>++resolutions===1?[{accountId,name:'Synthetic account',resourceUrl:'https://example.invalid'}]:[];
 await app.store.transaction(owner,'one',s=>{s.botId='synthetic-bot';});
 await assert.rejects(app.engine.enqueue(owner,'one',{requestId:'racing-account',...payload(serverId)}),{code:'INVALID_MCP_REFERENCE'});
 assert.equal(resolutions,2);assert.equal(app.store.get(owner,'one').queue.length,0);assert.equal(app.connections(),0);
});
test('due scheduler does not advance or create work when its referenced connector is no longer configured',async t=>{
 const app=await setup(t);app.engine.clock=()=>new Date('2098-01-01T00:00:00.000Z');
 await app.engine.createSchedule(owner,'one',{...schedule(payload()),enabled:true});await app.store.transaction(owner,'one',s=>{s.customServers=[];});
 app.engine.clock=()=>new Date('2099-01-01T00:00:01.000Z');await app.engine.tick();const state=app.store.get(owner,'one');
 assert.equal(state.queue.length,0);assert.equal(state.schedules[0].nextDueAt,'2099-01-01T00:00:00.000Z');assert.equal(state.schedules[0].lastError.code,'INVALID_MCP_REFERENCE');assert.equal(app.connections(),0);
});
test('accepted run-now receipt replays after configuration removal without accepting a successor',async t=>{
 const app=await setup(t),saved=await app.engine.createSchedule(owner,'one',schedule(payload())),body={requestId:'run-once',expectedRevision:saved.schedule.revision};
 const accepted=await app.engine.scheduleAction(owner,'one',saved.schedule.id,'run-now',body);await app.store.transaction(owner,'one',s=>{s.customServers=[];});
 assert.deepEqual(await app.engine.scheduleAction(owner,'one',saved.schedule.id,'run-now',body),accepted);assert.equal(app.store.get(owner,'one').queue.length,1);assert.equal(app.connections(),0);
});
test('configured queued dispatch retains exact rich identity without synthesizing skill context',async t=>{
 const app=await setup(t),body={requestId:'dispatch',...payload()};await app.engine.enqueue(owner,'one',body);await app.engine.pump('one');const state=await completed(app);
 assert.equal(state.entries[0].richText,body.richText);assert.equal(state.entries[0].text,body.text);assert.equal(app.seen[0].messages.findLast(message=>message.role==='user').content,body.text);assert.equal(state.entries[0].skillRefs,undefined);
});

test('existing ID-only configured records use the same identity fallback as the actual Grok tool host',async t=>{
 const app=await setup(t);await app.store.transaction(owner,'one',s=>{const {runtimeId,...legacy}=configured;s.customServers=[{...legacy,id:'synthetic_legacy'}];});
 const body={requestId:'legacy-record',...payload('synthetic_legacy')};await app.runtime.start(owner,'one',body);const state=await completed(app);assert.equal(state.entries[0].richText,body.richText);
});

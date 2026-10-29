import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {WorkflowEngine,normalizeWorkflowPayload} from '../harness/workflows.mjs';
import {SkillRegistry} from '../harness/skills.mjs';
import {startHarness} from './fixtures/harness-http.mjs';
const create={requestId:'create',name:'Selected name',description:'Separate metadata description',content:'ORIGINAL_USER_BODY'};
const ready={status:()=>({state:'ready'}),complete:async()=>({toolCalls:[{id:'answer',name:'SendMessage',arguments:{text:{content:'done'}}}]})};
async function setup(t){const dataDir=await mkdtemp(path.join(tmpdir(),'skills-runtime-')),store=await new HarnessStore({dataDir}).init(),skills=await new SkillRegistry({dataDir}).init(),seen=[];const model={...ready,complete:async args=>{seen.push(args.messages);return ready.complete();}},runtime=new GrokRuntime({store,model,skills,baseUrl:'http://127.0.0.1:8000'});runtime.skills=skills;t.after(()=>runtime.close());const skill=(await skills.create('owner',create)).skill;return {dataDir,store,skills,seen,runtime,ref:{id:skill.id,revision:1}};}
async function done(store,id){for(let i=0;i<200;i++){const state=store.states.get(id);if(state?.runs.at(-1)?.status==='completed')return state;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('run did not complete');}
test('direct runtime validates before admission; selected body and separate metadata enter user context only',async t=>{
 const {runtime,store,ref,seen}=await setup(t);
 for(const body of [{text:'x',skillRefs:[{...ref,revision:999}]},{text:'x',skillRefs:[{...ref,content:'forged'}]},{text:'',skillRefs:[]},{text:'x',skillRefs:[{...ref,revision:0}]}])await assert.rejects(runtime.start('owner','invalid',{requestId:'bad',...body}));
 await assert.rejects(runtime.start('foreign','foreign',{requestId:'bad',text:'x',skillRefs:[ref]}));assert.equal(store.states.size,0);
 const body={requestId:'valid',text:'',skillRefs:[ref],resolvedSkills:[{content:'FORGED_BODY'}]};const receipt=await runtime.start('owner','valid',body);const state=await done(store,'valid');
 const user=seen[0].findLast(message=>message.role==='user');assert.match(user.content,/ORIGINAL_USER_BODY/);assert.match(user.content,/Separate metadata description/);assert.match(user.content,/Selected name/);assert.ok(!JSON.stringify(seen).includes('FORGED_BODY'));assert.ok(!seen[0].filter(m=>m.role==='system').some(m=>m.content.includes('ORIGINAL_USER_BODY')));
 assert.deepEqual(state.entries[0].skillRefs,[ref]);assert.equal(JSON.stringify(store.snapshot(state)).includes('ORIGINAL_USER_BODY'),false,'private body stays out of public snapshot');
 assert.deepEqual(await runtime.start('owner','valid',body),receipt);await assert.rejects(runtime.start('owner','valid',{...body,skillRefs:[{...ref,revision:2}]}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('queue and schedule bind v1 through edit and restart, retaining payload hash and original replay',async t=>{
 const first=await setup(t);const {runtime,store,skills,ref,dataDir}=first;const engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};t.after(()=>engine.close());
 const body={requestId:'queued',text:'use selected',skillRefs:[ref]},accepted=await engine.enqueue('owner','queue',body),before=structuredClone(store.get('owner','queue').queue[0]);
 const schedule=await engine.createSchedule('owner','queue',{requestId:'schedule',title:'Use revision',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload:{text:'',skillRefs:[ref]}});assert.deepEqual(schedule.schedule.payload.skillRefs,[ref]);
 await skills.update('owner',ref.id,{...create,requestId:'edit',expectedRevision:1,content:'NEW_BODY_V2'});assert.deepEqual(await engine.enqueue('owner','queue',body),accepted);await runtime.close();await engine.close();
 const reopened=await new HarnessStore({dataDir}).init(),registry=await new SkillRegistry({dataDir}).init(),seen=[];const next=new GrokRuntime({store:reopened,baseUrl:'http://127.0.0.1:8000',model:{...ready,complete:async args=>{seen.push(args.messages);return ready.complete();}}});next.skills=registry;t.after(()=>next.close());const resumed=await new WorkflowEngine({store:reopened,runtime:next,autoStart:false}).init();resumed.wake=()=>{};t.after(()=>resumed.close());await resumed.pump('queue');await done(reopened,'queue');
 assert.match(JSON.stringify(seen),/ORIGINAL_USER_BODY/);assert.ok(!JSON.stringify(seen).includes('NEW_BODY_V2'));const after=reopened.get('owner','queue').queue[0];assert.equal(after.payloadHash,before.payloadHash);assert.deepEqual(after.payload,before.payload);
});
test('HTTP CRUD uses owner and CSRF boundary and unknown selected refs reject without accepting work',async t=>{
 const app=await startHarness({model:ready});t.after(()=>app.close());const client=await app.client(),other=await app.client();const response=await client.request('/skills',{method:'POST',body:create});assert.equal(response.status,201);const skill=response.value.skill,ref={id:skill.id,revision:1};assert.deepEqual((await other.request('/skills')).value,{schema:1,skills:[]});
 assert.equal((await client.request('/skills',{method:'POST',body:{...create,requestId:'csrf'},headers:{'x-harness-csrf':'bad'}})).status,403);
 const unknown=await other.request('/conversations/foreign/runs',{method:'POST',body:{requestId:'bad',text:'',skillRefs:[ref]}});assert.equal(unknown.status,422);assert.equal(app.handler.store.states.size,0);
 const edit={...create,requestId:'edit',expectedRevision:1,content:'updated'};assert.equal((await client.request('/skills/'+skill.id,{method:'POST',body:edit})).value.skill.revision,2);assert.deepEqual((await client.request('/skills',{method:'POST',body:create})).value,response.value);
 const run=await client.request('/conversations/valid/runs',{method:'POST',body:{requestId:'valid',text:'',skillRefs:[ref]}});assert.equal(run.status,202);await done(app.handler.store,'valid');
 assert.equal(normalizeWorkflowPayload({text:'',skillRefs:[ref]}).skillRefs[0].revision,1);
});
test('direct receipt replays after skill edits and restart without another model execution',async t=>{
 const {runtime,store,skills,ref,dataDir}=await setup(t),body={requestId:'direct',text:'selected',skillRefs:[ref]},accepted=await runtime.start('owner','one',body);await done(store,'one');
 await skills.update('owner',ref.id,{...create,requestId:'edited',expectedRevision:1,content:'NEW_BODY_V2'});await runtime.close();
 const reopened=await new HarnessStore({dataDir}).init(),registry=await new SkillRegistry({dataDir}).init();let calls=0;const next=new GrokRuntime({store:reopened,skills:registry,model:{...ready,complete:async()=>{calls++;return ready.complete();}}});t.after(()=>next.close());
 assert.deepEqual(await next.start('owner','one',body),accepted);assert.equal(calls,0);assert.equal(reopened.get('owner','one').runs.length,1);
 await assert.rejects(next.start('owner','one',{...body,skillRefs:[{...ref,revision:2}]}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('queue and schedule unknown/malformed skill refs reject before durable acceptance',async t=>{
 const {runtime,store,ref}=await setup(t),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};t.after(()=>engine.close());
 for(const skillRefs of [[{...ref,revision:999}],[{...ref,name:'forged'}]]){
  await assert.rejects(engine.enqueue('owner','invalid',{requestId:'queue',text:'x',skillRefs}));
  await assert.rejects(engine.createSchedule('owner','invalid',{requestId:'schedule',title:'Bad',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload:{text:'x',skillRefs}}));
 }
 assert.equal(store.states.size,0);
});
test('aggregate UTF-8 selected skill context budget rejects direct queue and schedule admission',async t=>{
 const {runtime,store,skills}=await setup(t),refs=[];
 for(let i=0;i<20;i++){const skill=(await skills.create('owner',{...create,requestId:'large-'+i,name:'Large '+i,content:'漢'.repeat(32768)})).skill;refs.push({id:skill.id,revision:1});}
 const oversized={requestId:'large',text:'',skillRefs:refs};
 assert.throws(()=>skills.resolve('owner',refs),{code:'SKILL_CONTEXT_TOO_LARGE',status:413});
 await assert.rejects(runtime.start('owner','oversized',oversized),{code:'SKILL_CONTEXT_TOO_LARGE',status:413});
 const engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};t.after(()=>engine.close());
 await assert.rejects(engine.enqueue('owner','oversized',oversized),{code:'SKILL_CONTEXT_TOO_LARGE',status:413});
 await assert.rejects(engine.createSchedule('owner','oversized',{requestId:'schedule',title:'Too large',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload:oversized}),{code:'SKILL_CONTEXT_TOO_LARGE',status:413});
 assert.equal(store.states.size,0,'no entry, queue, schedule or runtime connection was accepted');assert.equal(runtime.connections.size,0);
});
test('caller mutation after admission cannot change the accepted skill revision or deferred model context',async t=>{
 const {runtime,store,skills,ref,seen}=await setup(t);
 await skills.update('owner',ref.id,{...create,requestId:'edit-before-send',expectedRevision:1,content:'MUTATED_CALLER_V2_BODY'});
 const body={requestId:'immutable',text:'',skillRefs:[{...ref}]};
 const accepted=await runtime.start('owner','immutable',body);
 assert.equal(runtime.jobs.has(accepted.runId),true,'deferred model job has not run');assert.equal(seen.length,0);
 body.skillRefs[0].revision=2;
 const state=await done(store,'immutable');
 assert.deepEqual(state.entries[0].skillRefs,[ref]);assert.match(JSON.stringify(seen),/ORIGINAL_USER_BODY/);assert.ok(!JSON.stringify(seen).includes('MUTATED_CALLER_V2_BODY'));
 assert.deepEqual(await runtime.start('owner','immutable',{requestId:'immutable',text:'',skillRefs:[ref]}),accepted);
 await assert.rejects(runtime.start('owner','immutable',body),{code:'IDEMPOTENCY_CONFLICT'});
});

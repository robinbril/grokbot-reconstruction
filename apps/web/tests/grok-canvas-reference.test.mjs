import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {HarnessStore} from '../harness/store.mjs';
import {CanvasStore} from '../harness/canvas-store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {appendHeldCanvasReference} from '../composer-canvas-reference.js';
const owner='synthetic-owner',one='b801193a-6b2b-4d5c-a766-19c8a192ce72',two='d37d7317-754c-4e80-92b2-b39ae997ae85';
const reply=()=>({toolCalls:[{id:'answer',name:'SendMessage',arguments:{text:{content:'SYNTHETIC_CANVAS_OK'}}}]});
const body=(canvas,requestId='direct',attrs={})=>({requestId,text:'Explain this canvas',richText:appendHeldCanvasReference(undefined,{canvasId:canvas.id,storeId:null,title:'Forged client title',...attrs},{text:'Explain this canvas'})});
const schedule=payload=>({requestId:'schedule',title:'Canvas schedule',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload});
async function setup(t,{dataDir}={}){
 dataDir??=await mkdtemp(path.join(tmpdir(),'canvas-reference-'));const store=await new HarnessStore({dataDir}).init(),canvases=new CanvasStore({store}),seen=[];let connections=0;
 const runtime=new GrokRuntime({store,model:{status:()=>({state:'ready'}),complete:async request=>{seen.push(request);return reply();}},toolHostFactory:async()=>{connections++;return {getDefinitions:()=>[],inventory:()=>[],call:async()=>{throw Error('No canvas tool should be needed to read admitted context');},close:async()=>{}};}});
 const engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};
 t.after(async()=>{await engine.close();await runtime.close();});return {dataDir,store,canvases,runtime,engine,seen,connections:()=>connections};
}
async function create(h,id=one,source='PRIVATE_CANVAS_V1_NONCE'){return (await h.canvases.create(owner,id,{requestId:randomUUID(),title:'Actual stored title',source})).canvas;}
async function done(h,id=one){const run=h.store.get(owner,id).runs.at(-1);await h.runtime.jobs.get(run.id)?.promise;assert.equal(h.store.get(owner,id).runs.at(-1).status,'completed');return h.store.get(owner,id);}
const input=h=>h.seen.at(-1).messages.findLast(message=>message.role==='user').content;

test('direct hidden reference resolves actual source and title privately without changing visible text or granting tools',async t=>{
 const h=await setup(t),canvas=await create(h),request=body(canvas),ack=await h.runtime.start(owner,one,request),state=await done(h);
 assert.equal(state.entries[0].text,request.text);assert.equal(state.entries[0].richText,request.richText);
 assert.match(input(h),/PRIVATE_CANVAS_V1_NONCE/);assert.match(input(h),/Actual stored title/);assert.doesNotMatch(input(h),/Forged client title/);
 assert.deepEqual(h.seen[0].tools.map(tool=>tool.name),['SendMessage']);
 const snapshot=JSON.stringify(h.store.snapshot(state));assert.equal(snapshot.includes('PRIVATE_CANVAS_V1_NONCE'),false);assert.equal(snapshot.includes('canvasInputs'),false);
 assert.equal(JSON.stringify(state.events).includes('PRIVATE_CANVAS_V1_NONCE'),false);
 await h.canvases.update(owner,one,canvas.id,{requestId:'edit',expectedRevision:1,title:'New title',source:'PRIVATE_CANVAS_V2_NONCE'});
 assert.deepEqual(await h.runtime.start(owner,one,request),ack);assert.equal(h.seen.length,1);
 await assert.rejects(h.runtime.start(owner,one,{...request,richText:request.richText.replace('Forged client title','Changed client title')}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('unknown, cross conversation, foreign owner and cloud store references reject before connection or run acceptance',async t=>{
 const h=await setup(t),canvas=await create(h);await h.store.transaction(owner,two,()=>{});
 await assert.rejects(h.runtime.start(owner,one,body({...canvas,id:randomUUID()},'missing')),{code:'INVALID_CANVAS_REFERENCE'});
 await assert.rejects(h.runtime.start(owner,two,body(canvas,'cross')),{code:'INVALID_CANVAS_REFERENCE'});
 await assert.rejects(h.runtime.start('foreign',one,body(canvas,'foreign')),{code:'NOT_FOUND'});
 await assert.rejects(h.runtime.start(owner,one,body(canvas,'cloud',{storeId:'store-'+one})),{code:'UNSUPPORTED_CANVAS_STORE'});
 assert.equal(h.connections(),0);assert.equal(h.store.get(owner,one).runs.length,0);assert.equal(h.store.get(owner,two).runs.length,0);
});
test('direct admission rechecks actual source inside serialized acceptance after connection changes revision',async t=>{
 const h=await setup(t),canvas=await create(h),connect=h.runtime.connect.bind(h.runtime);h.runtime.connect=async(...args)=>{await h.canvases.update(owner,one,canvas.id,{requestId:'raced-edit',expectedRevision:1,title:'Raced title',source:'PRIVATE_RACED_V2'});return connect(...args);};
 await h.runtime.start(owner,one,body(canvas));await done(h);assert.match(input(h),/PRIVATE_RACED_V2/);assert.doesNotMatch(input(h),/PRIVATE_CANVAS_V1_NONCE/);
});
test('queued context pins the admitted revision across later edits and restart without adding source to queue payload',async t=>{
 const h=await setup(t),canvas=await create(h),request=body(canvas,'queued'),ack=await h.engine.enqueue(owner,one,request),before=structuredClone(h.store.get(owner,one).queue[0]);
 assert.equal(JSON.stringify(before).includes('PRIVATE_CANVAS_V1_NONCE'),false);
 await h.canvases.update(owner,one,canvas.id,{requestId:'edit',expectedRevision:1,title:'New title',source:'PRIVATE_CANVAS_V2_NONCE'});
 assert.deepEqual(await h.engine.enqueue(owner,one,request),ack);await h.engine.close();await h.runtime.close();
 const next=await setup(t,{dataDir:h.dataDir});await next.engine.pump(one);await done(next);
 assert.match(input(next),/PRIVATE_CANVAS_V1_NONCE/);assert.doesNotMatch(input(next),/PRIVATE_CANVAS_V2_NONCE/);
 const after=next.store.get(owner,one).queue[0];assert.equal(after.payloadHash,before.payloadHash);assert.deepEqual(after.payload,before.payload);
 assert.equal(JSON.stringify(next.store.snapshot(next.store.get(owner,one))).includes('PRIVATE_CANVAS_V1_NONCE'),false);
});
test('schedule run-now carries its pinned revision while edit captures a new one',async t=>{
 const h=await setup(t),canvas=await create(h),request=body(canvas),saved=await h.engine.createSchedule(owner,one,schedule({text:request.text,richText:request.richText}));
 await h.canvases.update(owner,one,canvas.id,{requestId:'edit',expectedRevision:1,title:'New title',source:'PRIVATE_CANVAS_V2_NONCE'});
 await h.engine.scheduleAction(owner,one,saved.schedule.id,'run-now',{requestId:'first',expectedRevision:1});await h.engine.pump(one);await done(h);
 assert.match(input(h),/PRIVATE_CANVAS_V1_NONCE/);assert.doesNotMatch(input(h),/PRIVATE_CANVAS_V2_NONCE/);
 const edited=await h.engine.scheduleAction(owner,one,saved.schedule.id,'edit',{requestId:'schedule-edit',expectedRevision:1,title:'Changed schedule',payload:{text:request.text,richText:request.richText},rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'}});
 await h.engine.scheduleAction(owner,one,saved.schedule.id,'run-now',{requestId:'second',expectedRevision:edited.schedule.revision});await h.engine.pump(one);await done(h);assert.match(input(h),/PRIVATE_CANVAS_V2_NONCE/);
});
test('queue and schedule unknown references fail before durable admission and invalid edit leaves original revision',async t=>{
 const h=await setup(t),canvas=await create(h),unknown=body({...canvas,id:randomUUID()});
 await assert.rejects(h.engine.enqueue(owner,one,unknown),{code:'INVALID_CANVAS_REFERENCE'});
 await assert.rejects(h.engine.createSchedule(owner,one,schedule(unknown)),{code:'INVALID_CANVAS_REFERENCE'});
 const saved=await h.engine.createSchedule(owner,one,schedule(body(canvas)));
 await assert.rejects(h.engine.scheduleAction(owner,one,saved.schedule.id,'edit',{requestId:'invalid-edit',expectedRevision:1,title:'Bad',payload:unknown,rule:{kind:'daily',time:'09:00',timeZone:'UTC'}}),{code:'INVALID_CANVAS_REFERENCE'});
 assert.equal(h.store.get(owner,one).queue.length,0);assert.equal(h.store.get(owner,one).schedules[0].revision,1);
});
test('local selected source budget rejects before model connection or acceptance instead of truncating',async t=>{
 const h=await setup(t);let richText;
 for(let index=0;index<5;index++){const canvas=await create(h,one,'x'.repeat(60000));richText=appendHeldCanvasReference(richText,{canvasId:canvas.id,title:'Budget'},{text:'Explain this canvas'});}
 await assert.rejects(h.runtime.start(owner,one,{requestId:'oversized',text:'Explain this canvas',richText}),{code:'CANVAS_CONTEXT_TOO_LARGE'});
 assert.equal(h.connections(),0);assert.equal(h.store.get(owner,one).runs.length,0);
});

test('due occurrence after pause and enable retains the schedule input revision through restart',async t=>{
 const h=await setup(t),canvas=await create(h),request=body(canvas);h.engine.clock=()=>new Date('2098-01-01T00:00:00.000Z');
 const saved=await h.engine.createSchedule(owner,one,{...schedule({text:request.text,richText:request.richText}),enabled:true});
 await h.canvases.update(owner,one,canvas.id,{requestId:'edit',expectedRevision:1,title:'New title',source:'PRIVATE_CANVAS_V2_NONCE'});
 const paused=await h.engine.scheduleAction(owner,one,saved.schedule.id,'pause',{requestId:'pause',expectedRevision:1});
 await h.engine.scheduleAction(owner,one,saved.schedule.id,'enable',{requestId:'enable',expectedRevision:paused.schedule.revision});
 await h.engine.close();await h.runtime.close();const next=await setup(t,{dataDir:h.dataDir});next.engine.clock=()=>new Date('2099-01-01T00:00:01.000Z');
 await next.engine.tick();assert.equal(next.store.get(owner,one).queue.length,1);await next.engine.pump(one);await done(next);
 assert.match(input(next),/PRIVATE_CANVAS_V1_NONCE/);assert.doesNotMatch(input(next),/PRIVATE_CANVAS_V2_NONCE/);
 assert.equal(next.store.get(owner,one).queue[0].source.scheduleRevision,3);
});
test('direct receipt and pinned context survive restart without redispatching the model',async t=>{
 const h=await setup(t),canvas=await create(h),request=body(canvas),ack=await h.runtime.start(owner,one,request);await done(h);
 await h.canvases.update(owner,one,canvas.id,{requestId:'edit',expectedRevision:1,title:'Changed',source:'PRIVATE_CANVAS_V2_NONCE'});
 await h.engine.close();await h.runtime.close();const next=await setup(t,{dataDir:h.dataDir});
 assert.deepEqual(await next.runtime.start(owner,one,request),ack);assert.equal(next.seen.length,0);assert.equal(next.connections(),0);
 const saved=next.store.get(owner,one);assert.equal(saved.canvasInputs['run:'+ack.runId][0].revision,1);assert.equal(saved.canvasInputs['run:'+ack.runId][0].source,'PRIVATE_CANVAS_V1_NONCE');
 assert.equal(JSON.stringify(next.store.snapshot(saved)).includes('PRIVATE_CANVAS_V1_NONCE'),false);
});
test('queue admission captures the actual revision after preparation changed the resource',async t=>{
 const h=await setup(t),canvas=await create(h),prepare=h.engine.prepare.bind(h.engine);
 h.engine.prepare=async(...args)=>{const result=await prepare(...args);await h.canvases.update(owner,one,canvas.id,{requestId:'raced-edit',expectedRevision:1,title:'Raced title',source:'PRIVATE_RACED_V2'});h.engine.prepare=prepare;return result;};
 await h.engine.enqueue(owner,one,body(canvas,'queued-race'));await h.engine.pump(one);await done(h);
 assert.match(input(h),/PRIVATE_RACED_V2/);assert.doesNotMatch(input(h),/PRIVATE_CANVAS_V1_NONCE/);
});

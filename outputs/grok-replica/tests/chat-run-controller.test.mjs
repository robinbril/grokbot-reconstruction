// PREPARATION ONLY. Copy to tests/ after API freeze. Unit stubs are not app/adapter/UI proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatRunController} from '../chat-run-controller.js';
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async predicate=>{for(let i=0;i<64;i++){if(predicate())return;await Promise.resolve();}assert.fail('owned work did not reach expected handshake in 64 microtasks');};
const initial=()=>({version:1,selected:'c1',agents:[{id:'c1',name:'One'},{id:'c2',name:'Two'}],messages:{c1:[{id:'legacy',role:'bot',text:'old',localRun:{status:'complete',output:'old'}}],c2:[]},drafts:{c1:'one two',c2:'other draft'},replyDrafts:{c1:{messageId:'legacy',text:'old',title:'old'}},chatRuns:{},settings:{theme:'light'},documents:[{id:'doc',text:'keep'}]});
function harness(seed=initial()){
 let state=freeze(seed),durable=JSON.stringify(seed),reject=()=>false,rejectProgress=()=>false,ids=0;
 const writes=[],attempts=[],progressCalls=[],jobs=[],notifications=[],markers=new Map();
 const marker=(s,r)=>{const e=s.messages[r.conversationId]?.find(e=>e.id===r.outputEntryId);return e?{entryId:e.id,generation:r.generation,revision:e.transcript.revision,lastSeq:r.lastSeq,phase:r.phase,deliveryId:r.delivery?.id??null}:null;};
 const saveMarkers=s=>{markers.clear();for(const r of Object.values(s.chatRuns??{})){const m=marker(s,r);if(m)markers.set(r.id,freeze(m));}};saveMarkers(state);
 const host={getState:()=>state,commit(build){
  const before=state;let next,bytes;try{next=build(before);assert.ok(!next?.then,'pure builder must be synchronous');bytes=JSON.stringify(next);}catch{return {ok:false,error:{code:'invalid'}};}
  attempts.push({before,next,bytes});if(reject(next))return {ok:false,error:{code:'storage'}};
  writes.push(bytes);durable=bytes;state=freeze(next);saveMarkers(state);return {ok:true};
 },publishChatProgress(p){
  progressCalls.push(p);if(rejectProgress(p))return {ok:false,code:'stale'};assert.ok(['running','final-pending-delivery'].includes(p.phase));assert.equal(p.delivery,undefined);assert.equal(p.status,undefined);
  const r=Object.hasOwn(state.chatRuns,p.runId)?state.chatRuns[p.runId]:null;
  const list=Object.hasOwn(state.messages,p.conversationId)?state.messages[p.conversationId]:null;
  const e=list?.find(e=>e.id===p.entryId);
  if(!r||!e||r.conversationId!==p.conversationId||r.outputEntryId!==p.entryId||r.generation!==p.generation||r.delivery||!list.some(e=>e.id===r.inputEntryId))return {ok:false,code:'stale'};
  const input=list.find(e=>e.id===r.inputEntryId),q=p.progress;if(p.seq!==r.lastSeq+1||typeof p.text!=='string'||!q||Object.keys(q).sort().join(',')!=='processed,total'||!Number.isSafeInteger(q.processed)||!Number.isSafeInteger(q.total)||q.processed<0||q.processed>q.total||q.total!==input.text.length||q.total>100000||(p.phase==='final-pending-delivery'&&q.processed!==q.total)||(r.phase==='final-pending-delivery'&&p.phase==='running'))return {ok:false,code:'invalid'};
  state=freeze({...state,messages:{...state.messages,[p.conversationId]:list.map(v=>v===e?{...e,text:p.text,transcript:{...e.transcript,revision:e.transcript.revision+1,status:'streaming'}}:v)},chatRuns:{...state.chatRuns,[r.id]:{...r,lastSeq:p.seq,phase:p.phase,progress:{processed:q.processed,total:q.total},delivery:null}}});return {ok:true};
 },getChatSaveState:({runId})=>markers.get(runId)??null,onEntryChange:n=>notifications.push(n),now:()=>1700000000000,newId:()=>`generated-${++ids}`,
 adapter:{id:'local-text-v1',execute(args){const job={...deferred(),args};jobs.push(job);return job.promise;}}};
 const controller=createChatRunController(host);
 return {host,controller,jobs,writes,attempts,progressCalls,notifications,get state(){return state;},get durable(){return JSON.parse(durable);},get ids(){return ids;},deny:fn=>{reject=fn;},denyProgress:fn=>{rejectProgress=fn;},checkpoint:()=>host.commit(s=>({...s})),mutate:build=>host.commit(build)};
}
async function ready(seed){const h=harness(seed);assert.equal(h.writes.length,0);assert.equal(h.jobs.length,0);assert.equal(h.notifications.length,0);assert.equal((await h.controller.reconcileReload()).ok,true);return h;}
const input=(conversationId='c1',submissionId='s1',overrides={})=>({conversationId,submissionId,text:'one two',operation:'upper',style:'short',...(conversationId==='c1'?{quote:{messageId:'legacy',text:'old',title:'old'}}:{}),...overrides});
const output=(h,id)=>{const r=h.state.chatRuns[id];return h.state.messages[r.conversationId].find(e=>e.id===r.outputEntryId);};
const runtime=(h,id)=>h.controller.getRuntime({conversationId:h.state.chatRuns[id].conversationId,runId:id});
const finish=async(h,job,text='ONE TWO')=>{job.resolve({text,processed:job.args.text.length,total:job.args.text.length});await settle(()=>Object.values(h.state.chatRuns).some(r=>['delivered','final-pending-delivery'].includes(r.phase)));};
const command=(id,conversationId='c1')=>({conversationId,runId:id});

test('failed acceptance preserves live identity/draft/quote and never executes; same submission reuses allocated IDs',async()=>{
 const h=await ready(),before=h.state;h.deny(()=>true);const failed=await h.controller.start(input());
 assert.equal(failed.ok,false);assert.equal(h.state,before);assert.equal(h.jobs.length,0);assert.equal(h.writes.length,0);assert.equal(h.state.drafts.c1,'one two');assert.equal(h.state.replyDrafts.c1,before.replyDrafts.c1);
 const allocated=h.ids;h.deny(()=>false);const accepted=await h.controller.start(input());assert.equal(accepted.ok,true);assert.equal(h.ids,allocated);await settle(()=>h.jobs.length===1);h.controller.destroy();
});
test('acceptance structurally shares every untouched legacy branch and commits one complete acceptance envelope',async()=>{
 const h=await ready(),before=h.state,result=await h.controller.start(input());assert.equal(result.ok,true);
 const accepted=h.attempts.find(a=>a.next.chatRuns[result.runId]?.phase==='accepted');assert.ok(accepted);
 const n=accepted.next,r=n.chatRuns[result.runId],messages=n.messages.c1;
 assert.equal(n.messages.c2,before.messages.c2);assert.equal(messages[0],before.messages.c1[0]);assert.equal(messages[0].localRun,before.messages.c1[0].localRun);assert.equal(n.documents,before.documents);assert.equal(n.settings,before.settings);
 assert.notEqual(n.messages,before.messages);assert.notEqual(messages,before.messages.c1);assert.equal(messages.filter(e=>e.id===r.inputEntryId).length,1);assert.equal(messages.filter(e=>e.id===r.outputEntryId).length,1);
 assert.equal(n.drafts.c1,'');assert.equal(n.replyDrafts.c1,undefined);assert.deepEqual(messages.find(e=>e.id===r.inputEntryId).quote,{messageId:'legacy',text:'old',title:'old'});const pending=messages.find(e=>e.id===r.outputEntryId);assert.equal(pending.transcript.kind,'send-message');assert.equal(pending.transcript.status,'pending');assert.deepEqual(pending.transcript.replica,{producer:'local-text-v1',operation:'upper'});assert.deepEqual(pending.transcript.payload,{layoutMode:'bubble'});assert.equal(r.layoutMode,undefined);assert.deepEqual(r.progress,{processed:0,total:7});assert.equal(r.delivery,null);h.controller.destroy();
});
test('progress is one volatile transcript update, not stable/delivered; incidental save is only a checkpoint',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);const count=h.writes.length;
 h.jobs[0].args.onProgress({text:'ONE',processed:3,total:7});await settle(()=>output(h,a.runId).text==='ONE');
 const e=output(h,a.runId),r=h.state.chatRuns[a.runId];assert.equal(h.writes.length,count);assert.equal(e.transcript.status,'streaming');assert.equal(e.transcript.kind,'send-message');assert.equal(r.delivery,null);assert.equal(runtime(h,a.runId).textSaved,false);assert.equal(runtime(h,a.runId).text,undefined);assert.ok(Object.isFrozen(runtime(h,a.runId)));assert.deepEqual(r.progress,{processed:3,total:7});assert.deepEqual(runtime(h,a.runId).progress,{processed:3,total:7});assert.ok(Object.isFrozen(runtime(h,a.runId).progress));assert.equal(e.transcript.payload.progress,undefined);assert.equal(e.transcript.progress,undefined);
 for(const key of ['text','input','output','chunks','messages','chatEntries'])assert.equal(Object.hasOwn(r,key),false);
 h.checkpoint();assert.equal(runtime(h,a.runId).textSaved,true);assert.equal(runtime(h,a.runId).delivered,false);assert.equal(h.durable.chatRuns[a.runId].delivery,null);assert.equal(output(h,a.runId),e);h.controller.destroy();
});
test('final result and browser-local receipt are atomic and bound to exact output/revision/generation',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);await finish(h,h.jobs[0]);
 await settle(()=>runtime(h,a.runId).delivered);const r=h.durable.chatRuns[a.runId],e=h.durable.messages.c1.find(e=>e.id===r.outputEntryId);
 assert.equal(e.text,'ONE TWO');assert.equal(e.transcript.status,'stable');assert.equal(e.transcript.kind,'send-message');assert.equal(r.phase,'delivered');assert.deepEqual(r.progress,{processed:7,total:7});assert.equal(r.delivery.scope,'browser-local');
 assert.equal(r.delivery.entryId,e.id);assert.equal(r.delivery.revision,e.transcript.revision);assert.equal(r.delivery.generation,r.generation);assert.equal(r.delivery.id,`${r.id}:final`);assert.deepEqual(e.transcript.replica,{producer:'local-text-v1',operation:'upper'});assert.deepEqual(e.transcript.payload,{layoutMode:'bubble'});
 for(const bytes of h.writes){const s=JSON.parse(bytes),j=s.chatRuns[a.runId];if(j?.phase==='delivered'){const entry=s.messages.c1.find(e=>e.id===j.outputEntryId);assert.equal(entry.transcript.status,'stable');assert.ok(j.delivery);}else assert.ok(!j?.delivery);}
 h.controller.destroy();
});
test('failed final plus checkpoint stays streaming; concurrent save-only retries rebase latest state and preserve IDs/bytes',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);h.deny(s=>Object.values(s.chatRuns).some(r=>r.phase==='delivered'));await finish(h,h.jobs[0],'EXACT\tFINAL\n');
 await settle(()=>runtime(h,a.runId).canRetryDelivery);const r=h.state.chatRuns[a.runId],e=output(h,a.runId),ids=h.ids;
 assert.equal(e.text,'EXACT\tFINAL\n');assert.equal(e.transcript.status,'streaming');assert.equal(r.delivery,null);assert.equal(r.phase,'final-pending-delivery');assert.deepEqual(r.progress,{processed:7,total:7});assert.deepEqual(runtime(h,a.runId).progress,r.progress);assert.equal(runtime(h,a.runId).effectivePhase,'final-pending-delivery');assert.equal(runtime(h,a.runId).delivered,false);assert.equal(Object.hasOwn(r,'workStreaming'),false);
 h.checkpoint();assert.equal(runtime(h,a.runId).textSaved,true);assert.equal(runtime(h,a.runId).delivered,false);
 h.mutate(s=>({...s,drafts:{...s.drafts,c1:'new A',c2:'new B'},settings:{theme:'dark'},messages:{...s.messages,c2:[...s.messages.c2,{id:'unrelated',role:'user',text:'new'}]}}));const latest=h.state,attempt=h.attempts.findLast(x=>x.next.chatRuns[a.runId]?.phase==='delivered');
 h.deny(()=>false);const retries=await Promise.all([h.controller.retryDelivery(command(a.runId)),h.controller.retryDelivery(command(a.runId))]);assert.ok(retries.every(r=>r.ok));
 const saved=h.state.chatRuns[a.runId],final=output(h,a.runId);assert.equal(h.jobs.length,1);assert.equal(h.ids,ids);assert.equal(final.id,e.id);assert.equal(final.text,e.text);assert.equal(saved.delivery.id,attempt.next.chatRuns[a.runId].delivery.id);
 assert.equal(h.state.messages.c2,latest.messages.c2);assert.equal(h.state.settings,latest.settings);assert.equal(h.state.drafts.c1,'new A');assert.equal(h.state.drafts.c2,'new B');assert.equal(h.writes.filter(b=>JSON.parse(b).chatRuns[a.runId]?.phase==='delivered').length,1);h.controller.destroy();
});

test('pending delivery cannot overwrite an externally changed output revision or revoked journal generation',async()=>{
 for(const change of ['entry','generation']){const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);h.deny(s=>Object.values(s.chatRuns).some(r=>r.phase==='delivered'));await finish(h,h.jobs[0]);await settle(()=>runtime(h,a.runId).canRetryDelivery);h.deny(()=>false);const outputId=output(h,a.runId).id;
  h.mutate(s=>change==='generation'?{...s,chatRuns:{...s.chatRuns,[a.runId]:{...s.chatRuns[a.runId],generation:s.chatRuns[a.runId].generation+1}}}:{...s,messages:{...s.messages,c1:s.messages.c1.map(e=>e.id===outputId?{...e,text:'EDIT',transcript:{...e.transcript,revision:e.transcript.revision+1}}:e)}});
  const before=h.state;assert.equal((await h.controller.retryDelivery(command(a.runId))).ok,false);assert.equal(h.state,before);assert.equal(h.jobs.length,1);h.controller.destroy();
 }
});

test('cancel revokes before denied save, blocks late progress/final and cannot be defeated by delivery retry',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);const job=h.jobs[0];job.args.onProgress({text:'ONE',processed:3,total:7});await settle(()=>output(h,a.runId).text==='ONE');
 h.deny(()=>true);const before=h.state;const cancelling=h.controller.cancel(command(a.runId));assert.equal(job.args.signal.aborted,true);assert.equal((await cancelling).ok,false);assert.equal(h.state,before);
 job.args.onProgress({text:'LATE',processed:7,total:7});job.resolve({text:'LATE',processed:7,total:7});for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(output(h,a.runId).text,'ONE');assert.equal(runtime(h,a.runId).effectivePhase,'cancelled');assert.equal(runtime(h,a.runId).statusSaved,false);assert.equal(runtime(h,a.runId).canRetryDelivery,false);assert.equal((await h.controller.retryDelivery(command(a.runId))).ok,false);assert.equal(h.state,before);
 h.deny(()=>false);assert.equal((await h.controller.cancel(command(a.runId))).ok,true);const generation=h.state.chatRuns[a.runId].generation;await h.controller.cancel(command(a.runId));assert.equal(h.state.chatRuns[a.runId].generation,generation);h.controller.destroy();
});
test('cancel after pending final drops the frozen delivery and never re-executes',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);h.deny(s=>Object.values(s.chatRuns).some(r=>r.phase==='delivered'));await finish(h,h.jobs[0]);await settle(()=>runtime(h,a.runId).canRetryDelivery);
 await h.controller.cancel(command(a.runId));h.deny(()=>false);assert.equal((await h.controller.retryDelivery(command(a.runId))).ok,false);assert.equal(h.state.chatRuns[a.runId].phase,'cancelled');assert.equal(h.state.chatRuns[a.runId].delivery,null);assert.equal(h.jobs.length,1);h.controller.destroy();
});
test('submission id dedupes by conversation, changed payload rejects, independent conversations finish interleaved',async()=>{
 const h=await ready(),a=await h.controller.start(input()),duplicate=await h.controller.start(input());assert.equal(duplicate.runId,a.runId);
 assert.equal((await h.controller.start(input('c1','s1',{text:'changed'}))).ok,false);assert.equal((await h.controller.start(input('c1','s2'))).ok,false);
 const b=await h.controller.start(input('c2','s1',{text:'other'}));assert.equal(b.ok,true);assert.notEqual(a.runId,b.runId);await settle(()=>h.jobs.length===2);
 h.jobs[1].args.onProgress({text:'OTH',processed:3,total:5});await settle(()=>output(h,b.runId).text==='OTH');assert.equal(output(h,a.runId).text,'');
 await finish(h,h.jobs[1],'OTHER');h.jobs[0].resolve({text:'ONE TWO',processed:7,total:7});await settle(()=>runtime(h,a.runId).delivered&&runtime(h,b.runId).delivered);assert.equal(output(h,a.runId).text,'ONE TWO');assert.equal(output(h,b.runId).text,'OTHER');assert.equal(h.jobs.length,2);h.controller.destroy();
});
test('deleted conversation and destroyed owners cannot be recreated by stale callbacks',async()=>{
 for(const mode of ['delete','destroy']){const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);const job=h.jobs[0];
  if(mode==='delete')h.mutate(s=>{const {c1,...messages}=s.messages;return {...s,messages,agents:s.agents.filter(a=>a.id!=='c1')};});else{h.controller.destroy();assert.equal(job.args.signal.aborted,true);}
  const before=h.state,writes=h.writes.length;job.args.onProgress({text:'LATE',processed:7,total:7});job.resolve({text:'LATE',processed:7,total:7});for(let i=0;i<16;i++)await Promise.resolve();assert.equal(h.state,before);assert.equal(h.writes.length,writes);h.controller.destroy();
 }
});
test('reload checkpoints interrupt without execution; only explicit matching local resume reuses output with new generation',async()=>{
 const old=await ready(),a=await old.controller.start(input());await settle(()=>old.jobs.length===1);old.jobs[0].args.onProgress({text:'ONE',processed:3,total:7});await settle(()=>output(old,a.runId).text==='ONE');old.checkpoint();const seed=old.durable,generation=seed.chatRuns[a.runId].generation;old.controller.destroy();
 const h=harness(seed);assert.equal(h.jobs.length,0);assert.equal(h.writes.length,0);assert.equal(runtime(h,a.runId).effectivePhase,'interrupted');assert.equal((await h.controller.reconcileReload()).ok,true);assert.equal(runtime(h,a.runId).delivered,false);assert.equal(output(h,a.runId).text,'ONE');
 const resumed=await h.controller.resume(command(a.runId));assert.equal(resumed.ok,true);await settle(()=>h.jobs.length===1);assert.equal(h.state.chatRuns[a.runId].outputEntryId,seed.chatRuns[a.runId].outputEntryId);assert.equal(h.state.chatRuns[a.runId].generation,generation+1);assert.deepEqual(h.state.chatRuns[a.runId].progress,{processed:0,total:7});assert.equal(h.jobs[0].args.text,'one two');assert.deepEqual(output(h,a.runId).transcript.replica,seed.messages.c1.find(e=>e.id===seed.chatRuns[a.runId].outputEntryId).transcript.replica);await finish(h,h.jobs[0]);assert.equal(h.progressCalls[0].seq,1);assert.equal(h.progressCalls[0].generation,generation+1);await settle(()=>runtime(h,a.runId).delivered);h.controller.destroy();
});

test('existing input may be reused only by matching own conversation/text, never appended twice',async()=>{
 const seed=initial();seed.messages.c1.push({id:'existing-user',role:'user',text:'one two'});const h=await ready(seed);
 assert.equal((await h.controller.start(input('c2','bad',{inputEntryId:'existing-user'}))).ok,false);assert.equal(h.jobs.length,0);
 assert.equal((await h.controller.start(input('c1','mismatch',{inputEntryId:'existing-user',text:'different'}))).ok,false);assert.equal(h.jobs.length,0);
 const a=await h.controller.start(input('c1','reuse',{inputEntryId:'existing-user'}));assert.equal(a.ok,true);assert.equal(h.state.chatRuns[a.runId].inputEntryId,'existing-user');assert.equal(h.state.messages.c1.filter(e=>e.id==='existing-user').length,1);h.controller.destroy();
});

test('unknown adapter, missing input and inherited conversation reject recovery/start without execution',async()=>{
 const old=await ready(),a=await old.controller.start(input());const seed=old.durable;old.controller.destroy();
 for(const damage of [s=>{s.chatRuns[a.runId].adapterId='remote-unknown';},s=>{s.messages.c1=s.messages.c1.filter(e=>e.id!==s.chatRuns[a.runId].inputEntryId);}]){
  const bad=JSON.parse(JSON.stringify(seed));damage(bad);const h=await ready(bad);assert.equal((await h.controller.resume(command(a.runId))).ok,false);assert.equal(h.jobs.length,0);h.controller.destroy();
 }
 const h=await ready();for(const conversationId of ['__proto__','constructor','toString'])assert.equal((await h.controller.start(input(conversationId))).ok,false);assert.equal(h.jobs.length,0);h.controller.destroy();
});
test('construction is inert, first explicit reconciliation enables commands, repeated call never interrupts live work',async()=>{
 const h=harness(),before=h.state;assert.equal(h.writes.length,0);assert.equal(h.notifications.length,0);assert.equal(h.jobs.length,0);assert.equal((await h.controller.start(input())).code,'reload-not-reconciled');assert.equal(h.state,before);
 assert.equal((await h.controller.reconcileReload()).ok,true);assert.equal(h.writes.length,0);const a=await h.controller.start(input());await settle(()=>h.jobs.length===1);const n=h.writes.length;await h.controller.reconcileReload();assert.equal(h.writes.length,n);assert.equal(h.jobs[0].args.signal.aborted,false);assert.equal(h.state.chatRuns[a.runId].phase,'running');h.controller.destroy();
});
test('denied reload checkpoint is inert/unsaved until explicit retry; successful repair preserves content and unrelated identity',async()=>{
 const old=await ready(),a=await old.controller.start(input());await settle(()=>old.jobs.length===1);old.jobs[0].args.onProgress({text:'ONE',processed:3,total:7});await settle(()=>output(old,a.runId).text==='ONE');old.checkpoint();const seed=old.durable;old.controller.destroy();
 const h=harness(seed),before=h.state;h.deny(()=>true);assert.equal((await h.controller.reconcileReload()).ok,false);assert.equal(h.state,before);assert.equal(h.jobs.length,0);assert.equal(runtime(h,a.runId).effectivePhase,'interrupted');assert.equal(runtime(h,a.runId).statusSaved,false);assert.equal(runtime(h,a.runId).errorCode,'reload-save-failed');assert.equal(runtime(h,a.runId).canResume,false);
 assert.equal((await h.controller.resume(command(a.runId))).ok,false);assert.equal((await h.controller.start(input('c2','new'))).ok,false);assert.equal(h.jobs.length,0);
 h.deny(()=>false);assert.equal((await h.controller.reconcileReload()).ok,true);assert.equal(output(h,a.runId).text,'ONE');assert.equal(output(h,a.runId).transcript.status,'interrupted');assert.equal(h.state.chatRuns[a.runId].generation,seed.chatRuns[a.runId].generation);assert.equal(h.state.messages.c2,before.messages.c2);assert.equal(h.state.documents,before.documents);assert.equal(h.state.messages.c1[0],before.messages.c1[0]);assert.equal(h.writes.length,1);assert.equal(h.jobs.length,0);h.controller.destroy();
});
test('accepted input survives denied running checkpoint; adapter starts only after explicit durable resume',async()=>{
 const h=await ready();h.deny(s=>Object.values(s.chatRuns).some(r=>r.phase==='running'));const a=await h.controller.start(input());assert.equal(a.ok,true);await settle(()=>runtime(h,a.runId).errorCode==='run-start-save-failed');assert.equal(h.jobs.length,0);assert.equal(h.durable.chatRuns[a.runId].phase,'accepted');assert.equal(h.durable.messages.c1.find(e=>e.id===h.durable.chatRuns[a.runId].inputEntryId).text,'one two');
 h.deny(()=>false);assert.equal((await h.controller.resume(command(a.runId))).ok,true);await settle(()=>h.jobs.length===1);assert.equal(h.state.chatRuns[a.runId].generation,2);h.controller.destroy();
});
test('controller owns contiguous cursor/generation and cannot route producer progress into another conversation',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);const other=h.state.messages.c2;
 h.jobs[0].args.onProgress({text:'O',processed:1,total:7});h.jobs[0].args.onProgress({text:'ONE',processed:3,total:7});await settle(()=>output(h,a.runId).text==='ONE');await finish(h,h.jobs[0]);await settle(()=>runtime(h,a.runId).delivered);
 assert.deepEqual(h.progressCalls.map(p=>p.seq),[1,2,3]);assert.ok(h.progressCalls.every(p=>p.conversationId==='c1'&&p.runId===a.runId&&p.entryId===a.outputEntryId&&p.generation===1));assert.equal(h.state.messages.c2,other);h.controller.destroy();
});
test('a rejected host-seam progress publication aborts its owner and ignores late completion',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);h.denyProgress(()=>true);const job=h.jobs[0];job.args.onProgress({text:'STALE',processed:3,total:7});await settle(()=>job.args.signal.aborted);const calls=h.progressCalls.length;
 job.args.onProgress({text:'LATE',processed:7,total:7});job.resolve({text:'LATE',processed:7,total:7});for(let i=0;i<16;i++)await Promise.resolve();assert.equal(h.progressCalls.length,calls);assert.equal(output(h,a.runId).text,'');assert.equal(h.state.chatRuns[a.runId].delivery,null);h.controller.destroy();
});
test('newer composer draft/quote survive acceptance while the submitted exact quote is attached once',async()=>{
 const h=await ready();h.mutate(s=>({...s,drafts:{...s.drafts,c1:'new draft'},replyDrafts:{...s.replyDrafts,c1:{messageId:'legacy',text:'old',title:'new title'}}}));const before=h.state;
 const a=await h.controller.start(input());assert.equal(a.ok,true);assert.equal(h.state.drafts.c1,'new draft');assert.equal(h.state.replyDrafts.c1,before.replyDrafts.c1);const r=h.state.chatRuns[a.runId],entry=h.state.messages.c1.find(e=>e.id===r.inputEntryId);assert.deepEqual(entry.quote,{messageId:'legacy',text:'old',title:'old'});h.controller.destroy();
});
for(const layoutMode of [undefined,'elevated','bubble'])test('Markdown keeps local producer/kind/layout stable through pending, final-preview and save retry: '+String(layoutMode),async()=>{
 const h=await ready(),text='Before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n',a=await h.controller.start(input('c1','markdown',{text,operation:'markdown',style:'full',layoutMode}));await settle(()=>h.jobs.length===1);const pending=h.attempts.find(x=>x.next.chatRuns[a.runId]?.phase==='accepted'),r=pending.next.chatRuns[a.runId],entry=pending.next.messages.c1.find(e=>e.id===r.outputEntryId);
 assert.equal(entry.transcript.status,'pending');assert.equal(entry.transcript.kind,'send-message');assert.deepEqual(entry.transcript.replica,{producer:'local-text-v1',operation:'markdown'});assert.deepEqual(entry.transcript.payload,{layoutMode:layoutMode??'elevated'});assert.equal(r.layoutMode,undefined);assert.equal(h.jobs[0].args.text,text);
 h.deny(s=>Object.values(s.chatRuns).some(r=>r.phase==='delivered'));h.jobs[0].resolve({text,processed:text.length,total:text.length});await settle(()=>runtime(h,a.runId).canRetryDelivery);assert.equal(output(h,a.runId).text,text);assert.equal(output(h,a.runId).transcript.status,'streaming');assert.equal(h.state.chatRuns[a.runId].phase,'final-pending-delivery');assert.equal(h.progressCalls.at(-1).phase,'final-pending-delivery');assert.equal(h.state.chatRuns[a.runId].delivery,null);
 h.deny(()=>false);assert.equal((await h.controller.retryDelivery(command(a.runId))).ok,true);const final=output(h,a.runId);assert.equal(final.id,entry.id);assert.equal(final.text,text);assert.equal(final.transcript.kind,entry.transcript.kind);assert.deepEqual(final.transcript.replica,entry.transcript.replica);assert.deepEqual(final.transcript.payload,entry.transcript.payload);assert.equal(h.jobs.length,1);h.controller.destroy();
});
test('two simultaneous submissions with identical key accept one input/output/run and execute once',async()=>{
 const h=await ready(),[a,b]=await Promise.all([h.controller.start(input()),h.controller.start(input())]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(a.runId,b.runId);assert.equal(a.outputEntryId,b.outputEntryId);await settle(()=>h.jobs.length===1);const r=h.state.chatRuns[a.runId];assert.equal(h.state.messages.c1.filter(e=>e.id===r.inputEntryId).length,1);assert.equal(Object.keys(h.state.chatRuns).length,1);h.controller.destroy();
});
for(const change of [{operation:'remote'},{style:'mystery'},{layoutMode:'native'},{quote:{messageId:'legacy',text:'old',author:'Bot'}}])test('invalid supplied operation/style/layout/quote rejects without acceptance '+JSON.stringify(change),async()=>{
 const h=await ready(),before=h.state,result=await h.controller.start(input('c1','invalid',change));assert.equal(result.ok,false);assert.equal(h.state,before);assert.equal(h.jobs.length,0);assert.equal(h.writes.length,0);h.controller.destroy();
});
test('canonical work counters update with text/revision/seq and are readonly journal projections, not payload copies',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);const before=output(h,a.runId).transcript.revision;
 h.jobs[0].args.onProgress({text:'ONE',processed:3,total:7});await settle(()=>output(h,a.runId).text==='ONE');const r=h.state.chatRuns[a.runId],e=output(h,a.runId),snapshot=runtime(h,a.runId);
 assert.deepEqual(r.progress,{processed:3,total:7});assert.equal(r.lastSeq,1);assert.equal(e.transcript.revision,before+1);assert.deepEqual(snapshot.progress,r.progress);assert.ok(Object.isFrozen(snapshot.progress));assert.deepEqual(Object.keys(r.progress).sort(),['processed','total']);assert.equal(e.transcript.progress,undefined);assert.equal(e.transcript.payload.processed,undefined);assert.equal(e.transcript.payload.total,undefined);
 assert.equal(h.host.getChatSaveState(command(a.runId)).processed,undefined);h.controller.destroy();
});
test('historical missing counters remain unknown through reconcile; only explicit resume starts a new measured generation',async()=>{
 const old=await ready(),a=await old.controller.start(input());await settle(()=>old.jobs.length===1);old.checkpoint();const seed=old.durable;delete seed.chatRuns[a.runId].progress;old.controller.destroy();
 const h=harness(seed);assert.equal(runtime(h,a.runId).progress,undefined);assert.equal((await h.controller.reconcileReload()).ok,true);assert.equal(Object.hasOwn(h.state.chatRuns[a.runId],'progress'),false);assert.equal(runtime(h,a.runId).progress,undefined);assert.equal(h.jobs.length,0);
 const generation=h.state.chatRuns[a.runId].generation;assert.equal((await h.controller.resume(command(a.runId))).ok,true);assert.equal(h.state.chatRuns[a.runId].generation,generation+1);assert.deepEqual(runtime(h,a.runId).progress,{processed:0,total:7});h.controller.destroy();
});
test('incomplete final adapter counters cannot become final-pending or a delivered receipt',async()=>{
 const h=await ready(),a=await h.controller.start(input());await settle(()=>h.jobs.length===1);h.jobs[0].resolve({text:'ONE TWO',processed:3,total:7});for(let i=0;i<32;i++)await Promise.resolve();
 assert.equal(h.state.chatRuns[a.runId].delivery,null);assert.notEqual(h.state.chatRuns[a.runId].phase,'final-pending-delivery');assert.equal(runtime(h,a.runId).delivered,false);assert.equal(h.progressCalls.some(p=>p.phase==='final-pending-delivery'),false);h.controller.destroy();
});
test('valid historical delivered receipt stays valid with absent unknown counters, never fabricated completion units',async()=>{
 const old=await ready(),a=await old.controller.start(input());await settle(()=>old.jobs.length===1);await finish(old,old.jobs[0]);await settle(()=>runtime(old,a.runId).delivered);const seed=old.durable,receipt=JSON.stringify(seed.chatRuns[a.runId].delivery);delete seed.chatRuns[a.runId].progress;old.controller.destroy();
 const h=await ready(seed);assert.equal(runtime(h,a.runId).delivered,true);assert.equal(runtime(h,a.runId).progress,undefined);assert.equal(Object.hasOwn(h.state.chatRuns[a.runId],'progress'),false);assert.equal(JSON.stringify(h.state.chatRuns[a.runId].delivery),receipt);assert.equal(h.writes.length,0);assert.equal(h.jobs.length,0);h.controller.destroy();
});

const richDocument=text=>JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
test('local operation accepts a matching plain rich document and consumes its text/document/quote atomically',async()=>{
 const richText=richDocument('one two'),seed=initial();seed.draftRichTexts={c1:richText,c2:'keep'};const h=await ready(seed);
 const result=await h.controller.start(input('c1','rich-plain',{richText}));assert.equal(result.ok,true);
 const accepted=h.state.messages.c1.find(e=>e.id===h.state.chatRuns[result.runId].inputEntryId);
 assert.equal(accepted.richText,richText);assert.equal(accepted.text,'one two');assert.equal(h.state.drafts.c1,'');assert.equal(Object.hasOwn(h.state.draftRichTexts,'c1'),false);assert.equal(h.state.draftRichTexts.c2,'keep');assert.equal(h.state.replyDrafts.c1,undefined);
 await settle(()=>h.jobs.length===1);assert.equal(h.jobs[0].args.text,'one two');assert.equal(h.jobs[0].args.richText,undefined);h.controller.destroy();
});
test('local operation refuses malformed mismatched or atom documents before acceptance',async()=>{
 const atom=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'workflowReference',attrs:{id:'skill',label:'Onderzoek'}}]}]});
 for(const [text,richText] of [['one two','broken'],['one two',richDocument('different')],['@Onderzoek',atom]]){
  const h=await ready(),before=h.state;const result=await h.controller.start(input('c1','invalid-rich',{text,richText}));
  assert.equal(result.ok,false);assert.equal(result.code,'invalid-rich-text');assert.equal(h.state,before);assert.equal(h.jobs.length,0);assert.equal(h.writes.length,0);h.controller.destroy();
 }
});
test('rich document bytes participate in submission deduplication',async()=>{
 const richText=richDocument('one two'),h=await ready(),args=input('c1','rich-dedupe',{richText});
 const accepted=await h.controller.start(args);assert.equal(accepted.ok,true);assert.equal((await h.controller.start(args)).runId,accepted.runId);
 for(const changed of [undefined,JSON.stringify(JSON.parse(richText),null,2)]){
  const result=await h.controller.start({...args,richText:changed});assert.equal(result.ok,false);assert.equal(result.code,'submission-mismatch');
 }
 assert.equal(h.state.messages.c1.filter(e=>e.role==='user').length,1);h.controller.destroy();
});
test('input reuse requires exact rich document equality and preserves accepted metadata',async()=>{
 const richText=richDocument('one two'),seed=initial();seed.messages.c1.push({id:'existing-rich',role:'user',text:'one two',richText});const h=await ready(seed);
 for(const changed of [undefined,JSON.stringify(JSON.parse(richText),null,2)]){
  const result=await h.controller.start(input('c1','reuse-invalid',{inputEntryId:'existing-rich',richText:changed}));assert.equal(result.ok,false);assert.equal(result.code,'invalid-input');
 }
 const accepted=await h.controller.start(input('c1','reuse-rich',{inputEntryId:'existing-rich',richText}));assert.equal(accepted.ok,true);
 assert.equal(h.state.messages.c1.filter(e=>e.id==='existing-rich').length,1);assert.equal(h.state.messages.c1.find(e=>e.id==='existing-rich').richText,richText);h.controller.destroy();
});
test('acceptance cannot consume newer rich draft metadata appearing after a plain request starts',async()=>{
 let state=initial(),inject=false,id=0;
 const controller=createChatRunController({getState:()=>state,commit:build=>{if(inject){inject=false;state={...state,draftRichTexts:{c1:'new rich document',c2:'keep'}};}state=build(state);return {ok:true};},adapter:{id:'local-text-v1',execute:()=>new Promise(()=>{})},newId:()=>`rich-race-${++id}`});
 await controller.reconcileReload();inject=true;const result=await controller.start(input());
 assert.equal(result.ok,true);assert.equal(state.drafts.c1,'one two');assert.deepEqual(state.replyDrafts.c1,{messageId:'legacy',text:'old',title:'old'});assert.equal(state.draftRichTexts.c1,'new rich document');assert.equal(state.draftRichTexts.c2,'keep');controller.destroy();
});

test('same-text newer rich draft survives acceptance of a different rich document',async()=>{
 const richText=richDocument('one two'),newer=JSON.stringify(JSON.parse(richText),null,2),seed=initial();seed.draftRichTexts={c1:newer,c2:'keep'};const h=await ready(seed),before=h.state;
 const accepted=await h.controller.start(input('c1','older-rich',{richText}));assert.equal(accepted.ok,true);assert.equal(h.state.drafts.c1,'one two');assert.equal(h.state.draftRichTexts.c1,newer);assert.equal(h.state.replyDrafts.c1,before.replyDrafts.c1);h.controller.destroy();
});
test('input rich document changed at commit boundary cannot be silently reused',async()=>{
 const richText=richDocument('one two'),seed=initial();seed.messages.c1.push({id:'existing-rich',role:'user',text:'one two',richText});let state=seed,inject=false,id=0;
 const controller=createChatRunController({getState:()=>state,commit:build=>{if(inject){inject=false;state={...state,messages:{...state.messages,c1:state.messages.c1.map(e=>e.id==='existing-rich'?{...e,richText:JSON.stringify(JSON.parse(richText),null,2)}:e)}};}state=build(state);return {ok:true};},adapter:{id:'local-text-v1',execute:()=>new Promise(()=>{})},newId:()=>`reuse-race-${++id}`});
 await controller.reconcileReload();inject=true;const result=await controller.start(input('c1','reuse-race',{inputEntryId:'existing-rich',richText}));
 assert.equal(result.ok,false);assert.equal(Object.keys(state.chatRuns).length,0);assert.equal(state.messages.c1.filter(e=>e.role==='bot').length,1);controller.destroy();
});

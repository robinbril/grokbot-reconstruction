import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChatRuns,normalizeEntry} from '../chat-entry-model.js';
import {createChatStateHost} from '../chat-state-host.js';
import {createChatRunController} from '../chat-run-controller.js';

function seed() {
 const input={id:'u',role:'user',text:'x'};
 const output={id:'o',role:'bot',text:'',transcript:{schema:1,kind:'send-message',revision:1,status:'streaming',runId:'r',generation:1,replica:{producer:'local-text-v1',operation:'upper'},payload:{layoutMode:'bubble'}}};
 const run={schema:1,id:'r',conversationId:'c',submissionId:'s',inputEntryId:'u',outputEntryId:'o',noticeEntryIds:[],adapterId:'local-text-v1',operation:'upper',style:'short',styleProfileVersion:'local-answer-v1',generation:1,lastSeq:0,phase:'running',progress:{processed:0,total:1},createdAt:1,updatedAt:1,delivery:null};
 return {version:1,messages:{c:[input,output]},chatRuns:{r:run}};
}
function unsafeList(state,kind) {
 const [input,output]=state.messages.c; let reads=0;
 const list=new Array(2);list[1]=output;
 if(kind==='accessor')Object.defineProperty(list,0,{enumerable:true,configurable:true,get(){reads++;throw Error('forbidden array getter');}});
 else {const proto=Object.create(Array.prototype);Object.defineProperty(proto,0,{value:input,configurable:true});Object.setPrototypeOf(list,proto);}
 state.messages.c=list;return()=>reads;
}
function hostFor(initial) {
 let state=initial;
 const host=createChatStateHost({getState:()=>state,publishState:next=>state=next,storage:{setItem(){}},storageKey:'grok-local-replica-v1',initialSavedState:null});
 return {host,get state(){return state;}};
}
for(const kind of ['accessor','inherited'])test(`journal rejects ${kind} array input without executing or borrowing it`,()=>{
 const state=seed();assert.ok(normalizeChatRuns(state).chatRuns.r);const reads=unsafeList(state,kind);let result;
 assert.doesNotThrow(()=>{result=normalizeChatRuns(state);});assert.equal(reads(),0);assert.equal(result.chatRuns.r,undefined);assert.ok(result.issues.length>0);
});
for(const kind of ['accessor','inherited'])test(`production progress rejects ${kind} array input without publication`,()=>{
 const state=seed(),reads=unsafeList(state,kind),h=hostFor(state);let result;
 assert.doesNotThrow(()=>{result=h.host.publishChatProgress({conversationId:'c',runId:'r',entryId:'o',generation:1,seq:1,text:'X',phase:'running',progress:{processed:1,total:1}});});
 assert.equal(reads(),0);assert.equal(result.ok,false);assert.equal(h.state,state);assert.equal(state.chatRuns.r.lastSeq,0);
});
for(const method of ['getRuntime','cancel','resume','retryDelivery'])test(`public ${method} rejects request accessors without invoking them`,async()=>{
 const h=hostFor({version:1,messages:{c:[]},chatRuns:{}}),controller=createChatRunController({getState:()=>h.state,...h.host,adapter:{id:'local-text-v1',execute:async()=>{throw Error('must never execute');}}});
 let reads=0;const request=Object.defineProperty({runId:'r'},'conversationId',{enumerable:true,get(){reads++;throw Error('forbidden request getter');}});
 try {let result;await assert.doesNotReject(async()=>{result=await controller[method](request);});assert.equal(reads,0);if(method==='getRuntime')assert.equal(result.errorCode,'unavailable');else assert.equal(result.ok,false);}finally{controller.destroy();}
});
test('real production save-only retry preserves reactions added to the exact final preview without rerunning work',async()=>{
 let state={version:1,messages:{c:[]},chatRuns:{},drafts:{c:'hello'}},deny=true,ids=0,calls=0;
 const host=createChatStateHost({getState:()=>state,publishState:s=>state=s,storage:{setItem(key,bytes){if(deny&&Object.values(JSON.parse(bytes).chatRuns).some(r=>r.phase==='delivered'))throw Error('quota');}},storageKey:'grok-local-replica-v1'});
 const controller=createChatRunController({getState:()=>state,...host,adapter:{id:'local-text-v1',execute:async({text})=>{calls++;return {text:text.toUpperCase(),processed:text.length,total:text.length};}},newId:()=>String(++ids)});
 try {
  assert.equal((await controller.reconcileReload()).ok,true);
  const a=await controller.start({conversationId:'c',submissionId:'s',text:'hello',operation:'upper',style:'short'});assert.equal(a.ok,true);
  for(let n=0;n<64&&!controller.getRuntime({conversationId:'c',runId:a.runId}).canRetryDelivery;n++)await Promise.resolve();
  assert.equal(controller.getRuntime({conversationId:'c',runId:a.runId}).canRetryDelivery,true);
  const pending=state.messages.c.find(e=>e.id===a.outputEntryId);assert.equal(pending.text,'HELLO');assert.equal(state.chatRuns[a.runId].delivery,null);
  const reactions=['useful'];pending.reactions=reactions;pending.ownAnnotation={keep:'unrelated outer metadata'};assert.equal(host.persist(),true);
  deny=false;assert.equal((await controller.retryDelivery({conversationId:'c',runId:a.runId})).ok,true);
  const final=state.messages.c.find(e=>e.id===a.outputEntryId);assert.equal(final.reactions,reactions);assert.deepEqual(final.ownAnnotation,{keep:'unrelated outer metadata'});assert.equal(final.text,'HELLO');assert.equal(final.transcript.status,'stable');assert.equal(state.chatRuns[a.runId].phase,'delivered');assert.equal(calls,1);assert.equal(final.id,pending.id);assert.equal(state.chatRuns[a.runId].delivery.revision,final.transcript.revision);
 }finally{controller.destroy();}
});
test('optional layout hint never reads an inherited payload getter',()=>{
 const state=seed(),message=state.messages.c[1];message.transcript.payload={};let reads=0,result;
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'layoutMode');
 try {Object.defineProperty(Object.prototype,'layoutMode',{configurable:true,get(){reads++;throw Error('forbidden layout getter');}});assert.doesNotThrow(()=>{result=normalizeEntry(message,{conversationId:'c'});});}
 finally {if(prior)Object.defineProperty(Object.prototype,'layoutMode',prior);else delete Object.prototype.layoutMode;}
 assert.equal(reads,0);assert.equal(result.payload,undefined);
});
test('journal traversal never calls an array-provided find getter',()=>{
 const state=seed();let reads=0;Object.defineProperty(state.messages.c,'find',{get(){reads++;throw Error('forbidden traversal method getter');}});
 assert.doesNotThrow(()=>normalizeChatRuns(state));assert.equal(reads,0);
});
test('notice reference validation never executes an indexed array getter',()=>{
 const state=seed();let reads=0;const list=new Array(1);Object.defineProperty(list,0,{enumerable:true,get(){reads++;throw Error('forbidden notice getter');}});state.chatRuns.r.noticeEntryIds=list;
 let result;assert.doesNotThrow(()=>{result=normalizeChatRuns(state);});assert.equal(reads,0);assert.equal(result.chatRuns.r,undefined);
});
for(const method of ['cancel','resume'])test(`${method} cannot commit a replacement revision beyond the safe integer boundary`,async()=>{
 let state=seed(),writes=0,executions=0;state.chatRuns.r.phase='interrupted';state.messages.c[1].transcript.status='interrupted';state.messages.c[1].transcript.revision=Number.MAX_SAFE_INTEGER;
 assert.ok(normalizeChatRuns(state).chatRuns.r);
 const host=createChatStateHost({getState:()=>state,publishState:s=>state=s,storage:{setItem(){writes++;}},storageKey:'grok-local-replica-v1'});
 const c=createChatRunController({getState:()=>state,...host,adapter:{id:'local-text-v1',execute:async()=>{executions++;return {text:'X',processed:1,total:1};}}});
 try {assert.equal((await c.reconcileReload()).ok,true);const before=state,prior=writes,result=await c[method]({conversationId:'c',runId:'r'});assert.equal(result.ok,false);assert.equal(state,before);assert.equal(writes,prior);assert.equal(executions,0);assert.equal(state.messages.c[1].transcript.revision,Number.MAX_SAFE_INTEGER);}
 finally{c.destroy();}
});

for(const method of ['getRuntime','cancel','resume','retryDelivery'])test(`public ${method} never reads inherited conversation lookup accessors`,async()=>{
 const h=hostFor({version:1,messages:{c:[]},chatRuns:{}}),controller=createChatRunController({getState:()=>h.state,...h.host,adapter:{id:'local-text-v1',execute:async()=>{throw Error('must never execute');}}});let reads=0,result;
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'conversationId');
 try{Object.defineProperty(Object.prototype,'conversationId',{configurable:true,get(){reads++;throw Error('inherited conversation getter');}});await assert.doesNotReject(async()=>{result=await controller[method]({runId:'r'});});assert.equal(reads,0);if(method==='getRuntime')assert.equal(result.errorCode,'unavailable');else assert.equal(result.ok,false);}
 finally{if(prior)Object.defineProperty(Object.prototype,'conversationId',prior);else delete Object.prototype.conversationId;controller.destroy();}
});
test('start never reads an inherited optional layout accessor',async()=>{
 const h=hostFor({version:1,messages:{c:[]},chatRuns:{}}),controller=createChatRunController({getState:()=>h.state,...h.host,adapter:{id:'local-text-v1',execute:async({text})=>({text,processed:text.length,total:text.length})}});let reads=0;
 await controller.reconcileReload();
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'layoutMode');
 try{Object.defineProperty(Object.prototype,'layoutMode',{configurable:true,get(){reads++;throw Error('inherited layout getter');}});await assert.doesNotReject(async()=>{await controller.start({conversationId:'c',submissionId:'s',text:'x',operation:'upper',style:'short'});});assert.equal(reads,0);}
 finally{if(prior)Object.defineProperty(Object.prototype,'layoutMode',prior);else delete Object.prototype.layoutMode;controller.destroy();}
});
test('adapter failure after last-safe resume cannot persist an unsafe replacement revision',async()=>{
 let state=seed(),writes=[];state.chatRuns.r.phase='interrupted';state.messages.c[1].transcript.status='interrupted';state.messages.c[1].transcript.revision=Number.MAX_SAFE_INTEGER-1;
 const host=createChatStateHost({getState:()=>state,publishState:s=>state=s,storage:{setItem(key,bytes){writes.push(JSON.parse(bytes));}},storageKey:'grok-local-replica-v1'});
 const controller=createChatRunController({getState:()=>state,...host,adapter:{id:'local-text-v1',execute:async()=>{throw Error('actual adapter failure');}}});
 try{assert.equal((await controller.reconcileReload()).ok,true);const resumed=await controller.resume({conversationId:'c',runId:'r'});assert.equal(resumed.ok,true);for(let n=0;n<32;n++)await Promise.resolve();assert.ok(writes.length>0);assert.equal(writes.every(s=>s.messages.c.every(m=>!m.transcript||Number.isSafeInteger(m.transcript.revision))),true);assert.ok(Number.isSafeInteger(state.messages.c[1].transcript.revision));}
 finally{controller.destroy();}
});

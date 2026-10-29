import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatRunController} from '../chat-run-controller.js';
import {createChatStateHost} from '../chat-state-host.js';

const settle=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await Promise.resolve();}assert.fail('Expected production lifecycle handshake was not reached');};
async function fixture(){
 let state={version:1,agents:[{id:'a'},{id:'b'}],messages:{a:[],b:[]},drafts:{a:'a text',b:'b text'},replyDrafts:{},chatRuns:{}},denyFinal=false;
 const writes=[],jobs=[];
 const host=createChatStateHost({getState:()=>state,publishState:s=>{state=s;},storageKey:'demo',storage:{setItem(_key,bytes){const next=JSON.parse(bytes);if(denyFinal&&Object.values(next.chatRuns).some(r=>r.phase==='delivered'))throw Error('Denied final');writes.push(bytes);}}});
 const controller=createChatRunController({...host,getState:()=>state,adapter:{id:'local-text-v1',execute(args){let resolve;const promise=new Promise(r=>{resolve=r;});jobs.push({args,resolve});return promise;}}});
 await controller.reconcileReload();
 const start=id=>controller.start({conversationId:id,submissionId:'submission-'+id,text:id+' text',operation:'upper',style:'short'});
 const clear=id=>{const result=host.commit(s=>({...s,messages:{...s.messages,[id]:[]},chatRuns:Object.fromEntries(Object.entries(s.chatRuns).filter(([,r])=>r.conversationId!==id))}),{reason:'clear-conversation'});assert.equal(result.ok,true);controller.revokeConversation(id);};
 return {controller,host,start,clear,jobs,writes,get state(){return state;},denyFinal:value=>{denyFinal=value;}};
}

test('clearing one conversation immediately aborts only its runtime and cannot publish late results',async()=>{
 const h=await fixture();const a=await h.start('a'),b=await h.start('b');assert.equal(a.ok,true);assert.equal(b.ok,true);await settle(()=>h.jobs.length===2);
 const first=h.jobs.find(j=>j.args.text==='a text'),second=h.jobs.find(j=>j.args.text==='b text');
 h.clear('a');const writes=h.writes.length;
 assert.equal(first.args.signal.aborted,true);assert.equal(second.args.signal.aborted,false);
 first.args.onProgress({text:'STALE',processed:6,total:6});first.resolve({text:'STALE',processed:6,total:6});
 for(let n=0;n<10;n++)await Promise.resolve();assert.equal(h.writes.length,writes);assert.deepEqual(h.state.messages.a,[]);assert.equal(h.state.chatRuns[a.runId],undefined);
 second.resolve({text:'B TEXT',processed:6,total:6});await settle(()=>h.state.chatRuns[b.runId]?.phase==='delivered');
 assert.equal(h.state.messages.b.find(m=>m.id===b.outputEntryId).text,'B TEXT');assert.deepEqual(h.state.messages.a,[]);h.controller.destroy();
});

test('clearing pending final delivery revokes its save-only retry without another storage write',async()=>{
 const h=await fixture(),a=await h.start('a');await settle(()=>h.jobs.length===1);h.denyFinal(true);
 h.jobs[0].resolve({text:'A TEXT',processed:6,total:6});await settle(()=>h.controller.getRuntime({conversationId:'a',runId:a.runId}).canRetryDelivery);
 h.denyFinal(false);h.clear('a');const writes=h.writes.length;
 assert.equal(h.jobs[0].args.signal.aborted,true);
 const result=await h.controller.retryDelivery({conversationId:'a',runId:a.runId});assert.equal(result.ok,false);assert.equal(h.writes.length,writes);assert.deepEqual(h.state.messages.a,[]);h.controller.destroy();
});

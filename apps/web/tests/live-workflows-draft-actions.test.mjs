import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveWorkflowActions} from '../live-workflows-actions.js';
import {createChatStateHost} from '../chat-state-host.js';

function fixture(){
 let state={version:1,messages:{A:[]},drafts:{A:''},liveHarness:{serverIds:{A:'server-A'}}},fail=false;
 const calls=[],writes=[];
 const host={...createChatStateHost({getState:()=>state,publishState:next=>{state=next;},storageKey:'synthetic-actions',storage:{setItem(_key,bytes){if(fail)throw Error('Synthetic denied write');writes.push(JSON.parse(bytes));}}}),getState:()=>state};
 const actions=createLiveWorkflowActions({host,serverId:()=> 'server-A',client:{cancelQueued:async(...args)=>{calls.push(args);return {schema:1,acknowledged:true,queueId:args[1],status:'cancelled'};}}});
 return {actions,calls,writes,get state(){return state;},set fail(value){fail=value;}};
}

test('draft recovery is a durable cancellation action sharing queue mutation ownership',async()=>{
 const f=fixture(),record=f.actions.begin('A','recover-draft','queue-1');
 assert.equal(record.valid,true);assert.equal(f.actions.held('A','cancel','queue-1'),true);assert.equal(f.actions.held('A','retry','queue-1'),true);
 assert.throws(()=>f.actions.begin('A','cancel','queue-1'),/niet bevestigd/);
 await f.actions.dispatch(record);assert.deepEqual(f.calls,[['server-A','queue-1',record.requestId]]);
 assert.equal(f.actions.recover('A',record.lock).requestId,record.requestId);
});

test('retirement atomically applies recovery and removes only the original action',()=>{
 const f=fixture(),record=f.actions.begin('A','cancel','queue-1');
 f.actions.retire(record,false,state=>({...state,drafts:{...state.drafts,A:'RESTORED_RAW'}}));
 assert.equal(f.state.drafts.A,'RESTORED_RAW');assert.deepEqual(f.state.liveHarness.workflowRequests,{});
 const last=f.writes.at(-1);assert.equal(last.drafts.A,'RESTORED_RAW');assert.deepEqual(last.liveHarness.workflowRequests,{});
});

test('failed atomic retirement preserves both original action and newer draft',()=>{
 const f=fixture(),record=f.actions.begin('A','cancel','queue-1'),before=structuredClone(f.state);f.fail=true;
 assert.throws(()=>f.actions.retire(record,false,state=>({...state,drafts:{...state.drafts,A:'RESTORED_RAW'}})),/opgeslagen/);
 assert.deepEqual(f.state,before);assert.equal(f.actions.recover('A',record.lock).requestId,record.requestId);
});

test('a recovery callback cannot remove or substitute the pinned action identity',()=>{
 const f=fixture(),record=f.actions.begin('A','cancel','queue-1'),before=structuredClone(f.state);
 assert.throws(()=>f.actions.retire(record,false,state=>({...state,liveHarness:{...state.liveHarness,workflowRequests:{}}})),/opgeslagen/);
 assert.deepEqual(f.state,before);
 assert.throws(()=>f.actions.retire(record,false,state=>({...state,liveHarness:{...state.liveHarness,workflowRequests:{[record.lock]:{...state.liveHarness.workflowRequests[record.lock],serverConversationId:'different-server'}}}})),/opgeslagen/);
 assert.deepEqual(f.state,before);
});

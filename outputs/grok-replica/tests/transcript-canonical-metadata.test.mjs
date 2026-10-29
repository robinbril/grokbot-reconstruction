import test from 'node:test';
import assert from 'node:assert/strict';
import {projectLiveMessages,emptyLiveConversation} from '../live-harness-model.js';
import {exchangePeerReferences,agentExchangeRows} from '../transcript-covered.js';
import {replicaUnreadEntries,currentUnreadReceipts} from '../transcript-unread-ledger.js';
import {isUnreadEntry} from '../transcript-unread-state.js';
const self={id:'self',kind:'agent',name:'Self'},peer={id:'peer',kind:'cloud-agent',name:'Peer'};
const entry=(extra={})=>({id:'canonical',kind:'message',role:'user',text:'synthetic exchange',createdAt:200,...extra});
const project=value=>projectLiveMessages({...emptyLiveConversation('synthetic'),entries:[value]});
test('canonical explicit native message endpoints reach exchange and native unread eligibility through public projection',()=>{
 const projected=project(entry({fromAgent:peer,toAgent:self,channel:'chat:actual',suppressed:false,branched:true}));
 assert.deepEqual(exchangePeerReferences(projected[0],self.id),[peer]);
 assert.deepEqual(agentExchangeRows(projected,peer.id,self).map(row=>[row.id,row.author,row.message.content]),[['canonical',peer,'synthetic exchange']]);
 const native=replicaUnreadEntries(projected)[0];
 assert.deepEqual(native.fromAgent,peer);assert.deepEqual(native.toAgent,self);
 assert.equal(native.channel,'chat:actual');assert.equal(native.suppressed,false);assert.equal(native.branched,true);
 assert.equal(isUnreadEntry(native),false);
 const ordinary=replicaUnreadEntries(project(entry()))[0];assert.equal(isUnreadEntry(ordinary),false);
 assert.equal(isUnreadEntry(replicaUnreadEntries(project(entry({fromAgent:peer})))[0]),true);
});
test('canonical edits alter current receipt eligibility without rewriting durable identity or claiming peer routing',()=>{
 const receipt={id:'canonical',entryId:'canonical',timestampMs:250,eligible:true};
 for(const metadata of [{suppressed:false},{branched:true},{channel:'meeting:actual'},{toAgent:{id:'service',kind:'integration',name:'Service'}}]){
  const projected=project(entry({fromAgent:peer,...metadata}));
  const current=currentUnreadReceipts(replicaUnreadEntries(projected),[receipt])[0];
  assert.equal(current.eligible,false);assert.equal(current.timestampMs,250);
  for(const [key,value] of Object.entries(metadata))assert.deepEqual(projected[0][key],value);
 }
 assert.deepEqual(exchangePeerReferences(project(entry({toAgent:{id:'service',kind:'integration',name:'Service'}}))[0],self.id),[]);
 assert.deepEqual(exchangePeerReferences(project(entry({fromAgent:{id:12,kind:'agent',name:'Invalid'}}))[0],self.id),[]);
 assert.deepEqual(exchangePeerReferences(project(entry({kind:undefined,text:'@Peer without endpoint'}))[0],self.id),[]);
});
test('canonical assistant deliveries preserve source eligibility metadata at the exact child identity',()=>{
 const projected=project(entry({role:'assistant',branched:true,channel:'voice:actual',messages:[{id:'delivery',type:'text',content:'synthetic',createdAt:210}]}));
 const native=replicaUnreadEntries(projected)[0];assert.equal(native.id,'delivery');assert.equal(native.entryId,'canonical');assert.equal(native.branched,true);assert.equal(native.message.channel,'voice:actual');assert.equal(isUnreadEntry(native),false);
 const untimed=replicaUnreadEntries(project(entry({role:'assistant',messages:[{id:'untimed',type:'text',content:'synthetic'}]})))[0];assert.equal(Object.hasOwn(untimed,'timestampMs'),false);
});

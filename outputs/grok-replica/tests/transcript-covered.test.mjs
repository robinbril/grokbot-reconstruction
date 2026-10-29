import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {agentExchangeRows,exchangePeerReferences,setTranscriptCovered} from '../transcript-covered.js';

const source=readFileSync(new URL('./fixtures/source-reference/agent-exchange.native.js',import.meta.url),'utf8');
const native=vm.runInNewContext(source+';Kp');
const self={kind:'agent',id:'marketing',name:'Marketing Agent'},peer={kind:'agent',id:'find',name:'Find Customers'};
test('actual endpoint selection and authors match the frozen native Kp function',()=>{
 const entries=[{kind:'message',id:'out',content:'outbound',toAgent:peer,timestampMs:42},{kind:'message',id:'in',content:'inbound',fromAgent:peer,attachments:[{id:'a'}],images:[{id:'i'}],cloudAgentWake:{reason:'actual'}},{kind:'message',id:'other',content:'unrelated',toAgent:{id:'other'}},{kind:'send-message',id:'not-message',content:'wrong kind',toAgent:peer},{kind:'message',id:'null-author',content:'missing author',fromAgent:{id:'find'}}];
 assert.deepEqual(agentExchangeRows(entries,'find',self),JSON.parse(JSON.stringify(native(entries,'find',self))));
 assert.deepEqual(agentExchangeRows([{id:'text-only',role:'bot',text:'@Find Customers'}],'find',self),[]);
});
test('local persisted text adapter keeps endpoint identity and never guesses peers from mentions or role',()=>{
 const entry={id:'persisted',role:'bot',text:'exact <text>',createdAt:'2026-10-21T10:00:00Z',toAgent:peer};
 assert.deepEqual(agentExchangeRows([entry],'find',self),[{kind:'send-message',id:'persisted',message:{type:'text',content:'exact <text>'},author:self,timestampMs:Date.parse(entry.createdAt)}]);
 assert.deepEqual(exchangePeerReferences(entry,self.id,id=>id==='find'?peer:null),[peer]);
 assert.deepEqual(exchangePeerReferences({id:'mention',text:'@Find Customers',role:'bot'},self.id,()=>peer),[]);
 assert.deepEqual(exchangePeerReferences({id:'actual',text:'actual content',fromAgent:self,toAgent:peer},self.id,()=>peer),[peer]);
 assert.deepEqual(agentExchangeRows([{id:'task',role:'bot',productKind:'run',text:'task state',toAgent:peer}],'find',self),[]);
 assert.deepEqual(exchangePeerReferences({id:'approval',role:'bot',card:'approval',text:'approval state',toAgent:peer},self.id,()=>peer),[]);
});
test('coverage touches only the supplied viewport and removes the exact attributes when uncovered',()=>{
 const attributes=new Map(),viewport={hasAttribute:name=>attributes.has(name),getAttribute:name=>attributes.get(name)??null,setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name)};
 setTranscriptCovered(viewport,true);assert.deepEqual(Object.fromEntries(attributes),{inert:'','aria-hidden':'true'});
 setTranscriptCovered(viewport,true);setTranscriptCovered(viewport,false);assert.deepEqual(Object.fromEntries(attributes),{});
 setTranscriptCovered(null,true);
});

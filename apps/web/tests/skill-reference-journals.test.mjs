import test from 'node:test';
import assert from 'node:assert/strict';
import {createSendJournal} from '../send-journal.js';
import {retainQueuedDraft,findQueuedDraft} from '../live-queued-drafts.js';
import {prepareRecoveredSendDraft} from '../send-draft-recovery.js';

const skill={kind:'skill',id:'synthetic-skill',label:'Synthetische skill',description:'Korte beschrijving',revision:1};
function journalFixture(initial={version:1}){
 let state=initial,index=0;const calls=[];
 const journal=createSendJournal({getState:()=>state,commit:update=>{state=update(state);return {ok:true};},newId:()=>`journal-${++index}`,dispatch:async value=>{calls.push(value);return {accepted:true};}});
 return {journal,calls,state:()=>state};
}
function queuedFixture({legacy=false}={}){
 const references=[structuredClone(skill),...(legacy?[{kind:'skill',id:'legacy',label:'Oude skill',description:'Oude instructies'}]:[])];
 const draft={conversationId:'local',requestId:'queued-skill',text:'',attachments:[],skillReferences:references};
 const payload={requestId:draft.requestId,text:'',skillRefs:[{id:skill.id,revision:1}],...(legacy?{skillReferences:[JSON.stringify(references[1],null,2)]}:{})};
 const request={queued:true,signature:'synthetic',serverConversationId:'server',draft,payload};
 const state={version:1,drafts:{local:''},composerSkillReferences:{local:[]},liveHarness:{serverIds:{local:'server'},pendingSends:{local:request}}};
 const args={conversationId:'local',serverConversationId:'server',queueId:'queue-skill',request};
 const {requestId,...canonicalPayload}=payload;
 return {state,args,row:{id:'queue-skill',requestId,status:'queued',payload:canonicalPayload}};
}
test('send journal persists an immutable selected skill revision through browser reload and dispatch',async()=>{
 const f=journalFixture(),input={conversationId:'local',text:'',attachments:[],skillReferences:[structuredClone(skill)]};
 const receipt=f.journal.enqueue(input);assert.equal(receipt.ok,true);
 input.skillReferences[0].revision=2;assert.equal(f.journal.records()[0].snapshot.skillReferences[0].revision,1);
 const saved=JSON.parse(JSON.stringify(f.state()));f.journal.destroy();const restarted=journalFixture(saved);
 await restarted.journal.drain();assert.equal(restarted.calls.length,1);
 assert.equal(restarted.calls[0].skillReferences[0].revision,1);assert.equal(restarted.calls[0].nonce,receipt.nonce);
 restarted.journal.destroy();
});
test('send journal rejects malformed skill revisions and untrusted body fields',()=>{
 const f=journalFixture();
 for(const revision of [0,-1,1.5,'1',null,Number.MAX_SAFE_INTEGER+1])assert.equal(f.journal.enqueue({conversationId:'local',text:'test',attachments:[],skillReferences:[{...skill,revision}]}).ok,false);
 assert.equal(f.journal.enqueue({conversationId:'local',text:'test',attachments:[],skillReferences:[{...skill,content:'forged body'}]}).ok,false);
 assert.equal(f.journal.records().length,0);f.journal.destroy();
});
test('model queue binds structured revisions separately from legacy skill text and retains them through reload',()=>{
 for(const legacy of [false,true]){
  const f=queuedFixture({legacy}),saved=retainQueuedDraft(f.state,f.args),reloaded=JSON.parse(JSON.stringify(saved));
  const binding=findQueuedDraft(reloaded,'local','server',f.row);assert.ok(binding);
  assert.deepEqual(binding.payload.skillRefs,[{id:skill.id,revision:1}]);
  assert.equal(binding.draft.skillReferences[0].revision,1);
  const changed=structuredClone(f.row);changed.payload.skillRefs[0].revision=2;
  assert.equal(findQueuedDraft(reloaded,'local','server',changed),null);
  const restored=prepareRecoveredSendDraft(reloaded,binding.draft,{attachments:[],failed:[],busy:false});
  assert.equal(restored.composerSkillReferences.local[0].revision,1);
 }
});
test('queue cannot bind a different revision, unknown reference fields or client-injected content',()=>{
 for(const change of [
  f=>{f.args.request.payload.skillRefs[0].revision=2;},
  f=>{f.args.request.payload.skillRefs[0].content='forged body';},
  f=>{f.args.request.draft.skillReferences[0].revision=0;},
  f=>{f.args.request.draft.skillReferences[0].content='forged body';},
 ]){const f=queuedFixture();change(f);assert.throws(()=>retainQueuedDraft(f.state,f.args));}
});

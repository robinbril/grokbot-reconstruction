import test from 'node:test';
import assert from 'node:assert/strict';
import {createSendJournal} from '../send-journal.js';
import {retainQueuedDraft,findQueuedDraft} from '../live-queued-drafts.js';
import {prepareRecoveredSendDraft} from '../send-draft-recovery.js';

const skill={kind:'skill',id:'synthetic-skill',label:'Onderzoek',description:'Synthetisch',revision:1};
const document=()=>JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Gebruik '},{type:'workflowReference',attrs:{id:skill.id,label:skill.label,iconId:null,iconUrl:null}},{type:'text',text:' nu'}]}]});
const draft=()=>({conversationId:'local',text:'Gebruik @Onderzoek nu',richText:document(),attachments:[],skillReferences:[structuredClone(skill)]});
function fixture(initial={version:1}){
 let state=initial,index=0;const calls=[];
 const journal=createSendJournal({getState:()=>state,commit:update=>{state=update(state);return {ok:true};},newId:()=>`journal-${++index}`,dispatch:async value=>{calls.push(value);return {accepted:true};}});
 return {journal,calls,state:()=>state};
}
function queuedFixture(){
 const snapshot={...draft(),requestId:'request-rich'};
 const payload={requestId:snapshot.requestId,text:snapshot.text,richText:snapshot.richText,skillRefs:[{id:skill.id,revision:1}]};
 const request={queued:true,signature:'synthetic',serverConversationId:'server',draft:snapshot,payload};
 const state={version:1,drafts:{local:''},composerSkillReferences:{local:[]},liveHarness:{serverIds:{local:'server'},pendingSends:{local:request}}};
 const {requestId,...canonicalPayload}=payload;
 return {state,args:{conversationId:'local',serverConversationId:'server',queueId:'queue-rich',request},row:{id:'queue-rich',requestId,status:'queued',payload:canonicalPayload}};
}
const recovery={attachments:[],failed:[],busy:false};
test('send journal preserves exact rich document through reload and dispatch',async()=>{
 const f=fixture(),snapshot=draft(),receipt=f.journal.enqueue(snapshot);assert.equal(receipt.ok,true);
 snapshot.richText='mutated';const persisted=JSON.parse(JSON.stringify(f.state()));f.journal.destroy();
 const restarted=fixture(persisted);await restarted.journal.drain();
 assert.equal(restarted.calls.length,1);assert.equal(restarted.calls[0].richText,document());assert.equal(restarted.calls[0].nonce,receipt.nonce);restarted.journal.destroy();
});
test('send journal rejects mismatched text, node skill binding and malformed rich documents without accepting an intent',()=>{
 const f=fixture();
 for(const change of [value=>{value.text='different';},value=>{value.skillReferences=[];},value=>{value.richText='not json';},value=>{value.richText='x'.repeat(262145);}]){
  const value=draft();change(value);assert.equal(f.journal.enqueue(value).ok,false);
 }
 assert.equal(f.journal.records().length,0);f.journal.destroy();
});
test('rich text bound is independent of the existing ordinary string limit',()=>{
 const f=fixture(),value=draft();value.richText=' '.repeat(100001)+value.richText;
 assert.equal(f.journal.enqueue(value).ok,true);assert.equal(f.journal.records()[0].snapshot.richText,value.richText);
 assert.equal(f.journal.enqueue({...draft(),text:'x'.repeat(100001),richText:undefined}).ok,false);f.journal.destroy();
});
test('exact canonical rich document is bound to queued draft and survives reload',()=>{
 const f=queuedFixture(),state=JSON.parse(JSON.stringify(retainQueuedDraft(f.state,f.args)));
 const binding=findQueuedDraft(state,'local','server',f.row);assert.ok(binding);assert.equal(binding.draft.richText,document());assert.equal(binding.payload.richText,document());
 const changed=structuredClone(f.row);changed.payload.richText=JSON.stringify(JSON.parse(document()),null,2);
 assert.equal(findQueuedDraft(state,'local','server',changed),null);
 const restored=prepareRecoveredSendDraft(state,binding.draft,recovery);assert.equal(restored.draftRichTexts.local,document());
});
test('queue rejects document mismatch or invalid inline skill linkage before retention',()=>{
 for(const change of [
  f=>{f.args.request.draft.richText=JSON.stringify(JSON.parse(document()),null,2);},
  f=>{delete f.args.request.payload.richText;},
  f=>{f.args.request.payload.richText='broken';f.args.request.draft.richText='broken';},
  f=>{f.args.request.payload.skillRefs=[];},
 ]){const f=queuedFixture();change(f);assert.throws(()=>retainQueuedDraft(f.state,f.args));assert.equal(f.state.liveHarness.queuedDrafts,undefined);}
});
test('recovery refuses newer rich document even when plain text is unchanged',()=>{
 const snapshot=draft(),newer=JSON.stringify(JSON.parse(document()),null,2);
 const current={drafts:{local:snapshot.text},draftRichTexts:{local:newer},composerSkillReferences:{local:snapshot.skillReferences}};
 assert.throws(()=>prepareRecoveredSendDraft(current,snapshot,recovery),/draft-conflict/);assert.equal(current.draftRichTexts.local,newer);
 const exact={...current,draftRichTexts:{local:snapshot.richText}};
 assert.equal(prepareRecoveredSendDraft(exact,snapshot,recovery).draftRichTexts.local,snapshot.richText);
});
test('a rich-only current draft cannot be overwritten by recovered plain text',()=>{
 const current={drafts:{local:''},draftRichTexts:{local:document()}};
 assert.throws(()=>prepareRecoveredSendDraft(current,{conversationId:'local',text:'older',attachments:[]},recovery),/draft-conflict/);
});
test('plain recovery removes absent rich metadata while preserving other conversation documents',()=>{
 const current={drafts:{local:''},draftRichTexts:{other:document()}};
 const result=prepareRecoveredSendDraft(current,{conversationId:'local',text:'plain',attachments:[]},recovery);
 assert.equal(result.drafts.local,'plain');assert.equal(Object.hasOwn(result.draftRichTexts,'local'),false);assert.equal(result.draftRichTexts.other,document());
});
test('queued cancellation removes the intent and restores exact rich draft in one persisted metadata change',async()=>{
 let state={version:1,drafts:{local:''},draftRichTexts:{other:document()},composerSkillReferences:{local:[]}},id=0;
 const journal=createSendJournal({getState:()=>state,commit:update=>{state=JSON.parse(JSON.stringify(update(state)));return {ok:true};},newId:()=>`cancel-${++id}`,dispatch:async()=>{throw Error('must not dispatch');},prepareCancel:(current,snapshot)=>prepareRecoveredSendDraft(current,snapshot,recovery)});
 const receipt=journal.enqueue(draft());assert.equal(receipt.ok,true);
 const result=await journal.cancelQueued(receipt.nonce);assert.equal(result.ok,true);
 assert.equal(state.sendJournal.records.length,0);assert.equal(state.draftRichTexts.local,document());assert.equal(state.draftRichTexts.other,document());assert.equal(state.drafts.local,draft().text);
 assert.equal(result.draft.richText,document());journal.destroy();
});
test('rich queue documents bind legacy skill metadata without replacing its text transport contract',()=>{
 const f=queuedFixture(),legacy={kind:'skill',id:skill.id,label:skill.label,description:'Old synthetic instructions'};
 f.args.request.draft.skillReferences=[legacy];delete f.args.request.payload.skillRefs;
 f.args.request.payload.skillReferences=[JSON.stringify(legacy,null,2)];
 f.row.payload={text:f.args.request.payload.text,richText:document(),skillReferences:f.args.request.payload.skillReferences};
 const binding=findQueuedDraft(retainQueuedDraft(f.state,f.args),'local','server',f.row);
 assert.ok(binding);assert.deepEqual(binding.payload.skillReferences,f.row.payload.skillReferences);assert.equal(binding.payload.richText,document());
});

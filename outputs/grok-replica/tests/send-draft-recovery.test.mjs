import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRecoveredSendDraft} from '../send-draft-recovery.js';

const file={id:'file-1',name:'proof.txt',type:'text/plain',size:4};
const snapshot={conversationId:'marketing',text:'  exact\ntext  ',attachments:[file],quote:{messageId:'source',text:'Quote'},skillReferences:[{id:'skill',label:'Check'}]};
const initial=()=>({version:1,messages:{marketing:[]},drafts:{marketing:'',customers:'other draft'},replyDrafts:{customers:{text:'Other quote'}},composerSkillReferences:{customers:[{id:'other',label:'Other'}]},attachmentConsumedIds:['file-1','accepted-file']});

test('queued recovery atomically restores exact payload and unconsumes only its own files',()=>{
 const state=initial(),saved=structuredClone(state),next=prepareRecoveredSendDraft(state,snapshot,{attachments:[],failed:[],busy:false});
 assert.deepEqual(state,saved);assert.equal(next.drafts.marketing,snapshot.text);assert.deepEqual(next.replyDrafts.marketing,snapshot.quote);assert.deepEqual(next.composerSkillReferences.marketing,snapshot.skillReferences);assert.deepEqual(next.attachmentConsumedIds,['accepted-file']);
 assert.equal(next.drafts.customers,'other draft');assert.deepEqual(next.replyDrafts.customers,state.replyDrafts.customers);
 next.replyDrafts.marketing.text='mutated';next.composerSkillReferences.marketing[0].label='changed';assert.equal(snapshot.quote.text,'Quote');assert.equal(snapshot.skillReferences[0].label,'Check');
});

test('newer text, reply, skill, attachment, failed upload or busy store refuses recovery without mutation',()=>{
 const variants=[
  state=>{state.drafts.marketing='newer text';},
  state=>{state.replyDrafts.marketing={text:'new quote'};},
  state=>{state.composerSkillReferences.marketing=[{id:'new',label:'New'}];}
 ];
 for(const mutate of variants){const state=initial();mutate(state);const saved=structuredClone(state);assert.throws(()=>prepareRecoveredSendDraft(state,snapshot,{attachments:[],failed:[],busy:false}),/draft-conflict/);assert.deepEqual(state,saved);}
 for(const attachments of [[{...file,id:'other'}]])assert.throws(()=>prepareRecoveredSendDraft(initial(),snapshot,{attachments,failed:[],busy:false}),/draft-conflict/);
 assert.throws(()=>prepareRecoveredSendDraft(initial(),snapshot,{attachments:[],failed:[{...file,saved:false}],busy:false}),/draft-conflict/);
 assert.throws(()=>prepareRecoveredSendDraft(initial(),snapshot,{attachments:[],failed:[],busy:true}),/draft-conflict/);
});

test('an identical retained payload can recover while a partial or altered one cannot',()=>{
 const state=initial();state.drafts.marketing=snapshot.text;state.replyDrafts.marketing=structuredClone(snapshot.quote);state.composerSkillReferences.marketing=structuredClone(snapshot.skillReferences);
 assert.equal(prepareRecoveredSendDraft(state,snapshot,{attachments:[file],failed:[],busy:false}).drafts.marketing,snapshot.text);
 assert.throws(()=>prepareRecoveredSendDraft(state,snapshot,{attachments:[],failed:[],busy:false}),/draft-conflict/);
 assert.throws(()=>prepareRecoveredSendDraft(state,snapshot,{attachments:[{...file,name:'changed.txt'}],failed:[],busy:false}),/draft-conflict/);
});

test('plain-text recovery clears only its own empty quote and skill slots',()=>{
 const state=initial(),plain={conversationId:'marketing',text:'plain',attachments:[]};
 const next=prepareRecoveredSendDraft(state,plain,{attachments:[],failed:[],busy:false});
 assert.equal(next.drafts.marketing,'plain');assert.equal(Object.hasOwn(next.replyDrafts,'marketing'),false);assert.deepEqual(next.composerSkillReferences.marketing,[]);assert.deepEqual(next.attachmentConsumedIds,state.attachmentConsumedIds);
});

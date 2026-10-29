import test from 'node:test';
import assert from 'node:assert/strict';
import {replyTargets} from '../harness/message-delivery.mjs';
import {resolveIncomingReply} from '../harness/incoming-replies.mjs';
import {liveReplyDraft,liveReplyPayload} from '../live-incoming-replies.js';
import {liveDeliveryReplyMarkup} from '../live-message-deliveries.js';
const skill={id:'synthetic-skill',revision:1,name:'Review aanvraag',description:'Do not quote this metadata',content:'PRIVATE_BODY_NOT_A_QUOTE'};
test('inline document reply previews do not repeat already positioned skill labels',()=>{
 const state=fixture('Gebruik @Review aanvraag nu');
 state.entries[0].richText=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Gebruik '},{type:'workflowReference',attrs:{id:skill.id,label:skill.name}},{type:'text',text:' nu'}]}]});
 assert.equal(replyTargets(state)[0].text,'Gebruik @Review aanvraag nu');
 assert.equal(liveReplyDraft(state,{entryId:'skill-input'}).text,'Gebruik @Review aanvraag nu');
});
function fixture(text=''){
 return {schema:1,conversationId:'synthetic',entries:[{id:'skill-input',role:'user',status:'completed',text,skills:[{...skill}]}],tools:[]};
}
test('canonical and composer reply previews show selected skill name/version instead of empty text',()=>{
 const state=fixture(),target=replyTargets(state)[0],draft=liveReplyDraft(state,{entryId:'skill-input'});
 assert.equal(target.text,'@Review aanvraag · Versie 1');assert.equal(draft.text,target.text);
 assert.deepEqual(liveReplyPayload(state,draft),{replyToId:'skill-input'});
 assert.equal(resolveIncomingReply(state,'skill-input').text,target.text);
 const html=liveDeliveryReplyMarkup(target,String);assert.match(html,/@Review aanvraag · Versie 1/);
 assert.doesNotMatch(html,/PRIVATE_BODY|Do not quote/);
 assert.equal(state.entries[0].text,'','the actual prompt remains empty');
});
test('mixed text/skill previews retain original text and canonical selected revisions',()=>{
 const state=fixture('Exact original\nmessage'),target=replyTargets(state)[0];
 assert.equal(target.text,'Exact original\nmessage\n@Review aanvraag · Versie 1');
 assert.equal(liveReplyDraft(state,{entryId:'skill-input'}).text,target.text);
 const restored=JSON.parse(JSON.stringify(state));assert.deepEqual(replyTargets(restored),replyTargets(state));
 restored.entries[0].skills[0].revision=2;
 assert.equal(target.text,'Exact original\nmessage\n@Review aanvraag · Versie 1','saved quote snapshot remains the selected version');
});
test('plain text and malformed skill metadata preserve the existing quote contract without leaking bodies',()=>{
 for(const skills of [undefined,{},[null,{name:'Forged',revision:0,content:'PRIVATE_BODY'}],[{name:'x'.repeat(101),revision:1}]]){
  const state=fixture('Original');state.entries[0].skills=skills;
  assert.equal(replyTargets(state)[0].text,'Original');assert.equal(liveReplyDraft(state,{entryId:'skill-input'}).text,'Original');
 }
 const state=fixture('');state.entries[0].skills=[];assert.equal(replyTargets(state)[0].text,'');
});

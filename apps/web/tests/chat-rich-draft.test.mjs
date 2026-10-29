import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatSurface} from '../chat-surface.js';

test('local operation refuses a rich composer draft before creating a conversation or changing state',async()=>{
 const originalDocument=globalThis.document,originalObserver=globalThis.MutationObserver;
 const element={dataset:{},style:{},setAttribute(){},remove(){}};
 globalThis.document={createElement:()=>element,body:{append(){}},documentElement:{dataset:{theme:'light'}}};
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 const state={messages:{chat:[]},drafts:{chat:'keep this'},draftRichTexts:{chat:'rich document'},replyDrafts:{chat:{text:'keep quote'}},composerSkillReferences:{chat:[]},chatPreferences:{chat:{operation:'upper',style:'short',layoutMode:'bubble'}}};
 const errors=[];let ensured=0,writes=0,surface;
 try{
  surface=createChatSurface({getState:()=>state,getConversationKey:()=> 'chat',app:{querySelector:()=>({value:'keep this'})},showChatError:message=>errors.push(message),draftAttachments:()=>[],ensureConversation:()=>{ensured++;return {id:'chat'};},commit:()=>{writes++;return {ok:true};}});
  assert.equal(await surface.handleAction({action:'send-message'}),true);
  assert.equal(errors.length,1);assert.match(errors[0],/opmaak|document/i);assert.equal(ensured,0);assert.equal(writes,0);assert.equal(state.draftRichTexts.chat,'rich document');assert.equal(state.drafts.chat,'keep this');
 }finally{surface?.destroy();globalThis.document=originalDocument;globalThis.MutationObserver=originalObserver;}
});

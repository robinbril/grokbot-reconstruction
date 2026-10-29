// Actual transcript action router + ordinary richAction fallback. Minimal DOM only;
// this controller regression does not replace the parent's browser acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptSurface} from '../product-transcript.js';
import {richAction} from '../rich-transcript.js';

function fixture(t,messages){
 const previous=new Map(['document','navigator'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const state={selected:'conversation',messages:{conversation:messages},replyDrafts:{}};
 const calls={persist:0,render:0,focus:0,copies:[]};
 const input={focus(){calls.focus++;}};
 const node=()=>({dataset:{},style:{},setAttribute(){},remove(){}});
 const app={querySelectorAll:()=>[],querySelector:selector=>selector==='#message-input'?input:null};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:node,body:{append(){}},querySelector:app.querySelector}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{calls.copies.push(value);}}}});
 const host={app,getState:()=>state,getConversationKey:()=>state.selected,selectedBot:()=>({name:'Marketing Agent'}),esc:String,
  persist:()=>{calls.persist++;return true;},render:()=>{calls.render++;},sourceMotion:{reduced:true,inspect:false}};
 const surface=createTranscriptSurface(host);
 t.after(()=>{try{surface.destroy();}finally{for(const[name,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 return {surface,state,host,calls};
}

test('live harness replies fall through to the ordinary router with exact source text and focus',async t=>{
 const message={id:'live-user',role:'user',productKind:'live-harness',text:'LIVE_RECOVERY_REPLY_SOURCE\n  exact source body  '};
 const h=fixture(t,[message]),target={dataset:{id:message.id}};
 const handled=await h.surface.handleAction({action:'reply-message',id:message.id,target});
 if(!handled)await richAction('reply-message',target,h.state,h.host.persist,h.host.render,async()=>true);
 assert.deepEqual(h.state.replyDrafts.conversation,{messageId:message.id,text:message.text,title:'LIVE_RECOVERY_REPLY_SOURCE'});
 assert.equal(handled,false);assert.equal(h.calls.persist,1);assert.equal(h.calls.render,1);assert.equal(h.calls.focus,1);
});

test('live harness copy is not intercepted as an empty local-product payload',async t=>{
 const message={id:'live-bot',role:'bot',productKind:'live-harness',text:'Exact live assistant response'};
 const h=fixture(t,[message]);
 const handled=await h.surface.handleAction({action:'copy-message',id:message.id,target:{isConnected:true,setAttribute(){}}});
 assert.equal(handled,false);assert.deepEqual(h.calls.copies,[]);assert.deepEqual(h.state.replyDrafts,{});
});

test('owned run draft and voice replies retain their specialized payloads',async t=>{
 const messages=[
  {id:'run-entry',role:'bot',productKind:'run',text:'generic run text',localRun:{id:'run',output:'Actual computed output',status:'complete'}},
  {id:'draft-entry',role:'bot',productKind:'draft',text:'generic draft text',localDraft:{body:'Actual email draft'}},
  {id:'voice-entry',role:'bot',productKind:'voice',text:'generic voice text',voiceMemo:{caption:'Actual voice caption'}},
 ];
 const h=fixture(t,messages),payloads=['Actual computed output','Actual email draft','Actual voice caption'];
 for(let index=0;index<messages.length;index++){
  const message=messages[index];
  assert.equal(await h.surface.handleAction({action:'reply-message',id:message.id,target:{dataset:{id:message.id}}}),true);
  assert.deepEqual(h.state.replyDrafts.conversation,{messageId:message.id,text:payloads[index],title:'Marketing Agent'});
 }
 assert.equal(h.calls.persist,3);assert.equal(h.calls.render,3);
});

test('unknown product kinds preserve ordinary reply routing instead of manufacturing blank context',async t=>{
 const message={id:'future-entry',role:'bot',productKind:'future-island',text:'## Future answer\nActual body'};
 const h=fixture(t,[message]),target={dataset:{id:message.id}};
 const handled=await h.surface.handleAction({action:'reply-message',id:message.id,target});
 if(!handled)await richAction('reply-message',target,h.state,h.host.persist,h.host.render,async()=>true);
 assert.equal(handled,false);assert.equal(h.state.replyDrafts.conversation.text,message.text);assert.equal(h.state.replyDrafts.conversation.title,'Future answer');
});

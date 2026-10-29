import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHarnessSurface} from '../live-harness-surface.js';
import {bindComposerInput} from '../composer-input.js';

function fixture(t,{live=true,unavailable=false}={}){
 const saved=new Map(['window','document','MutationObserver','fetch','EventSource','setInterval','clearInterval'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const text='Synthetic queue prompt',richText=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
 const composer={text,richText,references:[]},input={id:'message-input',dataset:{richComposer:'',...(unavailable?{editorUnavailable:''}:{})},getAttribute:()=>null};
 const nested={closest:selector=>selector==='#message-input'?input:null},requests=[],consumed=[];
 let state={version:1,messages:{chat:[]},drafts:{chat:text},draftRichTexts:{chat:richText},replyDrafts:{},composerSkillReferences:{chat:[]},liveHarness:{modes:{chat:live?'live':'demo'},serverIds:{chat:'server'},pendingSends:{}}};
 let accepted;const acceptance=new Promise(resolve=>{accepted=resolve;});
 const canonical={schema:1,conversationId:'server',entries:[],runs:[],tools:[],terminalSessions:[],browserSessions:[],queue:[],schedules:[],workflow:{},lastSeq:0};
 const response=value=>({ok:true,json:async()=>structuredClone(value)});
 globalThis.window=new EventTarget();
 globalThis.document={querySelector:()=>null,head:{append(){}},createElement:()=>({dataset:{},remove(){}}),body:{append(){}},documentElement:{dataset:{theme:'light'}}};
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 globalThis.setInterval=()=>({});globalThis.clearInterval=()=>{};
 globalThis.EventSource=class{close(){}};
 globalThis.fetch=async(url,options={})=>{
  const method=options.method||'GET';
  if(url.endsWith('/status'))return response({schema:1,csrfToken:'synthetic',runtime:{state:'ready'}});
  if(url.endsWith('/skills'))return response({schema:1,skills:[]});
  if(url.endsWith('/queue')&&method==='POST'){
   const payload=JSON.parse(options.body);requests.push({url,payload});const {requestId,...content}=payload;
   canonical.queue.push({id:'queue',requestId,status:'queued',payload:content});canonical.lastSeq++;
   return response({schema:1,accepted:true,queueId:'queue',lastSeq:canonical.lastSeq});
  }
  if(url.endsWith('/conversations/server'))return response(canonical);
  throw Error(`Unexpected synthetic request ${method} ${url}`);
 };
 const unbind=bindComposerInput(input,{getSnapshot:()=>structuredClone(composer)});
 const host={overlay:Object.assign(new EventTarget(),{open:false,querySelector:()=>null,querySelectorAll:()=>[]}),getState:()=>state,getConversationKey:()=> 'chat',app:Object.assign(new EventTarget(),{querySelector:selector=>selector==='#message-input'?input:null,querySelectorAll:()=>[],contains:()=>false}),esc:String,persist:()=>true,render(){},draftAttachments:()=>[],ensureConversation:()=>({id:'chat'}),commit:update=>{state=update(state);return {ok:true};},consumeLiveDraft:(draft,binding)=>{consumed.push({draft,binding});delete state.liveHarness.pendingSends.chat;accepted();return {ok:true};}};
 const surface=createLiveHarnessSurface(host);
 t.after(()=>{surface.destroy();unbind();for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 const event=extra=>({target:nested,key:'Enter',shiftKey:true,preventDefault(){this.defaultPrevented=true;},...extra});
 return {surface,input,nested,event,requests,consumed,acceptance,composer,unbind,get state(){return state;}};
}
async function deadline(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('queue dispatch did not complete')),1500);})]);}finally{clearTimeout(timer);}}

for(const defaultPrevented of [false,true])test(`Shift+Enter queues exact document even idle when ProseMirror defaultPrevented is ${defaultPrevented}`,async t=>{
 const f=fixture(t),event=f.event({defaultPrevented});
 assert.equal(typeof f.surface.handleKeyDown,'function');
 assert.equal(f.surface.handleKeyDown(event),true);assert.equal(event.defaultPrevented,true);
 await deadline(f.acceptance);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].payload.text,f.composer.text);assert.equal(f.requests[0].payload.richText,f.composer.richText);
 assert.equal(f.consumed[0].draft.richText,f.composer.richText);assert.equal(f.consumed[0].binding.request.queued,true);
});
test('queue shortcut ignores IME, noncomposer, other keys, modifiers, demo and unavailable editor',t=>{
 const f=fixture(t);
 for(const extra of [{isComposing:true},{keyCode:229},{shiftKey:false},{key:'Tab'},{metaKey:true},{ctrlKey:true},{altKey:true},{target:{id:'other'}}]){
  const event=f.event(extra);assert.equal(f.surface.handleKeyDown?.(event),false);assert.equal(Boolean(event.defaultPrevented),Boolean(extra.defaultPrevented));
 }
 f.input.dataset.editorUnavailable='';assert.equal(f.surface.handleKeyDown?.(f.event()),false);delete f.input.dataset.editorUnavailable;
 f.input.getAttribute=name=>name==='aria-readonly'?'true':null;assert.equal(f.surface.handleKeyDown?.(f.event()),false);
 assert.equal(f.requests.length,0);
 f.input.getAttribute=()=>null;f.unbind();const prevented=f.event({defaultPrevented:true});assert.equal(f.surface.handleKeyDown?.(prevented),false);
});
test('key repeat is consumed without duplicate dispatch and demo mode keeps its ordinary newline',t=>{
 const f=fixture(t),event=f.event({repeat:true});
 assert.equal(f.surface.handleKeyDown?.(event),true);assert.equal(event.defaultPrevented,true);assert.equal(f.requests.length,0);
 f.state.liveHarness.modes.chat='demo';const demo=f.event();assert.equal(f.surface.handleKeyDown?.(demo),false);assert.equal(demo.defaultPrevented,undefined);
});

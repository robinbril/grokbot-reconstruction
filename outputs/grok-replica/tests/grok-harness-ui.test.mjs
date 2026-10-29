import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../live-harness-model.js';
import {createLiveHarnessSurface} from '../live-harness-surface.js';

const configured={adapter:'grok-bot-harness',state:'configured',provider:'xai',model:'grok-test'};
test('default and missing Grok model never claim an installed CLI or active connection',()=>{
 const initial=model.liveRuntimeText();
 assert.match(initial,/Grok Bot-harness/);assert.doesNotMatch(initial,/Codex|OpenAI|Verbonden/);
 const missing=model.liveRuntimeText({...configured,state:'unavailable',model:null,reason:'XAI_API_KEY ontbreekt.'});
 assert.match(missing,/Model niet geconfigureerd/);assert.match(missing,/XAI_API_KEY ontbreekt/);assert.doesNotMatch(missing,/Codex|OpenAI|Verbonden/);
});
test('Grok model configuration is distinct from confirmed connection and unknown states',()=>{
 const available=model.liveRuntimeText(configured);
 assert.match(available,/xAI/);assert.match(available,/grok-test/);assert.match(available,/Model geconfigureerd/);assert.doesNotMatch(available,/Verbonden/);
 assert.match(model.liveRuntimeText({...configured,state:'connected'}),/Verbonden/);
 assert.match(model.liveRuntimeText({...configured,state:'unexpected'}),/Status niet bevestigd/);
 assert.doesNotMatch(model.liveRuntimeText({...configured,state:'unexpected'}),/Verbonden/);
 assert.doesNotMatch(model.liveRuntimeText({state:'connected',provider:'openai',model:'legacy-without-adapter'}),/Codex|OpenAI|Verbonden/);
});
test('explicit legacy metadata remains identifiable without becoming the default adapter',()=>{
 assert.match(model.liveRuntimeText({adapter:'codex-app-server',state:'connected',provider:'openai',modelExecution:'cloud',model:'legacy'}),/Codex CLI.*model via OpenAI/);
 assert.doesNotMatch(model.liveRuntimeText({state:'available'}),/Codex|OpenAI/);
 const failed=model.liveRuntimeText({...configured,state:'connected'},'Statusaanvraag mislukt.');
 assert.match(failed,/Status niet beschikbaar/);assert.doesNotMatch(failed,/Verbonden/);
});

test('actual surface renders unavailable Grok configuration and taskbox panel without fake success',async t=>{
 const names=['window','document','MutationObserver','fetch','setInterval','clearInterval'],saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 globalThis.window=new EventTarget();
 globalThis.document={querySelector:()=>null,head:{append(){}},createElement:()=>({dataset:{},remove(){}}),body:{append(){}},documentElement:{dataset:{theme:'light'}}};
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
 globalThis.fetch=async()=>({ok:true,json:async()=>({schema:1,runtime:{...configured,state:'unavailable',model:null,reason:'XAI_API_KEY ontbreekt.'}})});
 const state={messages:{test:[]},liveHarness:{modes:{test:'live'},serverIds:{},pendingSends:{}}};
 const host={overlay:Object.assign(new EventTarget(),{open:false,querySelector:()=>null,querySelectorAll:()=>[]}),getState:()=>state,getConversationKey:()=> 'test',esc:String,app:{querySelector:()=>null,querySelectorAll:()=>[],contains:()=>false},persist:()=>true};
 let surface;
 t.after(()=>{try{surface?.destroy();}finally{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 surface=createLiveHarnessSurface(host);
 const loading=surface.renderSlot('liveExecutionSelector');assert.match(loading,/Grok Bot-harness/);assert.doesNotMatch(loading,/Codex|OpenAI/);
 await new Promise(setImmediate);
 const selector=surface.renderSlot('liveExecutionSelector'),panel=surface.renderSlot('computerPanel');
 assert.match(selector,/Model niet geconfigureerd/);assert.match(panel,/XAI_API_KEY ontbreekt/);assert.match(panel,/taskbox/);assert.doesNotMatch(selector+panel,/Codex|OpenAI|Verbonden|op deze Mac/);
});

test('the actual model ready state is shown as configured without claiming provider verification',()=>{
 const text=model.liveRuntimeText({adapter:'grok-bot-harness',state:'ready',provider:'xai',model:'fixture-model'});
 assert.match(text,/Model geconfigureerd/);assert.doesNotMatch(text,/Verbonden|Codex|Status niet bevestigd/);
});

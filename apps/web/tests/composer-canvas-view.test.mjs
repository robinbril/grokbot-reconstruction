import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComposerDocument} from '../composer-document-view.js';
import {emptyLiveConversation,projectLiveMessages} from '../live-harness-model.js';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const attrs={canvasId:'4f31f778-9a31-41dd-b57e-b9b9d3071c35',storeId:null,title:'PRIVATE_CANVAS_TITLE'};
const atom={type:'canvasReference',attrs};
const encode=content=>JSON.stringify({type:'doc',content});

test('hidden canvas references have no visible transcript text controls or links at any inline position',()=>{
 const richText=encode([{type:'paragraph',content:[atom,{type:'text',text:'Exact '},atom,{type:'text',text:'antwoord',marks:[{type:'link',attrs:{href:'https://example.test'}}]},atom]}]);
 const html=renderComposerDocument({text:'Exact antwoord (https://example.test)',richText},esc);
 assert.equal(html,'<span class="composer-document" data-composer-document>Exact <a href="https://example.test" target="_blank" rel="noopener noreferrer nofollow">antwoord</a></span>');
 assert.doesNotMatch(html,/PRIVATE_CANVAS_TITLE|canvas-reference|4f31|button|data-action/);
});
test('nullable hidden canvas reference remains invisible and does not become skill metadata',()=>{
 for(const value of [{},{canvasId:null,storeId:null,title:null},attrs]){
  const richText=encode([{type:'paragraph',content:[{type:'canvasReference',attrs:value}]}]);
  assert.equal(renderComposerDocument({text:'',richText},esc),'<span class="composer-document" data-composer-document></span>');
 }
});
test('canonical live projection keeps exact hidden document without source or executable skill context',()=>{
 const richText=encode([{type:'paragraph',content:[{type:'text',text:'Lees het canvas'},atom]}]);
 const state={...emptyLiveConversation('synthetic-conversation'),entries:[{id:'synthetic-user',role:'user',text:'Lees het canvas',richText}]};
 const message=projectLiveMessages(state)[0];assert.equal(message.richText,richText);assert.deepEqual(message.skillReferences??[],[]);
 assert.equal(renderComposerDocument(message,esc),'<span class="composer-document" data-composer-document>Lees het canvas</span>');
});

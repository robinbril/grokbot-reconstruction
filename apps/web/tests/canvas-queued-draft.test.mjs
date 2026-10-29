import test from 'node:test';
import assert from 'node:assert/strict';
import {appendHeldCanvasReference} from '../composer-canvas-reference.js';
import {retainQueuedDraft,findQueuedDraft} from '../live-queued-drafts.js';
const ref={canvasId:'13ef3a12-60b7-4216-b4df-7b8fd3dd34ae',storeId:null,title:'Saved canvas'};
function fixture(richText){
 const text='Exact original prompt',requestId='canvas-queue-request';
 const draft={conversationId:'marketing',requestId,text,...(richText!==undefined?{richText}:{}),attachments:[],skillReferences:[]};
 const payload={requestId,text,richText:appendHeldCanvasReference(richText,ref,{text})};
 const request={queued:true,serverConversationId:'server-canvas',payload,draft};
 const state={liveHarness:{serverIds:{marketing:'server-canvas'},pendingSends:{marketing:request}}};
 return {state,request,args:{conversationId:'marketing',serverConversationId:'server-canvas',queueId:'canvas-queue',request},row:{id:'canvas-queue',requestId,status:'queued',payload:{text,richText:payload.richText}}};
}
for(const original of [undefined,JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact original prompt'}]}]})])test('queue recovery binds exact appended canvas payload while retaining original composer bytes '+(original?'rich':'plain'),()=>{
 const f=fixture(original),state=retainQueuedDraft(f.state,f.args),binding=findQueuedDraft(state,'marketing','server-canvas',f.row);
 assert.ok(binding);assert.deepEqual(binding.draft,f.request.draft);assert.equal(binding.payload.richText,f.request.payload.richText);
 assert.equal(binding.draft.richText,original);assert.ok(findQueuedDraft(JSON.parse(JSON.stringify(state)),'marketing','server-canvas',f.row));
});
test('hidden context cannot excuse unrelated formatting changes or multiple injected atoms in queue binding',()=>{
 const original=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact original prompt'}]}]});
 for(const mutate of [doc=>doc.content[0].content[0].marks=[{type:'bold'}],doc=>doc.content[0].content.push({type:'canvasReference',attrs:ref})]){
  const f=fixture(original),doc=JSON.parse(f.request.payload.richText);mutate(doc);f.request.payload.richText=JSON.stringify(doc);assert.throws(()=>retainQueuedDraft(f.state,f.args));
 }
});

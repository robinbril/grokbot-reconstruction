import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createChatStateHost} from '../chat-state-host.js';
import {queuedDraftKey,retainQueuedDraft,findQueuedDraft,removeQueuedDraft,pruneQueuedDrafts} from '../live-queued-drafts.js';

const local='marketing',canonical='owned-server',queueId='owned-queue';
function fixture(){
 const quote={title:'Bot',text:'Exact original quote'},skill={kind:'skill',id:'skill-one',label:'Owned skill'};
 const file={id:'local-file',name:'synthetic.txt',type:'text/plain',size:4};
 const draft={conversationId:local,requestId:'enqueue-one',text:'  exact raw\ntext  ',quote,attachments:[file],skillReferences:[skill]};
 const payload={requestId:draft.requestId,text:draft.text,quote:'Bot\nExact original quote',skillReferences:[JSON.stringify(skill,null,2)],attachmentRefs:[{attachmentId:'server-file',sha256:'a'.repeat(64),size:4}]};
 const request={queued:true,serverConversationId:canonical,signature:'opaque-current-signature',payload,draft};
 const state={version:1,messages:{[local]:[]},drafts:{[local]:draft.text},liveHarness:{pendingSends:{[local]:request},serverIds:{[local]:canonical},uploads:{[JSON.stringify([canonical,file.id])]:{state:'ready',...payload.attachmentRefs[0]}}}};
 const args={conversationId:local,serverConversationId:canonical,queueId,request};
 const row={id:queueId,requestId:payload.requestId,status:'queued',payload:{text:payload.text,quote:payload.quote,skillReferences:payload.skillReferences,attachmentRefs:payload.attachmentRefs}};
 return {state,args,row,request};
}
test('queued acceptance retains an immutable complete draft pinned to its exact canonical payload',()=>{
 const f=fixture(),state=retainQueuedDraft(f.state,f.args),binding=findQueuedDraft(state,local,canonical,f.row);
 assert.equal(f.state.liveHarness.queuedDrafts,undefined);assert.ok(binding);
 assert.deepEqual(binding.draft,f.request.draft);assert.equal(binding.enqueueRequestId,'enqueue-one');assert.equal(binding.queueId,queueId);
 assert.equal(binding.serverConversationId,canonical);assert.equal(binding.conversationId,local);
 assert.deepEqual(binding.payload,f.row.payload);assert.equal(Object.keys(state.liveHarness.queuedDrafts)[0],queuedDraftKey(local,queueId));
 f.request.draft.text='MUTATED';binding.draft.attachments[0].name='MUTATED';
 assert.equal(findQueuedDraft(state,local,canonical,f.row).draft.text,'  exact raw\ntext  ');
 assert.equal(findQueuedDraft(JSON.parse(JSON.stringify(state)),local,canonical,f.row).draft.attachments[0].name,'synthetic.txt');
});
test('queue receipt storage and draft consumption fail as one metadata transaction',()=>{
 const f=fixture();let state=f.state;
 const host=createChatStateHost({getState:()=>state,publishState:next=>{state=next;},storage:{setItem(){throw Error('synthetic storage failure');}},storageKey:'test'});
 const result=host.commit(current=>{const retained=retainQueuedDraft(current,f.args);return {...retained,drafts:{...retained.drafts,[local]:''},liveHarness:{...retained.liveHarness,pendingSends:{}}};});
 assert.equal(result.ok,false);assert.equal(state,f.state);assert.equal(state.drafts[local],f.request.draft.text);
 assert.equal(state.liveHarness.pendingSends[local],f.request);assert.equal(state.liveHarness.queuedDrafts,undefined);
});
test('only matching queued acceptance can retain the original browser draft',()=>{
 for(const change of [
  f=>{f.args.request.queued=false;},f=>{f.args.conversationId='other';},f=>{f.args.serverConversationId='foreign-server';},
  f=>{f.args.request.draft.requestId='other';},f=>{f.args.request.payload.text='changed';},
  f=>{f.args.request.payload.quote='changed';},f=>{f.args.request.payload.skillReferences=['changed'];},
  f=>{f.args.request.payload.attachmentRefs[0].size=5;},f=>{delete f.state.liveHarness.pendingSends[local];},
  f=>{f.args.queueId='../foreign';},f=>{f.args.request.draft.attachments[0].size=6*1024*1024;},
  f=>{f.args.request.serverConversationId='another-server';},
 ]){const f=fixture();change(f);assert.throws(()=>retainQueuedDraft(f.state,f.args));}
});
test('retention binds local file identity to the exact previously ready canonical upload',()=>{
 for(const change of [
  f=>{delete f.state.liveHarness.uploads;},f=>{f.state.liveHarness.uploads[JSON.stringify([canonical,'local-file'])].state='error';},
  f=>{f.state.liveHarness.uploads[JSON.stringify([canonical,'local-file'])].attachmentId='another-server-file';},
  f=>{f.state.liveHarness.uploads[JSON.stringify([canonical,'local-file'])].sha256='b'.repeat(64);},
 ]){const f=fixture();change(f);assert.throws(()=>retainQueuedDraft(f.state,f.args));}
});
test('canonical lookup refuses old queues, changed payloads, foreign identities and getters without execution',()=>{
 const f=fixture(),state=retainQueuedDraft(f.state,f.args);let touched=0;
 assert.equal(findQueuedDraft(f.state,local,canonical,f.row),null);
 for(const row of [{...f.row,id:'other'},{...f.row,requestId:'other'},{...f.row,payload:{...f.row.payload,text:'changed'}},{...f.row,payload:{...f.row.payload,attachmentRefs:[]}}])assert.equal(findQueuedDraft(state,local,canonical,row),null);
 assert.equal(findQueuedDraft(state,local,'foreign',f.row),null);assert.equal(findQueuedDraft(state,'other',canonical,f.row),null);
 const hostile={...f.row,get payload(){touched++;return f.row.payload;}};
 assert.equal(findQueuedDraft(state,local,canonical,hostile),null);
 const malformed={...state,liveHarness:{...state.liveHarness,queuedDrafts:{get record(){touched++;return {};}}}};
 assert.equal(findQueuedDraft(malformed,local,canonical,f.row),null);assert.equal(touched,0);
});
test('removal is immutable and refuses a replaced or missing recovery receipt',()=>{
 const f=fixture(),state=retainQueuedDraft(f.state,f.args),binding=findQueuedDraft(state,local,canonical,f.row);
 const next=removeQueuedDraft(state,binding);assert.equal(Object.keys(next.liveHarness.queuedDrafts).length,0);assert.equal(Object.keys(state.liveHarness.queuedDrafts).length,1);
 assert.throws(()=>removeQueuedDraft(next,binding));assert.throws(()=>removeQueuedDraft(state,{...binding,enqueueRequestId:'replacement'}));
});
test('duplicate acknowledgement is idempotent but cannot replace another raw draft',()=>{
 const f=fixture(),state=retainQueuedDraft(f.state,f.args);
 assert.deepEqual(retainQueuedDraft(state,f.args),state);
 const changed=structuredClone(f.args);changed.request.draft.quote.extra='new raw field';
 assert.throws(()=>retainQueuedDraft(state,changed));
});
test('legacy pending drafts without a canonical pin retain only the explicitly supplied current mapping',()=>{
 const f=fixture();delete f.request.serverConversationId;
 assert.ok(findQueuedDraft(retainQueuedDraft(f.state,f.args),local,canonical,f.row));
});
test('authoritative pruning removes only matching started or terminal noncancelled work',()=>{
 const f=fixture(),state=retainQueuedDraft(f.state,f.args);
 for(const row of [{...f.row,status:'cancelled'},{...f.row,status:'completed',payload:{text:'changed'}},{...f.row,id:'other',status:'completed'},{...f.row,status:'queued'}])assert.deepEqual(pruneQueuedDrafts(state,local,canonical,[row]),state);
 assert.deepEqual(pruneQueuedDrafts(state,local,canonical,[]),state);assert.deepEqual(pruneQueuedDrafts(state,local,'foreign',[{...f.row,status:'completed'}]),state);
 for(const row of [{...f.row,runId:'actual-run',status:'running'},{...f.row,status:'completed'},{...f.row,status:'failed'},{...f.row,status:'interrupted'}])assert.equal(Object.keys(pruneQueuedDrafts(state,local,canonical,[row]).liveHarness.queuedDrafts).length,0);
});
test('bounded retention refuses an unproved overflow without dropping recoverable drafts',()=>{
 const f=fixture(),original=findQueuedDraft(retainQueuedDraft(f.state,f.args),local,canonical,f.row),queuedDrafts={};
 for(let i=0;i<100;i++){const binding=structuredClone(original);binding.queueId='queue-'+i;binding.enqueueRequestId=binding.draft.requestId='enqueue-'+i;queuedDrafts[queuedDraftKey(local,binding.queueId)]=binding;}
 const state={...f.state,liveHarness:{...f.state.liveHarness,queuedDrafts}};
 const before=JSON.stringify(state);assert.throws(()=>retainQueuedDraft(state,{...f.args,queueId:'overflow'}));assert.equal(JSON.stringify(state),before);
});
test('aggregate retention overflow cannot poison existing recovery records or consume a pending draft',()=>{
 const f=fixture(),skills=Array.from({length:20},(_,i)=>({kind:'skill',id:'skill-'+i,label:'Synthetic',description:'x'.repeat(1500)}));
 f.request.draft={conversationId:local,requestId:'enqueue-base',text:'x'.repeat(32768),quote:{title:'Synthetic',text:'q'.repeat(9000)},attachments:[],skillReferences:skills};
 f.request.payload={requestId:'enqueue-base',text:f.request.draft.text,quote:'Synthetic\n'+f.request.draft.quote.text,skillReferences:skills.map(skill=>JSON.stringify(skill,null,2))};
 const original=findQueuedDraft(retainQueuedDraft(f.state,f.args),local,canonical,{...f.row,requestId:'enqueue-base',payload:{text:f.request.payload.text,quote:f.request.payload.quote,skillReferences:f.request.payload.skillReferences}}),queuedDrafts={};
 for(let i=0;i<57;i++){const binding=structuredClone(original);binding.queueId='queue-'+i;binding.enqueueRequestId=binding.draft.requestId='enqueue-'+i;queuedDrafts[queuedDraftKey(local,binding.queueId)]=binding;}
 const request=structuredClone(f.request);request.payload.requestId=request.draft.requestId='enqueue-57';
 let state={...f.state,liveHarness:{...f.state.liveHarness,queuedDrafts,pendingSends:{[local]:request}}};
 const firstRow={id:'queue-0',requestId:'enqueue-0',status:'queued',payload:original.payload};
 assert.ok(findQueuedDraft(state,local,canonical,firstRow),'the prior durable table is valid');
 const before=state,writes=[];
 const host=createChatStateHost({getState:()=>state,publishState:next=>{state=next;},storage:{setItem:(_key,bytes)=>writes.push(bytes)},storageKey:'test'});
 const result=host.commit(current=>retainQueuedDraft(current,{...f.args,queueId:'queue-57',request}));
 if(result.ok)assert.ok(findQueuedDraft(state,local,canonical,firstRow),'successful admission must leave all previous records readable');
 assert.equal(result.ok,false);assert.equal(state,before);assert.equal(writes.length,0);assert.equal(state.liveHarness.pendingSends[local],request);
 assert.ok(findQueuedDraft(state,local,canonical,firstRow));
 const pruned=pruneQueuedDrafts(state,local,canonical,[{...firstRow,status:'completed'}]);
 assert.equal(Object.keys(pruned.liveHarness.queuedDrafts).length,56,'the original valid records remain prunable');
});
test('own-data boundaries reject unsafe draft structure and oversized serialized state',()=>{
 let touched=0;const f=fixture();
 const request={...f.request,get draft(){touched++;return f.request.draft;}};
 assert.throws(()=>retainQueuedDraft(f.state,{...f.args,request}));assert.equal(touched,0);
 const dangerous=structuredClone(f.args);dangerous.request.draft.quote=JSON.parse('{"__proto__":{"polluted":true}}');
 assert.throws(()=>retainQueuedDraft(f.state,dangerous));assert.equal({}.polluted,undefined);
 const sparse=structuredClone(f.args);sparse.request.draft.attachments=new Array(1);assert.throws(()=>retainQueuedDraft(f.state,sparse));
 const oversized=structuredClone(f.args);oversized.request.payload.text=oversized.request.draft.text='x'.repeat(32769);assert.throws(()=>retainQueuedDraft(f.state,oversized));
});
test('queued dispatch does not clear files or retire uncertain acceptance after a failed local receipt commit',async()=>{
 const source=readFileSync(new URL('../live-harness-surface.js',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('async function dispatchRequest('),source.indexOf('async function command(',source.indexOf('async function dispatchRequest(')));
 const f=fixture(),cleared=[],errors=[],consumed=[];let refreshed=0;
 const context={pending:new Set(),errors:new Map(),sync(){},connect(){throw Error('queued work must not reconnect');},snapshot:()=>({queue:[],runs:[],lastSeq:0}),
  client:{enqueue:async()=>({accepted:true,queueId})},serverId:()=>canonical,recovering:new Map(),key:()=>local,
  host:{consumeLiveDraft:(draft,binding)=>{consumed.push({draft,binding});return {ok:false};},clearLiveAttachments:draft=>cleared.push(draft),render(){throw Error('must not render accepted success');}},
  refresh:async()=>{refreshed++;},setError:(id,error)=>errors.push({id,error}),releaseRejectedIntent(){throw Error('accepted remote work cannot be rejected locally');}};
 const dispatch=vm.runInNewContext('('+fragment+')',context);
 assert.equal(await dispatch(local,f.request),true);assert.equal(consumed.length,1);assert.equal(consumed[0].binding.queueId,queueId);
 assert.equal(errors.length,1);assert.match(errors[0].error.message,/opgeslagen|bewaren/);assert.equal(cleared.length,0);assert.equal(refreshed,0);
});
test('a remapped canonical address after remote acknowledgement cannot consume or bind the draft',async()=>{
 const source=readFileSync(new URL('../live-harness-surface.js',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('async function dispatchRequest('),source.indexOf('async function command(',source.indexOf('async function dispatchRequest(')));
 const f=fixture(),bindings=[],calls=[],errors=[];let currentCanonical=canonical,resolve;
 const waiting=new Promise(done=>{resolve=done;});
 const context={pending:new Set(),errors:new Map(),sync(){},snapshot:()=>({queue:[],runs:[],lastSeq:0}),client:{enqueue:async(id)=>{calls.push(id);return waiting;}},serverId:()=>currentCanonical,recovering:new Map(),key:()=>local,
  host:{consumeLiveDraft:(_draft,binding)=>{bindings.push(binding);return {ok:false};}},refresh(){throw Error('uncertain metadata must not finalize');},setError:(_id,error)=>errors.push(error),releaseRejectedIntent(){throw Error('remote acceptance cannot be rejected locally');}};
 const dispatch=vm.runInNewContext('('+fragment+')',context),sending=dispatch(local,f.request);
 assert.deepEqual(calls,[canonical]);currentCanonical='replacement-canonical';resolve({accepted:true,queueId});await sending;
 assert.equal(bindings.length,0);assert.match(errors[0].message,/gespreksadres/);
});
test('a reloaded pinned pending request refuses a different canonical mapping before any transport',async()=>{
 const source=readFileSync(new URL('../live-harness-surface.js',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('async function dispatchRequest('),source.indexOf('async function command(',source.indexOf('async function dispatchRequest(')));
 const f=fixture(),calls=[],errors=[];
 const context={pending:new Set(),errors:new Map(),sync(){},snapshot:()=>({queue:[],runs:[],lastSeq:0}),client:{enqueue:async(...args)=>{calls.push(args);return {accepted:true,queueId};}},serverId:()=> 'replacement-canonical',recovering:new Map(),key:()=>local,
  host:{consumeLiveDraft(){throw Error('mismatched conversation must retain original draft');}},refresh(){throw Error('must not refresh');},setError:(_id,error)=>errors.push(error),releaseRejectedIntent(){throw Error('must retain pending request');}};
 const dispatch=vm.runInNewContext('('+fragment+')',context);await dispatch(local,JSON.parse(JSON.stringify(f.request)));
 assert.equal(calls.length,0);assert.match(errors[0].message,/gespreksadres/);
});

test('canonical queued reply retains its exact scoped target and refuses a changed source identity',()=>{
 const f=fixture();Object.assign(f.request.draft.quote,{messageId:'source-message',entryId:'source-entry',replyToId:'source-message',serverConversationId:canonical});
 f.request.payload.replyToId='source-message';f.row.payload.replyToId='source-message';
 const next=retainQueuedDraft(f.state,f.args);assert.equal(findQueuedDraft(next,local,canonical,f.row).payload.replyToId,'source-message');
 for(const mutate of [draft=>{draft.quote.messageId='changed';},draft=>{draft.quote.replyToId='changed';},draft=>{draft.quote.serverConversationId='foreign';}]){
  const changed=structuredClone(f);mutate(changed.request.draft);assert.throws(()=>retainQueuedDraft(changed.state,changed.args));
 }
});

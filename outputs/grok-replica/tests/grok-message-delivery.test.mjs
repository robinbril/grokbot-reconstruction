import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {AttachmentStore} from '../harness/attachments.mjs';
import {sendDefinition,sendMessageText} from '../harness/send-message.mjs';
import {validateArguments} from '../harness/grok-turns.mjs';
const baseUrl='http://127.0.0.1:8999';
const call=(id,args)=>({id,name:'SendMessage',arguments:args});
async function setup(t,complete){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-delivery-'));
 const store=await new HarnessStore({dataDir}).init();
 const runtime=new GrokRuntime({store,baseUrl,model:{status:async()=>({state:'ready'}),complete}});
 runtime.attachments=await new AttachmentStore({dataDir,store}).init();
 t.after(()=>runtime.close());return {store,runtime,dataDir};
}
async function run(runtime,store,requestId='first'){
 const accepted=await runtime.start('owner','one',{requestId,text:'synthetic input'});
 await runtime.jobs.get(accepted.runId).promise;return store.get('owner','one');
}
function context(messages){return JSON.parse(messages.findLast(m=>m.role==='system'&&m.content.startsWith('Local delivery context:\n')).content.slice('Local delivery context:\n'.length));}
test('native oneof permits replies for text and attachments and keeps streaming text strict',()=>{
 for(const args of [{text:{content:'hello'},reply_to:'known'},{attachment:{url:baseUrl+'/file',alt:'A file'},reply_to:'known'}])assert.doesNotThrow(()=>validateArguments(sendDefinition.inputSchema,args));
 assert.equal(sendMessageText({text:{content:'hello'},reply_to:'known'}),'hello');
 assert.throws(()=>sendMessageText({attachment:{url:baseUrl+'/file'}}),{code:'INVALID_TOOL_ARGUMENTS'});
 for(const args of [{text:{content:'ok'},attachment:{url:'local'}},{attachment:{url:''}},{attachment:{url:'a',extra:1}},{attachment:{url:'a',alt:3}},{text:{content:'ok'},reply_to:''},{text:{content:'ok'},reply_to:'a'.repeat(97)},{text:{content:'ok'},unknown:1}])assert.throws(()=>validateArguments(sendDefinition.inputSchema,args),{code:'INVALID_TOOL_ARGUMENTS'});
});
test('text receipt and reply snapshots use durable delivery IDs visible only in transient model context',async t=>{
 let turn=0,firstId,inputId;
 const {runtime,store,dataDir}=await setup(t,async({messages})=>{
  const local=context(messages);assert.equal(local.conversation_id,'one');assert.equal(local.workspace_file_url_prefix,baseUrl+'/api/harness/conversations/one/preview/');
  if(++turn===1){inputId=local.current_input_message_id;assert.ok(local.reply_targets.some(r=>r.message_id===inputId&&r.role==='user'));return {toolCalls:[call('first-answer',{text:{content:'first'},reply_to:inputId})]};}
  assert.ok(local.reply_targets.some(r=>r.message_id===firstId&&r.entry_id!==firstId&&r.text==='first'));
  return {toolCalls:[call('second-answer',{text:{content:'second'},reply_to:firstId})]};
 });
 let state=await run(runtime,store);assert.equal(state.runs[0].status,'completed');
 const first=state.entries[1].messages[0];firstId=first.id;assert.match(first.id,/^[0-9a-f-]{36}$/);assert.deepEqual(first.replyTo,{messageId:inputId,entryId:inputId,role:'user',text:'synthetic input'});
 assert.deepEqual(JSON.parse(state.tools[0].output),{success:{message_id:first.id,timestamp:Date.parse(first.createdAt)}});
 state=await run(runtime,store,'second');assert.equal(state.runs[1].status,'completed');assert.deepEqual(state.entries[3].messages[0].replyTo,{messageId:first.id,entryId:state.entries[1].id,role:'assistant',text:'first'});
 assert.equal(state.agentHistory.some(m=>m.content?.startsWith?.('Local delivery context:\n')),false);
 const reloaded=(await new HarnessStore({dataDir}).init()).get('owner','one');assert.deepEqual(reloaded.entries[1].messages[0],first);
});
test('workspace attachment delivery stores actual bytes without inventing text',async t=>{
 const {runtime,store}=await setup(t,async({messages})=>({toolCalls:[call('file',{attachment:{url:context(messages).workspace_file_url_prefix+'report.txt',alt:'Report'},reply_to:context(messages).current_input_message_id})]}));
 const c=await runtime.connect('owner','one');await writeFile(path.join(store.get('owner','one').workspaceRoot,'report.txt'),'original bytes');
 const state=await run(runtime,store);assert.equal(state.runs[0].status,'completed');
 const entry=state.entries[1],message=entry.messages[0];assert.equal(message.type,'attachment');assert.equal(entry.text,'');assert.equal(message.attachment.alt,'Report');
 const file=await runtime.attachments.download(c.owner,c.id,message.attachment.attachmentId);assert.equal(file.bytes.toString(),'original bytes');
 assert.equal(JSON.parse(state.tools[0].output).success.message_id,message.id);
});
test('unknown, foreign and incomplete reply IDs fail before attachment import',async t=>{
 let selected='missing';const {runtime,store}=await setup(t,async()=>({toolCalls:[call('rejected',{attachment:{url:baseUrl+'/api/harness/conversations/one/preview/no-file'},reply_to:selected})]}));
 await store.transaction('other','foreign',s=>{s.entries.push({id:'foreign-id',role:'user',status:'completed',text:'foreign'});});
 await store.transaction('owner','one',s=>{s.entries.push({id:'incomplete',role:'assistant',status:'running',text:'draft'});});
 for(const [i,id]of ['missing','foreign-id','incomplete'].entries()){selected=id;const state=await run(runtime,store,'reject-'+i);assert.equal(state.runs.at(-1).error.code,'INVALID_REPLY_TARGET');assert.equal(state.tools.length,0);}
});
test('confirmed assistant deliveries remain replyable after interrupted run; legacy completed entries remain targets',async t=>{
 let turn=0;const {runtime,store}=await setup(t,async({messages})=>{
  if(++turn===1)return {toolCalls:[call('confirmed',{text:{content:'kept'}}),{id:'fail',name:'Missing',arguments:{}}]};
  const targets=context(messages).reply_targets;assert.ok(targets.some(r=>r.message_id==='legacy'));
  return {toolCalls:[call('reply',{text:{content:'reply'},reply_to:targets.find(r=>r.text==='kept').message_id})]};
 });
 await store.transaction('owner','one',s=>{s.entries.push({id:'legacy',role:'assistant',status:'completed',text:'legacy'});});
 await run(runtime,store);const state=await run(runtime,store,'second');assert.equal(state.runs.at(-1).status,'completed');
});
test('aborted direct delivery cannot commit a message or receipt',async t=>{
 const {runtime,store}=await setup(t,async()=>({toolCalls:[]}));const c=await runtime.connect('owner','one');
 await store.transaction('owner','one',s=>{s.runs.push({id:'run',status:'running',outputEntryId:'output',tools:[]});s.entries.push({id:'output',role:'assistant',text:'',status:'running'});});
 const controller=new AbortController();controller.abort();await assert.rejects(runtime.recordMessage(c,'run',call('aborted',{text:{content:'no'}}),{signal:controller.signal}));
 const state=store.get('owner','one');assert.equal(state.tools.length,0);assert.equal(state.entries[0].messages,undefined);
});
test('completed legacy outer entries with old message records remain reply targets',async t=>{
 const {runtime,store}=await setup(t,async()=>({toolCalls:[call('legacy-reply',{text:{content:'answer'},reply_to:'legacy-entry'})]}));
 await store.transaction('owner','one',s=>{s.entries.push({id:'legacy-entry',role:'assistant',status:'completed',text:'old confirmed text',messages:[{callId:'old-call',type:'text',content:'old confirmed text'}]});});
 const state=await run(runtime,store);assert.equal(state.runs.at(-1).status,'completed');assert.deepEqual(state.entries.at(-1).messages[0].replyTo,{messageId:'legacy-entry',entryId:'legacy-entry',role:'assistant',text:'old confirmed text'});
});
test('cancellation after attachment import prevents delivery and success receipt',async t=>{
 const {runtime,store}=await setup(t,async()=>({toolCalls:[]}));const c=await runtime.connect('owner','one');
 await writeFile(path.join(store.get('owner','one').workspaceRoot,'cancel.txt'),'unconfirmed bytes');
 await store.transaction('owner','one',s=>{s.runs.push({id:'run',status:'running',outputEntryId:'output',tools:[]});s.entries.push({id:'output',role:'assistant',text:'',status:'running'});});
 const controller=new AbortController(),original=runtime.attachments.importBytes.bind(runtime.attachments);
 runtime.attachments.importBytes=async(...args)=>{const result=await original(...args);controller.abort();return result;};
 await assert.rejects(runtime.recordMessage(c,'run',call('cancel-file',{attachment:{url:baseUrl+'/api/harness/conversations/one/preview/cancel.txt'}}),{signal:controller.signal}));
 const state=store.get('owner','one');assert.equal(state.tools.length,0);assert.equal(state.entries[0].messages,undefined);
});
test('retry after an interrupted delivery transaction reuses the imported attachment',async t=>{
 const {runtime,store}=await setup(t,async()=>({toolCalls:[]}));const c=await runtime.connect('owner','one');
 await writeFile(path.join(store.get('owner','one').workspaceRoot,'retry.txt'),'retry bytes');
 await store.transaction('owner','one',s=>{s.runs.push({id:'run',status:'running',outputEntryId:'output',tools:[]});s.entries.push({id:'output',role:'assistant',text:'',status:'running',revision:0});});
 const transaction=store.transaction.bind(store);let fail=true;
 store.transaction=(owner,id,mutate)=>transaction(owner,id,async(s,emit)=>{await mutate(s,emit);if(fail&&s.tools.length){fail=false;throw new Error('synthetic delivery persistence failure');}});
 const delivery=call('retry-file',{attachment:{url:baseUrl+'/api/harness/conversations/one/preview/retry.txt'}});
 await assert.rejects(runtime.recordMessage(c,'run',delivery),/synthetic delivery persistence failure/);
 const imported=store.get('owner','one').attachments.filter(row=>row.state==='ready');assert.equal(imported.length,1);
 await runtime.recordMessage(c,'run',delivery);const state=store.get('owner','one');
 assert.equal(state.attachments.length,1);assert.equal(state.entries[0].messages[0].attachment.attachmentId,imported[0].attachmentId);
});
test('entry draft snapshots preserve each call boundary through confirmation',async t=>{
 const {runtime,store}=await setup(t,async()=>({toolCalls:[]}));const c=await runtime.connect('owner','one');
 await store.transaction('owner','one',s=>{s.runs.push({id:'run',status:'running',outputEntryId:'output',tools:[]});s.entries.push({id:'output',role:'assistant',text:'',status:'running',revision:0});});
 await runtime.streamMessage(c,'run',{type:'message.delta',callId:'a',text:'same'});
 await runtime.streamMessage(c,'run',{type:'message.delta',callId:'b',text:'same'});
 assert.deepEqual(store.get('owner','one').entries[0].messageDrafts,[{callId:'a',text:'same',status:'streaming'},{callId:'b',text:'same',status:'streaming'}]);
 await runtime.recordMessage(c,'run',call('a',{text:{content:'same'}}));
 const entry=store.get('owner','one').entries[0];
 assert.deepEqual(entry.messageDrafts,[{callId:'a',text:'same',status:'delivered'},{callId:'b',text:'same',status:'streaming'}]);
 assert.equal(entry.messages[0].callId,'a');assert.equal(entry.text,'same\n\nsame');
});

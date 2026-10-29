import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
import {HarnessRuntime} from '../harness/runtime.mjs';
import {WorkflowEngine,normalizeWorkflowPayload} from '../harness/workflows.mjs';
import {SkillRegistry} from '../harness/skills.mjs';
import {startHarness} from './fixtures/harness-http.mjs';
import {projectComposerDocument} from '../composer-document.js';
const document = content => JSON.stringify({type:'doc',content});
const paragraph = text => ({type:'paragraph',...(text?{content:[{type:'text',text}]}:{})});
const plainDocument = text => document(text.split('\n').map(paragraph));
const inlineDocument = (id,label) => document([{type:'paragraph',content:[{type:'text',text:'Use '},{type:'workflowReference',attrs:{id,label,iconId:null,iconUrl:null}},{type:'text',text:' now'}]}]);
const ready={status:()=>({state:'ready'}),complete:async()=>({toolCalls:[{id:'answer',name:'SendMessage',arguments:{text:{content:'done'}}}]})};
async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'rich-text-transport-'));
 const store=await new HarnessStore({dataDir}).init(),skills=await new SkillRegistry({dataDir}).init(),seen=[];
 const runtime=new GrokRuntime({store,skills,model:{...ready,complete:async args=>{seen.push(args.messages);return ready.complete();}}});
 t.after(()=>runtime.close());return {dataDir,store,skills,runtime,seen};
}
async function done(store,id){
 for(let attempt=0;attempt<200;attempt++){
  const state=store.states.get(id);if(state?.runs.at(-1)?.status==='completed')return state;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('run did not complete');
}
test('native list and link documents survive queue admission, execution and exact replay',async t=>{
 const {runtime,store,seen}=await setup(t),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();
 engine.wake=()=>{};t.after(()=>engine.close());
 const native={type:'doc',content:[paragraph('Plan'),{type:'orderedList',attrs:{start:3,type:null},content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Read docs',marks:[{type:'link',attrs:{href:'https://example.test'}}]}]}]}]}]};
 const richText=JSON.stringify(native),text=projectComposerDocument(native),input={requestId:'native-list',text,richText};
 assert.equal(text,'Plan\n\n3. Read docs (https://example.test)');
 const accepted=await engine.enqueue('owner','native-list',input);
 await engine.pump('native-list');const state=await done(store,'native-list');
 assert.equal(state.entries[0].richText,richText);assert.equal(state.entries[0].text,text);
 assert.ok(seen.flat().some(message=>message.role==='user'&&message.content===text));
 assert.ok(seen.flat().every(message=>!String(message.content).includes(richText)));
 assert.deepEqual(await engine.enqueue('owner','native-list',input),accepted);
 await assert.rejects(engine.enqueue('owner','native-list',{...input,text:'Plan\n3. Read docs (https://example.test)'}),{code:'INVALID_RICH_TEXT'});
});
test('native selection quote reaches model input as exact user text and replays one immutable queued intent',async t=>{
 const {runtime,store,seen}=await setup(t),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();
 engine.wake=()=>{};t.after(()=>engine.close());
 const native={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Review '},{type:'quoteReference',attrs:{quote:'first\n\n<script>literal</script>'}},{type:'text',text:' now'}]}]};
 const richText=JSON.stringify(native),text=projectComposerDocument(native),input={requestId:'selection-quote',text,richText};
 assert.equal(text,'Review \n> first\n>\n> <script>literal</script>\n\n now');
 const accepted=await engine.enqueue('owner','quote',input);await engine.pump('quote');
 const state=await done(store,'quote');assert.equal(state.entries[0].richText,richText);assert.equal(state.entries[0].text,text);
 assert.ok(seen.flat().some(message=>message.role==='user'&&message.content===text));
 assert.ok(seen.flat().every(message=>!String(message.content).includes(richText)));
 assert.deepEqual(await engine.enqueue('owner','quote',input),accepted);
 await assert.rejects(engine.enqueue('owner','quote',{...input,richText:JSON.stringify({...native,content:[paragraph(text)]})}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('direct admission retains richText across restart and binds it to the accepted request',async t=>{
 const {runtime,store,dataDir,seen}=await setup(t),text='first\nsecond',richText=plainDocument(text);
 const input={requestId:'direct',text,richText},accepted=await runtime.start('owner','direct',input);
 const state=await done(store,'direct');assert.equal(state.entries[0].richText,richText);
 assert.equal(seen.flat().some(message=>typeof message.content==='string'&&message.content.includes(richText)),false,'serialized document is presentation metadata, not model authority');
 await runtime.close();const reopened=await new HarnessStore({dataDir}).init();let calls=0;
 const next=new GrokRuntime({store:reopened,model:{...ready,complete:async()=>{calls++;return ready.complete();}}});t.after(()=>next.close());
 assert.equal(reopened.get('owner','direct').entries[0].richText,richText);
 assert.deepEqual(await next.start('owner','direct',input),accepted);assert.equal(calls,0);
 const alternate=document([{type:'paragraph',content:[{type:'text',text:'first'},{type:'hardBreak'},{type:'text',text:'second'}]}]);
 await assert.rejects(next.start('owner','direct',{...input,richText:alternate}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(next.start('owner','direct',{requestId:'direct',text}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('malformed and divergent rich documents reject before connection or durable acceptance',async t=>{
 const {runtime,store}=await setup(t);let connections=0;runtime.connect=async()=>{connections++;throw Error('should not connect');};
 const invalid=[null,{},'{',plainDocument('different'),JSON.stringify({type:'doc',content:[{type:'script',text:'hello'}]}),inlineDocument('unselected','Hidden')];
 for(const richText of invalid)await assert.rejects(runtime.start('owner','bad',{requestId:'bad',text:'hello',richText}),{code:'INVALID_RICH_TEXT',status:422});
 assert.equal(connections,0);assert.equal(store.states.size,0);
});
test('selected inline references are validated against exact selected skill identities',async t=>{
 const {runtime,store,skills}=await setup(t);
 const skill=(await skills.create('owner',{requestId:'skill',name:'Research',description:'Synthetic',content:'Only user instruction'})).skill;
 const skillRefs=[{id:skill.id,revision:1}],text='Use @Research now',richText=inlineDocument(skill.id,'Research');
 await runtime.start('owner','skill',{requestId:'selected',text,richText,skillRefs});
 assert.equal((await done(store,'skill')).entries[0].richText,richText);
 await assert.rejects(runtime.start('owner','bad',{requestId:'bad',text,richText,skillRefs:[]}),{code:'INVALID_RICH_TEXT'});
 await assert.rejects(runtime.start('owner','bad',{requestId:'bad',text:'hello',richText:plainDocument('hello'),skillRefs}),{code:'INVALID_RICH_TEXT'});
});
test('queue and schedule preserve rich documents, payload hashes and replay after restart',async t=>{
 const {runtime,store,dataDir}=await setup(t),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};t.after(()=>engine.close());
 const payload={text:'queued\ntext',richText:plainDocument('queued\ntext')},input={requestId:'queued',...payload};
 assert.deepEqual(normalizeWorkflowPayload(payload),payload);
 const accepted=await engine.enqueue('owner','queued',input),before=structuredClone(store.get('owner','queued').queue[0]);
 const schedule=await engine.createSchedule('owner','queued',{requestId:'schedule',title:'Rich schedule',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload});
 assert.deepEqual(schedule.schedule.payload,payload);assert.deepEqual(await engine.enqueue('owner','queued',input),accepted);
 await assert.rejects(engine.enqueue('owner','queued',{...input,richText:undefined}),{code:'IDEMPOTENCY_CONFLICT'});
 await runtime.close();await engine.close();
 const reopened=await new HarnessStore({dataDir}).init(),next=new GrokRuntime({store:reopened,model:ready});t.after(()=>next.close());
 const resumed=await new WorkflowEngine({store:reopened,runtime:next,autoStart:false}).init();resumed.wake=()=>{};t.after(()=>resumed.close());
 assert.equal(reopened.get('owner','queued').queue[0].payloadHash,before.payloadHash);
 assert.deepEqual(await resumed.enqueue('owner','queued',input),accepted);
 await resumed.pump('queued');const state=await done(reopened,'queued');
 assert.equal(state.entries[0].richText,payload.richText);assert.deepEqual(state.queue[0].payload,payload);
});
test('queue and schedule reject invalid rich documents before admission',async t=>{
 const {runtime,store}=await setup(t),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};t.after(()=>engine.close());
 const payload={text:'hello',richText:plainDocument('changed')};
 await assert.rejects(engine.enqueue('owner','bad',{requestId:'queue',...payload}),{code:'INVALID_RICH_TEXT',status:422});
 await assert.rejects(engine.createSchedule('owner','bad',{requestId:'schedule',title:'Bad rich',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload}),{code:'INVALID_RICH_TEXT',status:422});
 assert.equal(store.states.size,0);
});
test('legacy runtime preserves and binds presentation metadata without changing its dispatch input',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'legacy-rich-text-')),store=await new HarnessStore({dataDir}).init();
 const runtime=new HarnessRuntime({store});t.after(()=>runtime.close());let connections=0;
 runtime.connect=async()=>{connections++;return {threadId:'synthetic'};};runtime.dispatch=async()=>{};
 const input={requestId:'legacy',text:'hello',richText:plainDocument('hello')};
 const accepted=await runtime.start('owner','legacy',input);assert.equal(store.get('owner','legacy').entries[0].richText,input.richText);
 assert.deepEqual(await runtime.start('owner','legacy',input),accepted);assert.equal(connections,1);
 await assert.rejects(runtime.start('owner','legacy',{requestId:'legacy',text:'hello'}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(runtime.start('owner','bad',{requestId:'bad',text:'hello',richText:plainDocument('different')}),{code:'INVALID_RICH_TEXT'});
 assert.equal(connections,1);
 const ref={kind:'skill',id:'local-skill:legacy',label:'Legacy skill',description:'LEGACY_PRIVATE_BODY_7319'};
 const selected={requestId:'selected',text:'Use @Legacy skill now',richText:inlineDocument(ref.id,ref.label),skillReferences:[JSON.stringify(ref)]};
 await runtime.start('owner','selected',selected);
 const entry=store.get('owner','selected').entries[0];
 assert.deepEqual(entry.legacySkillReferences,[{kind:'skill',id:ref.id,label:ref.label}]);
 assert.equal(JSON.stringify(entry).includes(ref.description),false);
});
test('legacy skill snapshots bind inline nodes without changing plain legacy requests',()=>{
 const selected={kind:'skill',id:'local-skill:synthetic',label:'Local skill',description:'Saved instructions'};
 const body={text:'Use @Local skill now',richText:inlineDocument(selected.id,selected.label),skillReferences:[JSON.stringify(selected,null,2)]};
 assert.deepEqual(normalizeWorkflowPayload(body),body);
 for(const skillReferences of [['not structured'],[JSON.stringify({...selected,id:'different'})]])assert.throws(()=>normalizeWorkflowPayload({...body,skillReferences}),{code:'INVALID_RICH_TEXT'});
 assert.deepEqual(normalizeWorkflowPayload({text:'hello',skillReferences:['historic plain context']}),{text:'hello',skillReferences:['historic plain context']});
});
test('HTTP rejects divergent rich text before admission and returns the exact accepted document',async t=>{
 const app=await startHarness({model:ready});t.after(()=>app.close());const client=await app.client();
 const body={requestId:'http-document',text:'hello',richText:plainDocument('hello')};
 const bad=await client.request('/conversations/bad/runs',{method:'POST',body:{...body,richText:plainDocument('different')}});
 assert.equal(bad.status,422);assert.equal(bad.value.error.code,'INVALID_RICH_TEXT');assert.equal(app.handler.store.states.size,0);
 const accepted=await client.request('/conversations/document/runs',{method:'POST',body});assert.equal(accepted.status,202);
 await done(app.handler.store,'document');const snapshot=await client.request('/conversations/document');
 assert.equal(snapshot.value.entries.find(entry=>entry.id===accepted.value.inputEntryId).richText,body.richText);
 const replay=await client.request('/conversations/document/runs',{method:'POST',body});assert.equal(replay.value.runId,accepted.value.runId);
 const conflict=await client.request('/conversations/document/runs',{method:'POST',body:{requestId:body.requestId,text:body.text}});
 assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
});
test('HTTP and restart expose only document-bound legacy skill presentation metadata',async t=>{
 const first=await startHarness({model:ready});t.after(()=>first.close());const client=await first.client();
 const ref={kind:'skill',id:'local-skill:presentation',label:'Snapshot label',description:'LEGACY_PRIVATE_BODY_9427'};
 const body={requestId:'legacy-http',text:'Use @Document label now',richText:inlineDocument(ref.id,'Document label'),skillReferences:[JSON.stringify(ref)]};
 const accepted=await client.request('/conversations/legacy-document/runs',{method:'POST',body});assert.equal(accepted.status,202);
 await done(first.handler.store,'legacy-document');
 const publicEntry=(await client.request('/conversations/legacy-document')).value.entries.find(entry=>entry.id===accepted.value.inputEntryId);
 const expected=[{kind:'skill',id:ref.id,label:'Document label'}];
 assert.deepEqual(publicEntry.legacySkillReferences,expected);assert.equal(JSON.stringify(publicEntry).includes(ref.description),false);
 const auth={cookie:client.cookie,csrf:client.csrf};await first.close({keepData:true});
 const reopened=await startHarness({dataDir:first.dataDir,model:ready});t.after(()=>reopened.close());const restored=await reopened.client(auth);
 const replay=await restored.request('/conversations/legacy-document/runs',{method:'POST',body});assert.equal(replay.value.runId,accepted.value.runId);
 const entry=(await restored.request('/conversations/legacy-document')).value.entries.find(entry=>entry.id===accepted.value.inputEntryId);
 assert.equal(entry.richText,body.richText);assert.deepEqual(entry.legacySkillReferences,expected);assert.equal(JSON.stringify(entry).includes(ref.description),false);
});

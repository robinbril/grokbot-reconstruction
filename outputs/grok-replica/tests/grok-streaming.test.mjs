import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {HarnessStore} from '../harness/store.mjs';
import {GrokRuntime} from '../harness/grok-runtime.mjs';
async function setup(t,complete){const root=await mkdtemp(path.join(os.tmpdir(),'grok-stream-test-')),store=await new HarnessStore({dataDir:root}).init(),runtime=new GrokRuntime({store,baseUrl:'http://127.0.0.1:8999',model:{status:()=>({state:'ready'}),complete}});t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});return {store,runtime};}
async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('timed out');}
const reply=(message='Hello world')=>({text:'private',toolCalls:[{id:'answer',name:'SendMessage',arguments:{text:{content:message}}}]});
test('host persists visible incremental revisions before model completion, reconnect snapshots and one final receipt',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),{store,runtime}=await setup(t,async({onEvent})=>{await onEvent({type:'message.delta',callId:'answer',text:'Hello'});await gate;await onEvent({type:'message.delta',callId:'answer',text:' world'});return reply();});
 const accepted=await runtime.start('a','one',{requestId:'first',text:'hello'});await until(()=>store.states.get('one').entries[1].text==='Hello');
 const partial=store.snapshot(store.states.get('one'));assert.equal(partial.entries[1].id,accepted.outputEntryId);assert.equal(partial.entries[1].status,'running');assert.equal(partial.entries[1].delivery,'partial');assert.equal(partial.tools.length,0);const revision=partial.entries[1].revision;
 release();await until(()=>store.states.get('one').runs[0].status==='completed');const final=store.states.get('one');assert.equal(final.entries[1].text,'Hello world');assert.equal(final.entries[1].id,accepted.outputEntryId);assert.ok(final.entries[1].revision>revision);assert.equal(final.entries[1].delivery,'delivered');assert.equal(final.entries[1].streaming,false);assert.equal(final.tools.filter(t=>t.name==='SendMessage').length,1);assert.equal(JSON.stringify(store.snapshot(final)).includes('private'),false);
});
for(const kind of ['cancel','failure','mismatch'])test('partial output remains explicitly partial after '+kind+' and gets no completion receipt',async t=>{
 let emitted=false;const {runtime,store}=await setup(t,async({onEvent,signal})=>{await onEvent({type:'message.delta',callId:'answer',text:'Hello'});emitted=true;if(kind==='failure')throw new Error('provider stopped');if(kind==='mismatch')return reply('different');await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true});});});
 const accepted=await runtime.start('a','one',{requestId:'first',text:'hi'});await until(()=>emitted);if(kind==='cancel')await runtime.cancel('a',accepted.runId);await until(()=>['failed','cancelled'].includes(store.states.get('one').runs[0].status));const state=store.states.get('one');assert.equal(state.entries[1].text,'Hello');assert.equal(state.entries[1].delivery,'partial');assert.equal(state.entries[1].streaming,false);assert.equal(state.tools.length,0);
});
test('restart recovery persists interrupted stream flags, draft status and a higher replay revision',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'grok-stream-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=await new HarnessStore({dataDir:root}).init();
 await store.transaction('a','one',(state,emit)=>{state.entries.push({id:'output',runId:'run',role:'assistant',text:'Partial',status:'running',revision:7,streaming:true,delivery:'partial'});state.runs.push({id:'run',outputEntryId:'output',status:'running',messageDrafts:[{callId:'a',text:'Partial',status:'streaming'}],approvals:[]});emit('entry.updated',{entry:state.entries[0]},'run');});
 const previousSeq=store.states.get('one').lastSeq,restarted=await new HarnessStore({dataDir:root}).init(),state=restarted.states.get('one');
 assert.equal(state.runs[0].status,'interrupted');assert.equal(state.runs[0].messageDrafts[0].status,'interrupted');assert.equal(state.entries[0].streaming,false);assert.equal(state.entries[0].delivery,'partial');assert.equal(state.entries[0].status,'interrupted');assert.equal(state.entries[0].revision,8);assert.equal(state.entries[0].text,'Partial');assert.equal(state.tools.length,0);
 const recovered=state.events.filter(event=>event.seq>previousSeq&&event.type==='entry.updated');assert.equal(recovered.length,1);assert.equal(recovered[0].data.entry.streaming,false);assert.equal(recovered[0].data.entry.revision,8);
 const twice=(await new HarnessStore({dataDir:root}).init()).states.get('one');assert.equal(twice.entries[0].revision,8);assert.equal(twice.lastSeq,state.lastSeq);
});

for(const [label,args] of Object.entries({legacy:{message:'Legacy'},attachment:{attachment:{url:'https://example.invalid/image.png'}},reply:{text:{content:'Hello'},reply_to:'native-id'},extra:{text:{content:'Hello'},message:'Legacy'},missingContent:{text:{}},wrongContent:{text:{content:42}},extraNested:{text:{content:'Hello',other:'private'}}}))test('malformed native SendMessage '+label+' fails without delivered output',async t=>{
 const {runtime,store}=await setup(t,async()=>({text:'private',toolCalls:[{id:'answer',name:'SendMessage',arguments:args}]}));
 await runtime.start('a','one',{requestId:'invalid-'+label,text:'hi'});
 await until(()=>store.states.get('one').runs[0].status==='failed');
 const state=store.states.get('one');assert.equal(state.tools.length,0);assert.ok(!state.entries.some(entry=>entry.role==='assistant'&&entry.delivery==='delivered'));
});

// PREPARATION ONLY: revision-3 own contract. Copy to tests/ only after root GO/freeze.
// No tests/imports have run. Pure local schema contracts, not native/backend evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_SCHEMA, ENTRY_KINDS, normalizeEntry, reduceEntry, normalizeChatRuns} from '../chat-entry-model.js';
const freeze = value => { if(value && typeof value === 'object' && !Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value; };
const base = () => ({id:'m1',role:'bot',text:'<b>same</b>',createdAt:17,localRun:{status:'complete',output:'legacy'}});
const typed = overrides => ({...base(),transcript:{schema:1,kind:'send-message',revision:4,status:'streaming',runId:'r1',generation:2,replica:{producer:'local-text-v1',operation:'upper'},payload:{layoutMode:'bubble'},...overrides}});
const run = overrides => ({schema:1,id:'r1',conversationId:'c1',submissionId:'s1',inputEntryId:'u1',outputEntryId:'m1',noticeEntryIds:[],adapterId:'local-text-v1',operation:'upper',style:'short',styleProfileVersion:'local-answer-v1',generation:2,lastSeq:0,phase:'running',progress:{processed:0,total:5},createdAt:17,updatedAt:17,delivery:null,...overrides});
const envelope = overrides => ({version:1,messages:{c1:[{id:'u1',role:'user',text:'input'},typed()]},chatRuns:{r1:run()},...overrides});

test('legacy projection is lazy, ID preserving, pure and repeatable; old complete is no receipt',()=>{
 const message=freeze(base()),before=JSON.stringify(message),n=normalizeEntry(message,{conversationId:'c1'});
 assert.deepEqual({id:n.messageId,c:n.conversationId,k:n.kind,r:n.revision,s:n.status,t:n.text},{id:'m1',c:'c1',k:'message',r:0,s:'stable',t:'<b>same</b>'});
 assert.deepEqual(normalizeEntry(message,{conversationId:'c1'}),n);assert.equal(JSON.stringify(message),before);
 assert.equal(n.runId,undefined);assert.equal(n.delivery,undefined);assert.equal(message.localRun.status,'complete');
});
test('all nine explicit kinds read the one outer text without changing persisted form',()=>{
 assert.equal(CHAT_SCHEMA,1);assert.ok(Object.isFrozen(ENTRY_KINDS));
 assert.deepEqual([...ENTRY_KINDS].sort(),['message','send-message','user-attachment','tool-call','notice','mcp-app','event','feedback','voice-call'].sort());
 for(const kind of ENTRY_KINDS){const message=freeze(typed({kind})),n=normalizeEntry(message,{conversationId:'c1'});assert.equal(n.kind,kind);assert.equal(n.text,message.text);assert.equal(n.messageId,message.id);assert.ok(!n.unsupported);}
});
for(const transcript of [
 {schema:9,kind:'send-message',revision:4,status:'stable',payload:{html:'<script>evil</script>'}},
 {schema:1,kind:'future-tool',revision:4,status:'stable',payload:{execute:'rm -rf'}},
 {schema:1,kind:'message',revision:-1,status:'stable'},
 {schema:1,kind:'message',revision:4,status:'stable',payload:['not-an-allowlisted-record']}
])test(`unknown/malformed metadata remains readable and opaque (${JSON.stringify(transcript)})`,()=>{
 const message=freeze({...base(),transcript}),before=JSON.stringify(message),n=normalizeEntry(message,{conversationId:'c1'});
 assert.equal(n.text,message.text);assert.equal(n.messageId,'m1');assert.deepEqual(n.unsupported,{schema:String(transcript.schema),kind:transcript.kind});assert.equal(n.kind,'message');assert.equal(JSON.stringify(message),before);
 assert.equal(n.execute,undefined);assert.equal(n.resume,undefined);assert.equal(n.html,undefined);assert.equal(n.runId,undefined);assert.equal(n.replica,undefined);assert.equal(n.payload,undefined);
});
// Closed replace envelope; conversation ownership is checked by the host.
const event = overrides => ({schema:1,type:'replace',conversationId:'c1',entryId:'m1',runId:'r1',generation:2,revision:5,text:'<b>edit</b>',status:'streaming',...overrides});
test('newer same-length correction replaces text once, preserving unrelated legacy metadata identity',()=>{
 const message=freeze(typed()),result=reduceEntry(message,event());
 assert.equal(result.changed,true);assert.equal(result.rejectedReason,null);assert.notEqual(result.message,message);
 assert.equal(result.message.text,'<b>edit</b>');assert.equal(result.message.transcript.kind,message.transcript.kind);assert.equal(result.message.transcript.revision,5);assert.equal(result.message.localRun,message.localRun);assert.equal(result.message.transcript.replica,message.transcript.replica);assert.equal(result.message.transcript.payload,message.transcript.payload);
 const duplicate=reduceEntry(freeze(result.message),event());assert.equal(duplicate.changed,false);assert.equal(duplicate.message,result.message);
});
for(const change of [{revision:4},{revision:3},{revision:NaN},{revision:Number.MAX_SAFE_INTEGER+1},{text:undefined},{status:'delivered'},{entryId:'other'},{runId:'other'},{generation:1},{kind:'tool-call'},{replica:{producer:'remote'}},{payload:{layoutMode:'elevated'}},{schema:2},{type:'append'},{conversationId:''},{conversationId:'x'.repeat(257)}])test(`reducer rejects stale, malformed or foreign event ${JSON.stringify(change)}`,()=>{
 const message=freeze(typed()),before=JSON.stringify(message),result=reduceEntry(message,event(change));
 assert.equal(result.changed,false);assert.equal(result.message,message);assert.ok(['invalid','identity','revision'].includes(result.rejectedReason));assert.equal(JSON.stringify(message),before);
});
test('valid journal preserves object identity; normalization does not mutate state or create text copies',()=>{
 const state=freeze(envelope()),before=JSON.stringify(state),result=normalizeChatRuns(state);
 assert.equal(result.chatRuns.r1,state.chatRuns.r1);assert.deepEqual(result.issues,[]);assert.equal(JSON.stringify(state),before);
 for(const key of ['text','input','output','messages','entries','chatEntries'])assert.equal(Object.hasOwn(result.chatRuns.r1,key),false);
});
for(const [label,alter] of [
 ['missing input',s=>{s.chatRuns.r1.inputEntryId='missing';}],['wrong output role',s=>{s.chatRuns.r1.outputEntryId='u1';}],
 ['foreign conversation',s=>{s.chatRuns.r1.conversationId='c2';}],['unsafe generation',s=>{s.chatRuns.r1.generation=Infinity;}],
 ['negative cursor',s=>{s.chatRuns.r1.lastSeq=-1;}]
])test('invalid/dangling journal never becomes executable or a fabricated delivery: '+label,()=>{
 const state=envelope();alter(state);freeze(state);const result=normalizeChatRuns(state),value=result.chatRuns.r1;
 assert.ok(result.issues.length>0);assert.equal(value,undefined);assert.ok(result.issues.every(i=>['invalid','reference','receipt'].includes(i.code)));
});
test('inherited maps and prototype-like references never select Object prototype or another conversation',()=>{
 const inheritedRuns=Object.create({r1:run()});const inherited=normalizeChatRuns(freeze(envelope({chatRuns:inheritedRuns})));assert.equal(Object.hasOwn(inherited.chatRuns,'r1'),false);
 const inheritedMessages=Object.create({c1:envelope().messages.c1});
 const state=freeze(envelope({messages:inheritedMessages})),result=normalizeChatRuns(state);
 assert.ok(result.issues.length>0);assert.equal(result.chatRuns.r1,undefined);
 for(const id of ['__proto__','constructor','toString']){
  const altered=envelope();altered.chatRuns.r1.inputEntryId=id;const before=JSON.stringify(altered);const n=normalizeChatRuns(freeze(altered));
  assert.ok(n.issues.length>0);assert.ok(!n.chatRuns.r1?.delivery);assert.equal(JSON.stringify(altered),before);
 }
 assert.equal({}.polluted,undefined);
});
test('normalized local provenance and layout are exact allowlisted hints, not raw payload execution',()=>{
 const message=freeze(typed({replica:{producer:'local-text-v1',operation:'markdown'},payload:{layoutMode:'elevated',execute:'never',text:'duplicate'}})),n=normalizeEntry(message,{conversationId:'c1'});
 assert.deepEqual(n.replica,{producer:'local-text-v1',operation:'markdown'});assert.deepEqual(n.payload,{layoutMode:'elevated'});assert.equal(n.text,message.text);assert.equal(n.execute,undefined);
 const legacy=normalizeEntry(freeze(base()),{conversationId:'c1'});assert.equal(legacy.payload,undefined);assert.equal(legacy.replica,undefined);
});
test('invalid optional format enum is discarded without granting elevated or hiding a supported message',()=>{
 const message=freeze(typed({payload:{layoutMode:'native-admin'}})),n=normalizeEntry(message,{conversationId:'c1'});assert.equal(n.kind,'send-message');assert.equal(n.text,message.text);assert.equal(n.payload,undefined);assert.equal(n.unsupported,undefined);assert.deepEqual(n.replica,{producer:'local-text-v1',operation:'upper'});
});
test('unsupported marker is bounded plain data and never invokes metadata accessors',()=>{
 let reads=0;const metadata=Object.freeze(Object.defineProperties({schema:99,revision:0,status:'stable',payload:{layoutMode:'elevated'}},{kind:{enumerable:true,get(){reads++;throw Error('getter invoked');}}}));
 const message=Object.freeze({...base(),transcript:metadata}),n=normalizeEntry(message,{conversationId:'c1'});assert.equal(reads,0);assert.deepEqual(n.unsupported,{schema:'99',kind:'unknown'});assert.equal(n.payload,undefined);
 const long=normalizeEntry(typed({schema:'s'.repeat(100),kind:'k'.repeat(100)}),{conversationId:'c1'});assert.deepEqual(long.unsupported,{schema:'s'.repeat(64),kind:'k'.repeat(64)});
});
test('terminal replacement is inert; unowned entry cannot acquire run ownership from an event',()=>{
 const terminal=freeze(typed({status:'stable'})),stopped=reduceEntry(terminal,event());assert.equal(stopped.changed,false);assert.equal(stopped.message,terminal);
 const unowned=freeze(typed({runId:undefined,generation:undefined})),foreign=reduceEntry(unowned,event());assert.equal(foreign.changed,false);assert.equal(foreign.message,unowned);
});
test('corrupt delivered receipt projects interrupted without mutation or fabricated replacement receipt',()=>{
 const state=envelope();state.chatRuns.r1={...state.chatRuns.r1,phase:'delivered',progress:{processed:5,total:5},delivery:{id:'r1:final',entryId:'other',generation:2,revision:4,committedAt:17,scope:'browser-local'}};state.messages.c1[1]=typed({status:'stable'});freeze(state);
 const normalized=normalizeChatRuns(state);assert.equal(normalized.chatRuns.r1.phase,'interrupted');assert.equal(normalized.chatRuns.r1.delivery,null);assert.notEqual(normalized.chatRuns.r1,state.chatRuns.r1);assert.equal(state.chatRuns.r1.phase,'delivered');assert.ok(normalized.issues.some(i=>i.runId==='r1'&&i.code==='receipt'));
});
for(const progress of [{processed:-1,total:5},{processed:1.1,total:5},{processed:Infinity,total:5},{processed:6,total:5},{processed:0,total:4},{processed:0,total:100001},{processed:0,total:NaN},{processed:0,total:5,text:'not allowed'},[],null])test('invalid numeric progress is inert: '+JSON.stringify(progress),()=>{
 const state=envelope();state.chatRuns.r1.progress=progress;freeze(state);const normalized=normalizeChatRuns(state);assert.equal(normalized.chatRuns.r1,undefined);assert.ok(normalized.issues.some(i=>i.runId==='r1'&&i.code==='invalid'));
});
test('historical absent progress remains unknown and preserves valid journal identity',()=>{
 const state=envelope();delete state.chatRuns.r1.progress;freeze(state);const result=normalizeChatRuns(state);assert.equal(result.chatRuns.r1,state.chatRuns.r1);assert.equal(Object.hasOwn(result.chatRuns.r1,'progress'),false);assert.deepEqual(result.issues,[]);
});

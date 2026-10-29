// PREPARATION ONLY. Copy into replica/tests only after root freeze/GO.
// No DOM, backend, fake provider or source-bundle execution. APIs are proposed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry } from '../chat-entry-model.js';
import { projectChatContent } from '../chat-content-frames.js';

const text='Vooraf\n\n| Naam | Aantal |\n| --- | ---: |\n| A\\|B | 4 |\n\nDaarna';
const table='| Naam | Aantal |\n| --- | ---: |\n| A\\|B | 4 |';
const adjacency={isGroupStart:true,isContinuedFromPrev:true,isContinuedToNext:true};
const baseContext=()=>({role:'bot',images:[],attachments:[],channel:null,specialized:null,
 work:{isStreaming:false,isStable:true},adjacency});
const raw=(overrides={})=>({id:'output',role:'bot',text,
 transcript:{schema:1,kind:'send-message',revision:1,status:'stable',
 replica:{producer:'local-text-v1',operation:'markdown'},payload:{layoutMode:'elevated'}},...overrides});
function entry(overrides={}){return normalizeEntry(raw(overrides),{conversationId:'conversation-A'});}
function project(overrides={},context={}){return projectChatContent(entry(overrides),{...baseContext(),...context});}
const contents=plan=>plan.runs.map(run=>({kind:run.kind,text:plan.source.slice(run.start,run.end)}));
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const key of Object.keys(value))deepFreeze(value[key]);}return value;}

test('eligible elevated local text projects exact prose/table/prose inside one entry',()=>{
 const message=raw(),before=structuredClone(message),ctx=deepFreeze(baseContext());deepFreeze(message);
 const normalized=normalizeEntry(message,{conversationId:'conversation-A'}),plan=projectChatContent(normalized,ctx);
 assert.equal(plan.mode,'split');assert.deepEqual(contents(plan),[{kind:'prose',text:'Vooraf'},{kind:'table',text:table},{kind:'prose',text:'Daarna'}]);
 assert.equal(new Set(plan.runs.map(r=>r.key)).size,3);assert.deepEqual(message,before);
 for(const r of plan.runs){assert.ok(Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end));assert.ok(r.start>=0&&r.end>=r.start&&r.end<=plan.source.length);}
});

for(const [name,change] of [
 ['legacy role-bearing message',{legacy:true}],
 ['supported ordinary message',{kind:'message'}],
 ['explicit bubble layout',{layoutMode:'bubble'}],
 ['no layout hint',{layoutMode:undefined}],
 ['invalid own layout hint',{layoutMode:'force-elevated'}],
])test(`split is ineligible for ${name}`,()=>{
 let message=raw();if(change.legacy)delete message.transcript;else{message.transcript={...message.transcript,kind:change.kind??'send-message',payload:change.layoutMode===undefined?{}:{layoutMode:change.layoutMode}};}
 const normalized=normalizeEntry(message,{conversationId:'conversation-A'}),plan=projectChatContent(normalized,baseContext());
 assert.equal(plan.mode,'whole');assert.equal(plan.runs.length,1);assert.equal(plan.runs[0].kind,'prose');assert.equal(plan.source.slice(plan.runs[0].start,plan.runs[0].end),text);
});

for(const [name,value,eligible] of [['null',null,true],['undefined',undefined,true],['empty string','',false],['channel text','slack:team',false]])
test(`channel ${name} keeps the exact nullish eligibility distinction`,()=>{
 const plan=project({}, {channel:value});assert.equal(plan.mode,eligible?'split':'whole');assert.equal(plan.runs.filter(r=>r.kind==='table').length,eligible?1:0);
});

for(const field of ['images','attachments'])for(const [name,value,eligible] of [['absent',undefined,true],['empty',[],true],['present',[{id:'attachment-only-reference'}],false]])
test(`${field} ${name} changes only split eligibility`,()=>{
 const plan=project({}, {[field]:value});assert.equal(plan.mode,eligible?'split':'whole');assert.notEqual(plan.mode,'plain');assert.equal(plan.source.includes('A\\|B'),true);
});

for(const specialized of ['canvas','document','agent','link','voice','link-list'])
test(`existing recognized ${specialized} presentation wins before generic table splitting`,()=>{
 const plan=project({}, {specialized});assert.equal(plan.mode,'delegate');assert.deepEqual(plan.runs,[]);
});

for(const kind of ['message','send-message'])test(`user text is plain even with ${kind} and an elevated hint`,()=>{
 const plan=project({role:'user',transcript:{schema:1,kind,revision:1,status:'stable',payload:{layoutMode:'elevated'}}},{role:'user'});
 assert.equal(plan.mode,'plain');assert.equal(plan.source,text);assert.equal(plan.runs.some(r=>r.kind==='table'),false);
});

for(const metadata of [
 {schema:99,kind:'send-message',revision:2,status:'stable',payload:{layoutMode:'elevated'}},
 {schema:1,kind:'future-execute',revision:2,status:'stable',payload:{layoutMode:'elevated',html:'<script>bad()</script>'}},
 {schema:1,kind:'send-message',revision:'wrong',status:'stable',payload:{layoutMode:'elevated'}},
])test(`unsupported or invalid metadata stays plain and cannot grant frames (${String(metadata.schema)}/${metadata.kind}/${String(metadata.revision)})`,()=>{
 const normalized=entry({transcript:metadata}),plan=projectChatContent(normalized,baseContext());
 assert.ok(normalized.unsupported);assert.equal(plan.mode,'plain');assert.equal(plan.source,text);assert.equal(plan.runs.some(r=>r.kind==='table'),false);
});

const guards=[
 ['backtick fenced table','```\n'+table+'\n```'],
 ['tilde fenced table','~~~markdown\n'+table+'\n~~~'],
 ['long fence with shorter nonclosing fence','````\n```\n'+table+'\n````'],
 ['quoted table','> | A | B |\n> | --- | --- |\n> | 1 | 2 |'],
 ['list continuation','- Item\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |'],
 ['four-space code','    | A | B |\n    | --- | --- |\n    | 1 | 2 |'],
 ['tab-indented code','\t| A | B |\n\t| --- | --- |\n\t| 1 | 2 |'],
 ['mismatched column count','| A | B |\n| --- |\n| 1 | 2 |'],
 ['non-delimiter line','| A | B |\n| x | y |\n| 1 | 2 |'],
 ['all blank header cells','| | |\n| - | - |\n| A | 2 |'],
 ['reference-definition guard',table+'\n\n[link]: https://example.test/'],
 ['raw script-block guard','<script>inert</script>\n\n'+table],
];
for(const [name,source] of guards)test(`source scanner does not elevate ${name}`,()=>{
 const plan=project({text:source});assert.equal(plan.mode,'whole');assert.equal(plan.runs.length,1);assert.equal(plan.runs[0].kind,'prose');assert.equal(plan.source.slice(plan.runs[0].start,plan.runs[0].end),source);
});

for(const [name,prefix] of [['closed fence','```\nnot a table\n```'],['ended quote','> quote'],['ended list','- item']])
test(`blank unindented boundary after ${name} permits the actual following table`,()=>{
 const plan=project({text:prefix+'\n\n'+table});assert.equal(plan.mode,'split');assert.deepEqual(contents(plan).map(r=>r.kind),['prose','table']);assert.equal(contents(plan)[1].text,table);
});

test('escaped pipe stays in one source cell; CRLF becomes view lines without rewriting outer input',()=>{
 const input=text.replaceAll('\n','\r\n'),message=raw({text:input});deepFreeze(message);
 const normalized=normalizeEntry(message,{conversationId:'conversation-A'}),plan=projectChatContent(normalized,baseContext());
 assert.equal(plan.mode,'split');assert.equal(contents(plan)[1].text,table);assert.equal(normalized.text,input);assert.equal(message.text,input);
 assert.equal(plan.runs.filter(r=>r.kind==='table').length,1);assert.equal(contents(plan)[1].text.split('\n')[2],'| A\\|B | 4 |');
});

test('unwrapped pipe table is recognized and a later heading ends its body',()=>{
 const source='A | B\n--- | ---\n1 | 2\n# Separate heading',plan=project({text:source});
 assert.equal(plan.mode,'split');assert.deepEqual(contents(plan),[{kind:'table',text:'A | B\n--- | ---\n1 | 2'},{kind:'prose',text:'# Separate heading'}]);
});

test('multiple actual tables preserve ordered intervening prose and independent variant',()=>{
 const second='| | Count |\n| - | - |\n| Name | 2 |',plan=project({text:table+'\n\nBetween\n\n'+second});
 assert.deepEqual(contents(plan),[{kind:'table',text:table},{kind:'prose',text:'Between'},{kind:'table',text:second}]);
 assert.deepEqual(plan.runs.filter(r=>r.kind==='table').map(r=>r.tableVariant.hasRowHeaders),[false,true]);assert.equal(new Set(plan.runs.map(r=>r.key)).size,3);
});

test('source bullet normalization is derived view text while original input stays unchanged',()=>{
 const source='• item\n\n'+table,message=raw({text:source});deepFreeze(message);
 const plan=projectChatContent(normalizeEntry(message,{conversationId:'conversation-A'}),baseContext());assert.equal(plan.mode,'split');
 assert.equal(contents(plan)[0].text,'- item');assert.equal(message.text,source);
});

for(const [name,source,variant] of [
 ['row headers and compact delimiter','| | Count |\n| - | - |\n| Name | 2 |',{hasRowHeaders:true,hasColumnRules:false}],
 ['ordinary headers and longer rules','| Name | Count |\n| --- | ---: |\n| A | 2 |',{hasRowHeaders:false,hasColumnRules:true}],
])test(`context table variant preserves ${name}`,()=>{
 const plan=project({text:source});assert.equal(plan.mode,'split');assert.equal(plan.runs.length,1);assert.equal(plan.runs[0].kind,'table');assert.deepEqual(plan.runs[0].tableVariant,variant);
});

for(const [name,tail] of [['candidate header','| Incomplete | Header |'],['candidate delimiter','| Incomplete | Header |\n| --']])
test(`streaming withholds only the trailing ${name}; stable text remains readable`,()=>{
 const input='Earlier prose\n\n'+tail;
 const live=project({text:input,transcript:{...raw().transcript,status:'streaming'}},{work:{isStreaming:true,isStable:false}});
 assert.equal(live.mode,'split');assert.deepEqual(contents(live),[{kind:'prose',text:'Earlier prose'}]);assert.equal(live.runs[0].isStreaming,true);
 const final=project({text:input});assert.equal(final.mode,'whole');assert.equal(final.source.slice(final.runs[0].start,final.runs[0].end),input);
});

test('streaming candidate-only input yields a bounded empty prose run instead of a fake table',()=>{
 const plan=project({text:'| A | B |',transcript:{...raw().transcript,status:'streaming'}},{work:{isStreaming:true,isStable:false}});
 assert.equal(plan.mode,'split');assert.deepEqual(contents(plan),[{kind:'prose',text:''}]);assert.equal(plan.runs[0].isStreaming,true);
});

for(const [name,source,kinds] of [['prose last',text,['prose','table','prose']],['table last','Before\n\n'+table,['prose','table']],['table only',table,['table']]])
test(`only final ${name} run is live and continuation belongs only to edge prose`,()=>{
 const plan=project({text:source,transcript:{...raw().transcript,status:'streaming'}},{work:{isStreaming:true,isStable:false}});
 assert.equal(plan.mode,'split');assert.deepEqual(plan.runs.map(r=>r.kind),kinds);
 assert.deepEqual(plan.runs.map(r=>r.isStreaming),kinds.map((_,i)=>i===kinds.length-1));
 const expected=kinds.map((kind,i)=>kind==='prose'?{isGroupStart:i===0,isContinuedFromPrev:i===0,isContinuedToNext:i===kinds.length-1}:undefined);
 assert.deepEqual(plan.runs.map(r=>r.adjacency),expected);
});

test('real work completion ends visual streaming even while durable final entry status stays streaming',()=>{
 const plan=project({transcript:{...raw().transcript,status:'streaming'}},{work:{isStreaming:false,isStable:true}});
 assert.equal(plan.mode,'split');assert.deepEqual(plan.runs.map(r=>r.isStreaming),[false,false,false]);
});

test('changed final prose preserves prior run keys; same-length correction is not mistaken for identical source',()=>{
 const first=project(),longer=project({text:text+' additional work'}),corrected=project({text:text.replace('Daarna','Andere')});
 assert.equal(longer.runs[0].key,first.runs[0].key);assert.equal(longer.runs[1].key,first.runs[1].key);
 assert.equal(contents(corrected).at(-1).text,'Andere');assert.equal(contents(first).at(-1).text,'Daarna');assert.equal(corrected.source.length,first.source.length);
});

test('pure projection cannot manufacture clipboard work delivery receipt or executable actions',()=>{
 const normalized=deepFreeze(entry()),context=deepFreeze(baseContext()),before=structuredClone(normalized);
 const plan=projectChatContent(normalized,context);assert.deepEqual(normalized,before);
 assert.equal(Object.hasOwn(plan,'delivery'),false);assert.equal(Object.hasOwn(plan,'execute'),false);assert.equal(Object.hasOwn(plan,'onCopy'),false);
 assert.equal(plan.runs.every(r=>typeof r.key==='string'&&r.key.length>0),true);
});

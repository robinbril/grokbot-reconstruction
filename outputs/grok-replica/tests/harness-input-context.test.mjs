// Historical protocol adapter coverage, not current product-provider execution.
// Actual production HTTP -> runtime -> native turn/start wire capture.
// The explicit CLI protocol fixture does not establish installed-model execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startLegacyHarness as startHarness} from './fixtures/legacy-runtime.mjs';

const binary=fileURLToPath(new URL('./fixtures/harness-input-codex-fixture.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const request=(client,id,body)=>client.request('/conversations/'+id+'/runs',{method:'POST',body});
const rendered=body=>body.text+(body.quote?'\n\nQuoted context:\n'+body.quote:'')+(body.skillReferences?.length?'\n\nExplicit skill references:\n'+JSON.stringify(body.skillReferences):'');
async function setup(t){const app=await startHarness({codexBinary:binary});t.after(()=>app.close());return {app,client:await app.client()};}
async function acceptedTurn(app,client,id,body){
 assert.ok(Buffer.byteLength(JSON.stringify(body),'utf8')<=131072,'positive context fits the existing HTTP body limit');
 const accepted=await request(client,id,body);assert.equal(accepted.status,202,JSON.stringify(accepted.value));
 const connection=app.handler.runtime.connections.get(id);assert.ok(connection);
 const captured=await connection.rpc.request('test/input/wait',{count:1},6000);assert.equal(captured.turns.length,1);
 const turn=captured.turns[0];assert.equal(turn.threadId,connection.threadId);assert.equal(turn.input.length,1);assert.equal(turn.input[0].type,'text');
 return {accepted,connection,text:turn.input[0].text};
}
function assertComplete(actual,expected){assert.equal(actual.length,expected.length,'all accepted input characters must reach turn/start');assert.equal(sha(actual),sha(expected),'turn/start must receive the exact accepted text and explicit context in order');}

test('all twenty accepted long skill references, including the final reference tail, reach native turn/start intact',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='context-twenty';
 const refs=Array.from({length:20},(_,index)=>{const start='REF_'+String(index).padStart(2,'0')+'_BEGIN|',end='|REF_'+String(index).padStart(2,'0')+'_TAIL';return start+String.fromCharCode(65+index).repeat(1925-start.length-end.length)+end;});
 assert.ok(refs.every(reference=>reference.length===1925));
 const body={requestId:randomUUID(),text:'FIXTURE_DEFER: preserve all explicit references',skillReferences:refs};
 const {text}=await acceptedTurn(app,client,id,body);assertComplete(text,rendered(body));
 for(const reference of refs)assert.ok(text.includes(reference),'each complete accepted reference must remain present');
 assert.ok(text.endsWith(JSON.stringify(refs).slice(-100)),'the final accepted reference tail must remain present');
 assert.equal(text.includes('[output truncated]'),false,'accepted model context must not contain an injected truncation marker');
});

test('an accepted quote longer than ten thousand characters reaches native turn/start through its final tail',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='context-long-quote';
 const quote='QUOTE_BEGIN|'+('quoted context '.repeat(1100))+'|QUOTE_FINAL_TAIL';assert.ok(quote.length>10000);
 const body={requestId:randomUUID(),text:'FIXTURE_DEFER: retain the accepted quote',quote};
 const {text}=await acceptedTurn(app,client,id,body);assertComplete(text,rendered(body));assert.ok(text.endsWith('|QUOTE_FINAL_TAIL'));
});

test('combined accepted Unicode text, long quote and ordered references survive exact idempotent retry with one native turn',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='context-unicode';
 const body={requestId:randomUUID(),text:'FIXTURE_DEFER\nTEXT café Ελληνικά 日本語 🌍\nEND_TEXT',quote:'QUOTE_BEGIN|'+('引用Ω'.repeat(4000))+'|QUOTE_END_🧭',skillReferences:Array.from({length:20},(_,index)=>'SKILL_'+index+'_BEGIN|'+('κ😀'.repeat(600))+'|SKILL_'+index+'_END_終')};
 assert.ok(body.skillReferences.every(reference=>reference.length<=2000));
 const {accepted,connection,text}=await acceptedTurn(app,client,id,body);assertComplete(text,rendered(body));
 assert.ok(text.indexOf('END_TEXT')<text.indexOf('QUOTE_BEGIN|'));assert.ok(text.indexOf('|QUOTE_END_🧭')<text.indexOf('SKILL_0_BEGIN|'));
 const replay=await request(client,id,structuredClone(body));assert.equal(replay.status,202);assert.equal(replay.value.runId,accepted.value.runId);assert.equal(replay.value.inputEntryId,accepted.value.inputEntryId);
 const changed=structuredClone(body);changed.skillReferences[19]+=' DIFFERENT_FINAL_TAIL';
 const conflict=await request(client,id,changed);assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
 const captured=await connection.rpc.request('test/input/captured',{},6000);assert.equal(captured.turns.length,1,'retry and tail conflict must never dispatch another native turn');
 assertComplete(captured.turns[0].input[0].text,rendered(body));
 const snapshot=(await client.request('/conversations/'+id)).value;assert.equal(snapshot.runs.length,1);assert.equal(snapshot.entries.filter(entry=>entry.role==='user').length,1);assert.equal(snapshot.entries.find(entry=>entry.role==='user').text,body.text);
});

test('an oversized HTTP context body is refused before a child, run or native dispatch exists',{timeout:15000},async t=>{
 const {app,client}=await setup(t),id='context-body-too-large',body={requestId:randomUUID(),text:'Valid user text',quote:'Q'.repeat(132000)};
 assert.ok(Buffer.byteLength(JSON.stringify(body),'utf8')>131072);
 const result=await request(client,id,body);assert.equal(result.status,413);assert.equal(result.value.error.code,'BODY_TOO_LARGE');
 assert.equal(app.handler.runtime.connections.size,0);assert.equal(app.handler.runtime.connecting.size,0);assert.equal(app.handler.runtime.bridges.size,0);assert.equal(app.handler.store.states.has(id),false);
});

test('existing text and reference field limits reject oversized context before native dispatch',{timeout:15000},async t=>{
 const {app,client}=await setup(t),cases=[{text:'x'.repeat(32769)},{text:'Valid text',skillReferences:Array(21).fill('reference')},{text:'Valid text',skillReferences:['x'.repeat(2001)]}];
 for(let index=0;index<cases.length;index++){
  const id='context-invalid-'+index,result=await request(client,id,{requestId:randomUUID(),...cases[index]});assert.equal(result.status,422);assert.equal(result.value.error.code,index===0?'INVALID_TEXT':'INVALID_CONTEXT');assert.equal(app.handler.store.states.has(id),false);
 }
 assert.equal(app.handler.runtime.connections.size,0);assert.equal(app.handler.runtime.connecting.size,0);assert.equal(app.handler.runtime.bridges.size,0);
});

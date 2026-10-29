import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SkillRegistry} from '../harness/skills.mjs';
import {startHarness} from './fixtures/harness-http.mjs';
const item=(name='Imported',content='Exact imported instructions')=>({name,description:'Imported summary',content});
const input=(requestId='batch')=>({requestId,skills:[item('First'),item('Second','Second body')]});
const code=value=>error=>error.code===value;
async function setup(limits={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-skill-import-'));
 return {dataDir,skills:await new SkillRegistry({dataDir,limits}).init()};
}

test('atomic import publishes every immutable skill and owner-scoped receipt across restart',async()=>{
 const {dataDir,skills}=await setup(),request=input(),receipt=await skills.import('owner',request);
 assert.equal(receipt.schema,1);assert.equal(receipt.skills.length,2);
 assert.deepEqual(receipt.skills.map(skill=>[skill.name,skill.content,skill.revision]),[['First','Exact imported instructions',1],['Second','Second body',1]]);
 assert.equal(new Set(receipt.skills.map(skill=>skill.id)).size,2);
 assert.deepEqual(skills.list('other').skills,[]);
 for(const skill of receipt.skills)assert.throws(()=>skills.resolve('other',[{id:skill.id,revision:1}]),code('SKILL_NOT_FOUND'));
 const reopened=await new SkillRegistry({dataDir}).init();
 assert.deepEqual(await reopened.import('owner',request),receipt);
 assert.deepEqual(reopened.list('owner').skills,receipt.skills);
 await assert.rejects(reopened.import('owner',{...request,skills:[item('Changed')]}),code('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(reopened.create('owner',{requestId:request.requestId,...item('Conflicting route')}),code('IDEMPOTENCY_CONFLICT'));
});

test('an invalid later item never persists a valid prefix or a receipt',async()=>{
 const {dataDir,skills}=await setup();
 await skills.create('owner',{requestId:'existing',...item('Existing')});
 const before=await readFile(path.join(dataDir,'skills','registry.json'),'utf8');
 for(const invalid of [{...item(),content:''},{...item(),owner:'other'},{...item(),name:'\nInvalid'},{...item(),content:'x'.repeat(32769)}]){
  await assert.rejects(skills.import('owner',{requestId:'invalid',skills:[item('Valid prefix'),invalid]}),code('INVALID_SKILL'));
  assert.equal(await readFile(path.join(dataDir,'skills','registry.json'),'utf8'),before);
 }
 for(const invalid of [[],Array.from({length:251},()=>item()),null])await assert.rejects(skills.import('owner',{requestId:'invalid',skills:invalid}),code('INVALID_SKILL_IMPORT'));
 for(const invalid of [{...input(),extra:true},{...input(),requestId:'../escape'}])await assert.rejects(skills.import('owner',invalid),code('INVALID_SKILL_IMPORT'));
 assert.equal((await skills.import('owner',input('invalid'))).skills.length,2,'rejected input does not consume a request identity');
});

test('batch quotas reject all items, and the original receipt replays at capacity',async()=>{
 const {skills}=await setup({revisions:2,bytes:100000,receipts:1}),request=input(),receipt=await skills.import('owner',request);
 assert.deepEqual(await skills.import('owner',request),receipt);
 await assert.rejects(skills.import('owner',input('full')),code('SKILL_CAPACITY'));
 assert.equal(skills.list('owner').skills.length,2);
 for(const limits of [{revisions:1},{bytes:100},{receipts:0}]){
  const {skills:small}=await setup(limits);
  await assert.rejects(small.import('owner',input()),code('SKILL_CAPACITY'));
  assert.deepEqual(small.list('owner').skills,[]);
 }
});

test('simultaneous duplicate imports coalesce while quota competition has no partial loser',async()=>{
 const {skills}=await setup({revisions:3}),request=input();
 const duplicated=await Promise.all([skills.import('owner',request),skills.import('owner',request)]);
 assert.deepEqual(duplicated[0],duplicated[1]);assert.equal(skills.list('owner').skills.length,2);
 const competing=await Promise.allSettled(['one','two'].map(requestId=>skills.import('owner',{requestId,skills:[item(requestId)]})));
 assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(competing.find(result=>result.status==='rejected').reason.code,'SKILL_CAPACITY');
 assert.equal(skills.list('owner').skills.length,3);
});

test('HTTP import requires CSRF, preserves existing body limits and accepts bounded larger batches',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),other=await app.client();
 const unauthorized=await client.request('/skills/import',{method:'POST',headers:{'x-harness-csrf':'invalid'},body:input()});
 assert.equal(unauthorized.status,403);assert.equal(unauthorized.value.error.code,'INVALID_CSRF');
 const large={requestId:'large',skills:Array.from({length:3},(_,i)=>item('Large '+i,'漢'.repeat(30000)))};
 const imported=await client.request('/skills/import',{method:'POST',body:large});
 assert.equal(imported.status,201,JSON.stringify(imported.value));assert.equal(imported.value.skills.length,3);
 assert.deepEqual((await client.request('/skills/import',{method:'POST',body:large})).value,imported.value);
 assert.deepEqual((await other.request('/skills')).value.skills,[]);
 const first=imported.value.skills[0],upsert={requestId:'http-upsert',skills:[{...item(first.name,'HTTP V2'),id:first.id,expectedRevision:1},item('HTTP New')]};
 const foreign=await other.request('/skills/import',{method:'POST',body:upsert});
 assert.equal(foreign.status,404);assert.equal(foreign.value.error.code,'SKILL_NOT_FOUND');
 assert.deepEqual((await other.request('/skills')).value.skills,[]);
 const updated=await client.request('/skills/import',{method:'POST',body:upsert});
 assert.equal(updated.status,201);assert.equal(updated.value.skills[0].revision,2);assert.equal(updated.value.skills[0].id,first.id);
 const stale=await client.request('/skills/import',{method:'POST',body:{...upsert,requestId:'http-stale'}});
 assert.equal(stale.status,409);assert.equal(stale.value.error.code,'SKILL_REVISION_CONFLICT');
 const oldLimit=await client.request('/skills',{method:'POST',body:{requestId:'oldlimit',...item('Original limit','漢'.repeat(50000))}});
 assert.equal(oldLimit.status,413);assert.equal(oldLimit.value.error.code,'BODY_TOO_LARGE');
 const oversized=await client.request('/skills/import',{method:'POST',body:{requestId:'oversized',skills:[item('Too big','x'.repeat(8*1024*1024))]}});
 assert.equal(oversized.status,413);assert.equal(oversized.value.error.code,'BODY_TOO_LARGE');
 assert.equal((await client.request('/skills')).value.skills.length,4);
});


test('explicit owned upserts preserve history, reject stale or foreign IDs and replay original batch versions',async()=>{
 const {skills}=await setup(),original=(await skills.create('owner',{requestId:'seed',...item('Existing','V1')})).skill;
 const request={requestId:'upsert',skills:[{...item('Existing','V2'),id:original.id,expectedRevision:1},item('New')]};
 const receipt=await skills.import('owner',request);
 assert.equal(receipt.skills[0].id,original.id);assert.equal(receipt.skills[0].revision,2);
 assert.equal(receipt.skills[0].createdAt,original.createdAt);
 assert.equal(skills.resolve('owner',[{id:original.id,revision:1}])[0].content,'V1');
 const current=skills.list('owner');
 await assert.rejects(skills.import('owner',{...request,requestId:'stale'}),code('SKILL_REVISION_CONFLICT'));
 await assert.rejects(skills.import('other',request),code('SKILL_NOT_FOUND'));
 await assert.rejects(skills.import('owner',{requestId:'duplicate',skills:[request.skills[0],request.skills[0]]}),code('INVALID_SKILL_IMPORT'));
 for(const invalid of [{...item(),id:original.id},{...item(),expectedRevision:1},{...item(),id:null,expectedRevision:1}])await assert.rejects(skills.import('owner',{requestId:'bad-update',skills:[invalid]}),code('INVALID_SKILL'));
 assert.deepEqual(skills.list('owner'),current);assert.deepEqual(skills.list('other').skills,[]);
 await skills.update('owner',original.id,{requestId:'later',...item('Existing','V3'),expectedRevision:2});
 assert.deepEqual(await skills.import('owner',request),receipt);
 assert.equal(skills.list('owner').skills.find(skill=>skill.id===original.id).revision,3);
});

test('import and editor updates serialize the same expected-revision contract without partial prefix',async()=>{
 const {skills}=await setup(),original=(await skills.create('owner',{requestId:'seed',...item()})).skill;
 const results=await Promise.allSettled([
  skills.import('owner',{requestId:'import',skills:[item('New prefix'),{...item('Imported edit'),id:original.id,expectedRevision:1}]}),
  skills.update('owner',original.id,{requestId:'editor',...item('Editor edit'),expectedRevision:1})
 ]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'SKILL_REVISION_CONFLICT');
 const latest=skills.list('owner').skills.find(skill=>skill.id===original.id);
 assert.equal(latest.revision,2);
 assert.equal(skills.resolve('owner',[{id:original.id,revision:1}])[0].content,'Exact imported instructions');
 assert.equal(skills.list('owner').skills.length,results[0].status==='fulfilled'?2:1);
});

test('a post-rename directory sync failure keeps the whole batch closed until retry confirms its receipt',async()=>{
 const {dataDir,skills}=await setup(),sync=skills.ensureDirectorySync.bind(skills);let fail=true;
 skills.ensureDirectorySync=async()=>{if(skills.pendingDirectorySync&&fail){fail=false;throw Object.assign(Error('Injected directory-sync failure'),{code:'EIO'});}return sync();};
 const request=input();await assert.rejects(skills.import('owner',request),{code:'EIO'});
 assert.throws(()=>skills.list('owner'),code('SKILLS_PERSISTENCE_UNCERTAIN'));
 const disk=JSON.parse(await readFile(path.join(dataDir,'skills','registry.json'),'utf8')),actor=Object.values(disk.owners)[0];
 assert.equal(Object.keys(actor.skills).length,2);assert.equal(Object.keys(actor.requests).length,1);
 const receipt=await skills.import('owner',request);
 assert.deepEqual(receipt.skills,skills.list('owner').skills);
 assert.equal(Object.keys(skills.data.owners[Object.keys(skills.data.owners)[0]].requests).length,1);
 const reopened=await new SkillRegistry({dataDir}).init();assert.deepEqual(await reopened.import('owner',request),receipt);
});

test('accepted batch input and request identity are snapshotted before serialized work starts',async()=>{
 const {skills}=await setup(),request=input('original');let release;
 skills.tail=new Promise(resolve=>{release=resolve;});
 const saved=skills.import('owner',request);
 request.requestId='mutated';request.skills[0].content='Mutated after call';request.skills.push(item('Mutated list'));
 release();const receipt=await saved;
 assert.equal(receipt.skills.length,2);assert.equal(receipt.skills[0].content,'Exact imported instructions');
 assert.deepEqual(await skills.import('owner',input('original')),receipt);
});


test('the source-derived 250 batch bound is not misapplied as a global owner skill limit',async()=>{
 const {skills}=await setup(),request={requestId:'full-batch',skills:Array.from({length:250},(_,i)=>item('Skill '+i))};
 const receipt=await skills.import('owner',request);assert.equal(receipt.skills.length,250);
 const next=await skills.import('owner',{requestId:'next-batch',skills:[item('One more')]});
 assert.equal(next.skills.length,1);assert.equal(skills.list('owner').skills.length,251);
});

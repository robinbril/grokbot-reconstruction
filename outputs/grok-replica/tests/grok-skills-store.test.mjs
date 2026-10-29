import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const input=(requestId='create')=>({requestId,name:'Review',description:'Separate description',content:'User instruction body'});
const code=value=>e=>e.code===value;
async function setup(options={}){const {SkillRegistry}=await import('../harness/skills.mjs');const dataDir=await mkdtemp(path.join(tmpdir(),'grok-skills-'));return {dataDir,SkillRegistry,skills:await new SkillRegistry({dataDir,...options}).init()};}
test('owner-scoped retained revisions and original receipts survive restart and later edits',async()=>{
 const {skills,dataDir,SkillRegistry}=await setup();const first=await skills.create('a',input());assert.equal(first.schema,1);assert.equal(first.skill.revision,1);
 const id=first.skill.id;assert.match(id,/^[a-f0-9-]{36}$/);assert.deepEqual(skills.list('b'),{schema:1,skills:[]});
 assert.throws(()=>skills.resolve('b',[{id,revision:1}]),code('SKILL_NOT_FOUND'));
 const edit={...input('edit'),expectedRevision:1,content:'Updated body'};const second=await skills.update('a',id,edit);assert.equal(second.skill.revision,2);
 assert.equal(skills.resolve('a',[{id,revision:1}])[0].content,'User instruction body');
 const reopened=await new SkillRegistry({dataDir}).init();assert.deepEqual(await reopened.create('a',input()),first);assert.deepEqual(await reopened.update('a',id,edit),second);
 assert.deepEqual(reopened.list('a').skills,[second.skill]);await assert.rejects(reopened.update('a',id,{...edit,requestId:'stale'}),code('SKILL_REVISION_CONFLICT'));
 await assert.rejects(reopened.create('a',{...input(),content:'changed'}),code('IDEMPOTENCY_CONFLICT'));
});
test('serialized simultaneous updates permit one revision and capacity includes retained versions',async()=>{
 const {skills}=await setup({limits:{revisions:2,bytes:100000,receipts:10}}),first=(await skills.create('a',input())).skill;
 const results=await Promise.allSettled(['x','y'].map(requestId=>skills.update('a',first.id,{...input(requestId),expectedRevision:1})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'SKILL_REVISION_CONFLICT');
 await assert.rejects(skills.update('a',first.id,{...input('third'),expectedRevision:2}),code('SKILL_CAPACITY'));assert.equal(skills.resolve('a',[{id:first.id,revision:1}]).length,1);
});
test('bounded exact input and immutable reference validation rejects substitutions',async()=>{
 const {skills}=await setup();for(const extra of [{name:''},{name:'x'.repeat(101)},{description:'x'.repeat(2001)},{content:''},{content:'x'.repeat(32769)},{owner:'other'},{requestId:'../x'}])await assert.rejects(skills.create('a',{...input(),...extra}));
 const skill=(await skills.create('a',input())).skill;for(const refs of [[{id:skill.id,revision:0}],[{id:skill.id,revision:1,content:'forged'}],[{id:skill.id,revision:1},{id:skill.id,revision:1}],Array(21).fill({id:skill.id,revision:1})])assert.throws(()=>skills.resolve('a',refs),code('INVALID_SKILL_REFS'));
 assert.throws(()=>skills.resolve('a',[{id:skill.id,revision:999}]),code('SKILL_NOT_FOUND'));
});
test('receipt and byte quotas reject explicitly, preserve history and permit exact replay at capacity',async()=>{
 const {skills}=await setup({limits:{revisions:100,bytes:100000,receipts:1}}),request=input(),first=await skills.create('a',request);
 assert.deepEqual(await skills.create('a',request),first);await assert.rejects(skills.create('a',input('overflow')),code('SKILL_CAPACITY'));assert.equal(skills.list('a').skills.length,1);
 const {skills:tiny}=await setup({limits:{bytes:10}});await assert.rejects(tiny.create('a',input()),code('SKILL_CAPACITY'));assert.equal(tiny.list('a').skills.length,0);
 const same=await Promise.all([skills.create('a',request),skills.create('a',request)]);assert.deepEqual(same,[first,first]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../composer-draft-retention.js');
test('volatile retention publishes exact rich draft only in memory and tracks each conversation independently',async()=>{
 const {createComposerDraftRetention,withComposerDraft}=await load(),pending=createComposerDraftRetention();
 const original={version:1,drafts:{a:'Old',b:'Other'},draftRichTexts:{a:'old-doc'},composerSkillReferences:{a:[]},messages:{}};
 const latest={text:'  Latest exact  ',richText:'new-doc',references:[{id:'skill',revision:1}]};
 const memory=pending.retain(original,'a',latest);
 assert.deepEqual(memory,withComposerDraft(original,'a',latest));assert.equal(original.drafts.a,'Old');assert.equal(memory.drafts.a,latest.text);
 assert.deepEqual(memory.composerSkillReferences.a,latest.references);assert.equal(memory.draftRichTexts.a,latest.richText);assert.equal(memory.drafts.b,'Other');
 assert.equal(pending.has('a'),true);assert.equal(pending.has('b'),false);
 latest.references[0].revision=99;assert.equal(memory.composerSkillReferences.a[0].revision,1);
 pending.saved();assert.equal(pending.has('a'),false);
});
test('a plain snapshot removes stale rich data and retains exact empty text without touching other drafts',async()=>{
 const {withComposerDraft}=await load();const original={drafts:{a:'Before',b:'Other'},draftRichTexts:{a:'old',b:'keep'},composerSkillReferences:{a:[{id:'old'}]}};
 const result=withComposerDraft(original,'a',{text:'',references:[]});assert.equal(result.drafts.a,'');assert.equal(Object.hasOwn(result.draftRichTexts,'a'),false);assert.equal(result.draftRichTexts.b,'keep');assert.deepEqual(result.composerSkillReferences.a,[]);assert.equal(original.draftRichTexts.a,'old');
});

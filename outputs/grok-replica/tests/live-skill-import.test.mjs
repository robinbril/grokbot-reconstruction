import test from 'node:test';
import assert from 'node:assert/strict';
import {skillsMarkup} from '../live-skills-view.js';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('real skill manager exposes separate multiple-file and folder inputs without replacing a manual draft',()=>{
 const html=skillsMarkup({esc,skills:[],draft:{name:'Manual draft',description:'Keep',content:'Keep exact body'},importState:{}});
 assert.match(html,/data-skill-import-files/);assert.match(html,/data-skill-import-folder/);assert.match(html,/webkitdirectory/);assert.match(html,/multiple/);assert.match(html,/Manual draft/);assert.match(html,/Keep exact body/);
});

import {createSkillImportController} from '../live-skill-import.js';
const firstId='11111111-1111-4111-8111-111111111111';
const secondId='22222222-2222-4222-8222-222222222222';
const file=(path,content)=>({path,file:{size:Buffer.byteLength(content),arrayBuffer:async()=>new TextEncoder().encode(content).buffer}});
const existing={id:firstId,revision:3,name:'exact',description:'Old',content:'---\nname: Exact\n---\n\nOld instructions'};
function receiptFor(payload){return {schema:1,skills:payload.skills.map((input,index)=>({id:input.id??(index?secondId:firstId),revision:(input.expectedRevision??0)+1,name:input.name,description:input.description,content:input.content,createdAt:'2026-10-21T00:00:00.000Z',updatedAt:'2026-10-21T00:00:00.000Z'}))};}
test('native-planned exact upsert and collision suffix bind actual owned revisions only after confirm',async()=>{
 const requests=[],published=[];
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[existing]}),importSkills:async input=>{requests.push(input);return receiptFor(input);}},onImported:skills=>published.push(skills)});
 await controller.prepare([file('one/SKILL.md','---\nname: Exact\ndescription: Precise\n---\n\nNew one'),file('two/SKILL.md','---\nname: Exact\n---\n\nNew two')]);
 const batch=controller.state().preview.payload;assert.equal(batch.skills.length,2);assert.equal(batch.skills[0].id,firstId);assert.equal(batch.skills[0].expectedRevision,3);assert.equal(batch.skills[1].name,'exact-2');assert.equal(batch.skills[1].id,undefined);assert.equal(requests.length,0);assert.equal(published.length,0);
 assert.equal(await controller.submit(),true);assert.equal(requests.length,1);assert.equal(published[0][0].revision,4);assert.equal(published[0][1].revision,1);assert.equal(controller.state().preview,null);assert.equal(controller.state().status,'2 skills geïmporteerd.');
});
test('lost receipt retry coalesces and keeps immutable exact request with no invented saved state',async()=>{
 let fail=true,release;const gate=new Promise(resolve=>{release=resolve;}),requests=[],published=[];
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[]}),importSkills:async input=>{requests.push(structuredClone(input));await gate;if(fail)throw Error('Lost ACK');return receiptFor(input);}},onImported:skills=>published.push(skills)});
 await controller.prepare([file('proof.md','# Proof\nExact frozen body')]);
 const original=controller.state().preview.payload;const leaked=controller.state();leaked.preview.payload.skills[0].content='Injected';
 const one=controller.submit(),two=controller.submit();assert.equal(one,two);release();assert.equal(await one,false);assert.equal(published.length,0);assert.deepEqual(controller.state().preview.payload,original);
 fail=false;assert.equal(await controller.submit(),true);assert.deepEqual(requests,[original,original]);assert.equal(published.length,1);
});
test('local storage bounds reject before submission without truncating or hiding rejected file',async()=>{
 let writes=0;
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[]}),importSkills:async()=>{writes++;}}});
 assert.equal(await controller.prepare([file('oversized.md','x'.repeat(32768))]),false);
 assert.match(controller.state().error.message,/32768/);assert.equal(controller.state().preview,null);assert.equal(await controller.submit(),false);assert.equal(writes,0);
});
test('malformed confirmation cannot consume staged batch or project saved success',async()=>{
 let published=0;
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[]}),importSkills:async()=>({schema:1,skills:[]})},onImported:()=>{published++;}});
 await controller.prepare([file('proof.md','Body')]);const exact=controller.state().preview.payload;
 assert.equal(await controller.submit(),false);assert.equal(published,0);assert.deepEqual(controller.state().preview.payload,exact);assert.equal(controller.state().status,'');
});
test('file and read failures retain manual control and destroyed controller never publishes an import',async()=>{
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[]}),importSkills:async()=>{throw Error('Unexpected');}}});
 await controller.prepare([file('image.png','fake'),file('empty.md','   ')]);assert.deepEqual(controller.state().preview.skipped.map(item=>item.reason),['unsupported','empty']);assert.equal(controller.state().preview.payload.skills.length,0);assert.equal(await controller.submit(),false);assert.equal(controller.discard(),true);
 let finish;const held=new Promise(resolve=>{finish=resolve;}),changes=[];
 const disposed=createSkillImportController({client:{skills:()=>held},onChange:()=>changes.push('changed')});const preparing=disposed.prepare([file('read.md','Body')]);disposed.destroy();const count=changes.length;finish({schema:1,skills:[]});assert.equal(await preparing,false);assert.equal(changes.length,count);
});
test('ambiguous existing names reject instead of silently binding one owner skill',async()=>{
 let writes=0;
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[existing,{...existing,id:secondId}]}),importSkills:async()=>{writes++;}}});
 assert.equal(await controller.prepare([file('one.md','---\nname: Exact\n---\n\nCannot choose an owner ID')]),false);assert.match(controller.state().error.message,/meerdere/);assert.equal(controller.state().preview,null);assert.equal(writes,0);
});
test('failed replacement files clear an earlier preview so confirmation cannot import the wrong old file',async()=>{
 let writes=0;
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[]}),importSkills:async()=>{writes++;}}});
 assert.equal(await controller.prepare([file('old.md','Old staged body')]),true);
 assert.equal(await controller.prepare([file('bad.md','x'.repeat(32768))]),false);assert.equal(controller.state().preview,null);assert.equal(await controller.submit(),false);assert.equal(writes,0);
});
test('unrelated duplicate local names cannot expand the 250-item import batch limit',async()=>{
 const controller=createSkillImportController({client:{skills:async()=>({schema:1,skills:[existing,{...existing,id:secondId}]})}});
 await controller.prepare(Array.from({length:251},(_,index)=>file(`new-${index}.md`,`Body ${index}`)));
 assert.equal(controller.state().preview.payload.skills.length,250);assert.equal(controller.state().preview.skipped.filter(item=>item.reason==='too-many-skills').length,1);
});

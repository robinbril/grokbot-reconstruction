import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillsController,mergeHarnessSkills} from '../live-skills-controller.js';
import {composerSkillReference,liveSkillPayload} from '../composer-commands.js';
const skill={id:'skill-1',name:'Synthetic',description:'Summary',content:'Instruction body',revision:1};
test('harness reference captures revision and sends only structured version reference',()=>{
 const ref=composerSkillReference({...skill,storage:'harness'});
 assert.deepEqual(ref,{kind:'skill',id:skill.id,label:skill.name,description:skill.description,revision:1});
 assert.deepEqual(liveSkillPayload([ref,{kind:'skill',id:'old',label:'Legacy',description:'Old instructions'}]),{skillRefs:[{id:skill.id,revision:1}],skillReferences:[JSON.stringify({kind:'skill',id:'old',label:'Legacy',description:'Old instructions'},null,2)]});
});
test('canonical refresh replaces stale canonical entries and preserves legacy entries',()=>{
 const old={name:'Local',description:'Local instructions'};
 assert.deepEqual(mergeHarnessSkills([old,{...skill,storage:'harness'}],[{...skill,revision:2}]),[old,{...skill,revision:2,storage:'harness'}]);
});
test('duplicate saves coalesce and retry a lost receipt with stable request ID',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];let fail=true;
 const controller=createSkillsController({client:{createSkill:async payload=>{calls.push(payload);await gate;if(fail)throw new Error('Lost receipt');return {schema:1,skill};}}});
 const first=controller.save(null,skill),second=controller.save(null,skill);assert.equal(first,second);release();await first;
 assert.equal(controller.state().skills.length,0);assert.equal(controller.state().error.message,'Lost receipt');fail=false;await controller.save(null,skill);
 assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(controller.state().skills[0].revision,1);
});
test('stale read cannot replace authoritative save and conflict retains known state',async()=>{
 let read;const waiting=new Promise(resolve=>{read=resolve;});let conflict=false;
 const controller=createSkillsController({client:{skills:()=>waiting,updateSkill:async()=>{if(conflict)throw Object.assign(new Error('Conflict'),{code:'SKILL_REVISION_CONFLICT'});return {schema:1,skill:{...skill,revision:2}};}}});
 const pending=controller.refresh();await controller.save(skill.id,{...skill,expectedRevision:1});read({schema:1,skills:[skill]});await pending;
 assert.equal(controller.state().skills[0].revision,2);conflict=true;await controller.save(skill.id,{...skill,expectedRevision:1});assert.equal(controller.state().error.code,'SKILL_REVISION_CONFLICT');assert.equal(controller.state().skills[0].revision,2);
});

test('a read started during a save cannot roll back its received revision',async()=>{
 let finishSave,finishRead;
 const controller=createSkillsController({client:{skills:()=>new Promise(resolve=>{finishRead=resolve;}),updateSkill:()=>new Promise(resolve=>{finishSave=resolve;})}});
 const save=controller.save(skill.id,{...skill,expectedRevision:1});await Promise.resolve();const read=controller.refresh();
 finishSave({schema:1,skill:{...skill,revision:2}});await save;finishRead({schema:1,skills:[skill]});await read;
 assert.equal(controller.state().skills[0].revision,2);assert.equal(controller.state().loading,false);
});

test('canonical import receipts merge all versions and invalidate an older list response',async()=>{
 let finishRead;const published=[];
 const controller=createSkillsController({client:{skills:()=>new Promise(resolve=>{finishRead=resolve;})},initialSkills:[skill],onRegistry:value=>published.push(value)});
 const pending=controller.refresh(),second={...skill,id:'second',name:'Second'};
 controller.acceptImported([{...skill,revision:2},second]);
 finishRead({schema:1,skills:[skill]});await pending;
 assert.deepEqual(controller.state().skills,[{...skill,revision:2},second]);
 assert.equal(controller.state().loading,false);assert.equal(published.length,1);
 controller.destroy();controller.acceptImported([{...skill,revision:3}]);
 assert.equal(controller.state().skills[0].revision,2);
});

import {skillsMarkup} from '../live-skills-view.js';
test('editor separates description from full instructions and escapes private content',()=>{
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const html=skillsMarkup({esc,skills:[],draft:{...skill,name:'<script>',expectedRevision:1},error:Object.assign(new Error('Conflict'),{code:'SKILL_REVISION_CONFLICT'})});
 assert.match(html,/aria-label="Naam"/);assert.match(html,/aria-label="Beschrijving"/);assert.match(html,/aria-label="Instructies"/);assert.match(html,/Instruction body/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Je concept blijft behouden/);assert.match(html,/Nieuwste versie laden/);
});

import {createLiveSkillsSurface} from '../live-skills-surface.js';
function surfaceFixture({live=true,cache=true,createSkill=async()=>({schema:1,skill})}={}){
 let version=0,html='',surface,fields=[];const state={privateSkills:[{name:'Legacy',description:'Legacy body'}]};
 const root={contains:()=>false,set outerHTML(value){html=value;}};
 const overlay={open:false,querySelector:selector=>selector==='[data-live-skills-root]'?root:null,querySelectorAll:()=>fields};
 const host={esc:String,overlay,getState:()=>state,getDialogVersion:()=>version,closePopover(){},commit(update){if(!cache)return {ok:false};Object.assign(state,update(state));return {ok:true};},showDialog(kind,label,content){surface.beforeDialogChange();version++;overlay.open=true;html=content;}};
 surface=createLiveSkillsSurface({host,isLive:()=>live,client:{skills:async()=>({schema:1,skills:[skill]}),createSkill}});
 return {surface,state,html:()=>html,setFields(values){fields=Object.entries(values).map(([name,value])=>({dataset:{skillField:name},value}));}};
}
test('live editor retains failed input and retries identical save; cache failure cannot invent an unsaved success',async()=>{
 const previous=globalThis.document;globalThis.document={activeElement:null};let fail=true;const requests=[];
 const f=surfaceFixture({cache:false,createSkill:async payload=>{requests.push(payload);if(fail)throw new Error('Offline');return {schema:1,skill};}});
 try{
  f.surface.handleAction({action:'skill-new'});f.setFields({name:skill.name,description:skill.description,content:skill.content});
  await f.surface.handleAction({action:'live-skill-save'});assert.match(f.html(),/Offline/);assert.match(f.html(),/Instruction body/);assert.doesNotMatch(f.html(),/De harness heeft de skills bewaard/);
  fail=false;await f.surface.handleAction({action:'live-skill-save'});assert.equal(requests[0].requestId,requests[1].requestId);assert.match(f.html(),/De harness heeft de skills bewaard/);assert.match(f.html(),/browsercache kon niet/);assert.equal(f.state.privateSkills.at(-1).storage,'harness');assert.equal(f.state.privateSkills[0].name,'Legacy');
 }finally{f.surface.destroy();globalThis.document=previous;}
});
test('demo skill creation delegates to original local UI',()=>{
 const f=surfaceFixture({live:false});assert.equal(f.surface.handleAction({action:'skill-new'}),false);assert.equal(f.surface.renderSlot('installedSkillsControls'),undefined);f.surface.destroy();
});

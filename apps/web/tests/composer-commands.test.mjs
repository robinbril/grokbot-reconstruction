import test from 'node:test';
import assert from 'node:assert/strict';
import {composerSlashToken,composerSkillReference,composerSuggestions} from '../composer-commands.js';
import {createSendJournal} from '../send-journal.js';

test('slash trigger is a collapsed whitespace-delimited token and preserves trailing text',()=>{
  const text='Bewaard /donker en verder';
  assert.deepEqual(composerSlashToken(text,15),{start:8,end:15,query:'donker'});
  assert.equal(text.slice(0,8)+text.slice(15),'Bewaard  en verder');
  assert.deepEqual(composerSlashToken('/licht',6),{start:0,end:6,query:'licht'});
  assert.deepEqual(composerSlashToken('regel\n/',7),{start:6,end:7,query:''});
  for(const value of ['https://example.test/route','woord/donker','/eerste/tweede'])assert.equal(composerSlashToken(value,value.length),null);
  assert.equal(composerSlashToken('/donker',2,7),null);
  assert.equal(composerSlashToken('/donker',99),null);
});

test('dynamic references preserve explicit IDs; scheduled skills are omitted',()=>{
  assert.deepEqual(composerSkillReference({id:'s-1',name:'Samenvatten',description:'Kort'}),{kind:'skill',id:'s-1',label:'Samenvatten',description:'Kort'});
  assert.equal(composerSkillReference({name:'Dagelijks',trigger:{schedule:'daily'}}),null);
  assert.equal(composerSkillReference({spec:{name:'Dagelijks',trigger:{isEnabled:false}}}),null);
  assert.equal(composerSkillReference({name:'  '}),null);
  const first=composerSkillReference({name:'Een:vaardigheid',description:'Détail'});
  assert.equal(first.id,composerSkillReference({name:'Een:vaardigheid',description:'Détail'}).id);
  assert.notEqual(first.id,composerSkillReference({name:'Een',description:'vaardigheid:Détail'}).id);
  assert.equal(typeof composerSkillReference({name:'Naam\ud800',description:'Tekst'}).id,'string');
});

test('suggestions reserve three action slots, have at most eight rows and deduplicate IDs',()=>{
  const skills=Array.from({length:10},(_,i)=>({id:`s-${i}`,name:`Vaardigheid ${i}`,description:''}));
  const visible=composerSuggestions([...skills,skills[0]],'');
  assert.equal(visible.length,8);
  assert.equal(visible.filter(row=>row.kind==='skill').length,5);
  assert.equal(visible.filter(row=>row.kind==='action').length,3);
  assert.equal(new Set(visible.map(row=>row.key)).size,8);
  assert.equal(composerSuggestions(skills,'',{actions:false}).length,8);
});

test('legacy skill IDs remain bounded for send journal with long instructions',()=>{
  const skill={name:'Weekoverzicht',description:'Plan en controleer zorgvuldig. '.repeat(130).slice(0,4000)};
  const ref=composerSkillReference(skill);
  assert.ok(ref.id.length<=256);
  assert.equal(ref.id,composerSkillReference({...skill}).id);
  assert.notEqual(ref.id,composerSkillReference({...skill,description:`${skill.description.slice(0,-1)}!`}).id);
  assert.equal(ref.description,skill.description);
  let state={version:1,messages:{}},sequence=0;
  const journal=createSendJournal({getState:()=>state,commit:build=>{state=build(state);return {ok:true};},dispatch:async()=>({accepted:true}),newId:()=>`identity-${++sequence}`});
  assert.equal(journal.enqueue({conversationId:'bot',text:'',attachments:[],skillReferences:[ref]}).ok,true);
  assert.equal(state.sendJournal.records[0].snapshot.skillReferences[0].description,skill.description);
  journal.destroy();
});

test('search matches localized labels and action keywords without interpreting slash commands',()=>{
  assert.deepEqual(composerSuggestions([],'donker').map(row=>row.id),['theme:dark']);
  assert.ok(composerSuggestions([],'light').some(row=>row.id==='theme:light'));
  assert.ok(composerSuggestions([],'instellingen').some(row=>row.id==='settings:general'));
  assert.deepEqual(composerSuggestions([{name:'Résumé maken',description:'local'}],'resume',{actions:false}).map(row=>row.label),['Résumé maken']);
  assert.deepEqual(composerSuggestions([],'/queue'),[]);
  assert.deepEqual(composerSuggestions([],'dit-bestaat-niet'),[]);
});

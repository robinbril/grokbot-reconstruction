import test from 'node:test';
import assert from 'node:assert/strict';
import * as commands from '../composer-commands.js';

const skill={id:'stored-skill-7',name:'Daily research brief',description:'Summarize the research.',storage:'harness',revision:3};

function fixture(value,caret=value.length,overrides={}) {
  let state={privateSkills:[skill],drafts:{chat:value},composerSkillReferences:{chat:[]},...overrides};
  const actions=[],attributes=new Map(),listeners=new Map();
  const input={id:'message-input',value,selectionStart:caret,selectionEnd:caret,
    setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key),
    addEventListener:(name,fn)=>listeners.set(name,fn),setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
    focus(){},dispatchEvent(){}};
  const nodes=[];
  const document={addEventListener(){},createElement(){const node={dataset:{},addEventListener(){},setAttribute(){},toggleAttribute(){},querySelectorAll:()=>[],querySelector:()=>null,remove(){this.removed=true;}};nodes.push(node);return node;}};
  const app={ownerDocument:document,querySelector:selector=>selector==='#message-input'?input:selector==='.composer-wrap'?{append(){}}:null};
  const controller=commands.createComposerCommands({app,esc:String,getState:()=>state,getConversationKey:()=> 'chat',commit:build=>{state=build(state);return {ok:true};},runComposerAction:id=>actions.push(id)});
  controller.afterRender();
  const type=()=>controller.handleInput({target:input});
  const key=(key,extra={})=>{let prevented=false;const handled=controller.handleKeyDown({target:input,key,preventDefault(){prevented=true;},stopPropagation(){},...extra});return {handled,prevented};};
  return {controller,input,nodes,actions,type,key,state:()=>state,listeners};
}

test('skill query recognizes both native triggers and spaces at a collapsed caret',()=>{
  assert.equal(typeof commands.composerSkillToken,'function');
  for(const trigger of ['@','/']){
    const text=`Keep ${trigger}Daily research brief after`,caret=text.indexOf(' after');
    assert.deepEqual(commands.composerSkillToken(text,caret),{start:5,end:caret,query:'Daily research brief',trigger});
    assert.equal(commands.composerSkillToken(text,caret-3,caret),null);
  }
});

test('@ multiword selection consumes only the query and stores the exact harness revision',()=>{
  const value='Keep @Daily research brief after',caret=value.indexOf(' after'),f=fixture(value,caret);
  f.type();assert.equal(f.controller.diagnostics().suggestions,1);
  assert.deepEqual(f.key('Enter'),{handled:true,prevented:true});
  assert.equal(f.input.value,'Keep  after');assert.equal(f.input.selectionStart,5);
  assert.equal(f.state().drafts.chat,'Keep  after');
  assert.deepEqual(f.state().composerSkillReferences.chat,[{kind:'skill',id:skill.id,label:skill.name,description:skill.description,revision:3}]);
  assert.deepEqual(f.actions,[]);f.controller.destroy();
});

test('/ multiword search still selects skills and / action search stays available',()=>{
  const f=fixture('/Daily research');f.type();assert.equal(f.controller.diagnostics().suggestions,1);
  f.key('Tab');assert.equal(f.state().composerSkillReferences.chat[0].revision,3);f.controller.destroy();
  const action=fixture('/donker');action.type();action.key('Enter');
  assert.deepEqual(action.actions,['theme:dark']);assert.equal(action.input.value,'');action.controller.destroy();
});

test('both native triggers expose common actions and Escape stays closed until input changes',()=>{
  const f=fixture('@donker');f.type();assert.equal(f.controller.diagnostics().suggestions,1);
  assert.equal(f.key('Enter').handled,true);assert.deepEqual(f.actions,['theme:dark']);
  f.input.value='@Daily research';f.input.selectionStart=f.input.selectionEnd=f.input.value.length;f.type();
  assert.equal(f.controller.diagnostics().suggestions,1);assert.equal(f.key('Escape').handled,true);
  f.type();assert.equal(f.controller.diagnostics().open,false);
  f.input.value+=' brief';f.input.selectionStart=f.input.selectionEnd=f.input.value.length;f.type();
  assert.equal(f.controller.diagnostics().open,true);f.controller.destroy();
});

test('IME keydown and changed query cannot commit a stale selected skill',()=>{
  const f=fixture('@Daily research');f.type();
  assert.equal(f.key('Enter',{isComposing:true}).handled,false);
  assert.equal(f.key('Enter',{keyCode:229}).handled,false);
  f.input.value='@unknown';f.input.selectionStart=f.input.selectionEnd=f.input.value.length;
  f.key('Enter');assert.deepEqual(f.state().composerSkillReferences.chat,[]);
  f.controller.destroy();
});

test('composition closes suggestions and resumes only after composition ends',()=>{
  const f=fixture('@Daily research');f.type();assert.equal(f.controller.diagnostics().open,true);
  f.controller.handleInput({target:f.input,isComposing:true});assert.equal(f.controller.diagnostics().open,false);
  f.listeners.get('compositionend')();assert.equal(f.controller.diagnostics().suggestions,1);
  f.controller.destroy();
});

test('native boundaries reject embedded email and URL triggers but accept parenthesized names',()=>{
  for(const value of ['name@example.test','https://example.test/route','word@Daily','word/Daily','@Daily  research','@Daily\nresearch']){
    assert.equal(commands.composerSkillToken(value,value.length),null,value);
  }
  assert.deepEqual(commands.composerSkillToken('Use (@Daily research',20),{start:5,end:20,query:'Daily research',trigger:'@'});
  assert.equal(commands.composerSkillToken('@'+'a'.repeat(50),51)?.query.length,50);
  assert.equal(commands.composerSkillToken('@'+'a'.repeat(51),52),null);
  assert.equal(commands.composerSkillToken('@Daily',-1),null);
  assert.equal(commands.composerSkillToken('@Daily',7),null);
});

test('native punctuation and absolute paths keep their source matcher behavior',()=>{
  for(const query of ['Daily-research','Daily/research','Daily,research','Daily. research']){
    assert.equal(commands.composerSkillToken('@'+query,query.length+1)?.query,query);
  }
  assert.equal(commands.composerSkillToken('@Daily, research',16),null);
  assert.equal(commands.composerSkillToken('/usr/local',10)?.query,'usr/local');
  assert.equal(commands.composerSlashToken('/usr/local',10),null);
});

test('midword caret consumes the complete matched word and preserves the following suffix',()=>{
  const value='Keep @Daily research brief after',caret=value.indexOf('brief')+2;
  assert.deepEqual(commands.composerSkillToken(value,caret),{start:5,end:value.indexOf(' after'),query:'Daily research brief',trigger:'@'});
  const f=fixture(value,caret);f.type();assert.equal(f.controller.diagnostics().suggestions,1);
  f.key('Tab');assert.equal(f.input.value,'Keep  after');assert.equal(f.input.selectionStart,5);
  assert.equal(f.state().composerSkillReferences.chat[0].revision,3);f.controller.destroy();
});

test('plain suggestion replacement clears only its own rich draft for skills and actions',()=>{
 for(const value of ['@Daily research','/donker']){
  const f=fixture(value,value.length,{draftRichTexts:{chat:'prior document',other:'keep document'}});
  f.type();f.key('Enter');assert.equal(Object.hasOwn(f.state().draftRichTexts,'chat'),false);assert.equal(f.state().draftRichTexts.other,'keep document');f.controller.destroy();
 }
});
test('skill removal downgrades only a mutated current rich draft and leaves no-op removal intact',()=>{
 const selected={kind:'skill',id:skill.id,label:skill.name,description:skill.description,revision:3};
 const f=fixture('unchanged',9,{composerSkillReferences:{chat:[selected]},draftRichTexts:{chat:'prior document',other:'keep document'}});
 f.controller.handleAction({action:'composer-skill-remove',id:'missing'});assert.equal(f.state().draftRichTexts.chat,'prior document');
 f.controller.handleAction({action:'composer-skill-remove',id:skill.id});assert.equal(Object.hasOwn(f.state().draftRichTexts,'chat'),false);assert.equal(f.state().draftRichTexts.other,'keep document');assert.equal(f.state().drafts.chat,'unchanged');f.controller.destroy();
});

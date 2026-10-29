import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLiveConversation,projectLiveMessages} from '../live-harness-model.js';
import {createLiveSkillsSurface} from '../live-skills-surface.js';

test('skill-only accepted messages retain public skill version metadata through projection and reload',()=>{
 const snapshot={...emptyLiveConversation('conversation'),entries:[{id:'user-entry',role:'user',text:'',skills:[{id:'private-skill',revision:2,name:'Synthetic review',description:'Review summary',content:'MUST NOT enter UI reference'}],skillRefs:[{id:'private-skill',revision:2}],revision:1}]};
 const projected=projectLiveMessages(JSON.parse(JSON.stringify(snapshot)));
 assert.deepEqual(projected[0].skillReferences,[{kind:'skill',id:'private-skill',label:'Synthetic review',description:'Review summary',revision:2}]);
 assert.doesNotMatch(JSON.stringify(projected),/MUST NOT/);
});
test('missing or malformed skill metadata does not produce an invented reference',()=>{
 const snapshot={...emptyLiveConversation('conversation'),entries:[{id:'entry',role:'user',text:'',skills:[null,{id:'skill',revision:0,name:'Invalid'},{id:'skill',revision:1}],skillRefs:[{id:'unresolved',revision:1}]}]};
 assert.deepEqual(projectLiveMessages(snapshot)[0].skillReferences,[]);
});

// A minimal DOM boundary: replacing a root disconnects its descendants, so a
// native chooser opened on an old input can no longer bubble to the overlay.
function skillDialog(t){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'document');
 globalThis.document={activeElement:null};
 let version=0,state={privateSkills:[]},root,reads=0,payload,live=true;
 const listeners=new Map(),fields=()=>root?.nodes.filter(node=>node.dataset.skillField)||[];
 function render(content){
  for(const node of root?.nodes||[])node.isConnected=false;
  const nodes=[];
  for(const match of content.matchAll(/<input\b([^>]*)>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)){
   const attrs=match[1]??match[2],body=match[3],field=/data-skill-field="([^"]+)"/.exec(attrs)?.[1];
   const selector=field?`[data-skill-field="${field}"]`:attrs.includes('data-skill-import-files')?'[data-skill-import-files]':attrs.includes('data-skill-import-folder')?'[data-skill-import-folder]':null;
   if(!selector)continue;
   const node={selector,dataset:field?{skillField:field}:{},value:body??/value="([^"]*)"/.exec(attrs)?.[1]??'',files:[],disabled:/\bdisabled\b/.test(attrs),isConnected:true,
    matches:query=>query.split(',').includes(selector),focus(){document.activeElement=this;},setSelectionRange(){},
    replaceWith(original){const index=root.nodes.indexOf(this);this.isConnected=false;root.nodes[index]=original;original.isConnected=true;}};
   nodes.push(node);
  }
  root={content,nodes,contains:node=>nodes.includes(node),querySelector:selector=>nodes.find(node=>node.selector===selector)||null,querySelectorAll:selector=>nodes.filter(node=>selector==='[data-skill-field]'?node.dataset.skillField:selector.split(',').includes(node.selector)),set outerHTML(next){render(next);}};
 }
 const overlay={open:true,querySelector:selector=>selector==='[data-live-skills-root]'?root:root?.querySelector(selector),querySelectorAll:selector=>selector==='[data-skill-field]'?fields():root?.querySelectorAll(selector)||[],
  addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type)};
 const host={overlay,esc:String,getState:()=>state,getDialogVersion:()=>version,closePopover(){},showDialog(_kind,_label,content){surface.beforeDialogChange();version++;render(content);},commit(update){state=update(state);return {ok:true};}};
 const client={async skills(){reads++;return {schema:1,skills:[]};},async importSkills(batch){payload=batch;return {schema:1,skills:batch.skills.map(skill=>({...skill,id:'12345678-1234-4123-8123-123456789abc',revision:1}))};}};
 const surface=createLiveSkillsSurface({host,client,isLive:()=>live});
 t.after(()=>{surface.destroy();if(prior)Object.defineProperty(globalThis,'document',prior);else delete globalThis.document;});
 return {surface,overlay,get root(){return root;},get reads(){return reads;},get payload(){return payload;},
  close(){surface.beforeDialogChange();version++;overlay.open=false;},leaveLive(){live=false;},
  edit(name,value){const input=fields().find(node=>node.dataset.skillField===name);input.value=value;surface.handleInput({target:input});},
  choose(input,text){input.files=[{name:'proof.md',size:text.length,arrayBuffer:async()=>new TextEncoder().encode(text).buffer}];if(input.isConnected)listeners.get('change')?.({target:input});}};
}

test('same-dialog sync retains native chooser identity after manual draft edits',async t=>{
 const e=skillDialog(t);e.surface.handleAction({action:'live-skill-new'});
 const input=e.overlay.querySelector('[data-skill-import-files]'),folder=e.overlay.querySelector('[data-skill-import-folder]');
 e.edit('name','Manual draft');e.edit('content','Manual exact body');
 e.surface.sync();
 assert.equal(e.overlay.querySelector('[data-skill-import-files]'),input,'sync must keep the native chooser target connected');
 assert.equal(e.overlay.querySelector('[data-skill-import-folder]'),folder,'folder chooser has the same lifetime');
 const source='---\nname: Proof\n---\n\nExact chosen bytes 5719';e.choose(input,source);
 assert.equal(input.disabled,true,'preserved native input adopts reading state');
 await new Promise(setImmediate);
 assert.equal(e.reads,1,'original target reaches the delegated import handler once');
 assert.match(e.root.content,/Import controleren/);assert.equal(input.disabled,false);
 assert.equal(e.overlay.querySelector('[data-skill-field="name"]').value,'Manual draft');
 assert.equal(e.overlay.querySelector('[data-skill-field="content"]').value,'Manual exact body');
 await e.surface.handleAction({action:'live-skill-import-confirm'});
 assert.equal(e.payload.skills[0].content,"---\nname: Proof\norigin: upload\nupload-extension: .md\n---\n\nExact chosen bytes 5719");
});

test('opening another dialog disconnects the old native chooser target',async t=>{
 const e=skillDialog(t);e.surface.handleAction({action:'live-skill-new'});
 const old=e.overlay.querySelector('[data-skill-import-files]');
 e.surface.handleAction({action:'live-skill-new'});
 assert.notEqual(e.overlay.querySelector('[data-skill-import-files]'),old,'node preservation must stay within one dialog version');
 e.choose(old,'# Stale file');await new Promise(setImmediate);
 assert.equal(e.reads,0,'an old native chooser cannot prepare an import in the replacement dialog');
 assert.doesNotMatch(e.root.content,/Import controleren/);
});

for(const leave of ['close','leaveLive'])test(`native chooser callback cannot prepare an import after ${leave}`,async t=>{
 const e=skillDialog(t);e.surface.handleAction({action:'live-skill-new'});
 const input=e.overlay.querySelector('[data-skill-import-files]');
 e[leave]();e.choose(input,'# Stale selection');await new Promise(setImmediate);
 assert.equal(e.reads,0,'inactive dialog rejects the callback even while its native input remains mounted');
 assert.doesNotMatch(e.root.content,/Import controleren/);
});

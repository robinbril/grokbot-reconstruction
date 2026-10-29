import test from 'node:test';
import assert from 'node:assert/strict';
import {bindComposerInput,composerText,composerSelection,replaceComposerText,readComposerInput} from '../composer-input.js';
import {createComposerCommands} from '../composer-commands.js';
import {captureInputState,restoreInputState} from '../ui-motion-main-state.js';

const skill={id:'stored-skill',name:'Daily research brief',description:'Synthetic',storage:'harness',revision:3};
function fixture({accept=true}={}){
 let state={privateSkills:[skill],drafts:{chat:'Use @Daily research brief'},draftRichTexts:{chat:'rich'},composerSkillReferences:{chat:[]}},commits=0;
 const attributes=new Map(),calls=[],actions=[];
 const input={id:'message-input',dataset:{richComposer:''},style:{},setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key),addEventListener(){},focus(){},dispatchEvent(){}};
 const rich={getEmojiQueryContext:()=>({text:state.drafts.chat,start:state.drafts.chat.length,end:state.drafts.chat.length,toRange:range=>range}),getSnapshot:()=>({text:state.drafts.chat,richText:state.draftRichTexts.chat,references:state.composerSkillReferences.chat}),getSelection:()=>({start:state.drafts.chat.length,end:state.drafts.chat.length}),getQueryContext:()=>({text:state.drafts.chat,start:state.drafts.chat.length,end:state.drafts.chat.length}),replaceSuggestion(range,reference){calls.push({range,reference});if(!accept)return false;state={...state,drafts:{chat:'Use @Daily research brief '},draftRichTexts:{chat:'accepted rich'},composerSkillReferences:{chat:[reference]}};return true;},removeReference(id){calls.push({remove:id});return accept;}};
 const unbind=bindComposerInput(input,rich),document={addEventListener(){},createElement:()=>({dataset:{},addEventListener(){},setAttribute(){},toggleAttribute(){},querySelectorAll:()=>[],querySelector:()=>null,remove(){}})};
 const app={ownerDocument:document,querySelector:selector=>selector==='#message-input'?input:selector==='.composer-wrap'?{append(){}}:null};
 const controller=createComposerCommands({app,esc:String,getState:()=>state,getConversationKey:()=> 'chat',commit:build=>{commits++;state=build(state);return {ok:true};},runComposerAction:id=>actions.push(id)});controller.afterRender();
 const type=target=>controller.handleInput({target:target||input});
 const enter=target=>controller.handleKeyDown({target:target||input,key:'Enter',preventDefault(){},stopPropagation(){}});
 return {input,rich,controller,type,enter,calls,actions,state:()=>state,commits:()=>commits,close(){controller.destroy();unbind();}};
}
test('rich suggestion inserts through editor transaction without a second host commit',()=>{
 const f=fixture();try{f.type();assert.equal(f.controller.diagnostics().suggestions,1);assert.equal(f.enter(),true);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].range,{start:4,end:25});assert.equal(f.calls[0].reference.revision,3);assert.equal(f.commits(),0);assert.equal(f.state().draftRichTexts.chat,'accepted rich');}finally{f.close();}
});
test('failed editor persistence retains selected query and no action or host write occurs',()=>{
 const f=fixture({accept:false});try{f.type();f.enter();assert.equal(f.state().drafts.chat,'Use @Daily research brief');assert.equal(f.calls.length,1);assert.equal(f.commits(),0);assert.deepEqual(f.actions,[]);}finally{f.close();}
});
test('nested rich editor events and skill removal resolve the bound editable root',()=>{
 const f=fixture();try{const child={closest:selector=>selector==='#message-input'?f.input:null};f.type(child);assert.equal(f.controller.diagnostics().suggestions,1);f.controller.handleAction({action:'composer-skill-remove',id:skill.id});assert.deepEqual(f.calls.at(-1),{remove:skill.id});assert.equal(f.commits(),0);}finally{f.close();}
});
test('input seam uses editor document and selection without a DOM value facade',()=>{
 const input={},snapshot={text:'real document',richText:'serialized',references:[]};let replacement;
 const unbind=bindComposerInput(input,{getSnapshot:()=>snapshot,getSelection:()=>({start:2,end:4}),replaceText:text=>{replacement=text;return false;}});
 try{assert.equal(composerText(input),'real document');assert.deepEqual(composerSelection(input),{start:2,end:4});assert.equal(replaceComposerText(input,'new'),false);assert.equal(replacement,'new');assert.equal(Object.hasOwn(input,'value'),false);assert.equal(readComposerInput(input),snapshot);}finally{unbind();}
});
test('same conversation rerender preserves rich view and exact caret for unchanged documents',()=>{
 const savedDocument=globalThis.document,old={id:'message-input',dataset:{},spellcheck:true,scrollTop:3,contains:node=>node===child,focus(){this.focused=true;}},child={},fresh={id:'message-input',spellcheck:false,replaceWith(node){this.replacement=node;}},root={querySelector:selector=>selector==='#message-input'?fresh:null,contains:()=>true};
 let snapshot={text:'same',richText:'doc A',references:[]},restores=0,selection;
 const unbindOld=bindComposerInput(old,{getSnapshot:()=>snapshot,getSelection:()=>({start:1,end:3,direction:'backward'}),setSelection:(start,end,direction)=>{selection=[start,end,direction];},restore:next=>{restores++;snapshot=next;return true;}}),unbindFresh=bindComposerInput(fresh,{getSnapshot:()=>snapshot});
 globalThis.document={activeElement:child};
 try{const captured=captureInputState({...root,querySelector:selector=>selector==='#message-input'?old:null});restoreInputState(root,captured,{sameConversation:true,explicitSend:false,composing:new WeakSet()});assert.equal(fresh.replacement,old);assert.equal(restores,0);assert.deepEqual(selection,[1,3,'backward']);assert.equal(old.focused,true);}finally{globalThis.document=savedDocument;unbindOld();unbindFresh();}
});
test('accepted empty draft restore resets editor history instead of retaining sent content',()=>{
 const old={id:'message-input',dataset:{},style:{}},fresh={id:'message-input',replaceWith(node){this.replacement=node;}},root={querySelector:selector=>selector==='#message-input'?fresh:null};
 const previous={text:'sent',richText:'prior doc',references:[]},next={text:'',references:[]};let restored;
 const unbindOld=bindComposerInput(old,{getSnapshot:()=>previous,restore:(snapshot,options)=>{restored={snapshot,options};return true;}}),unbindFresh=bindComposerInput(fresh,{getSnapshot:()=>next});
 try{restoreInputState(root,{input:old,composer:previous,selection:{start:4,end:4},scrolls:[]},{sameConversation:true,explicitSend:true,composing:new WeakSet()});assert.deepEqual(restored,{snapshot:next,options:{resetHistory:true}});assert.equal(fresh.replacement,old);}finally{unbindOld();unbindFresh();}
});

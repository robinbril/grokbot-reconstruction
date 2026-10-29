import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnreadFocusHandoff} from '../transcript-unread-focus.js';
function fixture(){
 const events=new Map(),document={body:{id:'body'},activeElement:null},window={addEventListener:(name,callback)=>events.set(name,callback),removeEventListener:(name,callback)=>{if(events.get(name)===callback)events.delete(name);}};document.activeElement=document.body;
 const anchor=(id,top)=>({id,contains:node=>node===document.activeElement&&node?.owner===id,getBoundingClientRect:()=>({top,bottom:top+40}),focus(options){assert.equal(options.preventScroll,true);assert.deepEqual(Object.keys(options),['preventScroll']);document.activeElement=this;}});
 const before=anchor('before',-60),after=anchor('after',160),bottom=anchor('bottom',500),divider={compareDocumentPosition:node=>node===after?4:0},log={querySelectorAll:()=>[before,after],querySelector:()=>divider,getBoundingClientRect:()=>({top:100,bottom:400})};
 const pill={contains:node=>node?.owner==='pill'},child={owner:'pill'};return {document,window,events,Node:{DOCUMENT_POSITION_FOLLOWING:4},before,after,bottom,log,pill,child};
}
test('focused unread pill removal transfers to first actual action anchor after divider during settling without scrolling',()=>{
 const f=fixture(),focus=createUnreadFocusHandoff(f);f.document.activeElement=f.child;focus.bindUnreadPill(f.pill)();f.document.activeElement=f.document.body;focus.handOff({log:f.log,isUnreadJumpSettling:true,isAtBottom:false,isCovered:false,toolbarInsetPx:0,dockInsetPx:0});assert.equal(f.document.activeElement,f.after);
});
test('non-settling pill dismissal prefers existing bottom dock, covered handoff never steals focus',()=>{
 const f=fixture(),focus=createUnreadFocusHandoff(f);focus.bindScrollToBottom(f.bottom);f.document.activeElement=f.child;focus.bindUnreadPill(f.pill)();f.document.activeElement=f.document.body;focus.handOff({log:f.log,isUnreadJumpSettling:false,isAtBottom:false,isCovered:false,toolbarInsetPx:0,dockInsetPx:0});assert.equal(f.document.activeElement,f.bottom);
 f.document.activeElement=f.child;focus.bindUnreadPill(f.pill)();f.document.activeElement=f.document.body;focus.handOff({log:f.log,isUnreadJumpSettling:true,isAtBottom:false,isCovered:true});assert.equal(f.document.activeElement,f.document.body);
});
test('missing arrived action anchor waits for a later commit but intervening user input retires the handoff',()=>{
 const f=fixture(),focus=createUnreadFocusHandoff(f);f.document.activeElement=f.child;focus.bindUnreadPill(f.pill)();f.document.activeElement=f.document.body;f.log.querySelector=()=>null;focus.handOff({log:f.log,isUnreadJumpSettling:true,isAtBottom:false,isCovered:false});assert.equal(f.events.size,3);
 f.events.get('pointerdown')();f.log.querySelector=()=>({compareDocumentPosition:()=>4});focus.handOff({log:f.log,isUnreadJumpSettling:true,isAtBottom:false,isCovered:false});assert.equal(f.document.activeElement,f.document.body);assert.equal(f.events.size,0);
});

test('handoff outcomes match the frozen native focus manager across settling covered dock and intervention branches',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
 const source=JSON.parse(readFileSync(new URL('./fixtures/source-reference/transcript-unread.json',import.meta.url),'utf8')).records.find(record=>record.id==='pill-focus-handoff').excerpt;
 function run(factory,branch){const f=fixture(),focus=factory(f);if(branch==='dock')focus.bindScrollToBottom(f.bottom);f.document.activeElement=f.child;focus.bindUnreadPill(f.pill)();f.document.activeElement=f.document.body;
  if(branch==='intervention')f.log.querySelector=()=>null;
  const options={log:f.log,isCovered:branch==='covered',isUnreadJumpSettling:branch!=='dock',isAtBottom:false,toolbarInsetPx:0,dockInsetPx:0};focus.handOff(options);
  if(branch==='intervention'){f.events.get('pointerdown')();f.log.querySelector=()=>({compareDocumentPosition:()=>4});focus.handOff(options);}
  return {focused:f.document.activeElement.id,events:f.events.size};
 }
 const native=f=>runInNewContext(`const W2=['focusin','pointerdown','keydown'],yge='.sand-message-action-anchor',Sge='.sand-unread-divider';${source};aze();`,f);
 for(const branch of ['settling','covered','dock','intervention'])assert.deepEqual(run(createUnreadFocusHandoff,branch),run(native,branch),branch);
});

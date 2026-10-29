import {composerController} from './composer-input.js';
import {normalizeSelectionQuote} from './composer-quote.js';

const excluded='button,input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],[inert]';
const element=node=>node instanceof Element?node:node?.parentElement;
const sameRange=(a,b)=>a.startContainer===b.startContainer&&a.startOffset===b.startOffset&&a.endContainer===b.endContainer&&a.endOffset===b.endOffset;
function makeToolbar(){
 const toolbar=document.createElement('div'),button=document.createElement('button'),hint=document.createElement('kbd'),isMac=/mac/i.test(navigator.platform);
 toolbar.className='quote-selection-actions';toolbar.dataset.sandSelectionActions='';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Selectieacties');toolbar.hidden=true;
 button.type='button';button.className='quote-selection-add';button.append(document.createTextNode('Toevoegen aan chat'));
 hint.textContent=isMac?'⌘L':'Ctrl+L';hint.setAttribute('aria-hidden','true');button.setAttribute('aria-keyshortcuts',isMac?'Meta+L':'Control+L');button.append(hint);toolbar.append(button);document.body.append(toolbar);
 return {toolbar,button,isMac};
}
function eligibleSelection(host,toolbar){
 const selection=document.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;
 const start=element(selection.anchorNode),end=element(selection.focusNode);
 if(!start||!end||start.closest(excluded)||end.closest(excluded))return null;
 const surface=start.closest('[data-sand-selection-surface]'),active=document.activeElement;
 if(!surface||!host.app.contains(surface)||!surface.contains(end)||surface!==end.closest('[data-sand-selection-surface]')||surface.closest('[inert]'))return null;
 if(active?.isConnected&&active!==document.body&&active!==document.documentElement&&!toolbar.contains(active)&&!surface.contains(active))return null;
 if([...document.querySelectorAll('dialog[open],[aria-modal="true"]')].some(modal=>!modal.contains(surface)))return null;
 const text=selection.toString().trim();if(!text)return null;
 return {key:host.getConversationKey(),surface,text,range:selection.getRangeAt(0).cloneRange()};
}
function positionSelection(state,toolbar,host,hide){
 const snapshot=state.snapshot;if(!snapshot?.surface.isConnected||snapshot.key!==host.getConversationKey())return hide();
 const bounds=snapshot.surface.getBoundingClientRect(),rect=snapshot.range.getBoundingClientRect();
 if(!rect.width&&!rect.height||rect.bottom<bounds.top||rect.top>bounds.bottom)return hide();
 const width=toolbar.getBoundingClientRect().width,height=toolbar.getBoundingClientRect().height;
 toolbar.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';
 toolbar.style.top=Math.max(Math.max(8,bounds.top+4),Math.min(rect.top-height-8,innerHeight-height-8))+'px';
}
function bindEvents({host,state,toolbar,button,isMac,abort,eligible,show,hide,activate,position}){
 toolbar.addEventListener('pointerdown',event=>event.preventDefault(),{signal:abort.signal});
 toolbar.addEventListener('mousedown',event=>event.preventDefault(),{signal:abort.signal});
 button.addEventListener('click',activate,{signal:abort.signal});
 document.addEventListener('selectionchange',()=>{if(!state.press&&!state.disposed)show(eligible());},{signal:abort.signal});
 document.addEventListener('pointerdown',event=>{
  if(toolbar.contains(event.target))return;
  if(event.target instanceof Element&&event.target.closest('[aria-modal="true"],dialog[open]'))return;
  const selection=document.getSelection();state.press=event.isPrimary&&event.button===0?{id:event.pointerId,range:selection?.rangeCount?selection.getRangeAt(0).cloneRange():null}:null;state.dismissed=null;hide();
 },{capture:true,signal:abort.signal});
 document.addEventListener('pointerup',event=>{
  if(!state.press||state.press.id!==event.pointerId)return;const before=state.press.range;state.press=null;const current=eligible();
  if(current&&before&&sameRange(before,current.range)){state.dismissed=current.range;return;}show(current);
 },{capture:true,signal:abort.signal});
 document.addEventListener('pointercancel',()=>{state.press=null;hide();},{capture:true,signal:abort.signal});
 document.addEventListener('keydown',event=>{
  if(!state.snapshot)return;
  if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();state.dismissed=state.snapshot.range;hide();return;}
  const modifier=isMac?event.metaKey:event.ctrlKey;
  if(modifier&&!event.altKey&&!event.shiftKey&&!event.isComposing&&event.key.toLowerCase()==='l'){event.preventDefault();if(!event.repeat)activate();}
 },{capture:true,signal:abort.signal});
 document.addEventListener('focusin',event=>{
  if(!state.snapshot||toolbar.contains(event.target)||state.snapshot.surface.contains(event.target))return;
  if(event.target!==document.body)hide();
 },{signal:abort.signal});
 host.app.addEventListener('scroll',position,{capture:true,passive:true,signal:abort.signal});
 window.addEventListener('resize',position,{passive:true,signal:abort.signal});
}

// Native chat selection is one transcript surface, separate from replyTo.
export function createQuoteSelectionSurface(host){
 const abort=new AbortController(),{toolbar,button,isMac}=makeToolbar(),state={snapshot:null,disposed:false,press:null,dismissed:null,observer:null};
 const eligible=()=>eligibleSelection(host,toolbar),position=()=>positionSelection(state,toolbar,host,hide);
 function hide(){state.snapshot=null;toolbar.hidden=true;state.observer?.disconnect();state.observer=null;}
 function show(value){
  if(state.disposed||!value)return hide();
  if(state.dismissed&&sameRange(state.dismissed,value.range))return;
  state.snapshot=value;toolbar.hidden=false;position();
  if(!state.snapshot||state.observer)return;
  state.observer=new MutationObserver(()=>{
   const current=eligible(),snapshot=state.snapshot;
   if(!current||current.surface!==snapshot?.surface||current.text!==snapshot.text||!sameRange(current.range,snapshot.range))hide();else position();
  });
  state.observer.observe(value.surface,{childList:true,subtree:true,characterData:true});
 }
 function activate(){
  const current=eligible(),owned=state.snapshot;
  if(!current||!owned||current.key!==owned.key||current.surface!==owned.surface||current.text!==owned.text||!sameRange(current.range,owned.range))return hide();
  const quote=normalizeSelectionQuote(current.text,current.surface.getAttribute('data-sand-selection-source'));
  const input=host.app.querySelector('#message-input'),controller=composerController(input);
  if(quote&&controller?.insertQuote?.(quote)===true){hide();controller.focus({preventScroll:true});}
 }
 bindEvents({host,state,toolbar,button,isMac,abort,eligible,show,hide,activate,position});
 function afterRender(){
  const surface=host.app.querySelector('.transcript');
  if(surface){surface.setAttribute('data-sand-selection-surface',String(host.getConversationKey()));surface.removeAttribute('data-sand-selection-source');}
  if(state.snapshot&&state.snapshot.surface!==surface)hide();
 }
 return {beforeRender(){state.press=null;hide();},afterRender,destroy(){state.disposed=true;abort.abort();hide();toolbar.remove();}};
}

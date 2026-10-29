import {composerController,composerEventInput} from './composer-input.js';
import {composerEmojiToken,emojiCompletion,composerEmojiIndex,loadComposerEmojiIndex,searchComposerEmoji} from './composer-emoji-index.js';

/** Plain Unicode edits, actual editor transactions, and one owner for lazy terminals. */
export function createComposerEmojiSurface(host){
 const app=host.app,esc=host.esc??(value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'));
 let input=null,controller=null,binding=null,menu=null,token=null,items=[],active=0,query='',dismissed=null;
 let pending=null,loading=null,destroyed=false,replaying=false,recents=[],reportedLoadError=false;
 const handledKeys=new WeakSet();
 const conversation=()=>String(host.getConversationKey?.()??'new');
 const context=()=>controller?.getQueryContext();
 const stamp=()=>{const current=context();return current?JSON.stringify([conversation(),current.text,current.start,current.end]):null;};
 const nativeContext=()=>controller?.getEmojiQueryContext();
 function currentToken(){const raw=nativeContext(),match=raw&&composerEmojiToken(raw.text,raw.start,raw.end);return match?raw.toRange(match):null;}
 const recent=()=>Array.isArray(host.getState().emojiRecents)?host.getState().emojiRecents:[];
 function record(entry){host.commit?.(state=>({...state,emojiRecents:[entry.id,...(Array.isArray(state.emojiRecents)?state.emojiRecents:[]).filter(id=>id!==entry.id)].slice(0,50)}));}
 function close(){
  menu?.remove();menu=null;token=null;items=[];query='';active=0;
  if(input?.getAttribute('aria-controls')==='composer-emoji-list'){
   input.setAttribute('aria-expanded','false');input.removeAttribute('aria-controls');input.removeAttribute('aria-activedescendant');
  }
 }
 function sync(){
  if(!menu)return;
  menu.querySelectorAll('[role=option]').forEach((option,i)=>option.setAttribute('aria-selected',String(i===active)));
  input.setAttribute('aria-activedescendant',`composer-emoji-${active}`);
  menu.querySelector(`[id="composer-emoji-${active}"]`)?.scrollIntoView({block:'nearest'});
 }
 function render(){
  if(!menu){
   menu=app.ownerDocument.createElement('div');menu.className='composer-emoji-menu';menu.dataset.composerEmojiMenu='';
   menu.addEventListener('pointerdown',event=>{if(event.target.closest('[role=option]'))event.preventDefault();});
   menu.addEventListener('pointermove',event=>{const option=event.target.closest('[data-emoji-index]');if(option){active=Number(option.dataset.emojiIndex);sync();}});
   menu.addEventListener('click',event=>{const option=event.target.closest('[data-emoji-index]');if(option)select(items[Number(option.dataset.emojiIndex)]);});
   app.querySelector('.composer-wrap')?.append(menu);
  }
  menu.innerHTML=`<div class="composer-emoji-grid" id="composer-emoji-list" role="listbox" aria-label="Emoji">${items.map((item,i)=>`<button type="button" class="composer-emoji-option" role="option" id="composer-emoji-${i}" data-emoji-index="${i}" aria-label="${esc(item.name)}" title=":${esc(item.id)}:" tabindex="-1">${esc(item.native)}</button>`).join('')}</div>`;
  input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls','composer-emoji-list');input.setAttribute('aria-autocomplete','list');sync();
 }
 function load(){
  if(loading)return loading;
  loading=loadComposerEmojiIndex().then(index=>{
   loading=null;if(destroyed)return index;
   if(pending)replay(index);else if(input===app.ownerDocument.activeElement)update();return index;
  }).catch(error=>{loading=null;pending=null;close();if(!reportedLoadError){reportedLoadError=true;console.warn('Emoji-index niet beschikbaar.',error);}});
  return loading;
 }
 function update(){
  if(destroyed||!input?.isConnected||input.getAttribute('contenteditable')==='false')return close();
  const current=context(),next=currentToken();
  if(!next||dismissed?.start===next.start&&dismissed.controller===controller)return close();
  const index=composerEmojiIndex();if(!index){void load();return close();}
  if(!menu)recents=[...recent()];
  const result=searchComposerEmoji(index.entries,next.query,recents);
  if(!result.length)return close();
  if(query!==next.query)active=0;query=next.query;token=next;items=result;active=Math.min(active,items.length-1);render();
 }
 function select(entry){
  const current=context(),next=currentToken();
  if(!entry||!next||!token||next.start!==token.start||next.end!==token.end||next.query!==token.query)return false;
  close();replaying=true;const accepted=controller.replaceRangeText(next,entry.native+' ');replaying=false;
  if(accepted){record(entry);controller.focus({preventScroll:true});}else update();return accepted;
 }
 function validPending(){return pending&&pending.field===input&&pending.conversation===conversation()&&pending.language===host.getState().language&&input.isConnected&&input===app.ownerDocument.activeElement&&pending.stamp===stamp();}
 function ensurePending(){
  if(!pending)pending={field:input,conversation:conversation(),language:host.getState().language,shortcodes:[],terminals:[],stamp:stamp(),caret:context().start};
  return pending;
 }
 function replay(index){
  if(!validPending()){pending=null;return;}
  const work=pending;pending=null;close();replaying=true;
  let shift=0;const succeeded=new Set();
  for(const range of work.shortcodes){
   const entry=index.aliases.get(range.shortcode);if(!entry||range.predecessor&&!succeeded.has(range.predecessor))continue;
   const start=range.start+shift,end=range.end+shift;
   if(!controller.replaceRangeText({start,end},entry.native,{preserveSelection:true})){replaying=false;return;}
   shift+=entry.native.length-(range.end-range.start);succeeded.add(range.id);record(entry);
  }
  for(const terminal of work.terminals){
   const current=context(),next=currentToken();
   const entry=next&&searchComposerEmoji(index.entries,next.query,recent(),1)[0];
   if(entry){if(controller.replaceRangeText(next,entry.native+' '))record(entry);else break;}
   else if(terminal==='Tab'){if(!controller.replaceRangeText({start:current.start,end:current.end},'\t'))break;}
   else {replaying=false;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));replaying=true;}
  }
  replaying=false;update();
 }
 function textInput(text,inputContext){
  if(text!==':'||replaying||!controller||input.getAttribute('aria-controls')==='composer-command-list')return false;
  const raw=inputContext??nativeContext(),current={...context(),...raw.toRange({start:raw.start,end:raw.end})};
  const base=raw.toRange({start:0,end:0}).start;
  const predecessors=(pending?.shortcodes??[]).map(range=>({...range,start:range.start-base,end:range.end-base}));
  const local=emojiCompletion(raw.text,raw.start,predecessors);
  const completion=local?raw.toRange({...local,end:raw.end}):null;
  if(!completion)return false;
  const index=composerEmojiIndex();
  if(index){
   const entry=index.aliases.get(completion.shortcode);if(!entry)return false;
   close();replaying=true;const accepted=controller.replaceRangeText({start:completion.start,end:current.end},entry.native,{allowSelectedAtoms:Boolean(inputContext)});replaying=false;
   if(accepted)record(entry);return accepted;
  }
  if(!controller.replaceRangeText({start:current.start,end:current.end},':',{allowSelectedAtoms:Boolean(inputContext)}))return false;
  ensurePending().shortcodes.push({...completion,end:current.start+1,id:Symbol()});pending.stamp=stamp();pending.caret=context().start;void load();return true;
 }
 function inList(){
  const anchor=app.ownerDocument.getSelection()?.anchorNode,element=anchor?.nodeType===1?anchor:anchor?.parentElement;
  const item=element?.closest?.('li');return Boolean(item&&input.contains(item));
 }
 function keyDown(event){const handled=processKey(event);if(handled)handledKeys.add(event);return handled;}
 function processKey(event){
  if(event.isComposing||event.keyCode===229||event.metaKey||event.ctrlKey||event.altKey||replaying)return false;
  if(menu){
   if(event.key==='Escape'){dismissed={start:token.start,controller};close();event.preventDefault();return true;}
   const rtl=getComputedStyle(input).direction==='rtl',moves={ArrowDown:8,ArrowUp:-8,ArrowRight:rtl?-1:1,ArrowLeft:rtl?1:-1};
   if(Object.hasOwn(moves,event.key)){active=Math.max(0,Math.min(items.length-1,active+moves[event.key]));sync();event.preventDefault();return true;}
   if(!event.shiftKey&&['Enter','Tab'].includes(event.key)){event.preventDefault();if(!event.repeat)select(items[active]??items[0]);return true;}
  }
  if(event.shiftKey||!['Enter','Tab'].includes(event.key)||composerEmojiIndex()||event.key==='Tab'&&inList())return false;
  const current=context(),next=currentToken();
  if(!next&&!pending?.shortcodes.length&&!pending?.terminals.length)return false;
  if(event.key==='Tab'&&!next&&!emojiCompletion(current.text,current.start,pending?.shortcodes??[]))return false;
  event.preventDefault();if(!event.repeat){ensurePending().terminals.push(event.key);pending.stamp=stamp();void load();}return true;
 }
 function transaction(change){
  if(replaying)return;
  if(dismissed&&context().text[dismissed.start]!==':')dismissed=null;
  if(pending){
   pending.shortcodes=pending.shortcodes.map(change.mapRange).filter(Boolean);
   const caret=change.mapCaret(pending.caret);
   if(change.selection.start!==caret||change.selection.end!==caret)pending=null;
   else {pending.caret=caret;if(change.docChanged)pending.terminals=[];pending.stamp=stamp();}
  }
  queueMicrotask(()=>{if(!destroyed)update();});
 }
 function detach(){pending=null;close();controller?.setEmojiHandlers(null);binding?.abort();binding=null;input=null;controller=null;}
 function bind(){
  const next=app.querySelector('#message-input');if(next===input)return;
  detach();input=next;controller=composerController(input);if(!controller)return;
  binding=new AbortController();const signal=binding.signal;
  controller.setEmojiHandlers({textInput,keyDown,transaction,blur(){pending=null;close();}});
  input.addEventListener('compositionstart',()=>{pending=null;close();},{signal});
  input.addEventListener('compositionend',()=>update(),{signal});
  input.addEventListener('click',()=>update(),{signal});
 }
 return {id:'composer-emoji',beforeRender:detach,afterRender:bind,beforeDialogChange(){pending=null;close();},
  handleKeyDown(event){return handledKeys.has(event)||composerEventInput(event.target)===input&&keyDown(event);},
  handleInput(event){if(composerEventInput(event.target)===input&&!event.isComposing)update();},
  destroy(){destroyed=true;detach();}};
}

import {normalizeEntry} from './chat-entry-model.js';
import {iconsReady,iconSvg} from './icon-library.js';
import {createQuoteSelectionSurface} from './quote-selection-surface.js';

// Selection is presentation state. Message text and local IDs stay in the transcript.
export function createMessageActionsSurface(host){
 const quoteSelection=createQuoteSelectionSurface(host);
 const abort=new AbortController();let selected=null,menu=null,renderedKey=null,disposed=false;
 const key=()=>host.getConversationKey();
 const rows=()=>Array.from(host.app.querySelectorAll('.message[data-message-id]'));
 const message=id=>(host.getState().messages[key()]||[]).find(entry=>entry.id===id);
 const interactive=target=>target.closest('a,button,input,textarea,select,summary,[role="button"],[contenteditable="true"]');
 const hasSelection=()=>{const selection=window.getSelection();return !!selection&&!selection.isCollapsed&&!!selection.toString();};
 const activeRow=()=>selected?.key===key()?rows().find(row=>row.dataset.messageId===selected.id):null;
 function closeMenu(restoreFocus=false){if(!menu)return;host.closePopover({restoreFocus});menu=null;}
 function position(row){const delivery=selected?.deliveryId?Array.from(row.querySelectorAll('[data-live-message-id]')).find(node=>node.dataset.liveMessageId===selected.deliveryId):null;const tray=row.querySelector('.message-actions'),anchor=delivery?.querySelector('[data-chat-frame="prose"]')||delivery||row.querySelector('[data-chat-frame="prose"]')||row.querySelector('.bubble,.message-body');if(!tray||!anchor)return;const parent=tray.offsetParent||row,p=parent.getBoundingClientRect(),a=anchor.getBoundingClientRect(),bounds=host.app.querySelector('.transcript').getBoundingClientRect(),width=tray.getBoundingClientRect().width,height=tray.getBoundingClientRect().height,user=row.classList.contains('user'),rtl=getComputedStyle(anchor).direction==='rtl',toRight=user?rtl:!rtl;const left=Math.max(bounds.left+6,Math.min(toRight?a.right+6:a.left-width-6,bounds.right-width-6));tray.style.left=(left-p.left)+'px';tray.style.top=(a.top+a.height/2-height/2-p.top)+'px';}
 function syncTimestamps(){const transcript=host.app.querySelector('.transcript');if(!transcript)return;const bounds=transcript.getBoundingClientRect();for(const row of rows()){if(!row.querySelector('[data-message-timestamp]'))continue;const anchor=row.querySelector('[data-chat-frame="prose"]')||row.querySelector('.bubble,.message-body');if(!anchor)continue;const r=row.getBoundingClientRect(),a=anchor.getBoundingClientRect(),rtl=getComputedStyle(row).direction==='rtl';const sourceInset=(rtl?a.left-r.left:r.right-a.right)-74,available=rtl?r.left-bounds.left-6:bounds.right-r.right-6;const inset=Math.max(sourceInset,66-available);row.style.setProperty('--message-timestamp-inset',inset.toFixed(2)+'px');}}
 const geometryObserver=new ResizeObserver(()=>{syncTimestamps();const row=activeRow();if(row)position(row);});
 function observeGeometry(){geometryObserver.disconnect();for(const row of rows()){geometryObserver.observe(row);const anchor=row.querySelector('[data-chat-frame="prose"]')||row.querySelector('.bubble,.message-body');if(anchor)geometryObserver.observe(anchor);}}
 function sync(){if(iconsReady())for(const icon of host.app.querySelectorAll('[data-message-icon]')){if(icon.dataset.messageIconReady==='true')continue;icon.innerHTML=iconSvg(icon.dataset.messageIcon,{size:20});icon.dataset.messageIconReady='true';}for(const row of rows()){const active=selected?.key===key()&&selected.id===row.dataset.messageId;row.toggleAttribute('data-message-active',active);row.tabIndex=0;const tray=row.querySelector('.message-actions');if(tray){const reply=tray.querySelector('[data-action="reply-message"]');if(reply){if(active&&selected.deliveryId)reply.dataset.replyMessageId=selected.deliveryId;else delete reply.dataset.replyMessageId;}tray.inert=!active;tray.setAttribute('aria-hidden',String(!active));if(active)position(row);else{tray.style.left='0px';tray.style.top='0px';}}}}
 function clear(){closeMenu(false);selected=null;sync();}
 function activate(row,origin){if(disposed)return;const delivery=origin?.closest('.live-delivery'),same=selected?.key===key()&&selected.id===row.dataset.messageId;selected={key:key(),id:row.dataset.messageId,deliveryId:delivery?delivery.dataset.liveMessageId:same?selected.deliveryId:undefined};sync();}
 function localId(entry){const normalized=normalizeEntry(entry,{conversationId:key()}),run=normalized.runId&&Object.hasOwn(host.getState().chatRuns||{},normalized.runId)?host.getState().chatRuns[normalized.runId]:null;return run?.conversationId===key()?{value:run.id,scope:'Lokaal run-ID'}:{value:entry.id,scope:'Lokaal bericht-ID'};}
 function openMenu(row,anchor,context=false,point){const entry=message(row.dataset.messageId);if(!entry)return;activate(row);closeMenu(false);const identity=localId(entry),extra=`data-id="${host.esc(entry.id)}"${selected?.deliveryId?` data-reply-message-id="${host.esc(selected.deliveryId)}"`:''}`;
  const reply=context?host.menuItem('Antwoorden','left','reply-message',extra):'';const retry=context&&entry.productKind==='run'&&entry.localRun&&['complete','cancelled','failed','interrupted'].includes(entry.localRun.status)?host.menuItem('Lokale taak opnieuw uitvoeren','refresh','retry-message',extra,'Lokale tekstbewerking'):'';
  menu=host.popover(anchor,reply+retry+host.menuItem('Kopiëren','copy','message-selection-copy',extra)+host.menuItem('Verzoek-ID kopiëren','key','message-selection-id',extra,identity.scope),'message-selection-menu',{mode:context?'manual':'auto'});
  menu.setAttribute('aria-label',context?'Berichtacties':'Meer berichtacties');
  menu.querySelector('[data-action="message-selection-id"]')?.setAttribute('aria-label','Verzoek-ID kopiëren');
  if(point){const bounds=menu.getBoundingClientRect();menu.style.left=Math.max(10,Math.min(point.x,innerWidth-bounds.width-10))+'px';menu.style.top=Math.max(10,Math.min(point.y,innerHeight-bounds.height-10))+'px';}
 }
 document.addEventListener('pointerdown',event=>{if(menu?.isConnected&&menu.getAttribute('popover')==='manual'&&!menu.contains(event.target))closeMenu(false);},{signal:abort.signal});
 document.addEventListener('click',event=>{
  if(disposed)return;const target=event.target;if(!(target instanceof Element))return;
  if(menu?.contains(target))return;
  const row=target.closest('.message[data-message-id]');
  if(row&&host.app.contains(row)){if(!interactive(target)&&!hasSelection())activate(row,target);return;}
  if(!target.closest('.message-selection-menu'))clear();
 },{signal:abort.signal});
 host.app.addEventListener('contextmenu',event=>{const target=event.target;if(!(target instanceof Element))return;const row=target.closest('.message[data-message-id]');if(!row||interactive(target)||hasSelection())return;event.preventDefault();activate(row,target);openMenu(row,row,true,{x:event.clientX,y:event.clientY});},{signal:abort.signal});
 host.app.addEventListener('keydown',event=>{const row=event.target.closest?.('.message[data-message-id]');if(!row||event.target!==row&&!event.target.matches('.live-delivery'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(row,event.target);}else if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();activate(row,event.target);openMenu(row,row,true);}else if(event.key==='Escape'){event.preventDefault();clear();row.focus({preventScroll:true});}},{signal:abort.signal});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu&&!menu.isConnected){menu=null;activeRow()?.focus({preventScroll:true});}},{signal:abort.signal});
 host.app.addEventListener('scroll',()=>{syncTimestamps();const row=activeRow();if(row)position(row);},{capture:true,signal:abort.signal,passive:true});
 window.addEventListener('resize',()=>{syncTimestamps();const row=activeRow();if(row)position(row);},{signal:abort.signal,passive:true});
 function toolbar(entry){const id=host.esc(entry.id),button=(label,icon,action,extra='')=>`<button type="button" class="icon-button ${action==='reaction-menu'?'reaction-add':''}" aria-label="${label}" title="${label}" data-action="${action}" data-id="${id}" ${extra}>${`<span class="icon" data-message-icon="${icon}" aria-hidden="true">${iconsReady()?iconSvg(icon,{size:20}):host.icon(icon==='smiley-happy'?'plus':icon==='dots-3-horizontal'?'more':'left')}</span>`}</button>`;
  return `<div class="message-actions" inert aria-hidden="true" aria-label="Berichtknoppen" role="toolbar">${entry.role==='bot'?button('Reactie toevoegen','smiley-happy','reaction-menu'):''}${button('Beantwoorden',entry.role==='user'?'arrow-u-up-right':'arrow-u-up-left','reply-message')}${button('Meer berichtacties','dots-3-horizontal','message-selection-more')}</div>`;
 }
 return {id:'message-actions',renderSlot(name,{message:entry}={}){return name==='messageActions'?toolbar(entry):undefined;},beforeRender(){quoteSelection.beforeRender();closeMenu(false);},afterRender(){if(disposed)return;quoteSelection.afterRender();if(renderedKey!==key()){selected=null;renderedKey=key();}if(selected&&!message(selected.id))selected=null;sync();queueMicrotask(()=>{const row=activeRow();if(disposed)return;syncTimestamps();observeGeometry();if(row?.isConnected)position(row);});},
  handleAction({action,id,target}){
   if(action==='message-selection-more'){const row=target.closest('.message[data-message-id]');if(row)openMenu(row,target);return true;}
   if(action==='message-selection-copy'){const entry=message(id),owner=menu;if(!entry)return true;const projected=host.getMessageCopyText(entry),payload=projected===undefined?entry.text:projected;return Promise.resolve(host.copyText(payload)).then(ok=>{if(owner?.isConnected&&target.isConnected){target.setAttribute('aria-label',ok?'Gekopieerd':'Kopiëren mislukt');target.querySelector('.fill').textContent=ok?'Gekopieerd':'Kopiëren mislukt';}return true;});}
   if(action==='message-selection-id'){const entry=message(id);if(!entry)return true;const identity=localId(entry),owner=menu;return Promise.resolve(host.copyText(identity.value)).then(ok=>{if(owner?.isConnected&&target.isConnected)target.setAttribute('aria-label',ok?'ID gekopieerd':'Kopiëren mislukt');return true;});}
   if(action==='reply-message'&&menu?.contains(target)){closeMenu(false);return false;}
   return false;
  },diagnostics:()=>({selectedMessage:!!selected,menuOpen:!!menu?.isConnected}),destroy(){if(disposed)return;disposed=true;quoteSelection.destroy();geometryObserver.disconnect();abort.abort();closeMenu(false);selected=null;}
 };
}

import {createUnreadBoundaryStore,unreadDivider,updateUnreadPillState,showsUnreadPill} from './transcript-unread-state.js';
import {transcriptReaderFor} from './transcript-reader.js';
import {createUnreadFocusHandoff} from './transcript-unread-focus.js';
const side=(row,viewport)=>row.bottom<=viewport.top?'above':row.top>=viewport.bottom?'below':'in-view';
const jumpClasses='sand-new-messages-pill__jump product-unread-jump';
// Metadata/receipt providers are explicit local adapters; the visibility state follows native RK/NK.
export function createTranscriptUnreadSurface(host){
 const boundaries=createUnreadBoundaryStore(),focus=createUnreadFocusHandoff(),anchorOwners=new Map();let releaseUnreadFocus=null,releaseBottomFocus=null,bottomFocusNode=null,jumpFocusPending=false;let currentKey=null,pillState={boundaryAt:null,hasSeen:false,hasDismissed:false},marker=null,pill=null,viewport=null,observer=null,abort=null,releaseReader=null,observedSide=null,disposed=false,pendingOpenCleanup=false;
 function key(){return host.getConversationKey();}
 function entries(){return host.getUnreadEntries?.(key())||[];}
 function currentDivider(){return host.getUnreadDivider?.(key())===undefined?unreadDivider(entries(),boundaries.read(key())):host.getUnreadDivider(key());}
 function covered(){return host.isTranscriptCovered?.()===true;}
 function state(){return {boundaryAt:boundaries.read(key()),hasSeen:pillState.hasSeen,hasDismissed:pillState.hasDismissed};}
 function detach(){observer?.disconnect();observer=null;abort?.abort();abort=null;releaseReader?.();releaseReader=null;viewport=null;}
 function removePill(){releaseUnreadFocus?.();releaseUnreadFocus=null;pill?.remove();pill=null;}
 function prepareAnchors(){
  for(const [node,owned] of anchorOwners)if(!node.isConnected){if(owned.classAdded)node.classList.remove('sand-message-action-anchor');if(owned.tabAdded&&node.getAttribute('tabindex')==='-1')node.removeAttribute('tabindex');anchorOwners.delete(node);}
  for(const node of host.app.querySelectorAll('.live-delivery[data-live-message-id],.message[data-message-id]')){
   if(node.matches('.message')&&node.querySelector('.live-delivery[data-live-message-id]'))continue;
   if(anchorOwners.has(node))continue;const owned={classAdded:!node.classList.contains('sand-message-action-anchor'),tabAdded:!node.hasAttribute('tabindex')};node.classList.add('sand-message-action-anchor');if(owned.tabAdded)node.tabIndex=-1;anchorOwners.set(node,owned);
  }
 }
 function handOffFocus(reader,settling){
  const next=viewport?.closest('.thread-frame')?.querySelector('.product-jump-latest:not([data-exiting])')||null;
  if(next!==bottomFocusNode){releaseBottomFocus?.();bottomFocusNode=next;releaseBottomFocus=next?focus.bindScrollToBottom(next):null;}
  focus.handOff({log:viewport,isCovered:covered(),isAtBottom:reader?.view().isPinnedToBottom===true,isUnreadJumpSettling:settling,toolbarInsetPx:0,dockInsetPx:0});
 }
 function removeMarker(){observer?.disconnect();observer=null;marker?.remove();marker=null;observedSide=null;}
 function noteAgentOpenBegin({agentId,row,isSameAgentReopen=false}){
  boundaries.noteAgentOpenBegin({agentId,row,isSameAgentReopen});
 }
 function locate(divider){
  const id=CSS.escape(divider.entryId),node=host.app.querySelector(`[data-live-message-id="${id}"],.message[data-message-id="${id}"]`);
  return node?.closest('.transcript')?node:null;
 }
 function mountMarker(divider){
  const target=locate(divider);if(!target){removeMarker();return;}
  const reader=transcriptReaderFor(host);
  if(marker?.isConnected&&marker.dataset.unreadEntryId===divider.entryId){
   if(marker.parentNode===target.parentNode&&marker.nextElementSibling===target)return;
   reader?.beforeMutation();try{target.before(marker);}finally{reader?.afterMutation({cause:'structure-change'});}return;
  }
  reader?.beforeMutation();
  try{
   removeMarker();marker=document.createElement('div');marker.className='product-unread-divider sand-unread-divider';marker.dataset.unreadDivider='';marker.dataset.rowKey='unread-divider';marker.dataset.unreadEntryId=divider.entryId;marker.setAttribute('role','separator');marker.setAttribute('aria-label','Nieuwe berichten');
   const label=document.createElement('span');label.className='sand-unread-divider__label';label.textContent='Nieuw';marker.append(label);target.before(marker);
  }finally{reader?.afterMutation({cause:'structure-change'});}
  observedSide=side(marker.getBoundingClientRect(),viewport.getBoundingClientRect());
  if(typeof IntersectionObserver==='function'){
   const observed=marker;observer=new IntersectionObserver(records=>{
    if(disposed||marker!==observed||!observed.isConnected)return;
    const record=records.at(-1);if(!record)return;
    observedSide=record.isIntersecting?'in-view':side(record.boundingClientRect,record.rootBounds||viewport.getBoundingClientRect());
    pillState=updateUnreadPillState(pillState,{boundaryAt:boundaries.read(key()),observedSide});paintPill();
   },{root:viewport});observer.observe(marker);
  }
 }
 function paintPill(){
  if(disposed||!viewport)return;prepareAnchors();
  const divider=currentDivider(),frame=viewport.closest('.thread-frame'),reader=transcriptReaderFor(host),navigation=reader?.view().navigation;
  observedSide=marker?.isConnected?side(marker.getBoundingClientRect(),viewport.getBoundingClientRect()):(divider?host.getUnreadDividerSide?.(divider):null)??null;
  const settling=navigation?.kind==='smooth'&&navigation.target?.rowId==='unread-divider'||jumpFocusPending&&Boolean(marker?.isConnected);
  const visible=showsUnreadPill({hasPortal:Boolean(frame),hasDivider:Boolean(divider),side:observedSide,state:pillState,isCovered:covered(),isUnreadJumpSettling:settling});
  if(!visible){removePill();handOffFocus(reader,settling);if(jumpFocusPending&&marker?.isConnected)jumpFocusPending=false;return;}
  if(!pill?.isConnected){
   pill=document.createElement('div');pill.dataset.productUnreadPill='';pill.dataset.direction='up';pill.className='sand-new-messages-pill product-unread-pill';
   const jump=document.createElement('button');jump.type='button';jump.className=jumpClasses;jump.dataset.action='transcript-unread-jump';jump.setAttribute('aria-label','Naar ongelezen berichten');
   const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.innerHTML=host.iconSvg?.('arrow-up',{size:16})||'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg>';
   const label=document.createElement('span');label.dataset.unreadCount='';jump.append(arrow,label);
   const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='sand-new-messages-pill__dismiss product-unread-dismiss';dismiss.dataset.action='transcript-unread-dismiss';dismiss.setAttribute('aria-label','Ongelezen melding sluiten');dismiss.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
   pill.append(jump,dismiss);frame.append(pill);releaseUnreadFocus=focus.bindUnreadPill(pill);
  }
  pill.querySelector('[data-unread-count]').textContent=divider.newMessageCount===1?'1 nieuw bericht':`${divider.newMessageCount} nieuwe berichten`;handOffFocus(reader,settling);
 }
 function prepareOpen(){
  if(disposed||key()===currentKey)return false;
  currentKey=key();pendingOpenCleanup=true;jumpFocusPending=false;noteAgentOpenBegin({agentId:currentKey,row:host.getUnreadRow?.(currentKey)});pillState={boundaryAt:boundaries.read(currentKey),hasSeen:false,hasDismissed:false};host.onUnreadOpen?.(currentKey);return true;
 }
 function afterRender(){
  if(disposed)return;prepareOpen();
  const next=key();if(pendingOpenCleanup){pendingOpenCleanup=false;removeMarker();removePill();}
  const nextViewport=host.app.querySelector('.transcript');if(!nextViewport){detach();removePill();return;}
  if(viewport!==nextViewport){detach();viewport=nextViewport;abort=new AbortController();viewport.addEventListener('scroll',paintPill,{passive:true,signal:abort.signal});releaseReader=transcriptReaderFor(host)?.subscribe(paintPill);}
  pillState=updateUnreadPillState(pillState,{boundaryAt:boundaries.read(next),observedSide:null});
  const divider=currentDivider();if(divider)mountMarker(divider);else removeMarker();paintPill();
 }
 function handleAction({action}){
  if(action==='transcript-unread-dismiss'){pillState={...pillState,hasDismissed:true};host.cancelUnreadBoundaryChase?.();paintPill();return true;}
  if(action==='transcript-unread-jump'){
   const boundaryAt=boundaries.read(key());if(boundaryAt==null&&!currentDivider())return true;jumpFocusPending=true;
   if(host.chaseUnreadBoundary){if(host.chaseUnreadBoundary({conversationKey:key(),boundaryAt:boundaryAt??0})===false)jumpFocusPending=false;}
   else transcriptReaderFor(host)?.navigateToTarget(()=>marker,{motion:'smooth',origin:'find-in-chat'});
   paintPill();return true;
  }
  return false;
 }
 return {id:'transcript-unread',prepareOpen,afterRender,handleAction,noteAgentOpenBegin,refresh:afterRender,destroy(){disposed=true;detach();removePill();removeMarker();boundaries.dispose();releaseBottomFocus?.();focus.releaseWhenUnmounted();for(const [node,owned]of anchorOwners){if(owned.classAdded)node.classList.remove('sand-message-action-anchor');if(owned.tabAdded&&node.getAttribute('tabindex')==='-1')node.removeAttribute('tabindex');}anchorOwners.clear();},diagnostics:()=>({...state(),side:observedSide,divider:currentDivider(),showsPill:Boolean(pill?.isConnected)})};
}

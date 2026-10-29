import {createReaderState,reduceReaderState,readerView} from './transcript-reader-state.js';
import {createTranscriptNavigation} from './transcript-navigation.js';

const systemEnvironment=()=>({now:()=>performance.now(),requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:id=>cancelAnimationFrame(id),deadline:(callback,ms)=>setTimeout(callback,ms),cancelDeadline:id=>clearTimeout(id),resize:callback=>new ResizeObserver(callback),isFrameClockPaused:()=>document.hidden});
function keyDirection(event){
 if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
 const target=event.target,Element=target?.ownerDocument?.defaultView?.HTMLElement;
 if(Element&&target instanceof Element){
  const editable=target.closest('[contenteditable]');
  if(target.isContentEditable||target.closest('input, textarea, select')||editable&&editable.getAttribute('contenteditable')!=='false'||event.key===' '&&target.closest('button'))return;
 }
 if(['ArrowDown','PageDown','End',' '].includes(event.key))return 1;
 if(['ArrowUp','PageUp','Home'].includes(event.key))return -1;
}
const priorities={'user-navigation':11,restore:10,'disclosure-toggle':9,'stream-settle':8,'stream-delta':7,'async-media-resolved':6,'tool-status-change':5,'probe-contract-minted':4,'structure-change':3,'epoch-change':2,'measured-verification':1,hydration:0};
const higher=(first,next)=>first===undefined||next!==undefined&&(priorities[next]??0)>(priorities[first]??0)?next:first;

export function createTranscriptReader({app,getConversationKey,environment=systemEnvironment(),isGenerating=()=>false,streamingFollowEligible=()=>false,reducedMotion=()=>false}){
 let state=createReaderState(),currentKey,element,abort,observer,frame,quiet,scrollIdle,pendingSource,pendingCause,mutations=0,rendering=false,pendingBottom=false,disposed=false,writing=false,echo=false,smoothTarget,parkedTop;
 const rows=new Set(),listeners=new Set(),renders=new Set();
 const view=()=>({...readerView(state),...navigation.view()});
 const publish=()=>{if(!rendering&&!mutations)for(const listener of [...listeners])listener(view());};
 const navigation=createTranscriptNavigation({environment,reducedMotion,snapshot:navigationGeometry,write:writeNavigation,settle:settleNavigation,changed:next=>{
  const release=next.navigation.kind==='smooth'&&next.navigation.target.kind!=='bottom'&&state.mode.kind==='pinned-bottom';
  const direction=release&&next.navigation.resolvedTarget.targetScrollTopPx<(element?.scrollTop??0)?-1:1;
  state=reduceReaderState(state,{type:'navigation',active:next.navigation.kind!=='idle',release,direction}).state;
  if(!disposed)publish();
 }});
 function rowElements(){
  if(!element)return [];
  return [...element.querySelectorAll('[data-unread-divider],.message[data-message-id]')].flatMap(container=>{
   if(container.dataset.unreadDivider!==undefined)return [{node:container,container,rowId:'unread-divider'}];
   const deliveries=[...container.querySelectorAll?.('.live-delivery[data-live-message-id]')??[]];
   return deliveries.length?deliveries.map(node=>({node,container,rowId:'live:'+node.dataset.liveMessageId})):[{node:container,container,rowId:container.dataset.messageId}];
  });
 }
 function geometry(){
  if(!element||element.isConnected===false||element.clientHeight<=0)return null;
  const box=element.getBoundingClientRect(),top=element.scrollTop;
  return {scrollTopPx:top,viewportHeightPx:element.clientHeight,totalSizePx:element.scrollHeight,epochId:'width:'+element.clientWidth,rows:rowElements().map(({node,rowId})=>{const rect=node.getBoundingClientRect();return {rowId,topPx:rect.top-box.top+top,heightPx:rect.height};}).sort((a,b)=>a.topPx-b.topPx)};
 }
 function navigationGeometry(){
  const g=geometry();if(!g)return null;const rows=g.rows,byId=new Map(rows.map((row,index)=>[row.rowId,index]));
  return {totalSizePx:g.totalSizePx,viewport:{scrollTopPx:g.scrollTopPx,viewportHeightPx:g.viewportHeightPx},rows,indexOf:id=>byId.get(id),offsetOf:id=>rows[byId.get(id)]?.topPx};
 }
 function writeNavigation(topPx){const g=geometry();if(!g)return;apply(reduceReaderState(state,{type:'navigation-write',geometry:g,topPx}));return element.scrollTop;}
 function settleNavigation(target){const g=geometry();if(g)apply(reduceReaderState(state,{type:'navigation-settle',geometry:g,target}));}
 function cancelFrame(){if(frame!==undefined)environment.cancelFrame(frame);frame=undefined;pendingSource=undefined;pendingCause=undefined;}
 function cancelQuiet(){if(quiet!==undefined)environment.cancelDeadline(quiet);quiet=undefined;}
 function scheduleQuiet(){
  cancelQuiet();if(!state.deferred||state.input.kind==='pointer-held'||disposed)return;
  const elapsed=state.input.kind==='idle'?251:Math.max(0,environment.now()-state.input.lastInputAtMs);
  quiet=environment.deadline(()=>{quiet=undefined;settle('input-quiet');},Math.max(0,250-elapsed+1));
 }
 function apply(result){
  state=result.state;const effect=result.effect;if(!effect||!element)return;
  if(effect.motion==='smooth'&&!reducedMotion()){
   smoothTarget=effect.topPx;element.scrollTo({top:effect.topPx,behavior:'smooth'});return;
  }
  smoothTarget=undefined;echo=false;writing=true;
  try{if(effect.reason==='user-navigation')element.scrollTo({top:effect.topPx,behavior:'instant'});else element.scrollTop=effect.topPx;}finally{writing=false;}
  state=reduceReaderState(state,{type:'write-applied',generation:effect.generation,scrollTopPx:element.scrollTop}).state;
  if(echo){echo=false;if(state.navigation.kind==='idle')settle('scroll');}
 }
 function settle(source='options',cause){
  if(disposed||rendering||mutations)return;
  const measured=geometry();if(!measured){navigation.pause();return;}
  if(smoothTarget!==undefined&&Math.abs(measured.scrollTopPx-smoothTarget)<1)smoothTarget=undefined;
  apply(reduceReaderState(state,{type:'geometry',geometry:measured,source,cause,nowMs:environment.now(),isGenerating:isGenerating(),streamingFollowEligible:streamingFollowEligible(),programmaticMotionActive:smoothTarget!==undefined}));
  navigation.resume();navigation.sync();
  scheduleQuiet();publish();
 }
 function schedule(source,cause){
  if(disposed)return;
  pendingSource=source==='scroll'?'scroll':pendingSource??source;pendingCause=higher(pendingCause,cause);
  if(frame!==undefined||rendering||mutations)return;
  frame=environment.requestFrame(()=>{frame=undefined;const source=pendingSource,cause=pendingCause;pendingSource=undefined;pendingCause=undefined;settle(source,cause);});
 }
 function flush(){
  if(rendering||mutations)return;
  const measured=geometry();if(!measured)return;
  const source=pendingSource==='scroll'||measured.scrollTopPx!==state.geometry.scrollTopPx?'scroll':'options',cause=pendingCause;
  cancelFrame();settle(source,cause);
 }
 function record(kind,direction=0){
  if(disposed||rendering)return;
  navigation.interrupt(direction);
  state=reduceReaderState(state,{type:'input',kind,direction,nowMs:environment.now()}).state;
  smoothTarget=undefined;schedule('input');scheduleQuiet();
 }
 function onScroll(){
  if(writing){echo=true;return;}
  schedule('scroll');
  if(scrollIdle!==undefined)environment.cancelDeadline(scrollIdle);
  scrollIdle=environment.deadline(()=>{scrollIdle=undefined;settle('input-quiet');},250);
 }
 function onScrollEnd(){
  if(scrollIdle!==undefined)environment.cancelDeadline(scrollIdle);scrollIdle=undefined;
  navigation.sync();schedule('input-quiet');
 }
 function detach(){
  abort?.abort();abort=undefined;observer?.disconnect();observer=undefined;rows.clear();cancelQuiet();
  if(scrollIdle!==undefined)environment.cancelDeadline(scrollIdle);scrollIdle=undefined;
 }
 function bind(){
  const next=app.querySelector('.transcript'),key=getConversationKey();
  if(currentKey!==key){navigation.disposeActive();state=createReaderState();currentKey=key;smoothTarget=undefined;parkedTop=undefined;cancelQuiet();}
  if(element===next&&abort)return;
  detach();element=next;if(!element)return;
  abort=new AbortController();const options={signal:abort.signal};
  element.addEventListener('scroll',onScroll,{...options,passive:true});
  element.addEventListener('scrollend',onScrollEnd,options);
  element.addEventListener('wheel',event=>record(event.ctrlKey?'zoom':'scroll',event.deltaY>0?1:event.deltaY<0?-1:0),{...options,passive:true});
  element.addEventListener('keydown',event=>{const direction=keyDirection(event);if(direction!==undefined)record('scroll',direction);},options);
  element.addEventListener('pointerdown',()=>record('pointer-down'),options);
  const root=element.closest?.('.thread-frame');
  root?.addEventListener('pointerdown',event=>{if(!element.contains(event.target)&&event.target.closest?.('[data-product-jump-dock]'))record('pointer-down');},{...options,capture:true});
  for(const name of ['pointerup','pointercancel'])element.ownerDocument.addEventListener(name,()=>{if(state.input.kind==='pointer-held')record('pointer-up');},{...options,capture:true});
  const binding=abort;observer=environment.resize(()=>{if(!binding.signal.aborted)schedule('observer','measured-verification');});observer.observe(element);
 }
 function observeRows(){
  if(!element||!observer)return;
  const next=new Set(rowElements().map(row=>row.node));
  for(const row of rows)if(!next.has(row)){observer.unobserve(row);rows.delete(row);}
  for(const row of next)if(!rows.has(row)){rows.add(row);observer.observe(row);}
 }
 function reconcile(cause){
  if(disposed||rendering||mutations)return;
  bind();observeRows();const measured=geometry();if(!measured)return;
  if(parkedTop!==undefined){const top=parkedTop;parkedTop=undefined;writeNavigation(Math.min(top,Math.max(0,element.scrollHeight-element.clientHeight)));}
  navigation.resume();
  if(pendingBottom){pendingBottom=false;apply(reduceReaderState(state,{type:'bottom',geometry:measured,nowMs:environment.now()}));scheduleQuiet();publish();}
  else settle('options',cause);
 }
 function beforeRender({explicitSend=false}={}){
  if(disposed)return;if(!rendering&&!mutations)flush();pendingBottom||=explicitSend;
  if(!rendering&&state.navigation.kind!=='idle')parkedTop=element?.scrollTop;
  navigation.pause();const token=Symbol('reader-render');renders.add(token);rendering=true;cancelFrame();detach();return token;
 }
 function afterRender({renderToken,explicitSend=false,cause='structure-change'}={}){
  if(disposed)return;if(renderToken!==undefined&&!renders.delete(renderToken))throw Error('Unknown reader render capture');
  pendingBottom||=explicitSend;rendering=renders.size>0;pendingCause=higher(pendingCause,cause);
  if(rendering||mutations)return;
  const next=pendingCause;pendingCause=undefined;reconcile(next);
 }
 function beforeMutation(){
  if(disposed)return;if(!mutations&&!rendering)flush();mutations++;
 }
 function afterMutation({explicitSend=false,cause='structure-change'}={}){
  if(disposed)return;if(mutations===0)throw Error('Unmatched reader mutation');
  mutations--;pendingBottom||=explicitSend;pendingCause=higher(pendingCause,cause);
  if(mutations||rendering)return;
  const next=pendingCause;pendingCause=undefined;reconcile(next);
 }
 function jumpToBottom(){
  if(disposed)return false;
  if(rendering||mutations){const result=reduceReaderState(state,{type:'bottom',geometry:state.geometry,nowMs:environment.now()});state=result.state;pendingBottom||=result.accepted;return result.accepted;}
  bind();flush();const measured=geometry();if(!measured)return false;
  const result=reduceReaderState(state,{type:'bottom',geometry:measured,nowMs:environment.now()});apply(result);scheduleQuiet();publish();return result.accepted;
 }
 function setNavigation(active){state=reduceReaderState(state,{type:'navigation',active}).state;schedule('navigation');}
 function navigateToTarget(getTarget,{motion='auto',align='center',offsetPx=0,origin='find-in-chat',timeoutMs=2000}={}){
  if(disposed||rendering||mutations)return null;bind();flush();
  const target=getTarget(),row=rowElements().find(row=>row.node===target||row.container===target);
  if(!row||target?.isConnected===false)return null;
  if(smoothTarget!==undefined){smoothTarget=undefined;element.scrollTo({top:element.scrollTop,behavior:'instant'});}
  return navigation.navigate({kind:'row',rowId:row.rowId,align,offsetPx},{motion,origin,timeoutMs});
 }
 function interruptForUserGesture(direction=0){record('scroll',direction);}
 function setFollow(kind){state=reduceReaderState(state,{type:'follow',kind}).state;schedule('options');}
 function destroy(){
  if(disposed)return;disposed=true;navigation.destroy();cancelFrame();cancelQuiet();detach();
  if(scrollIdle!==undefined)environment.cancelDeadline(scrollIdle);scrollIdle=undefined;listeners.clear();renders.clear();element=undefined;
 }
 return {beforeRender,afterRender,beforeMutation,afterMutation,jumpToBottom,navigateToTarget,interruptForUserGesture,setNavigation,setFollow,view,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},destroy};
}

// Direct controller fixtures may omit the transcript; a mounted transcript needs its shared owner.
export function transcriptReaderFor(host){
 if(host.transcriptReader)return host.transcriptReader;
 if(host.app.querySelector('.transcript'))throw Error('Mounted transcript requires the shared reader owner');
 return null;
}

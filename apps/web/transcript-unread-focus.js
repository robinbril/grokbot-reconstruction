// Native aze/vy/vge/Age, with injectable platform objects for exact unit verification.
export function createUnreadFocusHandoff({document=globalThis.document,window=globalThis.window,Node=globalThis.Node}={}){
 let bottomButton=null,latestJump=null,pending=null;const inputs=['focusin','pointerdown','keydown'];
 const anchors=log=>Array.from(log.querySelectorAll('.sand-message-action-anchor'));
 function retainIfFocused(node,kind){if(node.contains(document.activeElement))pending=kind;}
 function clear(){for(const input of inputs)window.removeEventListener(input,clear,true);pending=null;}
 function awaitArrival(){pending='unread-jump';for(const input of inputs)window.addEventListener(input,clear,true);}
 function afterDivider(log){const divider=log.querySelector('.sand-unread-divider');if(divider!=null)return anchors(log).find(node=>(divider.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)!==0);}
 function visibleAnchor(log,{toolbarInsetPx,dockInsetPx}){
  const box=log.getBoundingClientRect(),top=box.top+toolbarInsetPx,bottom=box.bottom-dockInsetPx,middle=(top+bottom)/2;
  const groups=anchors(log).map(group=>({group,rect:group.getBoundingClientRect()}));
  const centered=groups.find(({rect})=>{const center=(rect.top+rect.bottom)/2;return center>=top&&center<=bottom;});
  return (centered??groups.find(({rect})=>rect.top<=middle&&rect.bottom>=middle))?.group;
 }
 function target(kind,options,log){
  const {isAtBottom,isUnreadJumpSettling}=options;
  if(kind==='bottom-dock')return isAtBottom?anchors(log).at(-1):latestJump??bottomButton;
  if(kind==='unread-pill'&&!isUnreadJumpSettling)return latestJump??bottomButton??visibleAnchor(log,options);
  if(document.activeElement!==document.body)return;
  const arrived=isUnreadJumpSettling?afterDivider(log):undefined;if(arrived==null)awaitArrival();return arrived;
 }
 return {
  bindScrollToBottom(node){bottomButton=node;return()=>{bottomButton=null;retainIfFocused(node,'bottom-dock');};},
  bindJumpToLatestPill(node){latestJump=node.querySelector('.sand-new-messages-pill__jump');return()=>{latestJump=null;retainIfFocused(node,'bottom-dock');};},
  bindUnreadPill:node=>()=>retainIfFocused(node,'unread-pill'),
  handOff(options){const kind=pending;clear();if(kind!=null&&!options.isCovered&&options.log!=null)target(kind,options,options.log)?.focus({preventScroll:true});},
  releaseWhenUnmounted:clear,
 };
}

import {agentExchangeRows,exchangePeerReferences,setTranscriptCovered} from './transcript-covered.js';
import {renderRichText} from './rich-transcript.js';

// R8/ZX sheet lifecycle, with Kp over the replica's actual persisted endpoint records.
export function createAgentExchangeSurface(host){
 const abort=new AbortController(),signal=abort.signal;
 const parking=document.createElement('div');parking.dataset.productPortal='';parking.dataset.exchangeParking='';parking.inert=true;
 Object.assign(parking.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none'});document.body.append(parking);
 let peer=null,conversation=null,plane=null,planeAbort=null,viewport=null,invoker=null,invokerAddress=null,savedPlaneFocus=null,closing=false,disposed=false,rowsSignature=null;
 const currentKey=()=>host.getConversationKey(),messages=()=>host.getState().messages[currentKey()]||[];
 const self=()=>host.getAgent(currentKey())||host.selectedBot?.();
 const reduced=()=>Boolean(host.sourceMotion?.reduced);
 function peers(message){return exchangePeerReferences(message,self()?.id,host.getAgent);}
 function coverage(){
  const next=host.app.querySelector('.transcript');
  if(viewport!==next){setTranscriptCovered(viewport,false);viewport=next;}
  setTranscriptCovered(viewport,peer!==null);
 }
 function notifyCoverage(){coverage();host.onTranscriptCoverageChange?.();}
 function rowMarkup(row){
  const author=host.getAgent(row.author.id)||row.author,name=author.name||author.id;
  return `<article class="product-exchange-entry" data-exchange-entry-id="${host.esc(row.id)}"><div class="product-exchange-author">${host.avatar?.(author)||''}<span>${host.esc(name)}</span></div><div class="product-exchange-bubble">${renderRichText(row.message.content)}</div>${row.attachments?.length?host.attachmentMarkup?.(row.attachments)||'':''}</article>`;
 }
 function paintRows({initial=false}={}){
  if(!plane||!peer)return;
  const rows=agentExchangeRows(messages(),peer.id,self()),signature=JSON.stringify(rows);
  const log=plane.querySelector('[data-exchange-log]'),top=log.scrollTop;
  if(signature===rowsSignature){if(initial)log.scrollTop=log.scrollHeight;return;}rowsSignature=signature;
  const old=new Map([...log.children].map(node=>[node.dataset.exchangeEntryId,node]));
  for(const row of rows){
   const markup=rowMarkup(row),existing=old.get(row.id);let node=existing;
   if(!existing||existing.outerHTML!==markup){const template=document.createElement('template');template.innerHTML=markup;node=template.content.firstElementChild;existing?.remove();}
   if(node.isConnected)log.moveBefore(node,null);else log.append(node);old.delete(row.id);
  }
  for(const node of old.values())node.remove();
  log.scrollTop=initial?log.scrollHeight:top;
 }
 function fit(){
  if(!plane)return;const frame=host.app.querySelector('.thread-frame'),container=frame?.closest('.conversation');if(!frame||!container)return;
  const dock=Math.max(0,container.getBoundingClientRect().bottom-frame.getBoundingClientRect().bottom);
  plane.style.bottom=dock>0?-dock+'px':'0px';
 }
 function mount(){
  const frame=host.app.querySelector('.thread-frame');if(!frame||!plane)return;
  if(plane.parentElement!==frame){if(plane.isConnected)frame.moveBefore(plane,null);else frame.append(plane);}
  fit();coverage();paintRows();
 }
 function findInvoker(trigger,address,key){
  if(trigger?.isConnected)return trigger;
  if(currentKey()!==key||!address)return null;
  return [...host.app.querySelectorAll('[data-action="product-exchange-open"]')].find(node=>node.dataset.exchangeEntryId===address.entryId&&node.dataset.exchangePeerId===address.peerId)||null;
 }
 function finishClose({restoreFocus=true}={}){
  if(!peer)return;
  const shouldRestore=restoreFocus&&plane?.contains(document.activeElement);
  const focus=findInvoker(invoker,invokerAddress,conversation);
  planeAbort?.abort();planeAbort=null;peer=null;conversation=null;closing=false;rowsSignature=null;plane?.remove();plane=null;invoker=null;invokerAddress=null;savedPlaneFocus=null;notifyCoverage();
  if(shouldRestore&&focus?.isConnected)focus.focus({preventScroll:true});
 }
 function close({immediate=false}={}){
  if(!peer)return;
  if(immediate){finishClose();return;}
  if(closing)return;
  if(reduced()){finishClose();return;}
  closing=true;
  for(const selector of ['.sand-exchange-sheet__sheet','.sand-exchange-sheet__footer']){
   const node=plane.querySelector(selector),style=getComputedStyle(node);node.style.opacity=style.opacity;node.style.transform=style.transform==='none'?'translateY(0px)':style.transform;
  }
  plane.dataset.exiting='';host.onAgentExchangeExitBegin?.();
 }
 function open(next,name,trigger){
  if(disposed||!next||typeof next.id!=='string'||!next.id)return false;
  const known=host.getAgent(next.id),label=typeof name==='string'&&name?name:next.name||known?.name;if(typeof label!=='string'||!label)return false;
  if(peer)finishClose({restoreFocus:false});
  const sourceKey=currentKey(),address=trigger?.dataset.exchangeEntryId?{entryId:trigger.dataset.exchangeEntryId,peerId:next.id}:null;
  if(host.clearReplyForExchange?.()===false){findInvoker(trigger,address,sourceKey)?.focus({preventScroll:true});return false;}
  conversation=currentKey();peer={...next,kind:next.kind||'agent',name:label};invoker=trigger||document.activeElement;invokerAddress=trigger?.dataset.exchangeEntryId?{entryId:trigger.dataset.exchangeEntryId,peerId:next.id}:null;closing=false;rowsSignature=null;
  planeAbort=new AbortController();plane=document.createElement('div');plane.className='sand-exchange-sheet product-agent-exchange';plane.dataset.exchangeSheet='';plane.setAttribute('role','dialog');plane.setAttribute('aria-label','Bot-uitwisseling');plane.toggleAttribute('data-reduced-motion',reduced());
  plane.innerHTML='<div class="sand-exchange-sheet__sheet"><div class="sand-exchange-sheet__scrim" aria-hidden="true"></div><div class="sand-exchange-sheet__scrim-tint" aria-hidden="true"></div><div class="sand-exchange-sheet__messages" data-exchange-log role="log" aria-label="Transcript van Bot-uitwisseling" aria-live="off" tabindex="0"></div><div class="sand-exchange-sheet__fade-bottom" aria-hidden="true"></div></div><div class="sand-exchange-sheet__footer"><div class="sand-exchange-readonly-notice" role="note" aria-label="Alleen-lezen Bot-gesprek"><button type="button" class="pill product-exchange-close" data-action="product-exchange-close">Chat sluiten</button></div></div>';
  const mounted=plane;plane.querySelector('.sand-exchange-sheet__sheet').addEventListener('animationend',event=>{if(plane===mounted&&closing&&event.target===event.currentTarget)finishClose();},{signal:planeAbort.signal});
  mount();paintRows({initial:true});notifyCoverage();plane.querySelector('[data-exchange-log]').focus({preventScroll:true});return true;
 }
 function beforeRender(){
  if(!plane)return;savedPlaneFocus=plane.contains(document.activeElement)?document.activeElement:null;const rect=plane.getBoundingClientRect();parking.style.width=rect.width+'px';parking.style.height=rect.height+'px';parking.moveBefore(plane,null);
 }
 function afterRender(){
  if(disposed)return;
  if(peer&&conversation!==currentKey()){finishClose({restoreFocus:false});return;}
  mount();coverage();if(savedPlaneFocus&&plane?.contains(savedPlaneFocus))savedPlaneFocus.focus({preventScroll:true});savedPlaneFocus=null;
 }
 function handleAction({action,target}){
  if(action==='product-exchange-close'){close();return true;}
  if(action!=='product-exchange-open')return false;
  const message=messages().find(row=>row.id===target?.dataset.exchangeEntryId),selected=message&&peers(message).find(value=>value.id===target.dataset.exchangePeerId);
  if(selected)open(selected,selected.name,target);return true;
 }
 function handleKeyDown(event){
  if(!peer||event.key!=='Escape'||host.overlay?.open)return false;
  event.preventDefault();event.stopPropagation();close();return true;
 }
 function renderSlot(slot,{message}={}){
  if(slot!=='chatEntryPeerReferences')return undefined;
  const references=peers(message);if(!references.length)return '';
  return `<div class="product-exchange-peer-references">${references.map(value=>`<button type="button" class="product-exchange-peer" data-action="product-exchange-open" data-exchange-entry-id="${host.esc(message.id)}" data-exchange-peer-id="${host.esc(value.id)}" aria-label="${host.esc('Bot-uitwisseling met '+value.name+' openen')}">${host.esc(value.name)}</button>`).join('')}</div>`;
 }
 function setReducedMotion(value){plane?.toggleAttribute('data-reduced-motion',value);if(value&&closing)finishClose();}
 function destroy(){if(disposed)return;disposed=true;finishClose({restoreFocus:false});abort.abort();parking.remove();setTranscriptCovered(viewport,false);viewport=null;}
 window.addEventListener('resize',fit,{signal});
 return {id:'agent-exchange',beforeRender,afterRender,handleAction,handleKeyDown,renderSlot,setReducedMotion,open,close,isCovered:()=>peer!==null,getPeer:()=>peer?{...peer}:null,diagnostics:()=>({peer:peer?{id:peer.id,kind:peer.kind}:null,closing,covered:peer!==null,rows:peer?agentExchangeRows(messages(),peer.id,self()).length:0}),destroy};
}

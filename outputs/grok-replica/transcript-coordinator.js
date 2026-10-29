import {createTranscriptHistory} from './transcript-history.js';
import {createHistoryLoadProbe} from './transcript-history-state.js';
import {createTranscriptReadLedger,replicaUnreadEntries,currentUnreadReceipts} from './transcript-unread-ledger.js';
import {createTranscriptUnreadSurface} from './transcript-unread-surface.js';
import {transcriptReaderFor} from './transcript-reader.js';

// Local persistence and DOM adapters; native policy lives in the feature modules.
export function createTranscriptCoordinator(host){
 const ledger=createTranscriptReadLedger({storage:localStorage}),loadProbe=createHistoryLoadProbe();
 let disposed=false,queued=false,viewport=null,scrollAbort=null,renderedKey=null,quoteFocus=null;
 const messages=key=>{const entries=host.getState().messages[key];return Array.isArray(entries)?entries:[];};
 const noteEntries=(key,{baseline=false}={})=>ledger.noteEntries(key,replicaUnreadEntries(messages(key)),{baseline});
 for(const key of Object.keys(host.getState().messages))noteEntries(key,{baseline:true});
 function resolveEntry(id){
  if(id==='unread-divider')return host.app.querySelector('[data-unread-divider]');
  return [...host.app.querySelectorAll('[data-live-message-id],.message[data-message-id]')].find(node=>node.dataset.liveMessageId===id||node.dataset.messageId===id)||null;
 }
 const history=createTranscriptHistory({
  getConversationKey:host.getConversationKey,getEntries:messages,render:host.render,
  isRemoteHistory:key=>host.cloudHistory?.isRemote(key)===true,remoteHistoryState:key=>host.cloudHistory.state(key),loadRemoteHistory:key=>host.cloudHistory.loadOlder(key),
  selectConversation(key){
   if(!host.getAgent(key))return false;
   return host.update(state=>{state.selected=key;state.context=false;});
  },
  closeExchange:()=>host.agentExchange?.close(),
  isEntryInWindow:request=>Boolean(resolveEntry(request.entryId)),
  navigateToEntry(id,motion){
   const resolve=()=>resolveEntry(id),node=resolve();if(!node)return false;
   const navigation=transcriptReaderFor(host)?.navigateToTarget(resolve,{motion,origin:'find-in-chat'});
   if(navigation!=null&&id!=='unread-divider')host.highlightTranscriptEntry?.(node);
   return navigation!=null;
  },
  onError:error=>host.showChatError(error.message||'Oudere berichten konden niet worden geladen.'),
 });
 const unread=createTranscriptUnreadSurface({...host,
  getUnreadDivider:key=>host.cloudHistory?.isRemote(key)?host.cloudHistory.divider(key):undefined,
  getUnreadRow:key=>ledger.row(key,replicaUnreadEntries(messages(key))),getUnreadEntries:key=>currentUnreadReceipts(replicaUnreadEntries(messages(key)),ledger.entries(key)),
  onUnreadOpen:key=>ledger.markRead(key,replicaUnreadEntries(messages(key))),
  isTranscriptCovered:()=>host.agentExchange?.isCovered()===true,
  getUnreadDividerSide(divider){
   const key=host.getConversationKey(),all=messages(key),visible=history.entriesFor(key,all);
   const index=all.findIndex(entry=>entry.id===divider.parentEntryId),start=all.length-visible.length;
   return index>=0&&index<start||index<0&&host.cloudHistory?.isRemote(key)&&host.cloudHistory.state(key).hasOlder?'above':null;
  },
  chaseUnreadBoundary:({conversationKey,boundaryAt})=>history.revealEntry(conversationKey,'unread-divider',{boundaryAt}),
  cancelUnreadBoundaryChase:()=>history.cancelBoundary(),
 });
 function bindScroll(){
  const next=host.app.querySelector('.transcript');if(viewport===next)return;
  scrollAbort?.abort();viewport=next;scrollAbort=new AbortController();
  viewport?.addEventListener('scroll',()=>loadProbe.probe(),{passive:true,signal:scrollAbort.signal});
 }
 function showSaveState(){
  const wrap=host.app.querySelector('.composer-wrap');if(!wrap)return;
  let warning=wrap.querySelector('[data-unread-save-error]');
  if(!ledger.diagnostics().saveFailed){warning?.remove();return;}
  if(!warning){warning=document.createElement('p');warning.dataset.unreadSaveError='';warning.className='workflow-chat-feedback';warning.setAttribute('role','status');wrap.append(warning);}
  warning.textContent='Leesstatus kon niet worden opgeslagen.';
 }
 function beforeTranscriptCapture(){
  const target=document.activeElement?.closest?.('[data-action="product-quote-jump"],[data-action="live-reply-jump"]');
  quoteFocus=target&&host.app.contains(target)?{key:renderedKey??host.getConversationKey(),entryId:target.closest('.message[data-message-id]')?.dataset.messageId,action:target.dataset.action,quoteId:target.dataset.quoteMessageId,replyId:target.dataset.replyMessageId}:null;
 }
 function restoreQuoteFocus(){
  const saved=quoteFocus;quoteFocus=null;if(!saved||saved.key!==host.getConversationKey())return;
  if(document.activeElement!==document.body&&document.activeElement?.isConnected)return;
  const row=[...host.app.querySelectorAll('.message[data-message-id]')].find(node=>node.dataset.messageId===saved.entryId);
  const quote=[...row?.querySelectorAll('[data-action="product-quote-jump"],[data-action="live-reply-jump"]')||[]].find(node=>node.dataset.action===saved.action&&node.dataset.quoteMessageId===saved.quoteId&&node.dataset.replyMessageId===saved.replyId);
  quote?.focus({preventScroll:true});
 }
 function afterRender(){for(const key of Object.keys(host.getState().messages))noteEntries(key);unread.prepareOpen();renderedKey=host.getConversationKey();}
 function afterTranscriptReconcile(){
  if(disposed||queued)return;queued=true;
  queueMicrotask(()=>{
   queued=false;if(disposed)return;
   unread.afterRender();history.afterRender();host.cloudHistory?.afterRender();bindScroll();
   loadProbe.promote({wiringKey:history.diagnostics().hasOlder?viewport:null,maybeLoadOlder:()=>history.probe(viewport)});restoreQuoteFocus();showSaveState();
  });
 }
 const focusAbort=new AbortController();
 window.addEventListener('focus',()=>{unread.prepareOpen();const key=host.getConversationKey(),entries=replicaUnreadEntries(messages(key));if(ledger.row(key,entries).hasUnread)ledger.markRead(key,entries);showSaveState();},{signal:focusAbort.signal});
 return {id:'transcript-coordinator',history,beforeTranscriptCapture,afterRender,afterTranscriptReconcile,
  entriesFor:(key,entries)=>history.entriesFor(key,host.cloudHistory?.filterEntries(entries)??entries),
  noteEntries,refresh:afterTranscriptReconcile,
  revealEntry:(...args)=>history.revealEntry(...args),
  handleAction:ctx=>unread.handleAction(ctx),
  diagnostics:()=>({history:history.diagnostics(),unread:unread.diagnostics(),ledger:ledger.diagnostics()}),
  destroy(){disposed=true;focusAbort.abort();scrollAbort?.abort();history.destroy();unread.destroy();},
 };
}

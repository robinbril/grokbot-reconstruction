import {renderComposerDocument} from './composer-document-view.js';
import {createSendJournal} from './send-journal.js';
// Browser-local delivery intent. This adapter never contacts Grok or starts a model.
export function createWorkflowDelivery(host){
 let disposed=false,journal,refreshQueued=false,renderedProjection=null,recovering=false;
 const abort=new AbortController(),key=()=>host.getConversationKey();
 function projection(){
  const conversationId=key(),state=host.getState(),messages=state.messages[conversationId]||[];
  const accepted=new Set(messages.filter(message=>message.clientNonce).map(message=>JSON.stringify([message.id,message.clientNonce])));
  // A nonce binds an immutable snapshot, so IDs and phases fully identify the
  // visible pending projection without serializing message/attachment bodies.
  const pending=journal.records(conversationId).filter(record=>!accepted.has(JSON.stringify([record.inputEntryId,record.nonce]))).map(record=>[record.nonce,record.inputEntryId,record.phase,record.errorCode||null]);
  const roster=state.agents.filter(agent=>!state.hidden.includes(agent.id)).map(agent=>[agent.id,agent.preview]);
  return JSON.stringify([conversationId,navigator.onLine!==false,messages.map(message=>message.id),pending,roster]);
 }
 function changed(){if(disposed||refreshQueued)return;refreshQueued=true;queueMicrotask(()=>{refreshQueued=false;if(!disposed&&projection()!==renderedProjection)host.render();});}
 function make(){return createSendJournal({getState:host.getState,commit:host.commit,prepareEnqueue:host.prepareSendEnqueue,prepareCancel:host.prepareSendCancel,dispatch:host.acceptLocalSend,lookupAcceptance:host.lookupSavedSend,isHeld:()=>navigator.onLine===false,onChange:changed});}
 journal=make();
 function drain(){if(!disposed)return journal.drain().catch(()=>{});}
 window.addEventListener('online',()=>{changed();drain();},{signal:abort.signal});
 window.addEventListener('offline',changed,{signal:abort.signal});
 queueMicrotask(drain);
 function rows(){const state=host.getState();return journal.records(key()).filter(record=>!(state.messages[key()]||[]).some(message=>message.clientNonce===record.nonce&&message.id===record.inputEntryId)).map(record=>{
  const snapshot=record.snapshot,label=record.phase==='queued'?(navigator.onLine===false?'Wacht op verbinding':'Wacht op lokale opslag'):record.phase==='prepared'?'Lokaal voorbereiden':record.phase==='dispatching'?'Lokale ontvangst controleren':record.phase==='accepted-awaiting-echo'?'Lokaal geaccepteerd · wacht op bevestiging':'Niet opgeslagen';
  const actions=record.phase==='failed'?`<button type="button" class="text-button" data-action="workflow-send-retry" data-id="${host.esc(record.nonce)}">Opnieuw proberen</button><button type="button" class="text-button" data-action="workflow-send-remove" data-id="${host.esc(record.nonce)}">Verwijderen</button>`:['queued','prepared','dispatching'].includes(record.phase)?`<button type="button" class="text-button" data-action="workflow-send-cancel" data-id="${host.esc(record.nonce)}">Terug naar concept</button>`:'';
  return `<article class="message user workflow-pending" data-workflow-nonce="${host.esc(record.nonce)}"><div class="bubble">${host.renderReplyQuote(snapshot.quote)}${renderComposerDocument(snapshot,host.esc,{resolveMentionMember:host.getAgent,renderMentionAvatar:member=>host.avatar(member,'static')})??`${host.esc(snapshot.text.trim()).replace(/\n/g,'<br>')}${host.renderSkillReferences(snapshot.skillReferences)}`} ${host.attachmentMarkup(snapshot.attachments)}</div><div class="workflow-delivery-status" role="status">${label}</div>${actions?`<div class="workflow-delivery-actions">${actions}</div>`:''}</article>`;
 }).join('');}
 async function recover(nonce){
  if(recovering||disposed)return true;
  const record=journal.records().find(row=>row.nonce===nonce);if(!record)return true;
  const snapshot=record.snapshot,conversationId=snapshot.conversationId,owner=journal;let succeeded=false;recovering=true;
  try{
   await host.prepareQueuedDraftRecovery(snapshot);
   if(disposed||owner!==journal)throw Error('stale-recovery');
   const result=await journal.cancelQueued(nonce);succeeded=result.ok;
   if(!succeeded)throw Error('uncertain');
   host.clearChatError?.(conversationId);host.completeQueuedDraftRecovery(snapshot,true);host.render();
   if(key()===conversationId)host.app.querySelector('#message-input')?.focus();
   await drain();
  }catch(error){
   host.completeQueuedDraftRecovery?.(snapshot,false);
   if(!disposed)host.showChatError(error.message==='draft-conflict'?'Concept niet teruggezet. Bewaar of wis eerst je nieuwere concept.':'Concept niet teruggezet. Ontvangst of opslag kon niet veilig worden bevestigd.',conversationId);
  }finally{recovering=false;}
  return true;
 }
 return {id:'workflow-delivery',afterRender(){renderedProjection=projection();},get journal(){return journal;},enqueue:snapshot=>journal.enqueue(snapshot),drain,
  reset(){journal.destroy();journal=make();queueMicrotask(drain);},
  clearConversation(conversationId){
   const result=host.commit(current=>({...current,messages:{...current.messages,[conversationId]:[]},chatRuns:Object.fromEntries(Object.entries(current.chatRuns||{}).filter(([,run])=>run.conversationId!==conversationId)),sendJournal:{schema:1,records:journal.records().filter(record=>record.snapshot.conversationId!==conversationId)}}),{reason:'clear-conversation'});
   if(!result.ok){host.showChatError('Gesprek niet gewist. De lokale wachtrij kon niet worden opgeslagen.');return false;}
   journal.destroy();journal=make();host.revokeChatConversation?.(conversationId);queueMicrotask(drain);return true;
  },
  handleAction({action,id}){if(action==='workflow-send-cancel')return recover(id);if(action==='workflow-send-retry')return journal.retry(id).then(()=>true);if(action==='workflow-send-remove'){const result=journal.removeFailed(id);if(!result.ok){host.showChatError('Wachtrijbericht niet verwijderd. Probeer opnieuw.');return true;}return drain().then(()=>true);}return false;},
  renderSlot(name){if(name==='workflowPendingRows')return rows();if(name==='workflowSendNotice'&&navigator.onLine===false)return '<div class="workflow-connection-notice small" role="status">Geen verbinding · berichten wachten in deze browser</div>';return undefined;},
  destroy(){if(disposed)return;disposed=true;abort.abort();journal.destroy();}
 };
}

import {findQueuedDraft,removeQueuedDraft} from './live-queued-drafts.js';

const ready=row=>row&&!row.runId&&['queued','preparing','blocked'].includes(row.status);
const pending=row=>row&&!row.runId&&['queued','preparing','blocked','cancelled'].includes(row.status);
const uncertain=()=>new Error('Het oorspronkelijke concept kon niet veilig worden teruggezet. Controleer de ontvangst; je nieuwere concept blijft behouden.');
const started=()=>Object.assign(new Error('De opdracht is al gestart of afgehandeld en kan niet worden teruggezet. Je huidige concept is behouden.'),{code:'QUEUE_ALREADY_STARTED'});

// Server cancellation and local draft restoration have separate durable receipts.
// Only a fresh, never-run cancelled row can complete the local recovery transaction.
export function createLiveQueueDraftRecovery({host,serverId,snapshot}){
 const prepared=new Map();let disposed=false;
 const rowFor=record=>(snapshot(record.conversationId).queue||[]).find(row=>row.id===record.targetId);
 function bindingFor(record){
  if(disposed||serverId(record.conversationId)!==record.serverConversationId)throw uncertain();
  const row=rowFor(record),binding=findQueuedDraft(host.getState(),record.conversationId,record.serverConversationId,row);
  if(!pending(row)||!binding)throw uncertain();return binding;
 }
 function eligible(conversationId,row){
  return !disposed&&ready(row)&&Boolean(findQueuedDraft(host.getState(),conversationId,serverId(conversationId),row));
 }
 async function prepare(record){
  const binding=bindingFor(record);
  try{
   await host.prepareQueuedDraftRecovery(binding.draft);
   if(disposed||JSON.stringify(bindingFor(record))!==JSON.stringify(binding))throw uncertain();
   prepared.set(record.lock,binding);
  }catch(error){host.completeQueuedDraftRecovery?.(binding.draft,false);throw error;}
 }
 function confirmed(record,result){
  const binding=bindingFor(record),row=rowFor(record);
  if(result?.schema!==1||result.acknowledged!==true||result.queueId!==record.targetId||result.status!=='cancelled'||row.status!=='cancelled')throw uncertain();
  return binding;
 }
 function finish(record,result,actions){
  const binding=confirmed(record,result),original=prepared.get(record.lock);
  if(!original||JSON.stringify(original)!==JSON.stringify(binding))throw uncertain();
  actions.retire(record,false,state=>removeQueuedDraft(host.prepareSendCancel(state,binding.draft),binding));
  prepared.delete(record.lock);host.completeQueuedDraftRecovery(binding.draft,true);host.render?.();
  if(host.getConversationKey()===binding.conversationId&&!host.overlay?.open)host.app.querySelector('#message-input')?.focus();
 }
 function discard(record,result,actions){
  if(result?.acknowledged!==true||result.queueId!==record.targetId||result.status!=='cancelled'){actions.retire(record);return;}
  const row=rowFor(record),binding=findQueuedDraft(host.getState(),record.conversationId,record.serverConversationId,row);
  if(row?.status!=='cancelled'||!binding){actions.retire(record);return;}
  actions.retire(record,false,state=>removeQueuedDraft(state,binding));
 }
 function cleanup(record){
  const binding=prepared.get(record.lock);if(!binding)return;
  prepared.delete(record.lock);host.completeQueuedDraftRecovery?.(binding.draft,false);
 }
 function releaseStarted(record,actions){
  const row=rowFor(record);
  if(disposed||serverId(record.conversationId)!==record.serverConversationId||!row||!(row.runId&&['sending','running','blocked'].includes(row.status)||['completed','failed','interrupted'].includes(row.status)))return false;
  actions.retire(record,true);return true;
 }
 function rejectStarted(record,error,actions){
  if(error?.code!=='QUEUE_IN_FLIGHT'||disposed||serverId(record.conversationId)!==record.serverConversationId)return false;
  actions.retire(record,true);return true;
 }
 function terminalResponse(record,result,actions){
  const row=rowFor(record);
  if(result?.schema!==1||result.acknowledged!==true||result.queueId!==record.targetId||!['completed','failed','interrupted'].includes(result.status)||row?.status!==result.status)return false;
  return releaseStarted(record,actions);
 }
 return {eligible,prepare,finish,discard,cleanup,releaseStarted,rejectStarted,terminalResponse,started,destroy(){disposed=true;for(const lock of prepared.keys())cleanup({lock});}};
}

import {HISTORY_ACTIVE_TAIL_LIMIT,HISTORY_PAGE_LIMIT,historyEntryMatches,planPendingReveal,shouldLoadOlderHistory} from './transcript-history-state.js';

// Local persisted-history adapter: ownership/storage stay with the existing host.
// Native cloud RPC/sequence schemas are not imitated by this renderer adapter.
export function createTranscriptHistory(host){
 const windows=new Map();let pending=null,disposed=false,advancing=false,lastDrop=null;
 const now=host.now??Date.now;
 const remote=key=>host.isRemoteHistory?.(key)===true;
 const hasOlder=(key,value=windowFor(key))=>remote(key)?host.remoteHistoryState(key).hasOlder:value.start>0;
 function windowFor(key,entries=host.getEntries(key)){
  let value=windows.get(key);
  if(!value){const start=Math.max(0,entries.length-HISTORY_ACTIVE_TAIL_LIMIT);value={firstId:entries[start]?.id??null,start,loading:null,generation:0};windows.set(key,value);}
  let start=value.firstId===null?-1:entries.findIndex(entry=>entry.id===value.firstId);
  if(start<0){start=Math.max(0,entries.length-HISTORY_ACTIVE_TAIL_LIMIT);value.firstId=entries[start]?.id??null;}
  value.start=start;return value;
 }
 function entriesFor(key,entries=host.getEntries(key)){
  return remote(key)?entries:entries.slice(windowFor(key,entries).start);
 }
 function isVisibleEntry(key,id,entries=host.getEntries(key)){
  return entriesFor(key,entries).some(entry=>historyEntryMatches(entry,id));
 }
 function targetInWindow(request,key){
  const entries=entriesFor(key);
  return request.boundaryAt!=null&&host.isEntryInWindow?host.isEntryInWindow(request,key,entries):entries.some(entry=>historyEntryMatches(entry,request.entryId));
 }
 function loadOlder(key=host.getConversationKey()){
  const value=windowFor(key);
  if(value.loading)return value.loading;
  if(disposed||!hasOlder(key,value))return Promise.resolve({added:0,hasOlder:false});
  const generation=value.generation;
  const finish=success=>{if(value.loading===operation){value.loading=null;if(success)afterRender();}};
  const operation=Promise.resolve().then(()=>{
   if(remote(key))return host.loadRemoteHistory(key);
   if(disposed||generation!==value.generation)return {added:0,invalidated:true};
   const entries=host.getEntries(key),start=windowFor(key,entries).start,next=Math.max(0,start-HISTORY_PAGE_LIMIT);
   value.start=next;value.firstId=entries[next]?.id??null;
   if(key===host.getConversationKey())host.render();
   return {added:start-next,hasOlder:next>0};
  }).then(result=>{finish(true);return result;},error=>{finish(false);throw error;});
  value.loading=operation;return operation;
 }
 function startLoad(request){
  pending=request;
  loadOlder(request.agentId).catch(error=>{
   if(pending!==request||disposed)return;
   pending=null;lastDrop='load-failed';host.onError?.(error);
  });
 }
 function navigate(request){
  const result=host.navigateToEntry(request.entryId,request.boundaryAt!=null?'smooth':'auto');
  if(!result)lastDrop='unresolved';return Boolean(result);
 }
 function afterRender(){
  if(disposed||advancing||pending===null)return;
  advancing=true;
  try{
   const request=pending,key=host.getConversationKey(),value=windowFor(key);
   const plan=planPendingReveal(request,{currentAgentId:key,nowMs:now(),isEntryInWindow:targetInWindow(request,key),isWindowLoading:remote(key)?!host.remoteHistoryState(key).ready:host.isWindowLoading?.(key)===true,hasOlderHistory:hasOlder(key,value),isLoadingOlderHistory:value.loading!==null});
   if(plan.kind==='drop'){pending=null;lastDrop='unresolved';}
   else if(plan.kind==='reveal'){pending=null;navigate(request);}
   else if(plan.kind==='load-older')startLoad(plan.requested);
  }finally{advancing=false;}
 }
 function revealEntry(agentId,entryId,{boundaryAt}={}){
  if(disposed||typeof agentId!=='string'||!agentId||typeof entryId!=='string'||!entryId)return false;
  host.closeExchange?.();lastDrop=null;
  const fromAgentId=host.getConversationKey(),request={agentId,entryId,fromAgentId,pagesRequested:0,parkedAtMs:now(),...(boundaryAt!=null?{boundaryAt}:{})};
  if(agentId!==fromAgentId){pending=request;const selected=host.selectConversation(agentId);if(selected===false){pending=null;lastDrop='unresolved';return false;}afterRender();return true;}
  if(targetInWindow(request,agentId))return navigate(request);
  const value=windowFor(agentId);
  if(!hasOlder(agentId,value)){lastDrop='unresolved';return false;}
  startLoad({...request,pagesRequested:1});return true;
 }
 function probe(viewport){
  if(disposed||!viewport)return null;
  const key=host.getConversationKey(),value=windowFor(key);
  if(!shouldLoadOlderHistory({scrollTop:viewport.scrollTop,hasOlder:hasOlder(key,value),isLoadingOlder:value.loading!==null}))return null;
  const operation=loadOlder(key);operation.catch(error=>host.onError?.(error));return operation;
 }
 function cancelBoundary(){if(pending?.boundaryAt!=null)pending=null;}
 function diagnostics(){
  const key=host.getConversationKey(),entries=host.getEntries(key),value=windowFor(key,entries);
  return {key,pending:pending?{...pending}:null,lastDrop,total:entries.length,visible:remote(key)?entries.length:entries.length-value.start,hasOlder:hasOlder(key,value),isLoadingOlder:value.loading!==null};
 }
 function destroy(){disposed=true;pending=null;for(const value of windows.values())value.generation++;windows.clear();}
 return {entriesFor,isVisibleEntry,loadOlder,revealEntry,afterRender,probe,cancelBoundary,diagnostics,destroy};
}

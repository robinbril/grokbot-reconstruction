// Native jXe / D2e policy. Span provenance: covered-unread-history-2026-10-21/history/native-evidence.json.
export const HISTORY_PAGE_LIMIT=100;
export const HISTORY_ACTIVE_TAIL_LIMIT=500;
export const HISTORY_REVEAL_MAX_PAGES=20;
export const HISTORY_REVEAL_SWITCH_TIMEOUT_MS=30000;
export function planPendingReveal(request,environment){
 const matches=environment.currentAgentId===request.agentId;
 if(!matches&&environment.nowMs-request.parkedAtMs>HISTORY_REVEAL_SWITCH_TIMEOUT_MS)return {kind:'drop'};
 if(!matches)return {kind:environment.currentAgentId===request.fromAgentId?'wait':'drop'};
 if(environment.isEntryInWindow)return {kind:'reveal'};
 if(environment.isWindowLoading)return {kind:'wait'};
 if(!environment.hasOlderHistory)return {kind:'drop'};
 if(environment.isLoadingOlderHistory)return {kind:'wait'};
 if(request.pagesRequested>=HISTORY_REVEAL_MAX_PAGES)return {kind:'drop'};
 return {kind:'load-older',requested:{...request,pagesRequested:request.pagesRequested+1}};
}
export function historyEntryMatches(entry,id){
 return entry.id===id||Boolean(entry.liveHarness?.messages?.some(message=>message.id===id));
}

export const HISTORY_LOAD_TOP_PX=600;
export function shouldLoadOlderHistory({scrollTop,hasOlder,isLoadingOlder}){
 return hasOlder&&!isLoadingOlder&&scrollTop<=HISTORY_LOAD_TOP_PX;
}
export function createHistoryLoadProbe(){
 let callback=()=>{},key=null;
 return {promote(value){callback=value.maybeLoadOlder;if(value.wiringKey!==key){key=value.wiringKey;if(key!==null)callback();}},probe:()=>callback()};
}

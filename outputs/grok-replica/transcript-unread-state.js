// Derived from native LRe, LK/X5e, oLe and zRe; local labels in unread/evidence.json.
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const excluded=new Set(['tool-call','user-attachment','mcp-app','spend-initiation','error']);
export function createUnreadBoundaryStore(){
 const boundaries=new Map();let disposed=false;
 return {read:key=>boundaries.get(key)??null,noteAgentOpenBegin({agentId,row,isSameAgentReopen=false}){
  if(disposed||!agentId||isSameAgentReopen)return;
  const viewed=positive(row?.lastViewedAt)?row.lastViewedAt:0,activity=positive(row?.lastActivityAt)?row.lastActivityAt:0;
  if(activity>viewed)boundaries.set(agentId,viewed);else boundaries.delete(agentId);
 },reset(){boundaries.clear();},dispose(){disposed=true;}};
}
export function isUnreadEntry(entry){
 if(!positive(entry.timestampMs)||(entry.kind==='message'&&entry.suppressed!=null)||(['message','send-message','user-attachment','notice'].includes(entry.kind)&&entry.branched===true)||excluded.has(entry.kind))return false;
 const channel=entry.kind==='message'?entry.channel:entry.kind==='send-message'&&['text','attachment'].includes(entry.message?.type)?entry.message.channel:undefined;
 if(typeof channel==='string'&&['voice:','meeting:'].some(prefix=>channel.startsWith(prefix)))return false;
 if(entry.kind!=='message')return true;
 if(entry.toAgent!=null&&!['agent','cloud-agent'].includes(entry.toAgent.kind))return false;
 return entry.fromAgent!=null||entry.toAgent!=null||entry.fromUser!=null||entry.role!=='user';
}
export function unreadDivider(entries,boundaryAt){
 if(boundaryAt==null)return null;
 const unread=entries.filter(entry=>(entry.eligible??isUnreadEntry(entry))&&entry.timestampMs>boundaryAt);
 return unread.length?{id:'unread-divider',entryId:unread[0].id,parentEntryId:unread[0].entryId??unread[0].id,newMessageCount:unread.length}:null;
}
export function updateUnreadPillState(previous,{boundaryAt,observedSide}){
 const same=previous.boundaryAt===boundaryAt;
 return {boundaryAt,hasSeen:same&&previous.hasSeen||observedSide==='in-view',hasDismissed:same&&previous.hasDismissed};
}
export function unreadDividerSide({rowIndex,mountedRange,observedSide}){
 if(rowIndex==null||mountedRange==null)return null;
 return rowIndex<mountedRange.firstIndex?'above':rowIndex>mountedRange.lastIndex?'below':observedSide??'in-view';
}
export function showsUnreadPill({hasPortal,hasDivider,side,state,isUnreadJumpSettling,isCovered}){
 return Boolean(hasPortal&&hasDivider&&side==='above'&&!state.hasSeen&&!state.hasDismissed&&!isUnreadJumpSettling&&!isCovered);
}

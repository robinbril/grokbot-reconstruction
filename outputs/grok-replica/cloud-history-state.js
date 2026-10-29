export function mergeCloudEntries(previous,incoming){
 const rows=new Map(previous.map(row=>[row.id,row]));
 for(const row of incoming){const old=rows.get(row.id);if(!old||(row.revision??0)>=(old.revision??0))rows.set(row.id,row);}
 return [...rows.values()].sort((a,b)=>(a.historySeq??Number.MAX_SAFE_INTEGER)-(b.historySeq??Number.MAX_SAFE_INTEGER));
}
export function cloudUnreadDivider(status){
 const first=status?.firstUnread;
 return first&&status.unreadCount>0?{id:'unread-divider',entryId:first.messageId,parentEntryId:first.entryId,newMessageCount:status.unreadCount}:null;
}

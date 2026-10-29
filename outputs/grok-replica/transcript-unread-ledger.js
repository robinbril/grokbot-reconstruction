import {isUnreadEntry} from './transcript-unread-state.js';
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=512;
function timestamp(value){const number=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return positive(number)?number:undefined;}
// Explicit replica-to-native entry adapter; tool cards and uncommitted drafts are not messages.
export function replicaUnreadEntries(messages){
 return messages.flatMap(message=>{
  if(!identity(message?.id))return [];
  const time=timestamp(message.createdAt),shared={...(time===undefined?{}:{timestampMs:time}),...(message.channel?{channel:message.channel}:{}),...(message.branched?{branched:message.branched}:{}),...(message.suppressed!=null?{suppressed:message.suppressed}:{}),...(message.fromAgent?{fromAgent:message.fromAgent}:{}),...(message.toAgent?{toAgent:message.toAgent}:{})};
  if(message.liveHarness){
   if(message.liveHarness.kind==='user')return [{...shared,id:message.id,kind:'message',role:'user'}];
   if(message.liveHarness.kind!=='assistant')return [];
   const deliveryMetadata={...shared};delete deliveryMetadata.timestampMs;
   return (message.liveHarness.messages||[]).filter(item=>identity(item?.id)&&['text','attachment'].includes(item.type)).map(item=>({...deliveryMetadata,id:item.id,entryId:message.id,kind:'send-message',message:{type:item.type,...(item.channel||message.channel?{channel:item.channel||message.channel}:{})},...(timestamp(item.createdAt)===undefined?{}:{timestampMs:timestamp(item.createdAt)})}));
  }
  if(message.transcript){
   if(message.transcript.kind!=='send-message'||message.transcript.status!=='stable')return [];
   return [{...shared,id:message.id,kind:'send-message',message:{type:'text',...(message.channel?{channel:message.channel}:{})}}];
  }
  if(!['user','bot'].includes(message.role)||typeof message.text!=='string'||!message.text.length)return [];
  return [{...shared,id:message.id,kind:'message',role:message.role==='user'?'user':'assistant'}];
 });
}
function decode(bytes){
 if(!bytes)return new Map();
 try{
  const state=JSON.parse(bytes);if(state.version!==1||!Array.isArray(state.conversations))return new Map();
  return new Map(state.conversations.filter(row=>identity(row?.key)&&Array.isArray(row.seenIds)&&Array.isArray(row.receipts)).map(row=>[row.key,{lastViewedAt:positive(row.lastViewedAt)?row.lastViewedAt:0,seenIds:[...new Set(row.seenIds.filter(identity))],receipts:row.receipts.filter(item=>identity(item?.id)&&identity(item.entryId)&&positive(item.timestampMs)&&typeof item.eligible==='boolean').map(item=>({id:item.id,entryId:item.entryId,timestampMs:item.timestampMs,eligible:item.eligible}))}]));
 }catch{return new Map();}
}
export function createTranscriptReadLedger({storage=localStorage,key='grok-local-unread-v1',now=Date.now}={}){
 let rows;try{rows=decode(storage.getItem(key));}catch{rows=new Map();}let saveFailed=false;
 const empty=()=>({lastViewedAt:0,seenIds:[],receipts:[]});
 function write(next){
  const conversations=Array.from(next,([key,row])=>({key,...row}));
  try{storage.setItem(key,JSON.stringify({version:1,conversations}));}catch{saveFailed=true;return false;}
  rows=next;saveFailed=false;return true;
 }
 function row(conversationKey,currentNativeEntries){
  const value=rows.get(conversationKey)||empty(),receipts=currentNativeEntries===undefined?value.receipts:currentUnreadReceipts(currentNativeEntries,value.receipts),lastActivityAt=receipts.reduce((max,item)=>item.eligible?Math.max(max,item.timestampMs):max,0);
  return {lastViewedAt:value.lastViewedAt,lastActivityAt,hasUnread:lastActivityAt>value.lastViewedAt};
 }
 function noteEntries(conversationKey,entries,{baseline=false}={}){
  if(!identity(conversationKey)||!Array.isArray(entries))return false;
  const previous=rows.get(conversationKey)||empty(),seen=new Set(previous.seenIds),receipts=[...previous.receipts];let changed=false;
  for(const entry of entries){
   if(!identity(entry?.id)||seen.has(entry.id))continue;
   seen.add(entry.id);changed=true;
   const time=positive(entry.timestampMs)?entry.timestampMs:baseline?undefined:now();
   if(!positive(time))continue;
   receipts.push({id:entry.id,entryId:identity(entry.entryId)?entry.entryId:entry.id,timestampMs:time,eligible:isUnreadEntry({...entry,timestampMs:time})});
  }
  if(!changed)return true;
  return write(new Map(rows).set(conversationKey,{...previous,seenIds:[...seen],receipts}));
 }
 function markRead(conversationKey,currentNativeEntries){
  if(!identity(conversationKey))return false;
  const previous=rows.get(conversationKey)||empty(),time=now();if(!positive(time))return false;
  const lastViewedAt=Math.max(previous.lastViewedAt,row(conversationKey,currentNativeEntries).lastActivityAt,time);
  return lastViewedAt===previous.lastViewedAt?true:write(new Map(rows).set(conversationKey,{...previous,lastViewedAt}));
 }
 return {row,noteEntries,markRead,entries:conversationKey=>(rows.get(conversationKey)?.receipts||[]).map(item=>({...item})),diagnostics:()=>({saveFailed,conversations:rows.size})};
}

// Receipt storage is not the transcript: deleted rows disappear and current source order wins.
export function currentUnreadReceipts(nativeEntries,receipts){
 const byId=new Map(receipts.map(receipt=>[receipt.id,receipt]));
 return nativeEntries.flatMap(entry=>{const receipt=byId.get(entry.id);return receipt?[{...receipt,eligible:isUnreadEntry({...entry,timestampMs:receipt.timestampMs})}]:[];});
}

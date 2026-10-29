import {harnessError,identifier} from './store.mjs';
import {isUnreadEntry} from '../transcript-unread-state.js';
const maximumPageSize=500;
const finiteSeq=value=>Number.isSafeInteger(value)&&value>=0;
const timestamp=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
const invalid=()=>harnessError('INVALID_HISTORY_CURSOR','Use bounded integer history cursors',422);
function requireState(state){if(!state)throw harnessError('NOT_FOUND','Conversation not found',404);return state;}
function historyState(state){return state.historyState??={schema:1,nextSeq:0,entries:[],deliveries:[],throughSeq:0,lastViewedAt:0};}
function deliveredMessages(entry){
 if(Array.isArray(entry.messages))return entry.messages.filter(message=>typeof message?.id==='string'&&['text','attachment'].includes(message.type));
 if(entry.runId!=null||entry.streaming===true||entry.messageDrafts!=null||['accepted','starting','running','streaming'].includes(entry.status)||typeof entry.text!=='string'||!entry.text.length)return [];
 return [entry];
}
function indexState(state,clock){
 const history=historyState(state),entryIds=new Set(history.entries.map(entry=>entry.id)),deliveryIds=new Set(history.deliveries.map(delivery=>delivery.id));
 for(const entry of state.entries){
  if(!entryIds.has(entry.id)){history.entries.push({id:entry.id,seq:++history.nextSeq});entryIds.add(entry.id);}
  const messages=deliveredMessages(entry);
  for(const message of messages){
   if(deliveryIds.has(message.id))continue;
   const at=timestamp(message.createdAt??entry.createdAt);
   history.deliveries.push({id:message.id,entryId:entry.id,seq:++history.nextSeq,timestampMs:Number.isFinite(at)&&at>0?at:clock()});deliveryIds.add(message.id);
  }
 }
 return history;
}
function hasCompleteIndex(state){
 const history=state.historyState;if(!history)return false;
 const entries=new Set(history.entries.map(entry=>entry.id)),deliveries=new Set(history.deliveries.map(delivery=>delivery.id));
 return state.entries.every(entry=>entries.has(entry.id)&&(deliveredMessages(entry)).every(message=>deliveries.has(message.id)));
}
function activity(state){
 const history=historyState(state),receipts=new Map(history.deliveries.map(receipt=>[receipt.id,receipt]));
 return state.entries.flatMap(entry=>{
  const messages=deliveredMessages(entry);
  return messages.flatMap(message=>{
   const receipt=receipts.get(message.id);if(!receipt||receipt.entryId!==entry.id)return [];
   const candidate={...entry,...message,kind:message.kind??entry.kind??'message',timestampMs:receipt.timestampMs};
   if(!['assistant','bot'].includes(entry.role)&&entry.fromAgent==null&&entry.toAgent==null)return [];
   return isUnreadEntry(candidate)?[{...receipt,messageId:message.id}]:[];
  });
 }).sort((a,b)=>a.seq-b.seq);
}
function status(state,throughSeq=historyState(state).throughSeq){
 const history=historyState(state),eligible=activity(state),unread=eligible.filter(receipt=>receipt.seq>throughSeq);
 const first=unread[0];
 return {throughSeq,lastHistorySeq:history.nextSeq,lastActivitySeq:eligible.at(-1)?.seq??0,unreadCount:unread.length,lastViewedAt:history.lastViewedAt,lastActivityAt:eligible.at(-1)?.timestampMs??0,firstUnread:first?{entryId:first.entryId,messageId:first.id,seq:first.seq,timestampMs:first.timestampMs}:null};
}
function decoratedEntries(state){
 const history=historyState(state),sequences=new Map(history.entries.map(entry=>[entry.id,entry.seq])),deliveries=new Map(history.deliveries.map(delivery=>[delivery.id,delivery.seq]));
 return state.entries.map(entry=>({...entry,historySeq:sequences.get(entry.id),...(Array.isArray(entry.messages)?{messages:entry.messages.map(message=>({...message,historySeq:deliveries.get(message.id)}))}:{})})).sort((a,b)=>a.historySeq-b.historySeq);
}
function validatePage({beforeSeq,limit=maximumPageSize,unreadAfterSeq}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>maximumPageSize||beforeSeq!==undefined&&(!finiteSeq(beforeSeq)||beforeSeq===0)||unreadAfterSeq!==undefined&&!finiteSeq(unreadAfterSeq))throw invalid();
 return {beforeSeq,limit,unreadAfterSeq};
}
function validateRead(input){
 if(!input||!finiteSeq(input.throughSeq)||!identifier(input.requestId))throw harnessError('INVALID_READ_RECEIPT','A nonnegative sequence and requestId are required',422);
}
function validateDescriptor(input){
 if(!input||!identifier(input.requestId)||!identifier(input.clientKey)||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||input.color!==undefined&&!/^#[0-9a-fA-F]{6}$/.test(input.color))throw harnessError('INVALID_DESCRIPTOR','A bounded conversation key and name are required',422);
 return {clientKey:input.clientKey,name:input.name,...(input.color?{color:input.color}:{})};
}
// Stable sequence sidecars are persisted atomically with the canonical conversation.
// Entry cursors order pages; delivery cursors keep late SendMessage arrivals unread.
export function createConversationHistory({store,clock=Date.now}){
 async function indexed(owner,id,project,{mutate=false}={}){
  requireState(store.get(owner,id));
  if(!mutate){
   const cached=await store.resourceRead(owner,id,state=>hasCompleteIndex(requireState(state))?{ready:true,value:project(state)}:{ready:false});
   if(cached.ready)return cached.value;
  }
  return store.resourceTransaction(owner,id,(state,emit)=>{indexState(state,clock);return structuredClone(project(state,emit));});
 }
 async function page(owner,id,input={}){
  const {beforeSeq,limit,unreadAfterSeq}=validatePage(input);
  return indexed(owner,id,state=>{
   const all=decoratedEntries(state),eligible=all.filter(entry=>beforeSeq===undefined||entry.historySeq<beforeSeq),entries=eligible.slice(-limit),hasOlder=eligible.length>entries.length,readStatus=status(state);
   return {schema:1,conversationId:id,entries,nextBeforeSeq:hasOlder?entries[0].historySeq:null,hasOlder,lastHistorySeq:historyState(state).nextSeq,readStatus,...(unreadAfterSeq!==undefined?{unreadSince:status(state,Math.min(unreadAfterSeq,historyState(state).nextSeq))}:{})};
  });
 }
 async function markRead(owner,id,input){
  validateRead(input);
  return indexed(owner,id,(state,emit)=>{
   const key='history-read:'+input.requestId,prior=state.requests[key];
   if(prior){if(prior.throughSeq!==input.throughSeq)throw harnessError('IDEMPOTENCY_CONFLICT','Read request differs',409);return {schema:1,conversationId:id,...status(state)};}
   const history=historyState(state),next=Math.max(history.throughSeq,Math.min(input.throughSeq,history.nextSeq));
   if(next>history.throughSeq){history.throughSeq=next;history.lastViewedAt=Math.max(history.lastViewedAt,clock());emit('read.changed',{readStatus:status(state)});}
   state.requests[key]={throughSeq:input.throughSeq,appliedSeq:next};
   return {schema:1,conversationId:id,...status(state)};
  },{mutate:true});
 }
 function readStatus(owner,id){return indexed(owner,id,state=>({schema:1,conversationId:id,...status(state)}));}
 async function descriptor(owner,id,input){
  const value=validateDescriptor(input);
  return store.resourceTransaction(owner,id,state=>{
   const key='history-descriptor:'+input.requestId,hash=JSON.stringify(value),prior=state.requests[key];
   if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Descriptor request differs',409);return structuredClone(prior.response);}
   state.conversationDescriptor=value;const response={schema:1,conversationId:id,descriptor:value};state.requests[key]={hash,response};return structuredClone(response);
  });
 }
 async function catalog(owner){
  await store.tail;
  const ids=[...store.states.values()].filter(state=>state.owner===owner).map(state=>state.conversationId),conversations=[];
  for(const id of ids)conversations.push(await indexed(owner,id,state=>({conversationId:id,descriptor:state.conversationDescriptor??null,botId:state.botId??null,persistedAt:state.persistedAt,readStatus:status(state)})));
  return {schema:1,conversations};
 }
 return {page,markRead,readStatus,descriptor,catalog};
}

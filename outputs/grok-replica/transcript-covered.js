const identity=value=>typeof value==='string'&&value.length>0&&value.length<=512;
const endpoint=value=>value&&identity(value.id)&&(!value.kind||['agent','cloud-agent'].includes(value.kind));
// Explicit local persisted-message adapter. Only real endpoint fields establish an exchange.
function nativeExchangeEntry(message){
 if(!message||!identity(message.id)||(message.kind!=null&&message.kind!=='message'))return null;
 if(message.kind==null&&(message.productKind!=null||message.card!=null))return null;
 if(message.transcript&&message.transcript.kind!=='message')return null;
 const content=typeof message.content==='string'?message.content:typeof message.text==='string'?message.text:null;
 if(content===null)return null;
 const parsed=typeof message.createdAt==='string'?Date.parse(message.createdAt):message.createdAt;
 const timestampMs=message.timestampMs??parsed;
 return {...message,kind:'message',content,...(typeof timestampMs==='number'&&Number.isFinite(timestampMs)?{timestampMs}:{})};
}
export function agentExchangeRows(messages,peerId,self){
 if(!identity(peerId)||!Array.isArray(messages))return [];
 const rows=[];
 for(const raw of messages){
  const entry=nativeExchangeEntry(raw);if(!entry)continue;
  const outgoing=entry.toAgent?.id===peerId,incoming=entry.fromAgent?.id===peerId;
  if(!outgoing&&!incoming)continue;
  const author=outgoing?self:entry.fromAgent;if(author==null)continue;
  rows.push({kind:'send-message',id:entry.id,...(entry.seq!=null?{seq:entry.seq}:{}),message:{type:'text',content:entry.content,...(entry.images?.length?{images:entry.images}:{})},author,...(entry.timestampMs!=null?{timestampMs:entry.timestampMs}:{}),...(entry.attachments?.length?{attachments:entry.attachments}:{}),...(incoming&&entry.cloudAgentWake!=null?{cloudAgentWake:entry.cloudAgentWake}:{})});
 }
 return rows;
}
export function exchangePeerReferences(message,selfId,resolve){
 const entry=nativeExchangeEntry(message);if(!entry)return [];
 const peers=new Map();
 for(const value of [entry.fromAgent,entry.toAgent]){
  if(!endpoint(value)||value.id===selfId||peers.has(value.id))continue;
  const known=resolve?.(value.id),name=typeof value.name==='string'?value.name:known?.name;
  if(typeof name!=='string'||!name)continue;
  peers.set(value.id,{...value,kind:value.kind??'agent',name});
 }
 return [...peers.values()];
}
export function setTranscriptCovered(viewport,covered){
 if(!viewport)return;
 if(covered){
  if(!viewport.hasAttribute('inert'))viewport.setAttribute('inert','');
  if(viewport.getAttribute('aria-hidden')!=='true')viewport.setAttribute('aria-hidden','true');
 }else{
  if(viewport.hasAttribute('inert'))viewport.removeAttribute('inert');
  if(viewport.hasAttribute('aria-hidden'))viewport.removeAttribute('aria-hidden');
 }
}

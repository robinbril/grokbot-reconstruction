import {ownDataArray,findOwnArray,mapOwnArray} from './chat-entry-model.js';
// One browser-local writer, shared by legacy saves and immutable chat commits.
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const data=value=>record(value)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
const own=(value,key)=>value&&Object.getOwnPropertyDescriptor(value,key)?.value;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const counter=value=>Number.isSafeInteger(value)&&value>=0;
const closed=(value,keys)=>data(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const phases=new Set(['accepted','running','awaiting-question','awaiting-approval','final-pending-delivery','delivered','cancelled','failed','interrupted']);
function references(state,conversationId,runId){
 const runs=own(state,'chatRuns'),messages=own(state,'messages'),run=own(runs,runId),list=own(messages,conversationId);
 if(!data(run)||!ownDataArray(list)||run.schema!==1||run.id!==runId||run.conversationId!==conversationId||!id(run.inputEntryId)||!id(run.outputEntryId)||!counter(run.generation)||!run.generation||!counter(run.lastSeq)||!phases.has(run.phase))return null;
 const input=findOwnArray(list,entry=>own(entry,'id')===run.inputEntryId),output=findOwnArray(list,entry=>own(entry,'id')===run.outputEntryId),transcript=own(output,'transcript');
 if(!data(input)||!data(output)||input.role!=='user'||typeof input.text!=='string'||output.role!=='bot'||typeof output.text!=='string'||!data(transcript)||transcript.schema!==1||transcript.kind!=='send-message'||transcript.runId!==runId||transcript.generation!==run.generation||!counter(transcript.revision))return null;
 if(Object.hasOwn(run,'progress')&&(!closed(run.progress,['processed','total'])||!counter(run.progress.processed)||!counter(run.progress.total)||run.progress.processed>run.progress.total||run.progress.total!==input.text.length||input.text.length>100000))return null;
 return {run,list,input,output,transcript};
}
function receiptId(ref,runId){
 const {run,transcript}=ref,d=run.delivery;
 return run.phase==='delivered'&&transcript.status==='stable'&&data(d)&&d.id===runId+':final'&&d.entryId===run.outputEntryId&&d.generation===run.generation&&d.revision===transcript.revision&&Number.isFinite(d.committedAt)&&d.scope==='browser-local'?d.id:null;
}
export function createChatStateHost({getState,publishState,storage,storageKey,initialSavedState=null,onSaveResult}){
 let markers=new Map();
 function capture(state){
  const next=new Map(),runs=own(state,'chatRuns');
  if(data(runs))for(const runId of Object.keys(runs)){const conversationId=own(own(runs,runId),'conversationId');if(!id(conversationId)||!id(runId))continue;const ref=references(state,conversationId,runId);if(!ref)continue;
   next.set(JSON.stringify([conversationId,runId]),Object.freeze({entryId:ref.run.outputEntryId,generation:ref.run.generation,revision:ref.transcript.revision,lastSeq:ref.run.lastSeq,phase:ref.run.phase,deliveryId:receiptId(ref,runId)}));}
  return next;
 }
 markers=capture(initialSavedState);
 function notify(ok,reason,code){const result=Object.freeze({ok,reason,...(code?{error:Object.freeze({code})}:{})});try{onSaveResult?.(result);}catch{/* A view callback cannot undo a durable write. */}}
 function write(candidate,reason,publish){
  let bytes,nextMarkers;
  try{if(!record(candidate)||own(candidate,'version')!==1||!record(own(candidate,'messages'))||typeof own(candidate,'then')==='function')throw new TypeError('Invalid state');bytes=JSON.stringify(candidate);nextMarkers=capture(candidate);}
  catch{notify(false,reason,'invalid');return {ok:false,error:{code:'invalid'}};}
  try{storage.setItem(storageKey,bytes);}catch{notify(false,reason,'storage');return {ok:false,error:{code:'storage'}};}
  markers=nextMarkers;if(publish)publishState(candidate);notify(true,reason);return {ok:true};
 }
 function commit(buildCandidate,{reason='chat-commit'}={}){let candidate;try{candidate=buildCandidate(getState());}catch{notify(false,reason,'invalid');return {ok:false,error:{code:'invalid'}};}return write(candidate,reason,true);}
 function persist(){return write(getState(),'persist',false).ok;}
 function publishChatProgress(event){
  const reject=()=>({ok:false,code:'invalid'});
  if(!closed(event,['conversationId','runId','entryId','generation','seq','text','phase','progress'])||![event.conversationId,event.runId,event.entryId].every(id)||!counter(event.generation)||!event.generation||!counter(event.seq)||!event.seq||typeof event.text!=='string'||event.text.length>300000||!['running','final-pending-delivery'].includes(event.phase)||!closed(event.progress,['processed','total']))return reject();
  const state=getState(),ref=references(state,event.conversationId,event.runId);if(!ref)return reject();
  const {run,list,input,output,transcript}=ref,pair=event.progress;
  if(run.outputEntryId!==event.entryId||run.generation!==event.generation||!['accepted','running','final-pending-delivery'].includes(run.phase)||run.delivery!==null||!['pending','streaming'].includes(transcript.status)||transcript.revision>=Number.MAX_SAFE_INTEGER||run.lastSeq>=Number.MAX_SAFE_INTEGER||event.seq!==run.lastSeq+1||input.text.length>100000||!counter(pair.processed)||!counter(pair.total)||pair.processed>pair.total||pair.total!==input.text.length||(run.progress&&pair.processed<run.progress.processed)||(event.phase==='final-pending-delivery'&&pair.processed!==pair.total)||(run.phase==='final-pending-delivery'&&event.phase==='running'))return reject();
  const nextOutput={...output,text:event.text,transcript:{...transcript,status:'streaming',revision:transcript.revision+1}};
  const nextRun={...run,lastSeq:event.seq,phase:event.phase,progress:{processed:pair.processed,total:pair.total}};
  publishState({...state,messages:{...state.messages,[event.conversationId]:mapOwnArray(list,entry=>entry===output?nextOutput:entry)},chatRuns:{...state.chatRuns,[event.runId]:nextRun}});return {ok:true};
 }
 function getChatSaveState(request){if(!data(request)||!id(own(request,'conversationId'))||!id(own(request,'runId')))return null;return markers.get(JSON.stringify([request.conversationId,request.runId]))||null;}
 return {persist,commit,publishChatProgress,getChatSaveState};
}

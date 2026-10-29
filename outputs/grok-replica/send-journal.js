import {normalizeComposerDocument} from './composer-document.js';
// Browser-local send intent, deliberately separate from model/task completion.
const value=(object,key)=>object&&Object.getOwnPropertyDescriptor(object,key)?.value;
const plain=object=>object!==null&&typeof object==='object'&&!Array.isArray(object)&&[Object.prototype,null].includes(Object.getPrototypeOf(object));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const phases=new Set(['queued','prepared','dispatching','accepted-awaiting-echo','failed']);
const allowedSnapshot=new Set(['conversationId','text','attachments','quote','skillReferences','richText','inputEntryId','createdAt']);
function copyData(input,depth=0,budget={nodes:0},field='') {
 if(++budget.nodes>20000||depth>8)throw Error('invalid');
 if(input===null||typeof input==='boolean'||(typeof input==='number'&&Number.isFinite(input)))return input;
 if(typeof input==='string'){if(input.length>(field==='richText'?262144:100000))throw Error('invalid');return input;}
 if(!plain(input)&&!Array.isArray(input))throw Error('invalid');
 const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors);
 if(keys.some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')))throw Error('invalid');
 if(Array.isArray(input)){
  const length=descriptors.length.value;if(length>1000||keys.length!==length+1)throw Error('invalid');
  const result=[];for(let index=0;index<length;index++){if(!Object.hasOwn(descriptors,String(index)))throw Error('invalid');result.push(copyData(descriptors[index].value,depth+1,budget));}return result;
 }
 const result={};for(const key of keys){if(key==='__proto__'||key==='constructor'||key==='prototype'||key.length>256)throw Error('invalid');Object.defineProperty(result,key,{value:copyData(descriptors[key].value,depth+1,budget,key),enumerable:true,writable:true,configurable:true});}return result;
}
function snapshotOf(input){
 // Leave room for the journal/table wrapper when validating restored data.
 const snapshot=copyData(input,3);
 if(!plain(snapshot)||Object.keys(snapshot).some(key=>!allowedSnapshot.has(key))||!id(snapshot.conversationId)||typeof snapshot.text!=='string'||!Array.isArray(snapshot.attachments)||snapshot.attachments.length>10||(!snapshot.text.trim()&&!snapshot.attachments.length&&!snapshot.skillReferences?.length))throw Error('invalid');
 if(snapshot.inputEntryId!==undefined&&!id(snapshot.inputEntryId))throw Error('invalid');
 if(snapshot.createdAt!==undefined&&(!Number.isFinite(snapshot.createdAt)||snapshot.createdAt<0))throw Error('invalid');
 for(const ref of snapshot.attachments)if(!plain(ref)||!id(ref.id)||typeof ref.name!=='string'||ref.name.length>1024||typeof ref.type!=='string'||ref.type.length>256||!Number.isSafeInteger(ref.size)||ref.size<0||ref.size>5*1024*1024||(ref.conversation!==undefined&&!id(ref.conversation))||(ref.namespace!==undefined&&!id(ref.namespace))||(ref.createdAt!==undefined&&(!Number.isFinite(ref.createdAt)||ref.createdAt<0))||Object.keys(ref).some(key=>!['id','name','type','size','conversation','namespace','createdAt'].includes(key)))throw Error('invalid');
 if(snapshot.attachments.reduce((sum,ref)=>sum+ref.size,0)>20*1024*1024)throw Error('invalid');
 if(snapshot.quote!==undefined&&(!plain(snapshot.quote)||JSON.stringify(snapshot.quote).length>12000))throw Error('invalid');
 if(snapshot.skillReferences!==undefined&&(!Array.isArray(snapshot.skillReferences)||snapshot.skillReferences.length>50||snapshot.skillReferences.some(ref=>!plain(ref)||!id(ref.id)||typeof ref.label!=='string'||ref.label.length>256||(ref.kind!==undefined&&ref.kind!=='skill')||(ref.description!==undefined&&(typeof ref.description!=='string'||ref.description.length>4000))||(ref.revision!==undefined&&(!Number.isSafeInteger(ref.revision)||ref.revision<1))||Object.keys(ref).some(key=>!['kind','id','label','description','revision'].includes(key)))))throw Error('invalid');
 normalizeComposerDocument(snapshot.richText,{text:snapshot.text,references:snapshot.skillReferences||[]});
 return snapshot;
}
function tableOf(state){
 const descriptor=state&&Object.getOwnPropertyDescriptor(state,'sendJournal');
 if(!descriptor)return [];
 if(!Object.hasOwn(descriptor,'value'))throw Error('invalid');
 const table=descriptor.value,copy=copyData(table);
 if(!plain(copy)||copy.schema!==1||Object.keys(copy).length!==2||!Array.isArray(copy.records)||copy.records.length>100)throw Error('invalid');
 const identities=new Set();
 for(const record of copy.records){
  if(!plain(record)||Object.keys(record).some(key=>!['nonce','inputEntryId','noticeEntryId','snapshot','createdAt','phase','errorCode'].includes(key))||![record.nonce,record.inputEntryId,record.noticeEntryId].every(id)||!Number.isFinite(record.createdAt)||record.createdAt<0||!phases.has(record.phase)||(record.errorCode!==undefined&&(typeof record.errorCode!=='string'||record.errorCode.length>256)))throw Error('invalid');
  snapshotOf(record.snapshot);
  if(record.snapshot.inputEntryId!==undefined&&record.snapshot.inputEntryId!==record.inputEntryId)throw Error('invalid');
  for(const identity of [record.nonce,record.inputEntryId,record.noticeEntryId]){if(identities.has(identity))throw Error('invalid');identities.add(identity);}
 }
 return table.records;
}
export function createSendJournal({getState,commit,dispatch,lookupAcceptance=async()=>({status:'unknown'}),isHeld=()=>false,onChange=()=>{},prepareEnqueue=current=>current,prepareCancel=current=>current,now=Date.now,newId=()=>crypto.randomUUID()}){
 let destroyed=false,serial=Promise.resolve(),draining=null;
 const failure=code=>({ok:false,error:{code}});
 function notify(){try{onChange();}catch{/* A view cannot undo persistence. */}}
 function records(conversationId){try{return copyData(tableOf(getState()).filter(record=>conversationId===undefined||record.snapshot.conversationId===conversationId));}catch{return [];}}
 function enqueue(input){
  if(destroyed)return failure('destroyed');
  let snapshot,record;
  try{snapshot=snapshotOf(input);const createdAt=snapshot.createdAt??now();record={nonce:newId(),inputEntryId:snapshot.inputEntryId??newId(),noticeEntryId:newId(),snapshot,createdAt,phase:'queued'};if(![record.nonce,record.inputEntryId,record.noticeEntryId].every(id)||!Number.isFinite(createdAt)||createdAt<0)throw Error('invalid');}catch{return failure('invalid');}
  let result;try{result=commit(current=>{
   const previous=tableOf(current);if(previous.length>=100||previous.some(item=>item.nonce===record.nonce||item.inputEntryId===record.inputEntryId||item.noticeEntryId===record.noticeEntryId))throw Error('invalid');
   const candidate=prepareEnqueue(current,copyData(snapshot));if(!plain(candidate))throw Error('invalid');
   const next={...candidate,sendJournal:{schema:1,records:[...previous,record]}};tableOf(next);return next;
  },{reason:'send-journal-enqueue'});}catch{return failure('storage');}
  if(!result?.ok)return result||failure('storage');notify();return {ok:true,nonce:record.nonce,inputEntryId:record.inputEntryId,noticeEntryId:record.noticeEntryId};
 }
 function currentRecords(){try{return tableOf(getState());}catch{return [];}}
 const current=record=>!destroyed&&currentRecords().includes(record);
 function replace(record,next){
  if(!current(record))return failure(destroyed?'destroyed':'stale');
  let result;try{result=commit(state=>{
   const rows=tableOf(state);if(destroyed||!rows.includes(record))throw Error('stale');
   return {...state,sendJournal:{schema:1,records:next===null?rows.filter(item=>item!==record):rows.map(item=>item===record?next:item)}};
  },{reason:'send-journal-transition'});}catch{return failure('storage');}
  if(result?.ok)notify();return result||failure('storage');
 }
 const payload=record=>({...copyData(record.snapshot),nonce:record.nonce,clientNonce:record.nonce,inputEntryId:record.inputEntryId,noticeEntryId:record.noticeEntryId});
 async function inspect(record){
  let result;try{result=copyData(await lookupAcceptance(payload(record)));}catch{return 'unknown';}
  if(!current(record))return 'stale';
  return plain(result)&&['found','not-found'].includes(result.status)?result.status:'unknown';
 }
 async function reconcileRecord(record){
  if(!current(record)||!['dispatching','accepted-awaiting-echo'].includes(record.phase))return;
  const status=await inspect(record);if(!current(record))return;
  if(status==='found')replace(record,null);
  // An explicit accepted ACK outranks a temporarily missing transcript row.
  else if(status==='not-found'&&record.phase==='dispatching')replace(record,{...record,phase:'queued'});
 }
 async function reconcileInternal(){
  if(destroyed)return failure('destroyed');
  for(const record of currentRecords().slice())await reconcileRecord(record);
  return {ok:!destroyed};
 }
 function schedule(operation){const task=serial.then(operation,operation);serial=task.catch(()=>{});return task;}
 function reconcile(){return schedule(reconcileInternal);}
 async function drainInternal(){
  if(destroyed)return failure('destroyed');
  await reconcileInternal();
  const blocked=new Set(),considered=new Set();
  while(!destroyed){
   const ordered=currentRecords().map((record,index)=>({record,index})).filter(({record})=>!considered.has(record.nonce)).sort((a,b)=>a.record.createdAt-b.record.createdAt||a.index-b.index);
   if(!ordered.length)break;const initial=ordered[0].record;considered.add(initial.nonce);
   if(destroyed)break;if(!current(initial))continue;
   const conversationId=initial.snapshot.conversationId;
   if(blocked.has(conversationId))continue;
   if(!['queued','prepared'].includes(initial.phase)){blocked.add(conversationId);continue;}
   let held=true;try{held=!!isHeld(payload(initial));}catch{/* A failed hold predicate must not dispatch. */}
   if(held){blocked.add(conversationId);continue;}
   let record=initial;
   if(record.phase==='queued'){
    const next={...record,phase:'prepared'};if(!replace(record,next).ok){blocked.add(conversationId);continue;}record=next;
   }
   const dispatching={...record,phase:'dispatching'};
   if(!replace(record,dispatching).ok){blocked.add(conversationId);continue;}record=dispatching;
   if(!current(record)){blocked.add(conversationId);continue;}
   let result;try{result=copyData(await dispatch(payload(record)));}catch{blocked.add(conversationId);continue;}
   if(!current(record)){blocked.add(conversationId);continue;}
   if(plain(result)&&result.accepted===true){
    const accepted={...record,phase:'accepted-awaiting-echo'};
    if(replace(record,accepted).ok){await reconcileRecord(accepted);if(currentRecords().some(item=>item.nonce===record.nonce))blocked.add(conversationId);}
    else blocked.add(conversationId);
   }else if(plain(result)&&result.accepted===false){
    replace(record,{...record,phase:'failed',errorCode:typeof result.code==='string'?result.code.slice(0,256):'refused'});blocked.add(conversationId);
   }else blocked.add(conversationId);
  }
  return {ok:!destroyed};
 }
 function drain(){
  if(draining)return draining;
  draining=schedule(drainInternal).finally(()=>{draining=null;});return draining;
 }
 function retry(nonce){return schedule(async()=>{
  if(destroyed)return failure('destroyed');let record=currentRecords().find(item=>item.nonce===nonce);if(!record)return failure('missing');
  if(['dispatching','accepted-awaiting-echo'].includes(record.phase)){
   const status=await inspect(record);if(!current(record))return failure('stale');
   if(status==='found')return replace(record,null);
   if(status!=='not-found'||record.phase==='accepted-awaiting-echo')return failure('uncertain');
  }else if(!['failed','queued','prepared'].includes(record.phase))return failure('invalid');
  const {errorCode,...clean}=record;const result=replace(record,{...clean,phase:'queued'});if(!result.ok)return result;
  await drainInternal();return {ok:true};
 });}
 function recoverCancelled(record){
  if(!current(record))return failure(destroyed?'destroyed':'stale');
  const draft=copyData(record.snapshot);let result;
  try{result=commit(state=>{
   const rows=tableOf(state);if(destroyed||!rows.includes(record))throw Error('stale');
   const candidate=prepareCancel(state,copyData(draft));if(!plain(candidate))throw Error('invalid');
   if(!current(record))throw Error('stale');
   const next={...candidate,sendJournal:{schema:1,records:rows.filter(item=>item!==record)}};
   tableOf(next);return next;
  },{reason:'send-journal-cancel'});}catch{return failure('storage');}
  if(!result?.ok)return result||failure('storage');
  notify();return {ok:true,draft,nonce:record.nonce};
 }
 function cancelQueued(nonce){
  if(destroyed)return Promise.resolve(failure('destroyed'));
  const queued=currentRecords().find(item=>item.nonce===nonce);
  // A queued record has never dispatched. Commit immediately so a predecessor's
  // pending transport cannot make this cancelled successor eligible for drain.
  if(queued?.phase==='queued')return Promise.resolve(recoverCancelled(queued));
  return schedule(async()=>{
   if(destroyed)return failure('destroyed');
   const record=currentRecords().find(item=>item.nonce===nonce);if(!record)return failure('missing');
   if(record.phase==='failed')return failure('failed');
   // A durable accepted ACK outranks a temporarily absent transcript row.
   if(record.phase==='accepted-awaiting-echo')return failure('accepted');
   if(record.phase!=='queued'){
    const status=await inspect(record);if(!current(record))return failure(destroyed?'destroyed':'stale');
    if(status!=='not-found')return failure('uncertain');
   }
   return recoverCancelled(record);
  });
 }
 function removeFailed(nonce){
  if(destroyed)return failure('destroyed');const record=currentRecords().find(item=>item.nonce===nonce);
  return record?.phase==='failed'?replace(record,null):failure('not-failed');
 }
 function destroy(){destroyed=true;}
 return {enqueue,records,drain,reconcile,retry,cancelQueued,removeFailed,destroy};
}

import {canvasPayloadMatchesDraft} from './live-canvas-reference.js';
import {normalizeComposerDocument} from './composer-document.js';
// Original browser drafts retained only after their exact model-queue acceptance.
const own=(object,key)=>object&&Object.getOwnPropertyDescriptor(object,key)?.value;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const data=value=>plain(value)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const localId=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const invalid=()=>new Error('De oorspronkelijke wachtrijaanvraag is ongeldig of gewijzigd. Het concept blijft behouden.');
const closed=(object,allowed)=>data(object)&&Object.keys(object).every(key=>allowed.includes(key));
function copyData(input,depth=0,budget={nodes:0,characters:0}){
 if(++budget.nodes>20000||depth>12)throw invalid();
 if(input===null||typeof input==='boolean'||typeof input==='number'&&Number.isFinite(input))return input;
 if(typeof input==='string'){budget.characters+=input.length;if(input.length>300000||budget.characters>8*1024*1024)throw invalid();return input;}
 if(!plain(input)&&!Array.isArray(input))throw invalid();
 const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors),output=Array.isArray(input)?[]:{};
 if(keys.some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')||['__proto__','constructor','prototype'].includes(key)))throw invalid();
 if(Array.isArray(input)){
  const length=descriptors.length.value;if(length>1000||keys.length!==length+1)throw invalid();
  for(let index=0;index<length;index++){if(!Object.hasOwn(descriptors,String(index)))throw invalid();output.push(copyData(descriptors[index].value,depth+1,budget));}
 }else for(const key of keys){if(key.length>512)throw invalid();const value=descriptors[key].value;if(value!==undefined)output[key]=copyData(value,depth+1,budget);}
 return output;
}
function payloadOf(input,withRequest=false){
 const value=copyData(input),allowed=['text','richText','quote','replyToId','skillReferences','skillRefs','attachmentRefs',...(withRequest?['requestId']:[])];
 if(!closed(value,allowed)||typeof value.text!=='string'||value.text.length>32768||withRequest&&!identifier(value.requestId))throw invalid();
 if(value.replyToId!==undefined&&!identifier(value.replyToId))throw invalid();
 if(value.quote!==undefined&&(typeof value.quote!=='string'||value.quote.length>10000))throw invalid();
 if(value.skillReferences!==undefined&&(!Array.isArray(value.skillReferences)||value.skillReferences.length>20||value.skillReferences.some(ref=>typeof ref!=='string'||ref.length>2000)))throw invalid();
 if(value.skillRefs!==undefined&&(!Array.isArray(value.skillRefs)||value.skillRefs.length>20||value.skillRefs.some(ref=>!closed(ref,['id','revision'])||!identifier(ref.id)||!Number.isSafeInteger(ref.revision)||ref.revision<1)))throw invalid();
 if(value.attachmentRefs!==undefined&&(!Array.isArray(value.attachmentRefs)||value.attachmentRefs.length>10||value.attachmentRefs.some(ref=>!closed(ref,['attachmentId','sha256','size'])||!identifier(ref.attachmentId)||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.size)||ref.size<0||ref.size>5*1024*1024)))throw invalid();
 if(!value.text.trim()&&!value.attachmentRefs?.length&&!value.skillRefs?.length)throw invalid();
 const richText=normalizeComposerDocument(value.richText,{text:value.text,references:[...(value.skillRefs||[]),...(value.richText===undefined?[]:(value.skillReferences||[]).map(ref=>JSON.parse(ref)))]});
 return {text:value.text,...(richText!==undefined?{richText}:{}),...(value.replyToId!==undefined?{replyToId:value.replyToId}:{}),...(value.quote!==undefined?{quote:value.quote}:{}),...(value.skillReferences!==undefined?{skillReferences:value.skillReferences}:{}),...(value.skillRefs!==undefined?{skillRefs:value.skillRefs.map(({id,revision})=>({id,revision}))}:{}),...(value.attachmentRefs?.length?{attachmentRefs:value.attachmentRefs.map(ref=>({attachmentId:ref.attachmentId,sha256:ref.sha256,size:ref.size}))}:{})};
}
function draftOf(input,conversationId,requestId,payload){
 const draft=copyData(input);
 if(!closed(draft,['conversationId','requestId','text','richText','quote','attachments','skillReferences'])||draft.conversationId!==conversationId||draft.requestId!==requestId||draft.text!==payload.text||!canvasPayloadMatchesDraft(draft.richText,payload.richText,draft.text)||!Array.isArray(draft.attachments)||draft.attachments.length>10||!Array.isArray(draft.skillReferences)||draft.skillReferences.length>20)throw invalid();
 for(const file of draft.attachments)if(!closed(file,['id','name','type','size','namespace','conversation','createdAt'])||!localId(file.id)||typeof file.name!=='string'||file.name.length>1024||typeof file.type!=='string'||file.type.length>256||!Number.isSafeInteger(file.size)||file.size<0||file.size>5*1024*1024||(file.namespace!==undefined&&!localId(file.namespace))||(file.conversation!==undefined&&!localId(file.conversation))||(file.createdAt!==undefined&&(!Number.isFinite(file.createdAt)||file.createdAt<0)))throw invalid();
 if(new Set(draft.attachments.map(file=>file.id)).size!==draft.attachments.length||draft.attachments.reduce((sum,file)=>sum+file.size,0)>20*1024*1024)throw invalid();
 const refs=payload.attachmentRefs||[];
 if(refs.length!==draft.attachments.length||refs.some((ref,index)=>ref.size!==draft.attachments[index].size))throw invalid();
 if(draft.quote!==undefined&&(!plain(draft.quote)||JSON.stringify(draft.quote).length>12000||['title','text'].some(key=>draft.quote[key]!==undefined&&typeof draft.quote[key]!=='string')))throw invalid();
 const quote=draft.quote?[draft.quote.title,draft.quote.text].filter(Boolean).join('\n'):undefined;
 if(payload.replyToId!==undefined&&(draft.quote?.replyToId!==payload.replyToId||draft.quote?.messageId!==payload.replyToId))throw invalid();
 if(quote!==payload.quote||draft.skillReferences.some(ref=>!plain(ref)))throw invalid();
 const versioned=draft.skillReferences.filter(ref=>ref.revision!==undefined),legacy=draft.skillReferences.filter(ref=>ref.revision===undefined);
 if(versioned.some(ref=>!closed(ref,['kind','id','label','description','revision'])||!identifier(ref.id)||!Number.isSafeInteger(ref.revision)||ref.revision<1||typeof ref.label!=='string'||ref.label.length>256||(ref.kind!==undefined&&ref.kind!=='skill')||(ref.description!==undefined&&(typeof ref.description!=='string'||ref.description.length>4000))))throw invalid();
 if(!same(versioned.map(({id,revision})=>({id,revision})),payload.skillRefs||[])||!same(legacy.map(ref=>JSON.stringify(ref,null,2)),payload.skillReferences||[]))throw invalid();
 normalizeComposerDocument(draft.richText,{text:draft.text,references:draft.skillReferences});
 return draft;
}
export const queuedDraftKey=(conversationId,queueId)=>JSON.stringify([conversationId,queueId]);
function bindingOf(input){
 const value=copyData(input);
 if(!closed(value,['schema','conversationId','serverConversationId','queueId','enqueueRequestId','payload','draft'])||value.schema!==1||!localId(value.conversationId)||![value.serverConversationId,value.queueId,value.enqueueRequestId].every(identifier))throw invalid();
 const payload=payloadOf(value.payload),draft=draftOf(value.draft,value.conversationId,value.enqueueRequestId,payload);
 if(payload.replyToId!==undefined&&draft.quote?.serverConversationId!==value.serverConversationId)throw invalid();
 return {schema:1,conversationId:value.conversationId,serverConversationId:value.serverConversationId,queueId:value.queueId,enqueueRequestId:value.enqueueRequestId,payload,draft};
}
function preferences(state){const value=own(state,'liveHarness');if(!data(value))throw invalid();return value;}
function tableOf(state){
 const value=own(preferences(state),'queuedDrafts');if(value===undefined)return {};
 const table=copyData(value);if(!plain(table)||Object.keys(table).length>100)throw invalid();
 for(const key of Object.keys(table)){const binding=bindingOf(table[key]);if(key!==queuedDraftKey(binding.conversationId,binding.queueId))throw invalid();table[key]=binding;}
 return table;
}
function validateUploadBindings(preferencesNow,binding){
 const uploads=own(preferencesNow,'uploads');
 binding.draft.attachments.forEach((file,index)=>{
  const upload=own(uploads,JSON.stringify([binding.serverConversationId,file.id])),ref=binding.payload.attachmentRefs[index];
  if(!data(upload)||upload.state!=='ready'||upload.attachmentId!==ref.attachmentId||upload.sha256!==ref.sha256||upload.size!==ref.size)throw invalid();
 });
}
export function retainQueuedDraft(current,input){
 const args=copyData(input),request=args.request,preferencesNow=preferences(current);
 if(!closed(args,['conversationId','serverConversationId','queueId','request'])||!closed(request,['queued','signature','serverConversationId','payload','draft'])||request.queued!==true||(request.serverConversationId!==undefined&&request.serverConversationId!==args.serverConversationId))throw invalid();
 const payload=payloadOf(request.payload,true),binding=bindingOf({schema:1,conversationId:args.conversationId,serverConversationId:args.serverConversationId,queueId:args.queueId,enqueueRequestId:request.payload.requestId,payload,draft:request.draft});
 const serverIds=own(preferencesNow,'serverIds'),pending=own(own(preferencesNow,'pendingSends'),binding.conversationId);
 if(!data(serverIds)||own(serverIds,binding.conversationId)!==binding.serverConversationId||!same(copyData(pending),request))throw invalid();
 validateUploadBindings(preferencesNow,binding);
 const table=tableOf(current),key=queuedDraftKey(binding.conversationId,binding.queueId),previous=table[key];
 if(previous){if(!same(previous,binding))throw invalid();return current;}
 if(Object.keys(table).length>=100)throw new Error('Het wachtrijherstelregister is vol. De ontvangen aanvraag en je concept blijven bewaard; controleer eerst de eerdere wachtrij.');
 if(Object.values(table).some(row=>row.serverConversationId===binding.serverConversationId&&row.enqueueRequestId===binding.enqueueRequestId))throw invalid();
 const next={...current,liveHarness:{...preferencesNow,queuedDrafts:{...table,[key]:binding}}};
 // The complete prospective table must satisfy the same bounds used on restore.
 // Otherwise one valid record could make every previous record unreadable.
 tableOf(next);return next;
}
function matches(binding,row){
 if(!data(row)||own(row,'id')!==binding.queueId||own(row,'requestId')!==binding.enqueueRequestId)return false;
 return same(payloadOf(own(row,'payload')),binding.payload);
}
export function findQueuedDraft(state,conversationId,serverConversationId,queueRow){
 try{
  if(!localId(conversationId)||!identifier(serverConversationId)||!data(queueRow))return null;
  const binding=tableOf(state)[queuedDraftKey(conversationId,own(queueRow,'id'))];
  return binding&&binding.serverConversationId===serverConversationId&&matches(binding,queueRow)?binding:null;
 }catch{return null;}
}
export function removeQueuedDraft(current,input){
 const binding=bindingOf(input),table=tableOf(current),key=queuedDraftKey(binding.conversationId,binding.queueId);
 if(!same(table[key],binding))throw invalid();
 delete table[key];return {...current,liveHarness:{...preferences(current),queuedDrafts:table}};
}
export function pruneQueuedDrafts(current,conversationId,serverConversationId,queue){
 let table;try{table=tableOf(current);}catch{return current;}
 if(!Array.isArray(queue))return current;
 let changed=false;
 for(const [key,binding] of Object.entries(table)){
  if(binding.conversationId!==conversationId||binding.serverConversationId!==serverConversationId)continue;
  const row=queue.find(row=>data(row)&&own(row,'id')===binding.queueId);
  try{if(!row||!matches(binding,row)||own(row,'status')==='cancelled'||!identifier(own(row,'runId'))&&!['completed','failed','interrupted'].includes(own(row,'status')))continue;}catch{continue;}
  delete table[key];changed=true;
 }
 return changed?{...current,liveHarness:{...preferences(current),queuedDrafts:table}}:current;
}

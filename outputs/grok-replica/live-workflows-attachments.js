import {liveDeliveryAttachmentMarkup} from './live-message-deliveries.js';
import {uploadIdentity,readyAttachmentRefs} from './live-workflows-model.js';
export function liveAttachmentContentHint(file,record){
 if(record?.state!=='ready')return '';
 if(record.contentAccess==='unsupported')return 'Afbeeldingsinhoud niet ondersteund';
 if(record.contentAccess!=='file-only')return '';
 const document=/\.(pdf|docx)$/i.test(file.name||'')||['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type);
 return document?'Documentcontrole bij verzending':'Alleen bestand';
}
export function createLiveWorkflowAttachments({host,client,serverId,isLive,onChange,onError}){
 const jobs=new Map();let disposed=false;
 const mappings=()=>host.getState().liveHarness?.uploads||{};
 const update=(identity,patch)=>{const result=host.commit(state=>({...state,liveHarness:{...state.liveHarness,uploads:{...state.liveHarness?.uploads,[identity]:{...state.liveHarness?.uploads?.[identity],...patch}}}}),{reason:'live-attachment-upload'});if(!result.ok)throw new Error('Uploadkoppeling niet opgeslagen. Je bestand en concept blijven behouden.');};
 async function upload(conversationId,file,{retry=false}={}){
  const canonicalId=serverId(conversationId),identity=uploadIdentity(canonicalId,file.id);if(jobs.has(identity))return jobs.get(identity);
  const previous=mappings()[identity];if(previous?.state==='ready'||previous?.state==='error'&&!retry)return;
  const task=(async()=>{try{
   const record=await host.readAttachment(file.id),blob=record.blob;
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
   if(previous?.sha256&&previous.sha256!==sha256)throw new Error('De opgeslagen bijlage is gewijzigd. Voeg het bestand opnieuw toe.');
   update(identity,{requestId:previous?.requestId||crypto.randomUUID(),name:file.name,type:file.type||'application/octet-stream',size:blob.size,sha256,state:'uploading',error:''});onChange();
   let current=mappings()[identity];
   if(current.attachmentId){const metadata=await client.attachmentStatus(canonicalId,current.attachmentId);if(metadata.state==='ready'){update(identity,{state:'ready',contentAccess:metadata.contentAccess,contentError:metadata.contentError});return;}}
   else {const reserved=await client.reserveAttachment(canonicalId,{requestId:current.requestId,name:current.name,type:current.type,size:current.size,sha256:current.sha256});update(identity,{attachmentId:reserved.attachmentId});current=mappings()[identity];}
   const ready=await client.uploadAttachment(canonicalId,current.attachmentId,blob);update(identity,{state:'ready',contentAccess:ready.contentAccess,contentError:ready.contentError});
  }catch(error){try{update(identity,{state:'error',error:error.message});}catch(saveError){onError(conversationId,saveError);}onError(conversationId,error);}finally{jobs.delete(identity);if(!disposed)onChange();}})();
  jobs.set(identity,task);return task;
 }
 function reconcile(){if(disposed||!isLive())return;let id=host.getConversationKey();if(id==='new'){if(!host.draftAttachments(id).length)return;const agent=host.ensureConversation();if(!agent)return;id=agent.id;}for(const file of host.draftAttachments(id))void upload(id,file);}
 function draftMarkup(files,id){const canonicalId=serverId(id),esc=host.esc;return files.map(file=>{const record=mappings()[uploadIdentity(canonicalId,file.id)],state=record?.state==='ready'?'Gereed':record?.state==='error'?'Upload mislukt':'Uploaden',hint=liveAttachmentContentHint(file,record);return `<span class="attachment-chip live-upload-chip" ${record?.attachmentId?`data-live-upload-id="${esc(record.attachmentId)}"`:''}><span class="attachment-name">${esc(file.name)}</span><span class="small muted" data-live-upload-state>${state}</span>${hint?`<span class="small muted">${esc(hint)}</span>`:''}${record?.state==='error'?`<button type="button" class="text-button" data-action="live-upload-retry" data-id="${esc(file.id)}" aria-label="Upload opnieuw proberen: ${esc(file.name)}">Opnieuw proberen</button>`:''}<button type="button" class="text-button attachment-remove" data-action="remove-attachment" data-id="${esc(file.id)}" aria-label="Bijlage verwijderen: ${esc(file.name)}">×</button></span>`;}).join('');}
 function messageMarkup(message){const esc=host.esc,canonicalId=message.liveHarness?.conversationId;if(!canonicalId)return '';return (message.attachments||[]).map(file=>liveDeliveryAttachmentMarkup(file,canonicalId,esc)).join('');}
 return {reconcile,draftMarkup,messageMarkup,refs:(id,files)=>readyAttachmentRefs(serverId(id),files,mappings()),retry:async(id,fileId)=>{const file=host.draftAttachments(id).find(ref=>ref.id===fileId);if(file)await upload(id,file,{retry:true});},destroy(){disposed=true;}};
}

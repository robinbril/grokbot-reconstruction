import {createChatContentView} from './chat-content-frames.js';
import {attachmentDownloadUrl,previewSize} from './live-attachment-preview-data.js';

export function liveDeliveryAttachmentMarkup(file,conversationId,esc,icon=()=> ''){
 if(!conversationId||typeof file?.attachmentId!=='string'||!file.attachmentId)return '';
 const name=file.name||'Bijlage',url=attachmentDownloadUrl(conversationId,file.attachmentId);
 return `<div class="live-file-card">${icon('file')}<span class="live-file-info"><strong>${esc(name)}</strong><small>${esc(previewSize(file.size))}</small></span><button type="button" class="icon-button" data-live-attachment-open aria-label="Bijlage openen: ${esc(name)}">${icon('arrow')||'Openen'}</button><a class="icon-button" data-live-attachment-download href="${esc(url)}" download="${esc(name)}" aria-label="Bijlage bewaren: ${esc(name)}">${icon('download')||'Bewaren'}</a></div>${file.alt?`<p class="small muted" data-live-attachment-alt>${esc(file.alt)}</p>`:''}`;
}
export function liveDeliveryReplyMarkup(reply,esc){
 if(!reply||typeof reply.messageId!=='string')return '';
 const title=reply.role==='user'?'Jij':'Bot';
 return `<div class="reply-context reply-quote" role="group" aria-label="Antwoord op ${title}"><button type="button" class="product-quote-jump" data-action="live-reply-jump" data-reply-message-id="${esc(reply.messageId)}" data-reply-entry-id="${esc(reply.entryId||'')}" aria-label="Naar oorspronkelijk bericht"><strong>${title}</strong><span class="product-quote-preview">${esc(reply.text||'')}</span></button></div>`;
}
// A stable parent owns run status. Call IDs retain the same markdown view from
// the first streamed chunk through confirmation under its authoritative UUID.
export function createLiveMessageDeliveries(options){
 const element=document.createElement('div');element.className='message-body chat-content';element.dataset.chatEntryId=options.entryId;
 const createContent=options.createContentView||createChatContentView,records=new Map(),ownedRows=new Set();
 function makeRecord(key){
  const row=document.createElement('section');row.className='live-delivery';row.setAttribute('role','group');row.tabIndex=0;
  const quote=document.createElement('div'),file=document.createElement('div'),content=createContent({...options,entryId:key});
  file.addEventListener('click',event=>{if(event.target.closest('[data-live-attachment-open]')){const record=records.get(key);if(record?.attachment)void options.preview?.open(record.attachment,record.conversationId);}});
  row.append(quote,content.element,file);ownedRows.add(row);return {element:row,quote,file,content,quoteMarkup:'',fileMarkup:''};
 }
 function update({entry,context,theme,deliveries=[],drafts=[],conversationId,esc}){
  const typed=deliveries.filter(row=>typeof row?.id==='string'&&['text','attachment'].includes(row.type));
  const pending=drafts.filter(draft=>draft.status==='streaming'&&!typed.some(row=>row.callId===draft.callId)).map(draft=>({callId:draft.callId,type:'text',content:draft.text,pending:true}));
  const plan=typed.length||pending.length?[...typed,...pending]:[{callId:options.entryId+'-legacy',type:'text',content:entry.text,pending:true}];
  const keep=new Set();
  plan.forEach((delivery,index)=>{
   const key=delivery.callId||delivery.id;keep.add(key);let record=records.get(key);
   if(!record){record=makeRecord(key);records.set(key,record);}
   record.element.setAttribute('aria-label',`Botbericht ${index+1}`);
   if(delivery.pending)delete record.element.dataset.liveMessageId;else record.element.dataset.liveMessageId=delivery.id;
   const quote=liveDeliveryReplyMarkup(delivery.replyTo,esc),file=delivery.type==='attachment'?liveDeliveryAttachmentMarkup(delivery.attachment,conversationId,esc,options.icon):'';
   record.attachment=delivery.type==='attachment'?delivery.attachment:null;record.conversationId=conversationId;
   // Compare generated sources: browser HTML serialization expands SVG paths
   // and normalizes entities, so innerHTML readback would replace idle controls.
   if(record.quoteMarkup!==quote){record.quote.innerHTML=quote;record.quoteMarkup=quote;}
   if(record.fileMarkup!==file){record.file.innerHTML=file;record.fileMarkup=file;}
   record.content.element.hidden=delivery.type!=='text';
   record.content.update({entry:{...entry,messageId:delivery.id||key,text:delivery.type==='text'?delivery.content:''},context:{...context,work:{...context?.work,isStreaming:delivery.pending&&context?.work?.isStreaming===true,isStable:!delivery.pending||context?.work?.isStable===true}},theme});
   // Other transcript modules own semantic siblings such as the unread divider.
   const before=[...element.children].filter(child=>ownedRows.has(child))[index]||null;
   if(before!==record.element){if(record.element.parentNode===element&&typeof element.moveBefore==='function')element.moveBefore(record.element,before);else element.insertBefore(record.element,before);}
  });
  for(const [key,record] of records)if(!keep.has(key)){record.content.destroy();record.element.remove();ownedRows.delete(record.element);records.delete(key);}
 }
 return {element,update,destroy(){for(const record of records.values())record.content.destroy();records.clear();ownedRows.clear();element.remove();}};
}

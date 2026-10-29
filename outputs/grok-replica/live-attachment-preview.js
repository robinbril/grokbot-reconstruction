import DOMPurify from './assets/vendor/dompurify/dompurify.js';
import {Marked} from './assets/vendor/marked/marked.js';
import {readPreviewBytes,previewKind,previewDocument,attachmentDownloadUrl,decodePreviewText,safeRasterDataURL,formatPreviewJSON} from './live-attachment-preview-data.js';
const markdown=new Marked({gfm:true,breaks:true});
const staticTags=['p','br','hr','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','pre','code','blockquote','ul','ol','li','table','thead','tbody','tr','th','td','div','span','style','a','img'];
let sanitizer;
function sanitize(html){
 if(!sanitizer){sanitizer=DOMPurify(window);sanitizer.addHook('afterSanitizeAttributes',node=>{
  if(node.tagName==='A'){
   const href=node.getAttribute('href');let safe=false;
   try{safe=['https:','mailto:'].includes(new URL(href).protocol);}catch{}
   if(!safe)node.removeAttribute('href');else{node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer');}
  }
  if(node.tagName==='IMG'){
   const src=node.getAttribute('src')||'';
   if(!safeRasterDataURL(src))node.removeAttribute('src');
  }
 });}
 return sanitizer.sanitize(html,{ALLOWED_TAGS:staticTags,ALLOWED_ATTR:['style','class','colspan','rowspan','href','src','alt','width','height','target','rel'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
}
function textPreview(body,text){
 const pre=document.createElement('pre');pre.className='live-file-lines';
 const lines=text.replaceAll('\r\n','\n').split('\n');
 for(let index=0;index<lines.length;index++){const row=document.createElement('div'),number=document.createElement('span'),code=document.createElement('code');number.className='live-file-line-number';number.setAttribute('aria-hidden','true');number.textContent=String(index+1);code.textContent=lines[index];row.append(number,code);pre.append(row);}body.replaceChildren(pre);
}
function tablePreview(body,text,delimiter){
 // CSV quoting, including embedded newlines, is interpreted without evaluating cells.
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(char===delimiter||char==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(char==='\n'){rows.push(row);row=[];}}else cell+=char;if(rows.length>1000||row.length>100)throw new Error('Deze tabel is te groot voor het voorbeeld.');}
 if(quoted)throw new Error('De tabel bevat een onvolledige aangehaalde waarde.');if(cell||row.length)rows.push([...row,cell]);
 const table=document.createElement('table');table.className='live-file-table';for(const [i,cells] of rows.entries()){const tr=document.createElement('tr');for(const value of cells){const td=document.createElement(i===0?'th':'td');td.textContent=value;tr.append(td);}table.append(tr);}body.replaceChildren(table);
}
function staticFrame(body,html,title){const frame=document.createElement('iframe');frame.title=title;frame.sandbox='';frame.referrerPolicy='no-referrer';frame.srcdoc=previewDocument(sanitize(html));frame.className='live-file-document';body.replaceChildren(frame);}
export function createLiveAttachmentPreview({getScope,isCurrentConversation=()=>true,icon=()=>''}){
 if(!document.querySelector('link[data-live-file-styles]')){const link=document.createElement('link');link.rel='stylesheet';link.href='./live-attachment-preview.css';link.dataset.liveFileStyles='';document.head.append(link);}
 let generation=0,active=null,urls=[],documentCleanup=()=>{};
 function close(){generation++;documentCleanup();documentCleanup=()=>{};active?.controller.abort();const dialog=active?.dialog;active=null;for(const url of urls)URL.revokeObjectURL(url);urls=[];if(dialog){if(dialog.open)dialog.close();dialog.remove();}}
 const valid=(ticket,scope)=>active?.ticket===ticket&&getScope()===scope&&active.dialog.open;
 function sync(){if(active&&getScope()!==active.scope)close();}
 async function open(file,conversationId){
  close();const scope=getScope();if(!scope||!conversationId||!isCurrentConversation(conversationId)||typeof file?.attachmentId!=='string')return;
  const ticket=++generation,controller=new AbortController(),dialog=document.createElement('dialog');dialog.className='preview-dialog live-file-preview';dialog.setAttribute('aria-label',file.name||'Bijlage');
  const header=document.createElement('header');header.className='preview-toolbar';const title=document.createElement('strong');title.className='fill';title.textContent=file.name||'Bijlage';
  const download=document.createElement('a');download.className='text-button';download.textContent='Downloaden';download.href=attachmentDownloadUrl(conversationId,file.attachmentId);download.download=file.name||'bijlage';
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='icon-button';dismiss.setAttribute('aria-label','Sluiten');dismiss.innerHTML=icon('close');if(!dismiss.innerHTML)dismiss.textContent='×';dismiss.addEventListener('click',close);
  header.append(title,download,dismiss);const body=document.createElement('article');body.className='preview-body live-file-body';body.setAttribute('aria-live','polite');body.textContent='Bestand laden…';dialog.append(header,body);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(active?.dialog===dialog)close();});document.body.append(dialog);active={ticket,scope,controller,dialog};dialog.showModal();
  try{
   const response=await fetch(attachmentDownloadUrl(conversationId,file.attachmentId),{signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});if(!valid(ticket,scope))return;
   const bytes=await readPreviewBytes(response,file,controller.signal);if(!valid(ticket,scope))return;
   const kind=previewKind(file);
   if(['image','audio','video'].includes(kind)){const media=document.createElement(kind==='image'?'img':kind);media.className='live-file-media';if(kind==='image')media.alt=file.name;else{media.controls=true;media.preload='metadata';}const url=URL.createObjectURL(new Blob([bytes],{type:file.type}));urls.push(url);media.src=url;media.addEventListener('error',()=>{if(valid(ticket,scope))body.textContent='Dit mediaformaat kan hier niet worden weergegeven. Download het bestand om het te openen.';},{once:true});body.replaceChildren(media);return;}
   if(kind==='pdf'){
    const {renderPdfPreview}=await import('./live-pdf-preview.js');if(!valid(ticket,scope))return;body.replaceChildren();
    const rendered=await renderPdfPreview({bytes,container:body,signal:controller.signal,isCurrent:()=>valid(ticket,scope)});if(!valid(ticket,scope)){rendered.cleanup();return;}documentCleanup=rendered.cleanup;return;
   }
   if(kind==='docx'){
    const converted=await fetch(attachmentDownloadUrl(conversationId,file.attachmentId).replace(/\/download$/,'/preview'),{signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});if(!valid(ticket,scope))return;
    if(!converted.ok)throw new Error('Dit document kan niet veilig worden weergegeven.');
    const data=await converted.json();if(!valid(ticket,scope))return;
    if(data.kind!=='docx'||data.attachmentId!==file.attachmentId||data.sha256!==file.sha256||data.size!==file.size||typeof data.html!=='string'||data.html.length>2*1024*1024)throw new Error('De documentinhoud komt niet overeen met de bijlage.');
    staticFrame(body,data.html,file.name);return;
   }
   if(kind==='unsupported'){body.textContent='Voor dit bestand is geen voorbeeld beschikbaar. Download het bestand om het te openen.';return;}
   let text=decodePreviewText(bytes);
   if(kind==='html')staticFrame(body,text,file.name);
   else if(kind==='markdown')staticFrame(body,markdown.parse(text),file.name);
   else if(kind==='table')tablePreview(body,text,file.name.toLowerCase().endsWith('.tsv')?'\t':',');
   else{if(kind==='json')text=formatPreviewJSON(text);textPreview(body,text);}
  }catch(error){if(valid(ticket,scope))body.textContent=error.name==='TypeError'?'Het bestand kon niet worden gelezen.':error.message||'Het bestand kon niet worden gelezen.';}
 }
 return {open,close,sync,destroy:close};
}

export const previewLimit=5*1024*1024;
export const previewSize=size=>Number.isSafeInteger(size)&&size>=0?(size<1024?`${size} bytes`:size<1024*1024?`${(size/1024).toFixed(1)} KiB`:`${(size/1024/1024).toFixed(1)} MiB`):'Onbekende grootte';
export const attachmentDownloadUrl=(conversationId,attachmentId)=>'/api/harness/conversations/'+encodeURIComponent(conversationId)+'/attachments/'+encodeURIComponent(attachmentId)+'/download';
export async function readPreviewBytes(response,file,signal){
 if(!Number.isSafeInteger(file.size)||file.size<0||file.size>previewLimit)throw new Error('Voorbeeld is beperkt tot 5 MiB. Download het bestand om het te openen.');
 if(!/^[a-f0-9]{64}$/.test(file.sha256||''))throw new Error('De bestandsinhoud kan niet worden gecontroleerd.');
 if(!response.ok||response.redirected||!response.body)throw new Error('Het bestand kon niet worden gelezen.');
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)!==file.size)){await response.body.cancel();throw new Error('De bestandsgrootte is gewijzigd.');}
 const reader=response.body.getReader(),result=new Uint8Array(file.size);let length=0;
 try{
  while(true){signal?.throwIfAborted();const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;if(length+value.byteLength>file.size)throw new Error('De bestandsgrootte is gewijzigd.');result.set(value,length);length+=value.byteLength;}
  if(length!==file.size)throw new Error('De bestandsgrootte is gewijzigd.');
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',result)),byte=>byte.toString(16).padStart(2,'0')).join('');signal?.throwIfAborted();
 if(hash!==file.sha256)throw new Error('De bestandsinhoud komt niet overeen met de bijlage.');return result;
}
export function previewKind(file){
 const ext=String(file.name||'').split('.').pop().toLowerCase(),type=String(file.type||'').toLowerCase().split(';')[0];
 if(ext==='svg'&&type==='image/svg+xml')return 'text';
 if(['html','htm'].includes(ext)&&type==='text/html')return 'html';
 if(['png','jpg','jpeg','gif','webp','avif'].includes(ext)&&/^image\/(png|jpeg|gif|webp|avif)$/.test(type))return 'image';
 if(['mp4','webm','ogv','mov'].includes(ext)&&/^video\/(mp4|webm|ogg|quicktime)$/.test(type))return 'video';
 if(['mp3','wav','ogg','m4a','flac','aac'].includes(ext)&&/^audio\/(mpeg|wav|x-wav|ogg|mp4|flac|aac)$/.test(type))return 'audio';
 if(ext==='pdf'&&type==='application/pdf')return 'pdf';
 if(ext==='docx'&&type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')return 'docx';
 if(ext==='json'&&['application/json','text/json'].includes(type))return 'json';
 if(['csv','tsv'].includes(ext)&&['text/csv','text/tab-separated-values','text/plain'].includes(type))return 'table';
 if(['md','markdown'].includes(ext)&&['text/markdown','text/plain'].includes(type))return 'markdown';
 if(['txt','log','js','ts','css','xml','py','sh','yaml','yml'].includes(ext)&&(/^(text\/|application\/(json|javascript|xml))/.test(type)||!type))return 'text';
 return 'unsupported';
}
export function previewDocument(html){
 return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; media-src 'none'; style-src 'unsafe-inline'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light dark}body{font:14px/1.6 sans-serif;overflow-wrap:anywhere}img{max-width:100%}</style>${html}`;
}

export function decodePreviewText(bytes){
 if(bytes.byteLength>1024*1024)throw new Error('Deze tekst is te groot voor het voorbeeld. Download het bestand om het te openen.');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(text.includes('\0'))throw new Error('Dit bestand bevat geen ondersteunde tekst.');
 if(text.split('\n').length>10000)throw new Error('Dit bestand bevat te veel regels voor het voorbeeld.');return text;
}

export function safeRasterDataURL(value){
 if(typeof value!=='string'||value.length>1024*1024)return false;
 const match=/^data:image\/(png|jpeg|gif|webp|avif);base64,([a-z0-9+/]+=*)$/i.exec(value);if(!match)return false;
 let data;try{data=atob(match[2]);}catch{return false;}
 const type=match[1].toLowerCase();
 if(type==='png')return data.startsWith('\x89PNG\r\n\x1a\n');
 if(type==='jpeg')return data.startsWith('\xff\xd8\xff');
 if(type==='gif')return /^GIF8[79]a/.test(data);
 if(type==='webp')return data.startsWith('RIFF')&&data.slice(8,12)==='WEBP';
 return data.slice(4,8)==='ftyp'&&['avif','avis'].includes(data.slice(8,12));
}

export function formatPreviewJSON(text){return decodePreviewText(new TextEncoder().encode(JSON.stringify(JSON.parse(text),null,2)));}

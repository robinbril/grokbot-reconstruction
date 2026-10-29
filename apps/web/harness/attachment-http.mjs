import {previewDocx} from './docx-preview.mjs';
import {harnessError} from './store.mjs';
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){
 if(req.headers['content-type']?.split(';')[0]!=='application/json')throw harnessError('INVALID_CONTENT_TYPE','Use application/json for attachment metadata',415);
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>131072)throw harnessError('BODY_TOO_LARGE','Attachment metadata exceeds 128 KiB',413);chunks.push(chunk);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw harnessError('INVALID_JSON','Expected attachment metadata as a JSON object',400);}
}
function disposition(name){const fallback=name.replace(/[^\x20-\x7e]|["\\;]/g,'_'),encoded=encodeURIComponent(name).replace(/['()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());return 'attachment; filename="'+fallback+'"; filename*=UTF-8\'\''+encoded;}

// Caller must perform its existing Host/Origin/owner-cookie/CSRF checks first.
// This handler deliberately never creates a provider connection.
export function createAttachmentHandler({attachments}){
 return async(req,res,{owner,conversationId,route})=>{
  if(route!=='attachments'&&!route.startsWith('attachments/'))return false;
  if(route==='attachments'){
   if(req.method!=='POST')throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);
   json(res,201,await attachments.reserve(owner,conversationId,await body(req)));return true;
  }
  const match=route.match(/^attachments\/([^/]+)(?:\/(content|download|preview))?$/);if(!match)throw harnessError('NOT_FOUND','Attachment endpoint not found',404);
  const [,attachmentId,action]=match;
  if(req.method==='GET'&&!action){json(res,200,await attachments.metadata(owner,conversationId,attachmentId));return true;}
  if(req.method==='PUT'&&action==='content'){
   if(req.headers['content-type']?.split(';')[0]!=='application/octet-stream')throw harnessError('INVALID_CONTENT_TYPE','Use application/octet-stream for original attachment bytes',415);
   try{const source=typeof req.iterator==='function'?req.iterator({destroyOnReturn:false}):req;json(res,200,await attachments.put(owner,conversationId,attachmentId,source));}finally{if(!req.complete)req.resume();}return true;
  }
  if(req.method==='GET'&&action==='preview'){
   const value=await attachments.download(owner,conversationId,attachmentId);
   if(value.type?.split(';')[0].trim().toLowerCase()!=='application/vnd.openxmlformats-officedocument.wordprocessingml.document'&&!/\.docx$/i.test(value.name))throw harnessError('ATTACHMENT_PREVIEW_UNSUPPORTED','Only DOCX attachments use this preview endpoint',422);
   const controller=new AbortController(),close=()=>{if(!res.writableEnded)controller.abort();};res.once('close',close);
   try{const html=await previewDocx(value.bytes,{signal:controller.signal});json(res,200,{kind:'docx',html,attachmentId:value.attachmentId,sha256:value.sha256,size:value.size});}
   finally{res.removeListener('close',close);}return true;
  }
  if(req.method==='GET'&&action==='download'){
   const value=await attachments.download(owner,conversationId,attachmentId);
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':value.bytes.length,'Content-Disposition':disposition(value.name),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(value.bytes);return true;
  }
  throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);
 };
}

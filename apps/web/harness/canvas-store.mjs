import {randomUUID,createHash} from 'node:crypto';
import {harnessError,identifier,now} from './store.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const canvasId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const notAccepted=(code,message,status=422)=>Object.assign(harnessError(code,message,status),{accepted:false});
const invalid=()=>notAccepted('INVALID_CANVAS','Use exact bounded canvas fields');
function storeId(value){if(!canvasId(value))throw notAccepted('INVALID_CANVAS_STORE','Canvas store must be a canonical conversation UUID');return value;}
function canonical(input,update){
 const fields=['requestId','title','source',...(update?['expectedRevision']:[])];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.includes(key))||!identifier(input.requestId))throw invalid();
 if(typeof input.title!=='string'||input.title.length>200||typeof input.source!=='string'||!input.source.trim()||Buffer.byteLength(input.source)>65536||input.source.includes('\0'))throw invalid();
 const title=input.title.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu,' ').replace(/\s+/gu,' ').trim();if(!title)throw invalid();
 if(update&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1))throw invalid();
 return {title,source:input.source,...(update?{expectedRevision:input.expectedRevision}:{})};
}
const summary=({source,...value})=>value;
// Local reconstruction resource. This does not pretend to be a native cloud store.
export class CanvasStore{
 constructor({store,limits={}}){this.store=store;this.limits={revisions:128,bytes:4*1024*1024,receipts:256,...limits};}
 list(owner,conversationId){return this.store.resourceRead(owner,storeId(conversationId),s=>({schema:1,canvases:structuredClone((s?.canvases??[]).map(summary))}));}
 async read(owner,conversationId,id){
  if(!canvasId(id))throw invalid();return this.store.resourceRead(owner,storeId(conversationId),s=>{const canvas=s?.canvases?.find(value=>value.id===id);
   if(!canvas)throw harnessError('CANVAS_NOT_FOUND','Canvas unavailable in this conversation',404);return {schema:1,canvas:structuredClone(canvas)};
  });
 }
 create(owner,conversationId,input,options){return this.change(owner,conversationId,null,input,options);}
 update(owner,conversationId,id,input,options){return this.change(owner,conversationId,id,input,options);}
 async change(owner,conversationId,id,input,{signal}={}){
  storeId(conversationId);const value=canonical(input,id!==null);if(id!==null&&!canvasId(id))throw invalid();signal?.throwIfAborted();
  return this.store.resourceTransaction(owner,conversationId,(s,emit)=>{
   signal?.throwIfAborted();const key='canvas:'+input.requestId,hash=digest({id,value}),prior=s.requests[key];
   if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Canvas request identifier differs',409);return structuredClone(prior.response);}
   const canvases=s.canvases??=[],index=id?canvases.findIndex(canvas=>canvas.id===id):-1,previous=canvases[index];
   if(id&&!previous)throw notAccepted('CANVAS_NOT_FOUND','Canvas unavailable in this conversation',404);
   if(previous&&previous.revision!==value.expectedRevision)throw notAccepted('CANVAS_REVISION_CONFLICT','Canvas was edited; reload its current revision',409);
   const history=s.canvasHistory??[],count=history.length+canvases.length,bytes=Buffer.byteLength(JSON.stringify([...history,...canvases]));
   const at=now(),canvas={id:id??randomUUID(),storeId:conversationId,title:value.title,source:value.source,revision:(previous?.revision??0)+1,createdAt:previous?.createdAt??at,updatedAt:at};
   if(count>=this.limits.revisions||bytes+Buffer.byteLength(JSON.stringify(canvas))>this.limits.bytes||Object.keys(s.requests).filter(key=>key.startsWith('canvas:')).length>=this.limits.receipts)throw notAccepted('CANVAS_CAPACITY','Canvas history capacity reached; nothing was removed',429);
   s.canvases=canvases;s.canvasHistory=history;if(previous){history.push(previous);canvases[index]=canvas;}else canvases.push(canvas);
   const response={schema:1,canvas};s.requests[key]={hash,response:structuredClone(response)};emit(previous?'canvas.updated':'canvas.created',{canvas:summary(canvas)});return structuredClone(response);
  },{signal});
 }
}

import {bounded,harnessError} from './store.mjs';
import {toolResultImageParts,toolResultReceipt} from './tool-result-images.mjs';
const maximumBytes=20*1024*1024;
const unavailable=()=>harnessError('TOOL_IMAGE_UNAVAILABLE','The owned browser frame is no longer available. The tool was not repeated; obtain a fresh observation.',409,false);
function existingImageBytes(messages){
 let bytes=0;
 for(const message of messages)for(const part of Array.isArray(message.content)?message.content:[]){
  if(part.type!=='image_url')continue;
  const match=/^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url?.url??'');
  if(match)bytes+=match[1].length*3/4-(match[1].endsWith('==')?2:match[1].endsWith('=')?1:0);
 }
 return bytes;
}
// Pixels belong to message objects from this execution, not just tool-call IDs:
// IDs may legitimately be reused by a later run with a new tool observation.
// Only textual receipts enter durable history; providers get cloned pixels.
export function createToolResultContext(host,history=[]){
 const images=new WeakMap();let usedBytes=existingImageBytes(history);
 if(usedBytes>maximumBytes)throw harnessError('MODEL_CONTEXT_LIMIT','Accumulated image input exceeds the 20 MiB model image budget. Start a new conversation before running more tools.',413,false);
 return {
  async message(call,definition,result,{signal}={}){
   signal?.throwIfAborted();let frame;
   if(definition.serverId==='grok_workspace'&&definition.name.startsWith('browser_')&&typeof result?.captureId==='string'){
    frame=await host.frame?.(result.captureId);signal?.throwIfAborted();if(!frame)throw unavailable();
   }
   const input=await toolResultImageParts(result,{signal,frame});signal?.throwIfAborted();
   if(usedBytes+input.bytes>maximumBytes)throw harnessError('TOOL_IMAGE_CONTEXT_LIMIT','Tool images and prior image input exceed the combined 20 MiB model image budget. The last tool was not repeated.',413,false);
   const receipt=toolResultReceipt(result),message={role:'tool',tool_call_id:call.id,content:input.parts.length?bounded('[Tool image pixels belong only to this originating run; stored metadata is not visual access. Obtain a fresh observation in later tasks.]\n'+receipt):receipt};
   usedBytes+=input.bytes;if(input.parts.length)images.set(message,input.parts);return message;
  },
  forModel(messages){return messages.map(message=>{
   const copy=structuredClone(message),parts=images.get(message);
   if(parts)copy.content=[{type:'text',text:copy.content},...structuredClone(parts)];return copy;
  });},
 };
}

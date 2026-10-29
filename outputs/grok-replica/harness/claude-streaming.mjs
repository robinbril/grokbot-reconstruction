import {harnessError} from './store.mjs';
import {jsonPrefix,visibleStream} from './model-streaming.mjs';
const invalid=()=>harnessError('MODEL_RESPONSE_INVALID','Invalid seat stream',502);
export function claudeStream(onEvent){
 const visible=visibleStream(onEvent),blocks=new Map();let result;
 async function line(raw){if(!raw.trim())return;let value;try{value=JSON.parse(raw);}catch{throw invalid();}
  if(value.type==='result'){if(result)throw invalid();result=value;return;}
  if(result)throw invalid();if(value.type!=='stream_event')return;const event=value.event;if(!event||typeof event.type!=='string')throw invalid();
  if(event.type==='message_start'){blocks.clear();return;}
  if(event.type==='content_block_start'){if(!Number.isInteger(event.index)||event.index<0)throw invalid();const block=event.content_block;blocks.set(event.index,{structured:block?.type==='tool_use'&&block.name==='StructuredOutput',json:''});return;}
  if(event.type==='content_block_delta'&&event.delta?.type==='input_json_delta'){const block=blocks.get(event.index);if(!block)throw invalid();if(!block.structured)return;if(typeof event.delta.partial_json!=='string')throw invalid();block.json+=event.delta.partial_json;if(Buffer.byteLength(block.json)>1048576)throw invalid();await visible.envelope(jsonPrefix(block.json));}
 }
 function finish(decode){if(!result)throw invalid();return visible.reconcile(decode(result));}
 return {line,finish};
}
export function claudeInput(messages,tools){
 const images=[];
 const scrubbed=messages.map(message=>{if(!Array.isArray(message.content))return message;return {...message,content:message.content.map(part=>{if(part.type!=='image_url')return part;const url=part.image_url?.url,match=typeof url==='string'&&/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);if(!match)throw harnessError('MODEL_INPUT_INVALID','Seat images require a supported inline image',422);images.push({type:'image',source:{type:'base64',media_type:match[1],data:match[2]}});return {type:'text',text:'[Image '+images.length+' attached after this conversation context]'};})};});
 return JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:JSON.stringify({messages:scrubbed,tools})},...images]}})+'\n';
}

import {harnessError} from './store.mjs';
const completeFields=new WeakMap();
const completed=(value,key)=>!completeFields.has(value)||completeFields.get(value).has(key);
const invalid=()=>harnessError('MODEL_RESPONSE_INVALID','Invalid model stream',502);
// Parse a JSON prefix without guessing unfinished escapes or exposing unrelated fields.
export function jsonPrefix(source){
 let i=0,depth=0,stringClosed=false;
 const whitespace=()=>{while(/\s/.test(source[i]??'')&&i<source.length)i++;};
 function string(){
  i++;stringClosed=false;let value='';
  while(i<source.length){const ch=source[i++];if(ch==='"'){stringClosed=true;return value;}
   if(ch==='\\'){if(i>=source.length)return value;const escape=source[i++];
    if(escape==='u'){const hex=source.slice(i,i+4);if(hex.length<4){i=source.length;return value;}if(!/^[0-9a-f]{4}$/i.test(hex))throw invalid();value+=String.fromCharCode(parseInt(hex,16));i+=4;}
    else{const map={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!Object.hasOwn(map,escape))throw invalid();value+=map[escape];}
   }else{if(ch<' ')throw invalid();value+=ch;}}
  return value;
 }
 function value(){whitespace();const ch=source[i];if(ch==='"')return string();
  if(ch==='{'||ch==='['){if(++depth>32)throw invalid();const array=ch==='[',out=array?[]:Object.create(null);if(!array)completeFields.set(out,new Set());i++;whitespace();if(source[i]===(array?']':'}')){i++;depth--;return out;}
   while(i<source.length){whitespace();let key;if(!array){if(source[i]!=='"')throw invalid();key=string();if(!stringClosed)return out;whitespace();if(i>=source.length)return out;if(source[i++]!==':')throw invalid();}
    whitespace();if(i>=source.length)return out;const isString=source[i]==='"',item=value();if(array)out.push(item);else{out[key]=item;if(!isString||stringClosed)completeFields.get(out).add(key);}whitespace();if(i>=source.length)return out;const delimiter=source[i++];if(delimiter===(array?']':'}')){depth--;return out;}if(delimiter!==',')throw invalid();}
   return out;
  }
  const start=i;while(i<source.length&&!/[\s,}\]]/.test(source[i]))i++;const token=source.slice(start,i);if(i===source.length)return undefined;try{return JSON.parse(token);}catch{throw invalid();}
 }
 return value();
}
const safePrefix=value=>/[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value;
// Prefixes may end inside content, but no other branch can become visible text.
function messagePrefix(args){
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 if(!object(args)||Object.keys(args).some(key=>!['text','reply_to'].includes(key))||!Object.hasOwn(args,'text')||!object(args.text)||Object.keys(args.text).length!==1||!Object.hasOwn(args.text,'content')||typeof args.text.content!=='string')return;
 if(Object.hasOwn(args,'reply_to')&&(typeof args.reply_to!=='string'||args.reply_to.length>96||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(args.reply_to)))return;
 return args.text.content;
}
export function visibleStream(onEvent){
 const emitted=new Map();
 async function envelope(value){
  if(!value||!Object.hasOwn(value,'toolCalls')||!Array.isArray(value.toolCalls))return;
  for(const call of value.toolCalls){
   if(!call||!Object.hasOwn(call,'name')||!completed(call,'name')||call.name!=='SendMessage'||!Object.hasOwn(call,'id')||!completed(call,'id')||typeof call.id!=='string'||!call.id||!Object.hasOwn(call,'arguments'))continue;
   const text=messagePrefix(call.arguments);if(text!==undefined)await message(call.id,text);
  }
 }
 async function message(callId,text){if(typeof callId!=='string'||!callId||callId.length>200)throw invalid();text=safePrefix(text);const prior=emitted.get(callId)??'';if(!text.startsWith(prior))throw invalid();const delta=text.slice(prior.length);if(delta){emitted.set(callId,text);await onEvent?.({type:'message.delta',callId,text:delta});}}
 function reconcile(result){for(const [id,text]of emitted){const call=result.toolCalls.find(call=>call.id===id&&call.name==='SendMessage');if(!call||messagePrefix(call.arguments)!==text)throw invalid();}return result;}
 return {envelope,message,reconcile};
}
export async function readLines(body,onLine,{signal,maxBytes=1048576}={}){
 const reader=body?.getReader();if(!reader)throw invalid();const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,pending='';
 const abort=()=>reader.cancel().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
 try{for(;;){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw invalid();pending+=decoder.decode(value,{stream:true});let line;while((line=pending.indexOf('\n'))>=0){await onLine(pending.slice(0,line).replace(/\r$/,''));pending=pending.slice(line+1);}}
  signal?.throwIfAborted();pending+=decoder.decode();if(pending)await onLine(pending);
 }catch(error){if(signal?.aborted)throw harnessError('MODEL_CANCELLED','Model inference was cancelled',499);if(error.code&&error.code!=='ERR_ENCODING_INVALID_ENCODED_DATA')throw error;throw invalid();}finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
export async function readXaiStream(response,{signal,onEvent,decode}){
 if(!response.ok){await response.body?.cancel();throw harnessError(response.status===401||response.status===403?'MODEL_AUTH_REQUIRED':'MODEL_PROVIDER_UNAVAILABLE','The model provider could not complete this turn',502);}
 const visible=visibleStream(onEvent),calls=new Map();let text='',data=[],done=false,finished=false;
 async function dispatch(){if(!data.length)return;const raw=data.join('\n');data=[];if(raw==='[DONE]'){done=true;return;}if(done)throw invalid();let value;try{value=JSON.parse(raw);}catch{throw invalid();}if(value.error)throw invalid();
  const choice=value.choices?.[0];if(!choice){if(value.usage)return;throw invalid();}if(choice.finish_reason){if(!['stop','tool_calls'].includes(choice.finish_reason))throw invalid();finished=true;}const delta=choice.delta??{};if(typeof delta.content==='string')text+=delta.content;
  for(const part of delta.tool_calls??[]){if(!Number.isInteger(part.index)||part.index<0||part.index>=32)throw invalid();const call=calls.get(part.index)??{id:'',function:{name:'',arguments:''}};if(part.id)call.id+=part.id;if(part.function?.name)call.function.name+=part.function.name;if(part.function?.arguments)call.function.arguments+=part.function.arguments;if(call.function.arguments.length>131072)throw invalid();calls.set(part.index,call);if(call.function.name==='SendMessage'){const parsed=jsonPrefix(call.function.arguments);const content=messagePrefix(parsed);if(content!==undefined)await visible.message(call.id,content);}}
 }
 await readLines(response.body,async line=>{if(!line){await dispatch();return;}if(line.startsWith('data:'))data.push(line.slice(5).trimStart());else if(!line.startsWith(':')&&!/^(event|id|retry):/.test(line))throw invalid();},{signal});await dispatch();if(!done||!finished)throw invalid();const result=decode({content:text,tool_calls:[...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>call)});return visible.reconcile(result);
}

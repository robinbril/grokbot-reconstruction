import {harnessError} from './store.mjs';
import {xaiEnvelopeSchema,xaiMessages,decodeXaiEnvelope,xaiChoice,readXaiEnvelopeStream} from './xai-envelope.mjs';
import {secureOAuthFetch} from './identity/oauth-fetch.mjs';

const endpoint='https://api.x.ai/v1/chat/completions';
const invalid=()=>harnessError('MODEL_RESPONSE_INVALID','The model returned an invalid tool response',502);
async function readResult(response,tools,requireToolCall){
 if(!response.ok){await response.body?.cancel();throw harnessError(response.status===401||response.status===403?'MODEL_AUTH_REQUIRED':'MODEL_PROVIDER_UNAVAILABLE','The model provider could not complete this turn',response.status===401||response.status===403?401:502);}
 const reader=response.body?.getReader();if(!reader)throw invalid();
 const chunks=[];let bytes=0;
 for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1048576){await reader.cancel();throw invalid();}chunks.push(Buffer.from(value));}
 let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw invalid();}
 const choice=xaiChoice(result),message=choice.message;if(choice.finish_reason!=='stop'||message?.refusal!=null||message?.tool_calls!=null)throw invalid();return decodeXaiEnvelope(message?.content,tools,requireToolCall);
}
export function createGrokModel({env=process.env,fetchImpl=secureOAuthFetch}={}){
 const key=env.XAI_API_KEY,model=env.XAI_MODEL;
 const configured=typeof key==='string'&&key.trim()&&!/[\r\n]/.test(key)&&typeof model==='string'&&model.trim()&&model.length<=200&&!/[\r\n]/.test(model);
 function status(){return {adapter:'grok-bot-harness',state:configured?'ready':'unavailable',provider:'xai',model:configured?model:null,modelExecution:'cloud',toolHost:'local',...(!configured?{reason:'Configureer XAI_API_KEY en XAI_MODEL op de server om de eigen Grok Bot-harness te gebruiken.'}:{})};}
 async function complete({messages,tools,signal,onEvent,requireToolCall=false}){
  if(!configured)throw harnessError('MODEL_NOT_CONFIGURED',status().reason,503);
  if(!Array.isArray(messages)||!Array.isArray(tools)||messages.length>2048||tools.length>256)throw harnessError('MODEL_INPUT_INVALID','Invalid model context or tools');
  const schema={...xaiEnvelopeSchema,properties:{...xaiEnvelopeSchema.properties,toolCalls:{...xaiEnvelopeSchema.properties.toolCalls,...(requireToolCall?{minItems:1}:{})}}};
  const body=JSON.stringify({model,messages:xaiMessages(messages,tools),response_format:{type:'json_schema',json_schema:{name:'grok_host_step',strict:true,schema}},stream:Boolean(onEvent)});
  if(Buffer.byteLength(body)>29360128)throw harnessError('MODEL_CONTEXT_LIMIT','The task context exceeds the configured input limit',413);
  const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:onEvent?'text/event-stream':'application/json'},body,signal,timeoutMs:120000,redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw harnessError(response.status===401||response.status===403?'MODEL_AUTH_REQUIRED':'MODEL_PROVIDER_UNAVAILABLE','The model provider could not complete this turn',response.status===401||response.status===403?401:502);}
  return onEvent?readXaiEnvelopeStream(response,{signal,onEvent,tools,requireToolCall}):readResult(response,tools,requireToolCall);
 }
 return {status,complete};
}

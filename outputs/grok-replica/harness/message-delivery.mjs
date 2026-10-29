import {randomUUID,createHash} from 'node:crypto';
import {harnessError,activeStatuses,now} from './store.mjs';
import {sendMessageArguments} from './send-message.mjs';
import {resolveMessageAttachment} from './message-attachments.mjs';
import {userMessagePreview} from '../skill-message-preview.js';

export function replyTargets(state){
 const targets=[];
 for(const entry of state.entries){
  if(!['user','assistant'].includes(entry.role))continue;
  if(entry.role==='assistant'&&entry.messages?.some(message=>typeof message.id==='string')){
   for(const message of entry.messages){
    if(typeof message.id!=='string'||!state.tools.some(tool=>tool.runId===entry.runId&&tool.callId===message.callId&&tool.name==='SendMessage'&&tool.status==='completed'))continue;
    targets.push({messageId:message.id,entryId:entry.id,role:entry.role,text:message.type==='text'?message.content:message.attachment?.alt??message.attachment?.name??''});
   }
  }else if(entry.status==='completed')targets.push({messageId:entry.id,entryId:entry.id,role:entry.role,text:entry.role==='user'?userMessagePreview(entry):entry.text??''});
 }
 return targets;
}
function replyTarget(state,id){
 if(id===undefined)return undefined;
 const target=replyTargets(state).find(target=>target.messageId===id);
 if(!target)throw harnessError('INVALID_REPLY_TARGET','Reply target is not a confirmed message in this conversation',422);
 return target;
}
export function localDeliveryContext(runtime,c,run){
 const state=runtime.store.get(c.owner,c.id);
 return {role:'system',content:'Local delivery context:\n'+JSON.stringify({current_input_message_id:run.inputEntryId,conversation_id:c.id,workspace_file_url_prefix:`${runtime.baseUrl}/api/harness/conversations/${c.id}/preview/`,reply_targets:replyTargets(state).map(target=>({message_id:target.messageId,entry_id:target.entryId,role:target.role,text:target.text}))})};
}
function accepting(state,runId,callId,signal){
 signal?.throwIfAborted();const run=state.runs.find(run=>run.id===runId);
 if(state.tools.some(tool=>tool.runId===runId&&tool.callId===callId)||state.entries.some(entry=>entry.runId===runId&&entry.messages?.some(message=>message.callId===callId)))throw harnessError('MODEL_RESPONSE_INVALID','Message call was already delivered',502);
 if(!run||!activeStatuses.has(run.status)||run.cancelRequested)throw harnessError('MODEL_CANCELLED','Run no longer accepts output',499);
 return run;
}
export async function recordMessageDelivery(runtime,c,runId,call,{signal}={}){
 const args=sendMessageArguments(call.arguments),state=runtime.store.get(c.owner,c.id);
 accepting(state,runId,call.id,signal);replyTarget(state,args.reply_to);
 let attachment;
 if(args.attachment&&!runtime.attachments)throw harnessError('ATTACHMENTS_UNAVAILABLE','Attachment store unavailable',503);
 if(args.attachment)attachment=await resolveMessageAttachment({attachments:runtime.attachments,owner:c.owner,conversationId:c.id,workspaceRoot:state.workspaceRoot,baseUrl:runtime.baseUrl,...args.attachment,requestId:'delivery-'+createHash('sha256').update(JSON.stringify([runId,call.id])).digest('hex'),signal});
 signal?.throwIfAborted();const id=randomUUID(),createdAt=now(),result={success:{message_id:id,timestamp:Date.parse(createdAt)}};
 await runtime.store.transaction(c.owner,c.id,(saved,emit)=>{
  const run=accepting(saved,runId,call.id,signal),entry=saved.entries.find(entry=>entry.id===run.outputEntryId),replyTo=replyTarget(saved,args.reply_to);
  run.messageDrafts??=[];const draft=run.messageDrafts.find(draft=>draft.callId===call.id);
  if(draft&&(attachment||draft.status!=='streaming'||draft.text!==args.text.content))throw harnessError('MODEL_RESPONSE_INVALID','Stream differs from confirmed message',502);
  if(args.text){if(draft)draft.status='delivered';else run.messageDrafts.push({callId:call.id,text:args.text.content,status:'delivered'});}
  const message={id,callId:call.id,...(attachment?{type:'attachment',attachment}:{type:'text',content:args.text.content}),createdAt,...(replyTo?{replyTo}:{})};
  const tool={id:randomUUID(),callId:call.id,runId,name:'SendMessage',serverId:'grok',source:'grok-bot-harness',arguments:structuredClone(args),status:'completed',startedAt:createdAt,finishedAt:createdAt,output:JSON.stringify(result)};
  entry.messages??=[];entry.messages.push(message);entry.messageDrafts=structuredClone(run.messageDrafts);entry.text=run.messageDrafts.map(draft=>draft.text).join('\n\n');entry.streaming=run.messageDrafts.some(draft=>draft.status==='streaming');entry.delivery=entry.streaming?'partial':'delivered';entry.revision++;
  saved.tools.push(tool);run.tools.push(tool.id);emit('tool.started',{tool:{...tool,status:'running'}},runId);emit('tool.completed',{tool},runId);emit('entry.updated',{entry},runId);
 });
 return result;
}

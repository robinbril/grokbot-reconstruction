// Native-derived replyToId; canonical scope and confirmation belong to this host.
import {userMessagePreview} from './skill-message-preview.js';
const invalid=()=>new Error('Kies het oorspronkelijke bericht opnieuw in dit gesprek. Je concept blijft behouden.');
function targets(snapshot){
 return (snapshot.entries||[]).flatMap(entry=>{
  if(entry.role==='user'&&entry.status==='completed')return [{messageId:entry.id,entryId:entry.id,text:userMessagePreview(entry),title:'Jij'}];
  if(entry.role!=='assistant')return [];
  if(entry.messages?.length)return entry.messages.filter(message=>(snapshot.tools||[]).some(tool=>tool.runId===entry.runId&&tool.callId===message.callId&&tool.name==='SendMessage'&&tool.status==='completed')).map(message=>({messageId:message.id,entryId:entry.id,text:message.type==='text'?message.content:message.attachment?.alt??message.attachment?.name??'',title:'Bot'}));
  return entry.status==='completed'?[{messageId:entry.id,entryId:entry.id,text:entry.text||'',title:'Bot'}]:[];
 });
}
export function liveReplyDraft(snapshot,{entryId,messageId}={}){
 const options=targets(snapshot).filter(target=>target.entryId===entryId&&(!messageId||target.messageId===messageId));
 if(options.length!==1)throw invalid();
 const target=options[0];return {...target,replyToId:target.messageId,serverConversationId:snapshot.conversationId};
}
export function liveReplyPayload(snapshot,quote){
 if(!quote||quote.replyToId===undefined&&quote.serverConversationId===undefined)return {};
 if(quote.serverConversationId!==snapshot.conversationId||quote.messageId!==quote.replyToId||!targets(snapshot).some(target=>target.messageId===quote.replyToId&&target.entryId===quote.entryId))throw invalid();
 return {replyToId:quote.replyToId};
}

import {normalizeComposerDocument} from './composer-document.js';
// Canonical server data is separate from browser-local chatRuns and receipts.
export const liveActive=status=>['accepted','starting','running','started','waiting_approval','cancelling','awaiting-approval','awaiting-question','cancel-requested','cancel.requested'].includes(status);
const array=value=>Array.isArray(value)?value:[];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const rows=value=>array(value).filter(row=>object(row)&&typeof row.id==='string');
export const safeOutput=value=>typeof value==='string'?value:value==null?'':JSON.stringify(value,null,2);
export const liveHistoryResetMessage='Voorbeeldgegevens herstellen is geblokkeerd zolang echte gesprekken aan deze browser zijn gekoppeld. Je geschiedenis en werkmap blijven behouden.';
export function hasLiveHarnessOwnership(state,conversationId){
 const preferences=object(state?.liveHarness)?state.liveHarness:{},messages=object(state?.messages)?state.messages:{};
 const values=map=>conversationId===undefined?Object.values(object(map)?map:{}):object(map)&&Object.hasOwn(map,conversationId)?[map[conversationId]]:[];
 return values(preferences.serverIds).some(value=>typeof value==='string'&&value.length>0)
  ||values(preferences.pendingSends).some(value=>object(value))
  ||values(preferences.modes).some(value=>value==='live')
  ||values(messages).some(list=>array(list).some(message=>object(message)&&(message.productKind==='live-harness'||object(message.liveHarness))));
}
export function emptyLiveConversation(id){return {conversationId:id,entries:[],runs:[],tools:[],browserSessions:[],terminalSessions:[],servers:[],queue:[],schedules:[],workflow:{},lastSeq:0};}
export function normalizeLiveSnapshot(value,id){
 if(!object(value)||value.schema!==1||value.conversationId!==id)throw new Error('De gespreksgeschiedenis heeft een ongeldig adres.');
 return {...emptyLiveConversation(id),...value,entries:rows(value.entries),runs:rows(value.runs),tools:rows(value.tools),browserSessions:rows(value.browserSessions),terminalSessions:rows(value.terminalSessions),servers:array(value.servers),queue:rows(value.queue),schedules:rows(value.schedules),workflow:object(value.workflow)?value.workflow:{},lastSeq:Number.isSafeInteger(value.lastSeq)&&value.lastSeq>=0?value.lastSeq:0};
}
const upsert=(list,value)=>{if(!object(value)||typeof value.id!=='string')return list;const index=list.findIndex(row=>row.id===value.id);return index<0?[...list,value]:list.map((row,i)=>i===index?{...row,...value}:row);};
export function reduceLiveEvent(snapshot,event){
 if(!object(event)||event.schema!==1||event.conversationId!==snapshot.conversationId||!Number.isSafeInteger(event.seq)||event.seq<=0||typeof event.type!=='string'||!object(event.data))return {snapshot,invalid:true};
 if(event.seq<=snapshot.lastSeq)return {snapshot,duplicate:true};
 if(event.seq!==snapshot.lastSeq+1)return {snapshot,gap:true};
 const data=event.data,next={...snapshot,lastSeq:event.seq};
 if(event.type.startsWith('queue.')||event.type.startsWith('schedule.')||event.type.startsWith('workflow.'))return {snapshot,gap:true};
 const canonical=data.entry||data.tool||data.run||data.approval||data.session;
 if(canonical&&((canonical.runId!=null&&canonical.runId!==event.runId)||(data.run&&data.run.id!==event.runId)))return {snapshot,invalid:true};
 if(event.type==='entry.updated'){const entry=data.entry||data;const previous=snapshot.entries.find(row=>row.id===entry.id);if(!previous||entry.revision>=previous.revision)next.entries=upsert(snapshot.entries,entry);}
 else if(event.type.startsWith('run.')){const run=data.run||{id:event.runId,...data};next.runs=upsert(snapshot.runs,run);}
 else if(event.type.startsWith('tool.'))next.tools=upsert(snapshot.tools,data.tool||data);
 else if(event.type.startsWith('approval.')){
  const approval=data.approval||data,runId=approval.runId||event.runId;
  next.runs=snapshot.runs.map(run=>run.id===runId?{...run,approvals:upsert(array(run.approvals),approval)}:run);
 }
 else if(event.type.startsWith('terminal.')){
  const session=data.session;
  if(session)next.terminalSessions=upsert(snapshot.terminalSessions,session);
  else if(event.type==='terminal.output'){
   const id=data.sessionId,stream=data.stream==='stderr'?'stderr':'stdout';
   next.terminalSessions=snapshot.terminalSessions.map(row=>row.id!==id?row:{...row,[stream]:(row[stream]||'')+String(data.chunk||'')});
  }else next.terminalSessions=upsert(snapshot.terminalSessions,data);
 }
 else if(event.type==='browser.frame')next.browserSessions=upsert(snapshot.browserSessions,data.session||data);
 else if(event.type==='tools.changed')next.servers=array(data.servers);
 return {snapshot:next};
}
function publicSkillReferences(entry){
 const canonical=array(entry.skills).filter(skill=>object(skill)&&typeof skill.id==='string'&&typeof skill.name==='string'&&Number.isSafeInteger(skill.revision)&&skill.revision>0).map(skill=>({kind:'skill',id:skill.id,label:skill.name,description:typeof skill.description==='string'?skill.description:'',revision:skill.revision}));
 const legacy=array(entry.legacySkillReferences).filter(ref=>object(ref)&&ref.kind==='skill'&&typeof ref.id==='string'&&ref.id.length>0&&ref.id.length<=256&&typeof ref.label==='string'&&ref.label.length>0&&ref.label.length<=256).map(({id,label})=>({kind:'skill',id,label}));
 return [...canonical,...legacy];
}
function publicComposerDocument(entry){
 if(entry.role!=='user'||entry.richText===undefined)return {};
 try{
  const richText=normalizeComposerDocument(entry.richText,{text:entry.text,references:publicSkillReferences(entry)});
  return {richText};
 }catch{return {};}
}
function publicTranscriptMetadata(entry){
 const metadata={};
 if(entry.kind==='message')metadata.kind='message';
 if(typeof entry.channel==='string')metadata.channel=entry.channel;
 if(typeof entry.suppressed==='boolean')metadata.suppressed=entry.suppressed;
 if(typeof entry.branched==='boolean')metadata.branched=entry.branched;
 for(const key of ['fromAgent','toAgent']){
  const endpoint=entry[key];if(!object(endpoint))continue;
  const fields=Object.fromEntries(['id','kind','name'].filter(field=>typeof endpoint[field]==='string'&&endpoint[field].length>0&&endpoint[field].length<=512).map(field=>[field,endpoint[field]]));
  if(Object.keys(fields).length)metadata[key]=fields;
 }
 return metadata;
}
export function projectLiveMessages(snapshot){
 const entries=snapshot.entries.filter(entry=>['user','assistant'].includes(entry.role)&&typeof entry.text==='string').map(entry=>({id:entry.id,role:entry.role==='user'?'user':'bot',text:entry.text,...publicTranscriptMetadata(entry),...publicComposerDocument(entry),...(entry.replyTo?{quote:{messageId:entry.replyTo.messageId,replyToId:entry.replyTo.messageId,entryId:entry.replyTo.entryId,serverConversationId:snapshot.conversationId,title:entry.replyTo.role==='user'?'Jij':'Bot',text:entry.replyTo.text||''}}:{}),createdAt:entry.createdAt,attachments:array(entry.attachments),skillReferences:publicSkillReferences(entry),productKind:'live-harness',liveHarness:{kind:entry.role,conversationId:snapshot.conversationId,runId:entry.runId,revision:entry.revision||0,status:entry.status,messages:array(entry.messages),messageDrafts:array(entry.messageDrafts)}}));
 const cards=snapshot.tools.map(tool=>({id:'live-tool-'+tool.id,role:'bot',text:'',createdAt:tool.startedAt,productKind:'live-harness',liveHarness:{kind:'tool',runId:tool.runId,toolId:tool.id}}));
 const approvals=snapshot.runs.flatMap(run=>array(run.approvals).map(approval=>({id:'live-approval-'+approval.id,role:'bot',text:'',createdAt:approval.createdAt||run.startedAt,productKind:'live-harness',liveHarness:{kind:'approval',runId:run.id,approvalId:approval.id}})));
 return [...entries,...cards,...approvals].sort((a,b)=>(Number(a.createdAt)||Date.parse(a.createdAt)||0)-(Number(b.createdAt)||Date.parse(b.createdAt)||0));
}
export function stripTerminalControls(text){return String(text||'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');}

export function liveRuntimeText(runtime,error=''){
 if(error)return 'Grok Bot-harness · Status niet beschikbaar · '+error;
 if(!runtime)return 'Grok Bot-harness · Status laden…';
 if(runtime.adapter==='codex-app-server'){
  if(runtime.state==='unavailable')return runtime.reason||'Codex CLI niet beschikbaar.';
  return 'Codex CLI'+(runtime.modelExecution==='cloud'&&runtime.provider==='openai'?' · model via OpenAI':runtime.modelExecution==='cloud'?' · model in de cloud':' · modelprovider nog niet geverifieerd')+(runtime.model?' · '+runtime.model:'');
 }
 const name='Grok Bot-harness';
 if(runtime.state==='unavailable')return name+' · Model niet geconfigureerd'+(runtime.reason?' · '+runtime.reason:'');
 if(runtime.adapter!=='grok-bot-harness'||!['ready','configured','connected'].includes(runtime.state))return name+' · Status niet bevestigd';
 const details=(runtime.provider==='xai'?' · xAI':'')+(runtime.model?' · '+runtime.model:'');
 return name+details+(runtime.state==='connected'?' · Verbonden':' · Model geconfigureerd');
}

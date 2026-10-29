import {mergeCloudEntries,cloudUnreadDivider} from './cloud-history-state.js';

// This adapter speaks our owned server API; the native private cloud is not used.
export function createCloudHistoryController({host,client,serverId,isLive,snapshot,adopt}){
 const windows=new Map(),registered=new Set();let enabled=false,selected=null,disposed=false,catalogBusy=false,generation=0,identityKnown=false;
 const mergeById=(old=[],rows=[])=>[...new Map([...old,...rows].map(row=>[row.id,row])).values()];
 const current=()=>host.getConversationKey();
 const advances=(previous,next)=>!previous||next.throughSeq>=previous.throughSeq&&next.lastHistorySeq>=previous.lastHistorySeq;
 function windowFor(key){if(!windows.has(key))windows.set(key,{ready:false,older:null,readPending:null,boundary:undefined,unread:null,nextBeforeSeq:null});return windows.get(key);}
 function select(key){if(selected===key)return;selected=key;const value=windowFor(key);value.boundary=undefined;value.unread=null;value.pendingOpenRead=true;}
 function accept(value,key){
  if(!enabled||!value.historyPage)return value;
  const page=value.historyPage,window=windowFor(key),old=snapshot(key);
  if(key===current()){select(key);if(window.boundary===undefined){window.boundary=page.readStatus.throughSeq;window.unread=page.readStatus;}}
  if(!window.ready)window.nextBeforeSeq=page.nextBeforeSeq;
  window.ready=true;window.lastHistorySeq=Math.max(window.lastHistorySeq??0,page.lastHistorySeq);
  if(advances(window.readStatus,page.readStatus))window.readStatus=page.readStatus;
  if(window.boundary!==undefined&&page.unreadSince&&page.lastHistorySeq>=(window.unreadVersion??0)){window.unread=page.unreadSince;window.unreadVersion=page.lastHistorySeq;}
  const entries=mergeCloudEntries(old.historyPage?old.entries:[],value.entries);
  return {...value,entries,runs:mergeById(old.historyPage?old.runs:[],value.runs),tools:mergeById(old.historyPage?old.tools:[],value.tools),historyPage:{...page,nextBeforeSeq:window.nextBeforeSeq}};
 }
 function readVisible(key){
  const value=windowFor(key);if(!enabled||!isLive(key)||key!==current()||!value.ready||!value.pendingOpenRead&&(document.visibilityState==='hidden'||!document.hasFocus()))return;
  if(value.boundary===undefined)return;
  if(value.readStatus.throughSeq>=value.lastHistorySeq){value.pendingOpenRead=false;return;}if(value.readPending)return;
  const throughSeq=value.lastHistorySeq,version=generation;
  value.readPending=client.markRead(serverId(key),throughSeq).then(status=>{if(version!==generation||disposed)return;if(advances(value.readStatus,status))value.readStatus=status;value.pendingOpenRead=false;value.error=null;paint();}).catch(error=>{value.error='Leesstatus niet gesynchroniseerd. '+error.message;paint();}).finally(()=>{value.readPending=null;});
 }
 function query(key){if(!enabled)return {};const value=windowFor(key);return {historyLimit:500,...(value.boundary!==undefined?{unreadAfterSeq:value.boundary}:{})};}
 async function register(key){
  if(!identityKnown)enable(await client.status());if(!enabled||registered.has(key))return;
  const agent=host.getAgent(key);await client.describeConversation(serverId(key),{clientKey:key,name:agent?.name||'Gesprek',...(agent?.color&&/^#[0-9a-f]{6}$/i.test(agent.color)?{color:agent.color}:{})});registered.add(key);
 }
 function state(key){const value=windowFor(key);return {ready:value.ready,hasOlder:value.nextBeforeSeq!==null,isLoadingOlder:Boolean(value.older)};}
 function loadOlder(key){
  const value=windowFor(key);if(value.older)return value.older;
  if(value.nextBeforeSeq===null)return Promise.resolve({added:0,hasOlder:false});
  const version=generation,address=serverId(key),beforeSeq=value.nextBeforeSeq;
  value.older=client.history(address,{beforeSeq,limit:100,...(value.boundary!==undefined?{unreadAfterSeq:value.boundary}:{})}).then(page=>{
   if(disposed||generation!==version||serverId(key)!==address)return {added:0,invalidated:true};
   const previous=snapshot(key),entries=mergeCloudEntries(previous.entries,page.entries),added=entries.length-previous.entries.length;
   value.nextBeforeSeq=page.nextBeforeSeq;if(page.unreadSince)value.unread=page.unreadSince;
   adopt({...previous,entries,runs:mergeById(page.context?.runs,previous.runs),tools:mergeById(page.context?.tools,previous.tools),historyPage:{...page,nextBeforeSeq:page.nextBeforeSeq}},key);
   return {added,hasOlder:page.hasOlder};
  }).finally(()=>{value.older=null;});return value.older;
 }
 function divider(key){return cloudUnreadDivider(windowFor(key).unread);}
 function paint(){
  if(disposed)return;const app=host.app;
  for(const row of app.querySelectorAll('.agent-row[data-agent-id]')){
   const count=windows.get(row.dataset.agentId)?.readStatus?.unreadCount??0;let badge=row.querySelector('[data-cloud-unread]');
   if(!count){badge?.remove();continue;}
   if(!badge){badge=document.createElement('span');badge.dataset.cloudUnread='';badge.className='cloud-unread-badge';row.append(badge);}badge.textContent=String(count);badge.setAttribute('aria-label',`${count} ongelezen berichten`);
  }
  const wrap=app.querySelector('.composer-wrap');if(!wrap)return;let notice=wrap.querySelector('[data-cloud-read-error]'),error=windows.get(current())?.error;
  if(!error){notice?.remove();return;}
  if(!notice){notice=document.createElement('p');notice.dataset.cloudReadError='';notice.className='workflow-chat-feedback';notice.setAttribute('role','status');wrap.append(notice);}notice.textContent=error;
 }
 async function catalog(){
  if(!enabled||disposed||catalogBusy)return;catalogBusy=true;const version=generation;
  try{
   const result=await client.conversations();if(version!==generation||disposed)return;applyIdentity(result);const state=host.getState();let changed=false;
   for(const item of result.conversations){
    const descriptor=item.descriptor??{clientKey:'cloud-'+item.conversationId,name:'Gesprek '+item.conversationId.slice(0,8)};let key=Object.keys(state.liveHarness?.serverIds||{}).find(key=>state.liveHarness.serverIds[key]===item.conversationId);
    if(!key){key=descriptor.clientKey;if(state.liveHarness?.serverIds?.[key]&&state.liveHarness.serverIds[key]!==item.conversationId)key='cloud-'+item.conversationId;
     state.liveHarness??={};state.liveHarness.serverIds??={};state.liveHarness.modes??={};state.liveHarness.serverIds[key]=item.conversationId;state.liveHarness.modes[key]='live';
     if(!host.getAgent(key))state.agents.push({id:key,name:descriptor.name,color:descriptor.color||'#1688ff',preview:'Gesynchroniseerd gesprek',cloudScope:state.liveHarness.principalScope});changed=true;
    }
    const value=windowFor(key);if(advances(value.readStatus,item.readStatus))value.readStatus=item.readStatus;
   }
   if(changed){host.persist();host.render();}paint();
  }catch(error){if(version!==generation||disposed)return;windowFor(current()).error='Gesprekken niet gesynchroniseerd. '+error.message;paint();}
  finally{if(version===generation)catalogBusy=false;}
 }
 function applyIdentity(status){
  if(!status.principalScope)return;
  const state=host.getState(),previous=state.liveHarness?.principalScope;if(previous===status.principalScope)return;
  if(previous!==status.principalScope&&(previous||Object.keys(state.liveHarness?.serverIds||{}).length||Object.values(state.messages).some(rows=>rows.some(row=>row.productKind==='live-harness')))){
   const boundKeys=new Set(Object.keys(state.liveHarness?.serverIds||{}));
   const saved={preferences:state.liveHarness,agents:state.agents.filter(agent=>boundKeys.has(agent.id)||agent.cloudScope===previous),messages:Object.fromEntries(Object.entries(state.messages).map(([key,rows])=>[key,rows.filter(row=>row.productKind==='live-harness')]))};
   let backupError;try{localStorage.setItem('grok-device-cache:'+(previous||'legacy'),JSON.stringify(saved));}catch(error){backupError=error;}
   state.messages=Object.fromEntries(Object.entries(state.messages).map(([key,rows])=>[key,rows.filter(row=>row.productKind!=='live-harness')]));
   state.agents=state.agents.filter(agent=>!boundKeys.has(agent.id)&&(!agent.cloudScope||agent.cloudScope!==previous));
   if(!host.getAgent(current()))state.selected='new';
   state.liveHarness={modes:{},serverIds:{}};windows.clear();registered.clear();selected=null;generation++;catalogBusy=false;host.onCloudIdentityChanged?.();if(backupError)windowFor(current()).error='Vorige lokale cache kon niet worden bewaard. De servergegevens blijven behouden.';host.render();
  }
  state.liveHarness??={};state.liveHarness.principalScope=status.principalScope;host.persist();
 }
 function enable(status){identityKnown=true;if(status.capabilities?.cloudHistory!==true)return;applyIdentity(status);if(enabled)return;enabled=true;void Promise.allSettled(Object.keys(host.getState().liveHarness?.serverIds||{}).map(register)).then(catalog);}
 async function paired(status){applyIdentity(status);await catalog();host.render();}

 function afterRender(){if(!enabled)return;select(current());readVisible(current());paint();}
 const focus=()=>readVisible(current());window.addEventListener('focus',focus);
 const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void catalog();},2500);
 return {enable,paired,accept,query,register,filterEntries:entries=>identityKnown?entries:entries.filter(row=>row.productKind!=='live-harness'),generation:()=>generation,afterRender,loadOlder,state,divider,isRemote:key=>enabled&&isLive(key),catalog,
  diagnostics:()=>({enabled,windows:[...windows].map(([key,value])=>({key,...state(key),throughSeq:value.readStatus?.throughSeq,unreadCount:value.readStatus?.unreadCount}))}),
  destroy(){disposed=true;clearInterval(timer);window.removeEventListener('focus',focus);windows.clear();},
 };
}

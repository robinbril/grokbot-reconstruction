// Same-origin transport. Provider credentials remain in the server's CLI process.
export function createLiveHarnessClient({fetchImpl=globalThis.fetch.bind(globalThis),EventSourceImpl=globalThis.EventSource}={}) {
 let csrfToken,initializing;
 const base='/api/harness',segment=value=>encodeURIComponent(value);
 async function request(path,{method='GET',body,signal}={}) {
  if(method!=='GET'&&!csrfToken)await status();
  const response=await fetchImpl(base+path,{method,credentials:'same-origin',signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'x-harness-csrf':csrfToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let value;try{value=await response.json();}catch{throw Object.assign(new Error('De harness gaf geen leesbaar antwoord.'),{code:'INVALID_RESPONSE'});}
  if(!response.ok||value.error)throw Object.assign(new Error(value.error?.message||'De harnessaanvraag is mislukt.'),{code:value.error?.code||String(response.status),retryable:value.error?.retryable!==false,...(value.error?.accepted===false?{accepted:false}:{})});
  if(value.csrfToken)csrfToken=value.csrfToken;
  return value;
 }
 async function uploadAttachment(id,attachmentId,blob){if(!csrfToken)await status();const response=await fetchImpl(base+conversation(id,'/attachments/'+segment(attachmentId)+'/content'),{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','x-harness-csrf':csrfToken},body:blob});let value;try{value=await response.json();}catch{throw new Error('Upload gaf geen leesbaar antwoord.');}if(!response.ok)throw Object.assign(new Error(value.error?.message||'Upload mislukt.'),{code:value.error?.code});return value;}
 function status(){if(!initializing)initializing=request('/status').finally(()=>{initializing=null;});return initializing;}
 const conversation=(id,suffix='')=>'/conversations/'+segment(id)+suffix;
 function events(runId,after,{onEvent,onConnection}={}) {
  const stream=new EventSourceImpl(base+'/runs/'+segment(runId)+'/events?after='+Math.max(0,after||0),{withCredentials:true});
  stream.onopen=()=>onConnection?.('connected');stream.onerror=()=>onConnection?.('disconnected');
  stream.onmessage=event=>{try{onEvent?.(JSON.parse(event.data));}catch(error){onConnection?.('invalid-event',error);}};
  return ()=>stream.close();
 }
 return {status,events,uploadAttachment,
  devices:()=>request('/devices'),startDevicePairing:()=>request('/devices/pairing',{method:'POST',body:{}}),acceptDevicePairing:(code,label)=>request('/devices/pairing/accept',{method:'POST',body:{code,label}}),revokeDevice:id=>request('/devices/'+segment(id)+'/revoke',{method:'POST',body:{}}),
  conversations:()=>request('/conversations'),history:(id,query={})=>request(conversation(id,'/history?'+new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])))),markRead:(id,throughSeq)=>request(conversation(id,'/read'),{method:'POST',body:{requestId:crypto.randomUUID(),throughSeq}}),describeConversation:(id,descriptor)=>request(conversation(id,'/descriptor'),{method:'POST',body:{requestId:crypto.randomUUID(),...descriptor}}),
  canvasList:id=>request(conversation(id,'/canvases')),canvasRead:(id,canvasId)=>request(conversation(id,'/canvases/'+segment(canvasId))),canvasCreate:(id,payload)=>request(conversation(id,'/canvases'),{method:'POST',body:payload}),canvasUpdate:(id,canvasId,payload)=>request(conversation(id,'/canvases/'+segment(canvasId)),{method:'POST',body:payload}),
  skills:()=>request('/skills'),importSkills:payload=>request('/skills/import',{method:'POST',body:payload}),createSkill:payload=>request('/skills',{method:'POST',body:payload}),updateSkill:(id,payload)=>request('/skills/'+segment(id),{method:'POST',body:payload}),
  accounts:()=>request('/accounts'),accountProviders:()=>request('/accounts/providers'),startProviderOAuth:(id,payload)=>request('/accounts/providers/'+segment(id)+'/start',{method:'POST',body:payload}),startAccountOAuth:payload=>request('/accounts/oauth/start',{method:'POST',body:payload}),accountFlow:flowId=>request('/accounts/flows/'+segment(flowId)),cancelAccountFlow:(flowId,requestId)=>request('/accounts/flows/'+segment(flowId)+'/cancel',{method:'POST',body:{requestId}}),
  renameAccount:(id,name,requestId)=>request('/accounts/'+segment(id)+'/rename',{method:'POST',body:{requestId,name}}),defaultAccount:(id,requestId)=>request('/accounts/'+segment(id)+'/default',{method:'POST',body:{requestId}}),disconnectAccount:(id,requestId)=>request('/accounts/'+segment(id)+'/disconnect',{method:'POST',body:{requestId}}),
  accessOverview:()=>request('/access'),ensureBot:payload=>request('/bots',{method:'POST',body:payload}),createTeam:(name,requestId)=>request('/teams',{method:'POST',body:{requestId,name}}),inviteTeam:(teamId,role,requestId)=>request('/teams/'+segment(teamId)+'/invitations',{method:'POST',body:{requestId,role}}),joinTeam:(token,requestId)=>request('/teams/join',{method:'POST',body:{requestId,token}}),
  setTeamMember:(teamId,principalId,role,requestId)=>request('/teams/'+segment(teamId)+'/members/'+segment(principalId),{method:'POST',body:{requestId,role}}),shareBot:(botId,teamId,requestId)=>request('/bots/'+segment(botId)+'/team',{method:'POST',body:{requestId,teamId}}),grantAccount:(teamId,accountId,enabled,requestId)=>request('/teams/'+segment(teamId)+'/accounts',{method:'POST',body:{requestId,accountId,enabled}}),
  bindAccount:(botId,accountId,requestId)=>request('/bots/'+segment(botId)+'/accounts',{method:'POST',body:{requestId,accountId}}),unbindAccount:(botId,accountId,requestId)=>request('/bots/'+segment(botId)+'/accounts/'+segment(accountId)+'/unbind',{method:'POST',body:{requestId}}),bindConversationBot:(id,botId,requestId)=>request(conversation(id,'/bot'),{method:'POST',body:{botId,requestId}}),
  reserveAttachment:(id,payload)=>request(conversation(id,'/attachments'),{method:'POST',body:payload}),attachmentStatus:(id,attachmentId)=>request(conversation(id,'/attachments/'+segment(attachmentId))),
  enqueue:(id,payload)=>request(conversation(id,'/queue'),{method:'POST',body:payload}),cancelQueued:(id,queueId,requestId)=>request(conversation(id,'/queue/'+segment(queueId)+'/cancel'),{method:'POST',body:{requestId}}),retryQueued:(id,queueId,requestId)=>request(conversation(id,'/queue/'+segment(queueId)+'/retry'),{method:'POST',body:{requestId}}),resumeQueue:(id,requestId)=>request(conversation(id,'/queue/resume'),{method:'POST',body:{requestId}}),
  createSchedule:(id,payload)=>request(conversation(id,'/schedules'),{method:'POST',body:payload}),scheduleAction:(id,scheduleId,action,payload)=>request(conversation(id,'/schedules/'+segment(scheduleId)+'/'+action),{method:'POST',body:payload}),snapshot:(id,{historyLimit,unreadAfterSeq}={})=>request(conversation(id,historyLimit?'?'+new URLSearchParams({historyLimit:String(historyLimit),...(unreadAfterSeq!==undefined?{unreadAfterSeq:String(unreadAfterSeq)}:{})}):'')),connect:(id,requestId)=>request(conversation(id,'/connect'),{method:'POST',body:{requestId}}),
  start:(id,payload)=>request(conversation(id,'/runs'),{method:'POST',body:payload}),cancel:(runId,requestId)=>request('/runs/'+segment(runId)+'/cancel',{method:'POST',body:{requestId}}),
  decide:(runId,approvalId,decision,requestId)=>request('/runs/'+segment(runId)+'/approvals/'+segment(approvalId)+'/decision',{method:'POST',body:{requestId,decision}}),
  tools:id=>request(conversation(id,'/tools')),terminal:(id,command,requestId)=>request(conversation(id,'/terminal'),{method:'POST',body:{requestId,command}}),
  stopTerminal:(id,sessionId,requestId)=>request(conversation(id,'/terminal/'+segment(sessionId)+'/stop'),{method:'POST',body:{requestId}}),
  browser:(id,action,args,requestId)=>request(conversation(id,'/browser'),{method:'POST',body:{requestId,action,arguments:args}}),
  mcpPermissions:(id,runtimeId,disabledTools,requestId)=>request(conversation(id,'/mcp-servers/'+segment(runtimeId)+'/permissions'),{method:'POST',body:{requestId,disabledTools}}),
  mcpState:(id,runtimeId,enabled,requestId)=>request(conversation(id,'/mcp-servers/'+segment(runtimeId)+'/state'),{method:'POST',body:{requestId,enabled}}),
  addMcp:(id,server,requestId)=>request(conversation(id,'/mcp-servers'),{method:'POST',body:{requestId,server}})};
}

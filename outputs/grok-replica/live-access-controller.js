export function createAccessController({client,onChange=()=>{}}){
 let overview={principal:null,teams:[],bots:[],grants:[]},accounts=[],loading=false,pending=null,error=null,generation=0,disposed=false,invitation=null;
 const intents=new Map();
 async function refresh(){const version=++generation;loading=true;onChange();try{const [next,available]=await Promise.all([client.accessOverview(),client.accounts()]);if(!disposed&&version===generation){overview=next;accounts=available.accounts;error=null;}}catch(cause){if(!disposed&&version===generation)error=cause;}finally{if(!disposed&&version===generation){loading=false;onChange();}}}
 function mutate(kind,payload,execute){
  if(pending)return pending;
  const signature=JSON.stringify([kind,payload]),requestId=intents.get(signature)||crypto.randomUUID();intents.set(signature,requestId);error=null;generation++;loading=false;
  pending=Promise.resolve().then(()=>execute(requestId)).then(async receipt=>{if(disposed)return;invitation=receipt.invitation||null;await refresh();intents.delete(signature);return receipt;}).catch(cause=>{if(!disposed)error=cause;}).finally(()=>{pending=null;if(!disposed)onChange();});onChange();return pending;
 }
 return {refresh,state:()=>({...overview,accounts,loading,busy:Boolean(pending),error,invitation}),
  ensureBot:payload=>mutate('bot',payload,requestId=>client.ensureBot({...payload,requestId})),
  createTeam:name=>mutate('team',{name},requestId=>client.createTeam(name,requestId)),
  invite:(teamId,role)=>mutate('invite',{teamId,role},requestId=>client.inviteTeam(teamId,role,requestId)),
  join:token=>mutate('join',{token},requestId=>client.joinTeam(token,requestId)),
  member:(teamId,principalId,role)=>mutate('member',{teamId,principalId,role},requestId=>client.setTeamMember(teamId,principalId,role,requestId)),
  unbind:(botId,accountId)=>mutate('unbind',{botId,accountId},requestId=>client.unbindAccount(botId,accountId,requestId)),
  share:(botId,teamId)=>mutate('share',{botId,teamId},requestId=>client.shareBot(botId,teamId,requestId)),
  grant:(teamId,accountId,enabled)=>mutate('grant',{teamId,accountId,enabled},requestId=>client.grantAccount(teamId,accountId,enabled,requestId)),
  destroy(){disposed=true;generation++;invitation=null;intents.clear();},};
}

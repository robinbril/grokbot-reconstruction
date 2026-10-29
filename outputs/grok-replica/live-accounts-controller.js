// Account receipts come from the local backend. OAuth tokens never enter this store.
export function createAccountsController({client,onChange=()=>{},onBound=()=>{}}){
 let accounts=[],providers=[],providerError=null,loading=false,pending=null,error=null,disposed=false,readGeneration=0,binding=null;
 const intents=new Map(),flows=new Map();
 async function refresh(){
  const generation=++readGeneration;loading=true;onChange();
  const [accountResult,providerResult]=await Promise.allSettled([client.accounts(),client.accountProviders?.()||Promise.resolve({providers:[]})]);
  if(disposed||generation!==readGeneration)return;
  if(accountResult.status==='fulfilled'){
   const receipt=accountResult.value;accounts=receipt.accounts;error=null;
   if(Array.isArray(receipt.pendingFlows))for(const flow of receipt.pendingFlows)flows.set(flow.flowId,{...flows.get(flow.flowId),...flow});
  }else error=accountResult.reason;
  if(providerResult.status==='fulfilled'){providers=providerResult.value.providers;providerError=null;}
  else{providers=[];providerError=providerResult.reason;}
  loading=false;onChange();
 }
 function mutate(kind,id,payload,execute){
  if(pending)return pending;
  const signature=JSON.stringify([kind,id,payload]),requestId=intents.get(signature)||crypto.randomUUID();
  intents.set(signature,requestId);error=null;readGeneration++;loading=false;
  pending=Promise.resolve().then(()=>execute(requestId)).then(async receipt=>{
   if(disposed)return;
   if(receipt.flowId)flows.set(receipt.flowId,{status:'pending',...flows.get(receipt.flowId),...receipt});
   if(receipt.accounts)accounts=receipt.accounts;
   else await refresh();
   intents.delete(signature);
   return receipt;
  }).catch(cause=>{if(!disposed)error=cause;}).finally(()=>{pending=null;if(!disposed)onChange();});
  onChange();return pending;
 }
 return {
  refresh,
  start:payload=>mutate('start','',payload,requestId=>client.startAccountOAuth({...payload,requestId})),
  startProvider(id,{name,accountId}={}){
   const provider=providers.find(item=>item.id===id);
   if(provider?.status!=='ready'){error=new Error(provider?.setup?.message||'Providerconfiguratie is niet beschikbaar. Vernieuw de accounts.');onChange();return Promise.resolve();}
   const payload={...(name?{name}:{}),...(accountId?{accountId}:{})};
   return mutate('provider-start',id,payload,requestId=>client.startProviderOAuth(id,{...payload,requestId}));
  },
  cancel:flowId=>mutate('cancel',flowId,null,requestId=>client.cancelAccountFlow(flowId,requestId)),
  async poll(flowId){const generation=readGeneration;try{const flow=await client.accountFlow(flowId);if(disposed||generation!==readGeneration)return;flows.set(flowId,{...flows.get(flowId),...flow});if(flow.status==='connected')await refresh();else onChange();}catch(cause){if(!disposed&&generation===readGeneration){error=cause;onChange();}}},
  rename:(id,name)=>mutate('rename',id,{name},requestId=>client.renameAccount(id,name,requestId)),
  makeDefault:id=>mutate('default',id,null,requestId=>client.defaultAccount(id,requestId)),
  disconnect:id=>mutate('disconnect',id,null,requestId=>client.disconnectAccount(id,requestId)),
  bind:(id,scope)=>mutate('bind',id,scope,async requestId=>{const {bot}=await client.ensureBot({requestId:requestId+'_bot',clientKey:scope.clientKey,name:scope.name});await client.bindAccount(bot.id,id,requestId+'_account');const receipt=await client.bindConversationBot(scope.conversationId,bot.id,requestId+'_conversation');await onBound(receipt,scope.clientKey);binding={accountId:id,botId:bot.id,clientKey:scope.clientKey,name:scope.name};return receipt;}),
  state:()=>({accounts,providers,providerError,flows:[...flows.values()],loading,busy:Boolean(pending),error,binding}),
  account:id=>accounts.find(account=>account.id===id),
  flow:id=>flows.get(id),
  clearError(){error=null;},destroy(){disposed=true;readGeneration++;},
 };
}

// Backend receipts are the sole authority for connector and tool policy state.
export function createConnectorController({key,serverId,client,adopt,refresh,onChange=()=>{}}){
 const pending=new Map(),intents=new Map(),errors=new Map();let disposed=false;
 const signature=(kind,payload)=>JSON.stringify([kind,payload]);
 function mutate(kind,payload,execute){
  const conversation=key(),lock=conversation+':connectors';
  if(pending.has(lock))return pending.get(lock);
  const value=signature(kind,payload),prior=intents.get(conversation),requestId=prior?.signature===value?prior.requestId:crypto.randomUUID();
  intents.set(conversation,{signature:value,requestId});errors.delete(conversation);
  const task=Promise.resolve().then(()=>execute(serverId(conversation),requestId)).then(async receipt=>{
   if(disposed)return;
   // Refresh after a receipt without a snapshot; never invent a successful policy.
   if(receipt?.snapshot||receipt?.schema===1&&Array.isArray(receipt.servers))adopt(receipt,conversation);
   else await refresh(conversation,{afterPending:true});
   intents.delete(conversation);
  }).catch(error=>{if(!disposed)errors.set(conversation,error);}).finally(()=>{
   pending.delete(lock);if(!disposed)onChange();
  }).then(()=>true);
  pending.set(lock,task);onChange();return task;
 }
 return {
  add:server=>mutate('add',server,(id,requestId)=>client.addMcp(id,server,requestId)),
  permissions:(runtimeId,disabledTools)=>mutate('permissions',{runtimeId,disabledTools},(id,requestId)=>client.mcpPermissions(id,runtimeId,disabledTools,requestId)),
  state:(runtimeId,enabled)=>mutate('state',{runtimeId,enabled},(id,requestId)=>client.mcpState(id,runtimeId,enabled,requestId)),
  busy:(id=key())=>pending.has(id+':connectors'),error:(id=key())=>errors.get(id),
  clearError:()=>errors.delete(key()),destroy(){disposed=true;},
 };
}

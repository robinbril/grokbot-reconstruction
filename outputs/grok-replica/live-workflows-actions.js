const actions=new Set(['pause','enable','delete','run-now','cancel','recover-draft','retry','resume']);
const routine=action=>['pause','enable','delete','run-now','edit'].includes(action);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const own=(object,key)=>object&&Object.getOwnPropertyDescriptor(object,key)?.value;
const resource=(conversationId,action,id)=>JSON.stringify([conversationId,routine(action)?'routine':action==='resume'?'resume':'queue',id||'']);
export const workflowActionHoldMessage='Een eerdere actie is nog niet bevestigd. Kies Ontvangst controleren voordat je deze actie opnieuw uitvoert.';

// The durable table is authoritative; busy only prevents concurrent dispatch.
export function createLiveWorkflowActions({host,client,serverId}){
 const busy=new Set();
 const table=()=>host.getState().liveHarness?.workflowRequests;
 function decode(lock,value){
  const match=/^(.*):(pause|enable|delete|run-now|cancel|recover-draft|retry|resume):([^:]*)$/.exec(lock);
  const base={lock,conversationId:match?.[1],action:match?.[2],targetId:match?.[3],valid:false};
  if(!match||!plain(value)||!identifier(value.requestId)||(!identifier(base.targetId)&&!(base.action==='resume'&&base.targetId==='')))return base;
  const metadata=['schema','conversationId','serverConversationId','action','targetId'];
  if(Object.keys(value).some(key=>!['requestId','expectedRevision',...metadata].includes(key)))return base;
  const legacy=value.schema===undefined;
  if(!legacy&&(value.schema!==1||value.conversationId!==base.conversationId||value.action!==base.action||value.targetId!==base.targetId))return base;
  if(legacy&&metadata.some(key=>Object.hasOwn(value,key)))return base;
  if(routine(base.action)&&(!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<1))return base;
  if(!routine(base.action)&&Object.hasOwn(value,'expectedRevision'))return base;
  const canonical=legacy?own(host.getState().liveHarness?.serverIds,base.conversationId):value.serverConversationId;
  if(!identifier(canonical))return base;
  return {...base,valid:true,serverConversationId:canonical,requestId:value.requestId,command:{requestId:value.requestId,...(routine(base.action)?{expectedRevision:value.expectedRevision}:{})}};
 }
 function records(conversationId){
  const rows=table();
  if(rows===undefined)return [];
  if(!plain(rows))return [{valid:false,lock:'',conversationId}];
  return Object.keys(rows).map(lock=>decode(lock,own(rows,lock))).filter(row=>!row.valid||row.conversationId===conversationId);
 }
 function held(conversationId,action,id){
  return busy.has(resource(conversationId,action,id))||records(conversationId).some(row=>!row.valid||resource(row.conversationId,row.action,row.targetId)===resource(conversationId,action,id));
 }
 function saveHeld(conversationId,id){
  const saves=host.getState().liveHarness?.workflowSaves;
  return plain(saves)&&Object.values(saves).some(row=>row?.conversationId===conversationId&&row.scheduleId===id);
 }
 function begin(conversationId,action,targetId,revision){
  if(!actions.has(action))throw new Error('Onbekende workflowactie.');
  if(held(conversationId,action,targetId)||routine(action)&&saveHeld(conversationId,targetId))throw new Error(workflowActionHoldMessage);
  const lock=conversationId+':'+action+':'+(targetId||''),canonical=serverId(conversationId);
  const value={requestId:crypto.randomUUID(),...(routine(action)?{expectedRevision:revision}:{}),schema:1,conversationId,serverConversationId:canonical,action,targetId:targetId||''};
  const record=decode(lock,value);if(!record.valid)throw new Error('De actieaanvraag heeft een ongeldig adres of revisie.');
  const result=host.commit(state=>({...state,liveHarness:{...state.liveHarness,serverIds:{...state.liveHarness?.serverIds,[conversationId]:canonical},workflowRequests:{...state.liveHarness?.workflowRequests,[lock]:value}}}),{reason:'live-workflow-intent'});
  if(!result.ok)throw new Error('De actie kon niet worden opgeslagen. Probeer opnieuw.');
  return record;
 }
 function recover(conversationId,lock){
  const record=records(conversationId).find(row=>row.lock===lock);
  if(!record?.valid)throw new Error('De eerdere actieaanvraag is ongeldig. De opgeslagen identiteit blijft behouden; er is niets opnieuw uitgevoerd.');
  return record;
 }
 function acquire(record){const identity=resource(record.conversationId,record.action,record.targetId);if(busy.has(identity))return false;busy.add(identity);return true;}
 function release(record){busy.delete(resource(record.conversationId,record.action,record.targetId));}
 function retire(record,rejected=false,prepare=state=>state){
  const result=host.commit(state=>{
   const rows=state.liveHarness?.workflowRequests,value=own(rows,record.lock);
   if(!value||value.requestId!==record.requestId)throw new Error('De actieaanvraag is inmiddels gewijzigd.');
   const candidate=prepare(state),prepared=own(candidate?.liveHarness?.workflowRequests,record.lock);
   if(!plain(candidate)||!prepared||JSON.stringify(prepared)!==JSON.stringify(value))throw new Error('De actieaanvraag is inmiddels gewijzigd.');
   const next={...candidate.liveHarness.workflowRequests};delete next[record.lock];return {...candidate,liveHarness:{...candidate.liveHarness,workflowRequests:next}};
  },{reason:'live-workflow-ack'});
  if(!result.ok)throw new Error(rejected?'De actie is afgewezen, maar dit kon niet worden opgeslagen. Kies Ontvangst controleren.':'De actie is ontvangen, maar de bevestiging kon niet worden opgeslagen. Kies Ontvangst controleren.');
 }
 function dispatch(record){
  const {action,targetId,serverConversationId,command}=record;
  if(action==='cancel'||action==='recover-draft')return client.cancelQueued(serverConversationId,targetId,command.requestId);
  if(action==='retry')return client.retryQueued(serverConversationId,targetId,command.requestId);
  if(action==='resume')return client.resumeQueue(serverConversationId,command.requestId);
  return client.scheduleAction(serverConversationId,targetId,action,{...command});
 }
 return {records,held,saveHeld,begin,recover,acquire,release,retire,dispatch,routine};
}

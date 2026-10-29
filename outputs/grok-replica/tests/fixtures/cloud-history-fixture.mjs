import {startWorkflowProtocolServer} from './live-workflows-server.mjs';
export async function startCloudHistoryFixture({port=0}={}){
 const protocol=await startWorkflowProtocolServer({port});
 async function seed(cookie,{count=1250,id='cloud-proof'}={}){
  const token=cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('grok_harness_owner='))?.slice(19);
  const {owner}=await protocol.handler.sessions.resolve(token);
  await protocol.handler.history.descriptor(owner,id,{requestId:'synthetic-descriptor',clientKey:'cloud-proof',name:'Synthetische cloudgeschiedenis',color:'#1688ff'});
  await protocol.handler.store.transaction(owner,id,state=>{
   state.entries=Array.from({length:count},(_,index)=>({id:'cloud-entry-'+index,role:'assistant',runId:'synthetic-finished',revision:1,status:'completed',text:'Cloud proef '+String(index).padStart(4,'0'),createdAt:new Date(1700000000000+index).toISOString(),messages:[{id:'cloud-delivery-'+index,callId:'call-'+index,type:'text',content:'Cloud proef '+String(index).padStart(4,'0'),createdAt:new Date(1700000000000+index).toISOString(),...(index===count-1?{replyTo:{messageId:'cloud-delivery-0',entryId:'cloud-entry-0',role:'assistant',text:'Cloud proef 0000'}}:{})}]}));
  });
  return {owner,id};
 }
 return {...protocol,seed};
}

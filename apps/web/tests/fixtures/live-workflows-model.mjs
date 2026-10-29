// Deterministic synthetic model. Proves workflow transport, never model inference.
import {randomUUID} from 'node:crypto';

export function createWorkflowFixtureModel(){
 return {
  status:()=>({state:'ready',provider:'synthetic-workflow-fixture',model:'deterministic-workflow-fixture',modelExecution:'synthetic'}),
  async complete({messages,signal}){
   signal.throwIfAborted();
   const content=messages.findLast(message=>message.role==='user')?.content;
   const text=typeof content==='string'?content:(content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
   if(text.includes('FIXTURE_DEFER'))await new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
   });
   if(text.includes('FIXTURE_FAIL'))throw Object.assign(new Error('Synthetic workflow model failure; no effects were executed'),{code:'SYNTHETIC_MODEL_FAILURE'});
   return {text:'',toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'Protocol fixture output: '+text}}}]};
  }
 };
}

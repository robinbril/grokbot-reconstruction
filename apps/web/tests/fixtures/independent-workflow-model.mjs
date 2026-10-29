// Explicit synthetic inference and tool effects for the independent host.
// Dispatch counters replace the removed Codex fixture's private RPC endpoint.
import {randomUUID} from 'node:crypto';
import {createWorkflowFixtureModel} from './live-workflows-model.mjs';

export function createIndependentWorkflowFixture({offline=false}={}){
 const base=createWorkflowFixtureModel(),connections=[];
 let current;
 const model={
  status:()=>offline?{state:'unavailable',provider:'synthetic-workflow-fixture',reason:'Synthetic offline model and tool host'}:base.status(),
  async complete(request){
   const {messages}=request,index=messages.findLastIndex(message=>message.role==='user');
   const content=messages[index]?.content;
   const text=typeof content==='string'?content:(content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
   const key=messages.filter(message=>message.role==='user').length;
   if(!current.seen.has(key)){current.seen.add(key);current.turnStarts.push({input:[{text}]});}
   const approvalRequested=messages.slice(index+1).some(message=>message.tool_calls?.some(call=>call.function.name==='SyntheticApprovedEffect'));
   if(text.includes('FIXTURE_APPROVAL')&&!approvalRequested)return {toolCalls:[{id:randomUUID(),name:'SyntheticApprovedEffect',arguments:{text}}]};
   return base.complete(request);
  },
 };
 return {
  model,connections,
  latest:()=>connections.at(-1),
  async toolHostFactory(){
   if(offline)throw Object.assign(new Error('Synthetic offline model and tool host'),{code:'MODEL_NOT_CONFIGURED',status:503,retryable:true});
   current={turnStarts:[],seen:new Set(),effects:[]};connections.push(current);
   const owned=current;
   return {
    getDefinitions:()=>[{name:'SyntheticApprovedEffect',requiresApproval:true,inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}],
    async call(name,args){owned.effects.push({name,arguments:structuredClone(args)});return {executed:true};},
    close:async()=>{},
   };
  },
 };
}

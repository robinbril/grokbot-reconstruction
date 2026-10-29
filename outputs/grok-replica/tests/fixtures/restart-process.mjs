// Synthetic inference/effects around the real HTTP handler. Parent owns this process.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHarnessHandler} from '../../harness/http.mjs';

const [dataDir,mode]=process.argv.slice(2);
const root=fileURLToPath(new URL('../../',import.meta.url));
const marker=path.join(dataDir,'synthetic-effects.txt');
let handler;
const server=http.createServer((req,res)=>handler.handle(req,res));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const baseUrl='http://127.0.0.1:'+server.address().port;
const model={
 status:()=>({state:'ready',provider:'synthetic-crash-test',model:'synthetic-crash-test'}),
 async complete({messages}){
  if(mode==='before')return {toolCalls:[
   {id:'confirmed-call',name:'ConfirmedEffect',arguments:{}},
   {id:'uncertain-call',name:'UncertainEffect',arguments:{}},
  ]};
  const confirmed=messages.find(message=>message.role==='tool'&&message.tool_call_id==='confirmed-call');
  const uncertain=messages.find(message=>message.role==='tool'&&message.tool_call_id==='uncertain-call');
  assert.match(confirmed?.content??'',/confirmed-effect-receipt/);
  assert.match(uncertain?.content??'',/uncertain/i);
  assert.doesNotMatch(uncertain.content,/confirmed-effect-receipt/);
  return {toolCalls:[{id:'recovered-delivery',name:'SendMessage',arguments:{text:{content:'RECOVERED_UNCERTAIN_NO_REPLAY'}}}]};
 },
};
handler=await createHarnessHandler({root,dataDir,baseUrl,model,workflowAutoStart:false,
 toolHostFactory:async()=>({
  getDefinitions:()=>['ConfirmedEffect','UncertainEffect'].map(name=>({name,inputSchema:{type:'object',additionalProperties:false}})),
  async call(name,args,{signal}){
   await appendFile(marker,name+'\n');
   if(name==='ConfirmedEffect')return {receipt:'confirmed-effect-receipt'};
   return new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
   });
  },
  close:async()=>{},
 }),
});
process.send({ready:true,baseUrl});
process.on('message',async message=>{
 if(message!=='close')return;
 await handler.close();server.closeAllConnections();
 await new Promise(resolve=>server.close(resolve));process.disconnect();
});

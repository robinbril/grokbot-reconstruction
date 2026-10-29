import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {startHarness} from './fixtures/harness-http.mjs';
import {startUncertainEffectMcp} from './fixtures/uncertain-effect-mcp.mjs';

async function waitFor(client,id,predicate){
 for(let attempt=0;attempt<300;attempt++){
  const response=await client.request('/conversations/'+id);assert.equal(response.status,200);
  if(predicate(response.value))return response.value;
  await delay(10);
 }
 assert.fail('Expected synthetic HTTP lifecycle was not reached');
}

test('real MCP effect with lost HTTP response stays uncertain in next model history and is not repeated',{timeout:20000},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'grok-mcp-uncertain-'));
 const marker=path.join(directory,'effect.txt'),provider=await startUncertainEffectMcp(marker);
 let calls=0,nextContext;
 const app=await startHarness({model:{status:()=>({state:'ready',provider:'synthetic-lost-response'}),async complete({messages,tools}){
  if(++calls===1){
   const tool=tools.find(definition=>definition.serverId==='custom_lost');assert.ok(tool);
   return {toolCalls:[{id:'lost-response-call',name:tool.name,arguments:{}}]};
  }
  nextContext=messages.find(message=>message.role==='tool'&&message.tool_call_id==='lost-response-call')?.content;
  return {toolCalls:[{id:'reconciliation-reply',name:'SendMessage',arguments:{text:{content:'CHECK_EXISTING_EFFECT_BEFORE_RETRY'}}}]};
 }}});
 t.after(async()=>{await app.close();await provider.close();await rm(directory,{recursive:true,force:true});});
 const client=await app.client(),id='lost-mcp-response';
 const registered=await client.request('/conversations/'+id+'/mcp-servers',{method:'POST',body:{requestId:'register-lost',server:{id:'lost',name:'Synthetic lost response',url:provider.url}}});
 assert.equal(registered.status,200);
 const started=await client.request('/conversations/'+id+'/runs',{method:'POST',body:{requestId:'effect',text:'Perform exactly one synthetic marker append'}});
 assert.equal(started.status,202);
 const waiting=await waitFor(client,id,state=>state.runs[0]?.status==='waiting_approval');
 const run=waiting.runs[0],approval=run.approvals[0];
 assert.equal(provider.calls.length,0);
 const approved=await client.request('/runs/'+run.id+'/approvals/'+approval.id+'/decision',{method:'POST',body:{requestId:'approve-exact',decision:'approve'}});
 assert.equal(approved.status,200);
 const interrupted=await waitFor(client,id,state=>state.runs[0]?.status==='interrupted');
 assert.equal(provider.calls.length,1);assert.equal(provider.calls[0].name,'append_marker');assert.deepEqual(provider.calls[0].arguments,{});
 assert.equal(await readFile(marker,'utf8'),'SYNTHETIC_REMOTE_EFFECT\n');
 assert.equal(interrupted.tools.length,1);assert.equal(interrupted.tools[0].status,'failed');
 assert.equal(Object.hasOwn(interrupted.tools[0],'output'),false);
 const followup=await client.request('/conversations/'+id+'/runs',{method:'POST',body:{requestId:'review',text:'Review the previous uncertain result; do not repeat the action'}});
 assert.equal(followup.status,202);
 const finished=await waitFor(client,id,state=>state.runs[1]?.status==='completed');
 assert.match(JSON.parse(nextContext).error,/uncertain/i);
 assert.match(nextContext,/Do not assume success or automatically repeat/);
 assert.ok(finished.entries.some(entry=>entry.text==='CHECK_EXISTING_EFFECT_BEFORE_RETRY'));
 assert.equal(provider.calls.length,1);assert.equal(await readFile(marker,'utf8'),'SYNTHETIC_REMOTE_EFFECT\n');
 assert.equal(calls,2);assert.equal(finished.runs.length,2);
});

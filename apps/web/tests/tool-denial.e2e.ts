// Synthetic inference; real approval button, denial receipt, FIFO, SSE and reload.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
let effects=0,receivedDenial=false;
beforeEach(async({browser})=>{
 effects=0;receivedDenial=false;
 protocol=await startWorkflowProtocolServer({port:18886,model:{status:()=>({state:'ready',provider:'synthetic-denial-ui'}),async complete({messages}){
  const index=messages.findLastIndex(message=>message.role==='user'),text=messages[index].content;
  if(text==='REA_DENIAL_SAFE'){
   const result=messages.slice(index+1).find(message=>message.role==='tool'&&message.tool_call_id==='denied-ui-call');
   if(!result)return {toolCalls:[{id:'denied-ui-call',name:'SyntheticApprovedEffect',arguments:{}}]};
   const denial=JSON.parse(result.content);assert.equal(denial.isError,true);
   assert.equal(denial.structuredContent.code,'TOOL_DENIED');assert.equal(denial.structuredContent.executed,false);
   assert.equal(denial.structuredContent.callId,'denied-ui-call');receivedDenial=true;
  }
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:text==='REA_DENIAL_SAFE'?'De geweigerde actie is niet uitgevoerd.':'De volgende taak is afgerond.'}}}]};
 }},toolHostFactory:async()=>({
  getDefinitions:()=>[{name:'SyntheticApprovedEffect',requiresApproval:true,inputSchema:{type:'object',additionalProperties:false}}],
  call:async()=>{effects++;return {executed:true};},close:async()=>{},
 })});
 await browser.goto(protocol.baseUrl);
});
afterEach(async()=>{await protocol?.close();});
type Snapshot={runs:{id:string;status:string;approvals:{id:string;decision?:string}[]}[];queue:{status:string;runId?:string}[];tools:{status:string;output?:string}[];workflow:{hold:unknown}};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
 const id=saved.liveHarness?.serverIds?.[saved.selected];if(typeof id!=='string')throw Error('No canonical live conversation');
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw Error('Canonical GET '+response.status);return response.json();
});}
test('explicit refusal produces a safe answer and advances queued work without executing the rejected operation',async({browser,screen,agent,app})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REA_DENIAL_SAFE');
 await agent.act('Verstuur het klaargezette bericht REA_DENIAL_SAFE eenmaal.');
 await expect(screen.getByRole('button','Afwijzen',{exact:true})).toBeVisible();expect(effects).toBe(0);
 await input.fill('REA_AFTER_DENIAL');await screen.getByRole('button','In wachtrij',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).queue[0]?.status).toBe('queued');
 await agent.act('Wijs uitsluitend de openstaande SyntheticApprovedEffect-aanvraag af met Afwijzen. Gebruik Goedkeuren niet.');
 await expect(browser.locator('.transcript')).toContainText('De geweigerde actie is niet uitgevoerd.');
 await expect(browser.locator('.transcript')).toContainText('De volgende taak is afgerond.');
 const state=await canonical(browser);expect(state.runs.map(run=>run.status)).toEqual(['completed','completed']);
 expect(state.queue[0].status).toBe('completed');expect(state.workflow.hold).toBeNull();
 expect(state.runs[0].approvals[0].decision).toBe('reject');expect(effects).toBe(0);expect(receivedDenial).toBe(true);
 expect(JSON.parse(state.tools.find(tool=>tool.output?.includes('TOOL_DENIED'))!.output!).structuredContent.executed).toBe(false);
 await browser.reload();await expect(browser.locator('.transcript')).toContainText('De geweigerde actie is niet uitgevoerd.');
 await expect(browser.locator('.transcript')).toContainText('De volgende taak is afgerond.');expect(effects).toBe(0);
 await expect(screen.getByRole('button','Wachtrij voortzetten',{exact:true})).toHaveCount(0);
 await app.screenshot('refused-tool-safe-answer-and-fifo-after-reload');
});

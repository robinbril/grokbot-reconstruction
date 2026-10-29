// Actual ProseMirror key-event boundary and production queue HTTP, synthetic inference.
import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function canonical(browser:Browser){return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 return fetch('/api/harness/conversations/'+encodeURIComponent(id)).then(response=>response.json());
});}
test('Shift+Enter queues after ProseMirror prevents native Enter and retains exact rich document',async({browser,screen})=>{
 protocol=await startWorkflowProtocolServer({port:18893,model:{status:()=>({state:'ready',provider:'synthetic-key-boundary'}),async complete(){return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'REA_QUEUE_KEY_REPLY'}}}]};}}});
 await browser.goto(protocol.baseUrl);
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill('REA_QUEUE_KEY_PROBE');
 const before=await browser.evaluate(()=>{
  document.addEventListener('keydown',event=>{
   if(event.key==='Enter'&&event.shiftKey)document.documentElement.dataset.queueCapturePrevented=String(event.defaultPrevented);
  },true);
  document.addEventListener('keydown',event=>{
   if(event.key==='Enter'&&event.shiftKey)document.documentElement.dataset.queueBubblePrevented=String(event.defaultPrevented);
  });
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),key=state.selected;
  return {text:state.drafts[key],richText:state.draftRichTexts[key]};
 });
 await input.press('Shift+Enter');
 await expect(browser.locator('html')).toHaveAttribute('data-queue-capture-prevented','false');
 await expect(browser.locator('html')).toHaveAttribute('data-queue-bubble-prevented','true');
 await expect.poll(async()=>(await canonical(browser)).queue?.length).toBe(1);
 const snapshot=await canonical(browser);
 expect(snapshot.queue[0].payload).toMatchObject(before);
 await expect(input).toHaveText('');
});

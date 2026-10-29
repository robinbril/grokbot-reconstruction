import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>|undefined,releaseAway:(()=>void)|undefined;
afterEach(async()=>{releaseAway?.();await protocol?.close();protocol=undefined;releaseAway=undefined;});
async function state(browser:Browser){return browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!));}
async function runs(browser:Browser){return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),id=state.liveHarness.serverIds.marketing;
 const response=await fetch('/api/harness/conversations/'+id);if(!response.ok)throw Error('Canonical unread snapshot unavailable');return response.json();
});}
async function ledger(browser:Browser){return browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-unread-v1')!).conversations.find((row:{key:string})=>row.key==='marketing'));}

test('two canonical deliveries while away retain their exact unread divider through live refresh and reopen',async({browser,screen,agent,app})=>{
 let modelEntered=false;const awayGate=new Promise<void>(resolve=>{releaseAway=resolve;});
 protocol=await startWorkflowProtocolServer({port:19103,model:{status:()=>({state:'ready',provider:'synthetic-unread-protocol'}),async complete({messages}:{messages:Array<{role:string;content:unknown}>}){
  const prompt=messages.findLast(message=>message.role==='user')?.content;if(prompt==='SYNTHETIC_UNREAD_AWAY'){modelEntered=true;await awayGate;}
  const content=prompt==='SYNTHETIC_UNREAD_AWAY'?'SYNTHETIC_NEW_UNREAD_AWAY':'SYNTHETIC_READ_BASELINE';
  return {toolCalls:(prompt==='SYNTHETIC_UNREAD_AWAY'?[content,'SYNTHETIC_SECOND_UNREAD_AWAY']:[content]).map(content=>({id:randomUUID(),name:'SendMessage',arguments:{text:{content}}}))};
 }}});
 await browser.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});});
 await browser.goto(protocol.baseUrl);await agent.act('Open Marketing Agent zonder een bericht te verzenden.');await expect(screen.getByRole('button',{name:'Gespreksopties',exact:true})).toBeVisible();
 await screen.getByRole('radio',{name:'Echte harness',exact:true}).check();const input=screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true});
 // Canonical completion includes durable post-delivery writes; use the sibling protocol run budget.
 await input.fill('SYNTHETIC_UNREAD_BASELINE');await input.press('Enter');await expect.poll(async()=>(await runs(browser)).runs.map((run:{status:string})=>run.status),{timeout:60_000}).toEqual(['completed']);
 await expect(screen.getByText('SYNTHETIC_READ_BASELINE',{exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Find Customers',exact:true}).click();await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 const readAt=(await ledger(browser)).lastViewedAt;expect(readAt).toBeGreaterThan(0);
 await input.fill('SYNTHETIC_UNREAD_AWAY');await input.press('Enter');await expect.poll(()=>modelEntered).toBe(true);
 await screen.getByRole('button',{name:'Find Customers',exact:true}).click();expect((await state(browser)).selected).toBe('customers');releaseAway!();
 await expect.poll(async()=>(await runs(browser)).runs.map((run:{status:string})=>run.status),{timeout:60_000}).toEqual(['completed','completed']);
 const snapshot=await runs(browser),delivered=snapshot.entries.flatMap((entry:{id:string;messages?:Array<{id:string;content:string}>})=>(entry.messages||[]).filter(message=>message.content==='SYNTHETIC_NEW_UNREAD_AWAY').map(message=>({messageId:message.id,entryId:entry.id})));
 expect(delivered).toHaveLength(1);const target=delivered[0];
 const second=snapshot.entries.flatMap((entry:{messages?:Array<{id:string;content:string}>})=>entry.messages||[]).find((message:{content:string})=>message.content==='SYNTHETIC_SECOND_UNREAD_AWAY');expect(second).toBeDefined();
 await expect.poll(async()=>(await ledger(browser)).receipts.filter((receipt:{id:string;eligible:boolean})=>receipt.id===target.messageId&&receipt.eligible).length).toBe(1);
 expect((await state(browser)).selected).toBe('customers');const receipt=(await ledger(browser)).receipts.find((item:{id:string})=>item.id===target.messageId);expect(receipt.timestampMs).toBeGreaterThan(readAt);
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await expect(browser.locator('[data-unread-divider]')).toHaveAttribute('data-unread-entry-id',target.messageId);
 expect(await browser.evaluate(()=>{
  const w=window as Window&{productSurfaces:{diagnostics():{modules:Array<{id:string;unread?:{divider?:{newMessageCount:number}}}>}}};return w.productSurfaces.diagnostics().modules.find(module=>module.id==='transcript-coordinator')!.unread!.divider!.newMessageCount;
 })).toBe(2);
 await expect.poll(()=>browser.evaluate(()=>{
  const marker=document.querySelector('[data-unread-divider]');return marker?.nextElementSibling?.getAttribute('data-live-message-id')===marker?.getAttribute('data-unread-entry-id');
 })).toBe(true);
 await expect(browser.locator(`[data-live-message-id="${target.messageId}"]`)).toHaveText('SYNTHETIC_NEW_UNREAD_AWAY');
 await browser.reload();await expect(screen.getByText('SYNTHETIC_NEW_UNREAD_AWAY',{exact:true})).toBeVisible();
 expect((await ledger(browser)).receipts.filter((item:{id:string})=>item.id===target.messageId)).toHaveLength(1);await expect(browser.locator('[data-unread-divider]')).toHaveCount(0);
 await app.screenshot('canonical-background-unread-receipt-reopened-without-duplicates');
});

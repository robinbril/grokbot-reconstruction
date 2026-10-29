import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {createWorkflowFixtureModel} from './fixtures/live-workflows-model.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
const source='import {useState} from "react";export default function Canvas(){const[n,setN]=useState(0);return <main><h1>CANVAS_SOURCE_NONCE_4827</h1><button onClick={()=>setN(n+1)}>Teller {n}</button></main>}';
async function boot(browser:Browser,screen:Screen,calls:string[],pause?:Promise<void>){
 const base=createWorkflowFixtureModel();protocol=await startWorkflowProtocolServer({port:18968,model:{status:base.status,async complete(input:Parameters<typeof base.complete>[0]){
  input.signal.throwIfAborted();calls.push(JSON.stringify(input.messages));if(pause)await Promise.race([pause,new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}))]);
  return {text:'',toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'CANVAS_CONTEXT_RECEIVED'}}}]};
 }}});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();await screen.getByRole('button','Gespreksdetails',{exact:true}).last().click();await screen.getByRole('tab','Bibliotheek',{exact:true}).click();await screen.getByRole('button','Nieuw canvas',{exact:true}).click();await screen.getByRole('textbox','Canvastitel',{exact:true}).fill('Held source');await screen.getByRole('textbox','Canvasbroncode',{exact:true}).fill(source);await screen.getByRole('button','Opslaan',{exact:true}).click();await expect(screen.getByText('Opgeslagen · versie 1',{exact:true})).toBeVisible();
}
async function canonical(browser:Browser){return browser.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');return (await fetch('/api/harness/conversations/'+s.liveHarness.serverIds.marketing)).json();});}
async function draft(browser:Browser){return browser.evaluate(async()=>{const module=await import('/composer-input.js');return module.readComposerInput(document.querySelector('#message-input'));});}
function refs(richText:string){const doc=JSON.parse(richText);return doc.content.flatMap((node:{content?:{type:string,attrs:object}[]})=>node.content??[]).filter((node:{type:string})=>node.type==='canvasReference');}

test('opened saved canvas is invisible send context resolved from actual source and closing its pane releases the hold',async({browser,screen,agent,app})=>{
 const calls:string[]=[];await boot(browser,screen,calls);await agent.act('Open de tab Voorbeeld van het opgeslagen canvas. Verzend nog geen bericht.');await expect(browser.frameLocator('iframe[title="Canvasvoorbeeld"]').getByRole('heading','CANVAS_SOURCE_NONCE_4827')).toBeVisible();const frame=browser.frameLocator('iframe[title="Canvasvoorbeeld"]');await frame.getByRole('button','Teller 0',{exact:true}).click();await expect(frame.getByRole('button','Teller 1',{exact:true})).toBeVisible();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('Wat staat in het geopende canvas?');const original=await draft(browser);expect(original.richText).not.toContain('canvasReference');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');const first=await canonical(browser),user=first.entries.find((entry:{role:string})=>entry.role==='user');expect(user.text).toBe(original.text);expect(refs(user.richText)).toHaveLength(1);expect(refs(user.richText)[0].attrs).toMatchObject({storeId:null,title:'Held source'});expect(calls[0]).toContain('Selected canvas context');expect(calls[0]).toContain('CANVAS_SOURCE_NONCE_4827');expect(first.canvasInputs).toBeUndefined();expect(first.canvases[0].source).toBeUndefined();expect((await draft(browser)).text).toBe('');await expect(frame.getByRole('button','Teller 1',{exact:true})).toBeVisible();await expect(browser.locator('.message.user [data-type="canvas-reference"]')).toHaveCount(0);
 await screen.getByRole('button','Details sluiten',{exact:true}).click();
 await expect(screen.getByRole('complementary','Gespreksdetails',{exact:true})).toBeHidden();
 await expect(browser.locator('iframe[title="Canvasvoorbeeld"]')).toHaveCount(0);
 await input.pressSequentially('Zonder geopend canvas');await input.press('Enter');await expect.poll(async()=>(await canonical(browser)).runs[1]?.status).toBe('completed');const next=await canonical(browser),second=next.entries.filter((entry:{role:string})=>entry.role==='user')[1];expect(refs(second.richText)).toHaveLength(0);const lastUser=JSON.parse(calls.at(-1)!).findLast((m:{role:string})=>m.role==='user');expect(JSON.stringify(lastUser)).not.toContain('Selected canvas context');
 await expect(browser.locator('iframe[title="Canvasvoorbeeld"]')).toHaveCount(0);
 await app.screenshot('held-canvas-hidden-context');
});

test('queued lost acknowledgement retries frozen canvas context after pane close and preserves the newer original draft',async({browser,screen})=>{
 const calls:string[]=[];let release!:()=>void;const pause=new Promise<void>(resolve=>{release=resolve;});
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);let lost=false;window.fetch=async(input,init)=>{const path=typeof input==='string'?input:input instanceof URL?input.href:input.url;const response=await original(input,init);if(!lost&&init?.method==='POST'&&/\/queue$/.test(path)){lost=true;throw Error('Synthetic lost queue ACK');}return response;};});
 await boot(browser,screen,calls,pause);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('Bewaar deze canvascontext');const original=await draft(browser);await input.press('Shift+Enter');await expect(screen.getByRole('button','Ontvangst controleren',{exact:true})).toBeVisible();await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(1);const before=await canonical(browser),richText=before.queue[0].payload.richText;expect(refs(richText)).toHaveLength(1);expect((await draft(browser)).richText).toBe(original.richText);
 await screen.getByRole('button','Canvassen',{exact:true}).click();await input.pressSequentially(' nieuw concept');const newer=await draft(browser);await screen.getByRole('button','Ontvangst controleren',{exact:true}).click();await expect(screen.getByRole('button','Ontvangst controleren',{exact:true})).toBeHidden();expect((await draft(browser)).text).toBe(newer.text);expect((await canonical(browser)).queue).toHaveLength(1);expect((await canonical(browser)).queue[0].payload.richText).toBe(richText);
 release();await expect.poll(async()=>(await canonical(browser)).queue[0].status).toBe('completed');expect(calls[0]).toContain('CANVAS_SOURCE_NONCE_4827');expect((await draft(browser)).richText).toBe(newer.richText);expect((await canonical(browser)).tools.map((tool:{name:string})=>tool.name)).toEqual(['SendMessage']);
});

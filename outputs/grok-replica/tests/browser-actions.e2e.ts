// Only inference is scripted. HTTP, ownership, Grok runtime and Chromium are real.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
const documentHtml=`<!doctype html><html><head><title>Browser workflow proof</title></head><body><input id="query" onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('#count').textContent='ENTER='+ ++window.count}"><p id="count">ENTER=0</p><select id="choice" onchange="document.querySelector('#selected').textContent='CHOICE='+this.value"><option value="one">One</option><option value="two">Two</option></select><p id="selected">CHOICE=one</p><div id="viewport" style="height:120px;overflow:auto" onscroll="document.querySelector('#position').textContent='SCROLL='+Math.round(this.scrollTop)"><div style="height:1800px;background:linear-gradient(white,steelblue)">Scrollable owned content</div></div><p id="position">SCROLL=0</p><script>window.count=0</script></body></html>`;
function fixtureModel(){let calls=0;return {status:()=>({state:'ready',provider:'synthetic-browser-fixture',model:'deterministic-browser-fixture'}),async complete(){calls++;return {text:'',toolCalls:[calls===1?{id:randomUUID(),name:'workspace_write',arguments:{path:'browser-controls.html',content:documentHtml}}:{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'Owned browser proof ready'}}}]};}};}
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer({model:fixtureModel()});await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Canonical={conversationId:string;runs:{status:string}[];browserSessions:{captureId:string}[]};
async function canonical(browser:Browser):Promise<Canonical>{return browser.evaluate(async()=>{const local=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=local.liveHarness?.serverIds?.[local.selected];if(!id)throw new Error('Missing owned conversation');const result=await fetch('/api/harness/conversations/'+id);if(!result.ok)throw new Error('History unavailable');return result.json();});}
async function pageText(browser:Browser):Promise<string>{return browser.evaluate(async()=>{const local=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=local.liveHarness.serverIds[local.selected],status=await fetch('/api/harness/status').then(r=>r.json());const result=await fetch('/api/harness/conversations/'+id+'/browser',{method:'POST',headers:{'Content-Type':'application/json','x-harness-csrf':status.csrfToken},body:JSON.stringify({requestId:crypto.randomUUID(),action:'browser_snapshot',arguments:{}})});if(!result.ok)throw new Error('Real browser snapshot failed');return (await result.json()).result.text;});}

test('owned browser UI types Enter selects scrolls and retains drafts after reload',async({screen,browser,app})=>{
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();
 const message=screen.getByRole('textbox','Bericht sturen naar Bot');await message.fill('Prepare the synthetic owned browser controls proof.');await message.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status,{timeout:60_000}).toBe('completed');
 await screen.getByRole('button','Computer openen').click();await screen.getByRole('tab','Browser').click();
 const owned=await canonical(browser),url=protocol.baseUrl+'/api/harness/conversations/'+owned.conversationId+'/preview/browser-controls.html';
 await screen.getByRole('textbox','Browser-URL').fill(url);await screen.getByRole('button','Pagina openen').click();await expect.poll(async()=>(await canonical(browser)).browserSessions.length,{timeout:60_000}).toBe(1);
 await screen.getByText('Pagina bedienen',{exact:true}).click();await screen.getByRole('textbox','Browserelement').fill('#query');await screen.getByRole('textbox','Browserinvoer').fill('REAL_BROWSER_TYPED_VALUE');await screen.getByRole('button','Veld invullen').click();
 await screen.getByRole('button','Toets indrukken',{exact:true}).click();
 await expect.poll(()=>pageText(browser)).toContain('ENTER=1');
 await screen.getByRole('textbox','Browserelement').fill('#choice');await screen.getByRole('textbox','Browserinvoer').fill('two');await screen.getByRole('button','Optie selecteren').click();await expect.poll(()=>pageText(browser)).toContain('CHOICE=two');
 await screen.getByRole('textbox','Browserelement').fill('#viewport');await screen.getByRole('spinbutton','Browserscrollafstand').fill('375');
 const before=(await canonical(browser)).browserSessions[0].captureId;await screen.getByRole('button','Pagina scrollen').click();await expect.poll(()=>pageText(browser)).toContain('SCROLL=375');await expect.poll(async()=>(await canonical(browser)).browserSessions[0].captureId).not.toBe(before);
 await screen.getByRole('combobox','Browsertoets').selectOption({value:'Shift+Enter'});await screen.getByRole('combobox','Browserscrollrichting').selectOption({value:'up'});
 await browser.reload();await screen.getByRole('tab','Browser').click();await screen.getByText('Pagina bedienen',{exact:true}).click();
 await expect(screen.getByRole('textbox','Browser-URL')).toHaveValue(url);await expect(screen.getByRole('textbox','Browserelement')).toHaveValue('#viewport');await expect(screen.getByRole('textbox','Browserinvoer')).toHaveValue('two');await expect(screen.getByRole('combobox','Browsertoets')).toHaveValue('Shift+Enter');await expect(screen.getByRole('combobox','Browserscrollrichting')).toHaveValue('up');await expect(screen.getByRole('spinbutton','Browserscrollafstand')).toHaveValue('375');
 await screen.getByRole('spinbutton','Browserscrollafstand').fill('2.5');await screen.getByRole('button','Pagina scrollen').click();await expect(browser.locator('[data-live-send-error]')).toContainText('geheel getal');await expect(screen.getByRole('spinbutton','Browserscrollafstand')).toHaveValue('2.5');
 await app.screenshot('owned-browser-controls-live');
});

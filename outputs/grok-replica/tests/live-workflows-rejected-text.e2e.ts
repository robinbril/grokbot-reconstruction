// Real public form + production HTTP/ledger. Protocol fixture is not model proof.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Schedule={id:string;title:string;revision:number;enabled:boolean;payload:{text:string}};
type Observation={status:number;errorCode?:string;command:{requestId:string;payload:{text:string}}};
async function canonical(browser:Browser):Promise<{conversationId:string;schedules:Schedule[]}>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];if(!id)throw new Error('No canonical live conversation');const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));
 if(response.status===404)return {conversationId:id,schedules:[]};if(!response.ok)throw new Error('Canonical GET '+response.status);return response.json();
});}
async function journalCount(browser:Browser):Promise<number>{return browser.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').liveHarness?.workflowSaves||{}).length);}
async function observations(browser:Browser):Promise<Observation[]>{return browser.evaluate(()=>JSON.parse(sessionStorage.getItem('rejected-text-save-observations')||'[]'));}

test('real whitespace-only prompt rejection preserves input and accepts one corrected routine',async({app,screen,browser})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 // Observe the unmodified HTTP response; no fabricated error or validation hook.
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(...args:Parameters<typeof fetch>)=>{
  const isCreate=new URL(String(args[0]),location.href).pathname.endsWith('/schedules')&&args[1]?.method==='POST';const response=await original(...args);
  if(isCreate){const body=await response.clone().json(),rows=JSON.parse(sessionStorage.getItem('rejected-text-save-observations')||'[]');rows.push({status:response.status,errorCode:body.error?.code,command:JSON.parse(String(args[1]?.body))});sessionStorage.setItem('rejected-text-save-observations',JSON.stringify(rows));}return response;
 };});await browser.reload();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();const dialog=screen.getByRole('dialog');await dialog.getByRole('textbox','Naam',{exact:true}).fill('Correctable text routine');await dialog.getByRole('textbox','Opdracht',{exact:true}).fill('   ');await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(new Date(Date.now()+172_800_000).toISOString());await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('Europe/Amsterdam');await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-routine-error]')).toContainText('Prompt text or ready uploaded attachments required');
 await expect(dialog.getByRole('textbox','Naam',{exact:true})).toHaveValue('Correctable text routine');await expect(dialog.getByRole('textbox','Opdracht',{exact:true})).toHaveValue('   ');expect((await canonical(browser)).schedules).toHaveLength(0);
 const rejected=await observations(browser);expect(rejected).toHaveLength(1);expect(rejected[0].status).toBe(422);expect(rejected[0].errorCode).toBe('INVALID_TEXT');expect(rejected[0].command.payload.text).toBe('   ');
 await dialog.getByRole('textbox','Opdracht',{exact:true}).fill('CORRECTED_NONEMPTY_ROUTINE_PROMPT');
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Correctable text routine',{exact:true})).toBeVisible();
 const saved=await canonical(browser);expect(saved.schedules).toHaveLength(1);expect(saved.schedules[0].title).toBe('Correctable text routine');expect(saved.schedules[0].payload.text).toBe('CORRECTED_NONEMPTY_ROUTINE_PROMPT');expect(saved.schedules[0].enabled).toBe(true);expect(saved.schedules[0].revision).toBe(1);expect(await journalCount(browser)).toBe(0);
 const requests=await observations(browser);expect(requests).toHaveLength(2);expect(requests[1].status).toBe(201);expect(requests[1].command.requestId).not.toBe(requests[0].command.requestId);expect(requests[1].command.payload.text).toBe('CORRECTED_NONEMPTY_ROUTINE_PROMPT');
 await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.reload();const reloaded=await canonical(browser);expect(reloaded.schedules).toHaveLength(1);expect(reloaded.schedules[0].id).toBe(saved.schedules[0].id);expect(reloaded.schedules[0].payload.text).toBe('CORRECTED_NONEMPTY_ROUTINE_PROMPT');expect(await journalCount(browser)).toBe(0);await app.screenshot('rejected-text-corrected-once');
});

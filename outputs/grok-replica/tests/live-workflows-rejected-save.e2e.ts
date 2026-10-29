// Real public form + production HTTP/ledger. Protocol fixture is not model proof.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Schedule={id:string;title:string;revision:number;enabled:boolean;payload:{text:string};rule:{at:string;timeZone:string}};
type Observation={status:number;errorCode?:string;command:{requestId:string;expectedRevision?:number;title:string;payload:{text:string};rule:{at:string;timeZone:string}}};
async function canonical(browser:Browser):Promise<{conversationId:string;schedules:Schedule[]}>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];if(!id)throw new Error('No canonical live conversation');
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));
 // A genuinely rejected first create has no canonical record yet.
 if(response.status===404)return {conversationId:id,schedules:[]};if(!response.ok)throw new Error('Canonical GET '+response.status);return response.json();
});}
async function journalCount(browser:Browser):Promise<number>{return browser.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').liveHarness?.workflowSaves||{}).length);}
async function observations(browser:Browser):Promise<Observation[]>{return browser.evaluate(()=>JSON.parse(sessionStorage.getItem('rejected-routine-save-observations')||'[]'));}
async function observeRealSaves(browser:Browser):Promise<void>{
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(...args:Parameters<typeof fetch>)=>{
  const url=new URL(String(args[0]),location.href),isSave=/\/schedules(?:\/[^/]+\/edit)?$/.test(url.pathname)&&args[1]?.method==='POST';
  const response=await original(...args);
  if(isSave){const body=await response.clone().json(),rows=JSON.parse(sessionStorage.getItem('rejected-routine-save-observations')||'[]');rows.push({status:response.status,errorCode:body.error?.code,command:JSON.parse(String(args[1]?.body))});sessionStorage.setItem('rejected-routine-save-observations',JSON.stringify(rows));}
  return response;
 };});
 await browser.reload();
}
async function openPlan(screen:Screen):Promise<void>{await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();}
async function fillPlan(screen:Screen,title:string,prompt:string,at:string):Promise<void>{
 const dialog=screen.getByRole('dialog');await dialog.getByRole('textbox','Naam',{exact:true}).fill(title);await dialog.getByRole('textbox','Opdracht',{exact:true}).fill(prompt);await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(at);await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('Europe/Amsterdam');await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();
}
async function openMarketing(screen:Screen):Promise<void>{await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();}

test('a server-rejected past routine retains the form and saves one corrected future job',async({app,screen,browser})=>{
 await openMarketing(screen);await observeRealSaves(browser);await openPlan(screen);await fillPlan(screen,'Correctable past routine','REJECTED_CREATE_PROMPT','2020-01-01T09:00:00Z');
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-routine-error]')).toContainText('Choose a future one-time instant');
 await expect(screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true})).toHaveValue('Correctable past routine');await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('REJECTED_CREATE_PROMPT');await expect(screen.getByRole('dialog').getByLabel('Datum en tijd',{exact:true})).toHaveValue('2020-01-01T09:00:00Z');
 expect((await canonical(browser)).schedules).toHaveLength(0);const rejected=await observations(browser);expect(rejected).toHaveLength(1);expect(rejected[0].status).toBe(422);expect(rejected[0].errorCode).toBe('INVALID_SCHEDULE');
 const correctedAt=new Date(Date.now()+172_800_000).toISOString();await screen.getByRole('dialog').getByLabel('Datum en tijd',{exact:true}).fill(correctedAt);
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Correctable past routine',{exact:true})).toBeVisible();
 const saved=await canonical(browser);expect(saved.schedules).toHaveLength(1);expect(saved.schedules[0].title).toBe('Correctable past routine');expect(saved.schedules[0].payload.text).toBe('REJECTED_CREATE_PROMPT');expect(saved.schedules[0].rule.at).toBe(correctedAt);expect(saved.schedules[0].enabled).toBe(true);expect(saved.schedules[0].revision).toBe(1);expect(await journalCount(browser)).toBe(0);
 const requests=await observations(browser);expect(requests).toHaveLength(2);expect(requests[1].status).toBe(201);expect(requests[1].command.requestId).not.toBe(requests[0].command.requestId);
 await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.reload();const reloaded=await canonical(browser);expect(reloaded.schedules).toHaveLength(1);expect(reloaded.schedules[0].id).toBe(saved.schedules[0].id);expect(await journalCount(browser)).toBe(0);await app.screenshot('rejected-create-corrected-once');
});

test('a server-rejected zone edit retains inputs and correction changes the same routine only once',async({app,screen,browser})=>{
 await openMarketing(screen);await openPlan(screen);await fillPlan(screen,'Correctable zone routine','ZONE_EDIT_BEFORE',new Date(Date.now()+172_800_000).toISOString());await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();await expect(screen.getByRole('dialog','Correctable zone routine',{exact:true})).toBeVisible();
 const initial=(await canonical(browser)).schedules[0];expect(initial.revision).toBe(1);await observeRealSaves(browser);
 const routines=screen.getByRole('button','Routines',{exact:false});if(!await routines.isVisible())await screen.getByRole('button','Gespreksdetails',{exact:true}).first().click();await routines.click();await screen.getByRole('button','Routine openen: Correctable zone routine',{exact:true}).click();await screen.getByRole('button','Bewerken',{exact:true}).click();
 await screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true}).fill('ZONE_EDIT_AFTER');await screen.getByRole('dialog').getByRole('textbox','Tijdzone',{exact:true}).fill('Owned/InvalidZone');
 await screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-routine-error]')).toContainText('Use a valid IANA timeZone');
 await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('ZONE_EDIT_AFTER');await expect(screen.getByRole('dialog').getByRole('textbox','Tijdzone',{exact:true})).toHaveValue('Owned/InvalidZone');expect((await canonical(browser)).schedules[0]).toEqual(initial);
 const rejected=await observations(browser);expect(rejected).toHaveLength(1);expect(rejected[0].status).toBe(422);expect(rejected[0].errorCode).toBe('INVALID_SCHEDULE');await screen.getByRole('dialog').getByRole('textbox','Tijdzone',{exact:true}).fill('UTC');
 await screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Correctable zone routine',{exact:true})).toBeVisible();
 const saved=await canonical(browser);expect(saved.schedules).toHaveLength(1);expect(saved.schedules[0].id).toBe(initial.id);expect(saved.schedules[0].revision).toBe(2);expect(saved.schedules[0].payload.text).toBe('ZONE_EDIT_AFTER');expect(saved.schedules[0].rule.timeZone).toBe('UTC');expect(saved.schedules[0].enabled).toBe(true);expect(await journalCount(browser)).toBe(0);
 const requests=await observations(browser);expect(requests).toHaveLength(2);expect(requests[1].status).toBe(200);expect(requests[1].command.requestId).not.toBe(requests[0].command.requestId);expect(requests[0].command.expectedRevision).toBe(1);expect(requests[1].command.expectedRevision).toBe(1);
 await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.reload();expect((await canonical(browser)).schedules[0].revision).toBe(2);expect(await journalCount(browser)).toBe(0);await app.screenshot('rejected-zone-edit-corrected-once');
});

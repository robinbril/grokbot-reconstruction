// Public UI + real production HTTP/store; protocol fixture is not installed-model proof.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Schedule={id:string;title:string;revision:number;enabled:boolean;payload:{text:string};rule:{at:string;timeZone:string}};
type Snapshot={conversationId:string;schedules:Schedule[]};
type Command={requestId:string;title:string;payload:{text:string};rule:{kind:string;at:string;timeZone:string};enabled:boolean;expectedRevision?:number};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];if(!id)throw new Error('No canonical live conversation');
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw new Error('Canonical GET '+response.status);return response.json();
});}
async function openPlan(screen:Screen):Promise<void>{await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();}
async function fillPlan(screen:Screen,title:string,prompt:string,at:string):Promise<void>{
 const dialog=screen.getByRole('dialog');await dialog.getByRole('textbox','Naam',{exact:true}).fill(title);await dialog.getByRole('textbox','Opdracht',{exact:true}).fill(prompt);
 await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(at);await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('Europe/Amsterdam');await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();
}
async function openMarketing(screen:Screen):Promise<void>{await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();}
async function openRoutineEditor(screen:Screen,title:string):Promise<void>{
 const routines=screen.getByRole('button','Routines',{exact:false});if(!await routines.isVisible())await screen.getByRole('button','Gespreksdetails',{exact:true}).first().click();
 await routines.click();await screen.getByRole('button','Routine openen: '+title,{exact:true}).click();await screen.getByRole('button','Bewerken',{exact:true}).click();
}

test('changed unresolved create refuses another job and keeps the newer title and prompt',async({app,screen,browser})=>{
 await openMarketing(screen);
 // The constructor captures fetch: install this real-response fault before reload.
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(...args:Parameters<typeof fetch>)=>{
  const url=new URL(String(args[0]),location.href),isCreate=url.pathname.endsWith('/schedules')&&args[1]?.method==='POST';
  if(isCreate){const requests=JSON.parse(sessionStorage.getItem('save-journal-create-requests')||'[]');requests.push(JSON.parse(String(args[1]?.body)));sessionStorage.setItem('save-journal-create-requests',JSON.stringify(requests));}
  const response=await original(...args);
  if(isCreate&&response.ok&&!sessionStorage.getItem('save-journal-create-lost')){sessionStorage.setItem('save-journal-create-lost',JSON.stringify(await response.clone().json()));throw new TypeError('Owned journal lost ACK after durable create');}
  return response;
 };});
 await browser.reload();await openPlan(screen);const at=new Date(Date.now()+172_800_000).toISOString();await fillPlan(screen,'Journal original title','JOURNAL_ORIGINAL_PROMPT',at);
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();await expect(browser.locator('[data-live-routine-error]')).toContainText('Owned journal lost ACK');
 const first=await canonical(browser);expect(first.schedules).toHaveLength(1);expect(first.schedules[0].enabled).toBe(true);
 await screen.getByRole('button','Sluiten',{exact:true}).click();await openPlan(screen);
 await expect(screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true})).toHaveValue('Journal original title');await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('JOURNAL_ORIGINAL_PROMPT');
 await screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true}).fill('Journal newer unsaved title');await screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true}).fill('JOURNAL_NEWER_UNSAVED_PROMPT');
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-routine-error]')).not.toHaveText('');
 await expect(screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true})).toHaveValue('Journal newer unsaved title');await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('JOURNAL_NEWER_UNSAVED_PROMPT');
 const after=await canonical(browser);expect(after.schedules).toHaveLength(1);expect(after.schedules[0].id).toBe(first.schedules[0].id);expect(after.schedules[0].title).toBe('Journal original title');expect(after.schedules[0].payload.text).toBe('JOURNAL_ORIGINAL_PROMPT');
 const requests:Command[]=await browser.evaluate(()=>JSON.parse(sessionStorage.getItem('save-journal-create-requests')||'[]'));expect(requests).toHaveLength(1);await app.screenshot('save-journal-changed-pending-input-preserved');
});

test('accepted edit ACK replay across reload retains original request identity and revision two',async({app,screen,browser})=>{
 await openMarketing(screen);await openPlan(screen);await fillPlan(screen,'Journal edit routine','JOURNAL_EDIT_BEFORE',new Date(Date.now()+172_800_000).toISOString());await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();await expect(screen.getByRole('dialog','Journal edit routine',{exact:true})).toBeVisible();
 const created=await canonical(browser);expect(created.schedules).toHaveLength(1);
 const initial=created.schedules[0];expect(initial.id).not.toBe('');expect(initial.title).toBe('Journal edit routine');expect(initial.payload.text).toBe('JOURNAL_EDIT_BEFORE');expect(initial.enabled).toBe(true);expect(initial.revision).toBe(1);
 const detail=screen.getByRole('dialog','Journal edit routine',{exact:true});
 await expect(detail.getByText(initial.payload.text,{exact:true})).toBeVisible();await expect(browser.locator('[data-live-routine-status]')).toHaveText('Actief');
 await expect(detail.getByRole('button','Pauzeren',{exact:true})).toHaveAttribute('data-id',initial.id);
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(...args:Parameters<typeof fetch>)=>{
  const url=new URL(String(args[0]),location.href),isEdit=/\/schedules\/[^/]+\/edit$/.test(url.pathname)&&args[1]?.method==='POST';
  if(isEdit){const requests=JSON.parse(sessionStorage.getItem('save-journal-edit-requests')||'[]');requests.push(JSON.parse(String(args[1]?.body)));sessionStorage.setItem('save-journal-edit-requests',JSON.stringify(requests));}
  const response=await original(...args);
  if(isEdit&&response.ok&&!sessionStorage.getItem('save-journal-edit-lost')){sessionStorage.setItem('save-journal-edit-lost',JSON.stringify(await response.clone().json()));throw new TypeError('Owned journal lost ACK after durable edit');}
  return response;
 };});
 await browser.reload();await openRoutineEditor(screen,'Journal edit routine');await screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true}).fill('JOURNAL_EDIT_AFTER');await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-routine-error]')).toContainText('Owned journal lost ACK');await expect.poll(async()=>(await canonical(browser)).schedules[0].revision).toBe(2);expect((await canonical(browser)).schedules[0].payload.text).toBe('JOURNAL_EDIT_AFTER');
 const original:Command[]=await browser.evaluate(()=>JSON.parse(sessionStorage.getItem('save-journal-edit-requests')||'[]'));expect(original).toHaveLength(1);expect(original[0].expectedRevision).toBe(1);
 await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.reload();await openRoutineEditor(screen,'Journal edit routine');await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('JOURNAL_EDIT_AFTER');
 await screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Journal edit routine',{exact:true})).toBeVisible();
 const after=await canonical(browser);expect(after.schedules).toHaveLength(1);expect(after.schedules[0].id).toBe(initial.id);expect(after.schedules[0].revision).toBe(2);expect(after.schedules[0].payload.text).toBe('JOURNAL_EDIT_AFTER');
 const requests:Command[]=await browser.evaluate(()=>JSON.parse(sessionStorage.getItem('save-journal-edit-requests')||'[]'));expect(requests).toHaveLength(2);expect(requests[1]).toEqual(original[0]);expect(requests[1].requestId).toBe(original[0].requestId);expect(requests[1].expectedRevision).toBe(1);await app.screenshot('save-journal-edit-replayed-exactly-once');
});

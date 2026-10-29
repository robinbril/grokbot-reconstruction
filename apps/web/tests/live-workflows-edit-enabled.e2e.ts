// Real production UI/HTTP/ledger, with the existing explicitly labeled protocol fixture.
// These synthetic task results are not evidence of installed-model execution.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Schedule={id:string;title:string;revision:number;enabled:boolean;status:string;nextDueAt:string|null;payload:{text:string}};
type Snapshot={conversationId:string;schedules:Schedule[];queue:{id:string;status:string;runId?:string;source:{scheduleId?:string;scheduleRevision?:number}}[];runs:{id:string;status:string}[];entries:{role:string;text:string}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];
 if(!id)throw new Error('No owned canonical routine conversation');
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw new Error('Canonical snapshot '+response.status);return response.json();
});}
async function createRoutine(screen:Screen,title:string,prompt:string,at:string,enabled:boolean){
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();
 const dialog=screen.getByRole('dialog','Routine toevoegen',{exact:true});
 await dialog.getByRole('textbox','Naam',{exact:true}).fill(title);await dialog.getByRole('textbox','Opdracht',{exact:true}).fill(prompt);
 await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(at);await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('Europe/Amsterdam');
 if(enabled)await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();else await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).uncheck();
 await dialog.getByRole('button','Routine opslaan',{exact:true}).click();await expect(screen.getByRole('dialog',title,{exact:true})).toBeVisible();
}
async function openRoutine(screen:Screen,title:string){
 if(!await screen.getByRole('button','Routines',{exact:false}).isVisible())await screen.getByRole('button','Gespreksdetails',{exact:true}).first().click();
 await screen.getByRole('button','Routines',{exact:false}).click();await screen.getByRole('button','Routine openen: '+title,{exact:true}).click();
 await expect(screen.getByRole('dialog',title,{exact:true})).toBeVisible();
}

test('editing a paused routine checkbox durably enables its exact due execution',async({app,screen,browser})=>{
 const title='Edit checkbox enable',prompt='OWNED_CHECKBOX_ENABLE',at=new Date(Date.now()+172_800_000).toISOString();
 await createRoutine(screen,title,prompt,at,false);
 const original=(await canonical(browser)).schedules[0];expect(original.enabled).toBe(false);expect(original.status).toBe('paused');expect(original.nextDueAt).toBe(null);expect(original.revision).toBe(1);
 await screen.getByRole('button','Bewerken',{exact:true}).click();
 const checkbox=screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('checkbox','Inschakelen na opslaan',{exact:true});
 await expect(checkbox).not.toBeChecked();
 await checkbox.check();
 await expect(checkbox).toBeChecked();
 await screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog',title,{exact:true})).toBeVisible();
 await expect.poll(async()=>(await canonical(browser)).schedules[0].enabled).toBe(true);
 const enabled=(await canonical(browser)).schedules[0];expect(enabled.id).toBe(original.id);expect(enabled.revision).toBe(2);expect(enabled.status).toBe('enabled');expect(enabled.nextDueAt).toBe(at);expect(enabled.payload.text).toBe(prompt);
 await expect(browser.locator('[data-live-routine-status]')).toHaveText('Actief');await expect(browser.locator('[data-live-routine-next]')).toContainText(at);
 await browser.reload();await expect.poll(async()=>(await canonical(browser)).schedules[0].enabled).toBe(true);expect((await canonical(browser)).schedules[0].nextDueAt).toBe(at);
 await openRoutine(screen,title);await screen.getByRole('button','Bewerken',{exact:true}).click();await expect(screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('checkbox','Inschakelen na opslaan',{exact:true})).toBeChecked();
 await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.goto(protocol.baseUrl+'/missing-test-page');await protocol.advanceTo(Date.parse(at)+1);
 await expect.poll(async()=>{const state=await canonical(browser);return state.queue[0]?.status==='completed'&&state.runs[0]?.status==='completed';},{timeout:60_000}).toBe(true);
 const done=await canonical(browser);expect(done.schedules).toHaveLength(1);expect(done.queue).toHaveLength(1);expect(done.runs).toHaveLength(1);expect(done.queue[0].source.scheduleId).toBe(original.id);expect(done.queue[0].source.scheduleRevision).toBe(2);expect(done.queue[0].runId).toBe(done.runs[0].id);
 expect(done.entries.some(entry=>entry.role==='assistant'&&entry.text.includes('Protocol fixture output: '+prompt))).toBe(true);
 await protocol.advanceTo(Date.parse(at)+86_400_000);expect((await canonical(browser)).queue).toHaveLength(1);
 await browser.goto(protocol.baseUrl);await openRoutine(screen,title);await expect(screen.getByRole('dialog',title,{exact:true})).toContainText('Voltooid');await app.screenshot('edit-checkbox-enabled-durable-due-once');
});

test('editing an active routine checkbox durably pauses and prevents its future execution',async({app,screen,browser})=>{
 const title='Edit checkbox pause',prompt='OWNED_CHECKBOX_MUST_NOT_RUN',at=new Date(Date.now()+172_800_000).toISOString();
 await createRoutine(screen,title,prompt,at,true);
 const original=(await canonical(browser)).schedules[0];expect(original.enabled).toBe(true);expect(original.status).toBe('enabled');expect(original.nextDueAt).toBe(at);expect(original.revision).toBe(1);
 await screen.getByRole('button','Bewerken',{exact:true}).click();
 const checkbox=screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('checkbox','Inschakelen na opslaan',{exact:true});
 await expect(checkbox).toBeChecked();
 await checkbox.uncheck();
 await expect(checkbox).not.toBeChecked();
 await screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog',title,{exact:true})).toBeVisible();
 await expect.poll(async()=>(await canonical(browser)).schedules[0].enabled).toBe(false);
 const paused=(await canonical(browser)).schedules[0];expect(paused.id).toBe(original.id);expect(paused.revision).toBe(2);expect(paused.status).toBe('paused');expect(paused.nextDueAt).toBe(null);expect(paused.payload.text).toBe(prompt);
 await expect(browser.locator('[data-live-routine-status]')).toHaveText('Gepauzeerd');await expect(browser.locator('[data-live-routine-next]')).toHaveText('Geen volgende uitvoering');
 await browser.reload();await expect.poll(async()=>(await canonical(browser)).schedules[0].enabled).toBe(false);expect((await canonical(browser)).schedules[0].nextDueAt).toBe(null);
 await openRoutine(screen,title);await screen.getByRole('button','Bewerken',{exact:true}).click();await expect(screen.getByRole('dialog','Routine bewerken',{exact:true}).getByRole('checkbox','Inschakelen na opslaan',{exact:true})).not.toBeChecked();
 await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.goto(protocol.baseUrl+'/missing-test-page');await protocol.advanceTo(Date.parse(at)+1);
 let state=await canonical(browser);expect(state.queue).toEqual([]);expect(state.runs).toEqual([]);expect(state.entries).toEqual([]);expect(state.schedules[0].status).toBe('paused');expect(state.schedules[0].nextDueAt).toBe(null);
 await protocol.advanceTo(Date.parse(at)+86_400_000);state=await canonical(browser);expect(state.queue).toEqual([]);expect(state.runs).toEqual([]);
 await browser.goto(protocol.baseUrl);await openRoutine(screen,title);await expect(browser.locator('[data-live-routine-status]')).toHaveText('Gepauzeerd');await app.screenshot('edit-checkbox-disabled-no-future-effect');
});

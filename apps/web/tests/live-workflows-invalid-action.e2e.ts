// Actual production HTTP with owned synthetic data; protocol fixture is not native-model proof.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Snapshot={schedules:{id:string;revision:number;enabled:boolean}[];queue:{id:string}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];
 if(!id)throw new Error('Missing owned canonical conversation');const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));
 if(!response.ok)throw new Error('Canonical snapshot '+response.status);return response.json();
});}
async function createRoutine(screen:Screen,title:string):Promise<void>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();
 const dialog=screen.getByRole('dialog');await dialog.getByRole('textbox','Naam',{exact:true}).fill(title);await dialog.getByRole('textbox','Opdracht',{exact:true}).fill('OWNED_INVALID_ACTION_PROMPT');
 await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(new Date(Date.now()+172_800_000).toISOString());
 await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('UTC');await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();await dialog.getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog',title,{exact:true})).toBeVisible();
}
async function journal(browser:Browser):Promise<Record<string,unknown>>{return browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').liveHarness?.workflowRequests||{});}

test('malformed persisted action visibly blocks an owned routine after reload without replacing its identity',async({browser,screen,agent,app})=>{
 const title='Owned malformed action routine';await createRoutine(screen,title);const before=await canonical(browser);expect(before.schedules).toHaveLength(1);expect(before.queue).toHaveLength(0);
 const schedule=before.schedules[0];expect(schedule.enabled).toBe(true);
 // Inject before the next document hydrates: the current document's snapshot poll
 // persists its in-memory state and can overwrite an out-of-band storage edit.
 await browser.addInitScript(({id,revision})=>{
  if(sessionStorage.getItem('owned-malformed-original-journal'))return;
  const key='grok-local-replica-v1',saved=JSON.parse(localStorage.getItem(key)||'{}'),selected=saved.selected,canonicalId=saved.liveHarness?.serverIds?.[selected];
  if(!selected||!canonicalId)throw new Error('Missing owned persisted mapping');
  const lock=selected+':pause:broken:pause:'+id;
  saved.liveHarness.workflowRequests={[lock]:{requestId:'owned-malformed-pending',expectedRevision:revision,schema:1,conversationId:selected,serverConversationId:canonicalId,action:'pause',targetId:id}};
  localStorage.setItem(key,JSON.stringify(saved));
  sessionStorage.setItem('owned-malformed-original-journal',JSON.stringify(saved.liveHarness.workflowRequests));
 },{id:schedule.id,revision:schedule.revision});
 await browser.reload();
 const original=await browser.evaluate(()=>{const saved=sessionStorage.getItem('owned-malformed-original-journal');if(!saved)throw new Error('Missing injected malformed journal');return JSON.parse(saved);});
 expect(await journal(browser)).toEqual(original);
 await agent.act('Open via Gespreksdetails en Routines de routine Owned malformed action routine en bekijk de status van de opgeslagen actieaanvraag.');
 const dialog=screen.getByRole('dialog',title,{exact:true});await expect(dialog.getByRole('status').filter({hasText:'ongeldig'})).toBeVisible();
 await expect(dialog.getByRole('button','Pauzeren',{exact:true})).toBeDisabled();await expect(dialog.getByRole('button','Bewerken',{exact:true})).toBeDisabled();await expect(dialog.getByRole('button','Nu uitvoeren',{exact:true})).toBeDisabled();
 expect(await journal(browser)).toEqual(original);const after=await canonical(browser);expect(after.schedules).toHaveLength(1);expect(after.schedules[0]).toEqual(schedule);expect(after.queue).toHaveLength(0);
 await app.screenshot('malformed-owned-action-visible-and-blocked');
});

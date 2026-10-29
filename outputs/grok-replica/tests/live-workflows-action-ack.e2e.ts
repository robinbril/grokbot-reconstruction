// Actual production HTTP + exclusive 18876 protocol fixture, not installed-model proof.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Schedule={id:string;revision:number;enabled:boolean};
type Snapshot={schedules:Schedule[];queue:{id:string;source:{scheduleId?:string;occurrenceKey?:string}}[]};
type Action={kind:string;command:{requestId:string;expectedRevision:number};status:number};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];
 if(!id)throw new Error('No canonical live conversation');const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));
 if(!response.ok)throw new Error('Canonical GET '+response.status);return response.json();
});}
async function pending(browser:Browser):Promise<Record<string,unknown>>{return browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').liveHarness?.workflowRequests||{});}
async function actions(browser:Browser):Promise<Action[]>{return browser.evaluate(()=>JSON.parse(sessionStorage.getItem('action-ack-observations')||'[]'));}
async function openRoutine(screen:Screen,title:string):Promise<void>{
 const routines=screen.getByRole('button','Routines',{exact:false});if(!await routines.isVisible())await screen.getByRole('button','Gespreksdetails',{exact:true}).first().click();
 await routines.click();await screen.getByRole('button','Routine openen: '+title,{exact:true}).click();
}
async function createRoutine(screen:Screen,title:string):Promise<void>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();
 const dialog=screen.getByRole('dialog');await dialog.getByRole('textbox','Naam',{exact:true}).fill(title);await dialog.getByRole('textbox','Opdracht',{exact:true}).fill('OWNED_ACTION_ACK_PROMPT');
 await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(new Date(Date.now()+172_800_000).toISOString());
 await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('UTC');await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();await dialog.getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog',title,{exact:true})).toBeVisible();
}
async function installRetirementFault(browser:Browser,kind:'pause'|'run-now'):Promise<void>{
 await browser.addInitScript((actionKind)=>{
  const originalWrite=Storage.prototype.setItem,originalFetch=window.fetch.bind(window);
  Storage.prototype.setItem=function(key:string,value:string){
   if(key==='grok-local-replica-v1'&&!sessionStorage.getItem('action-ack-recovered')){
    const before=JSON.parse(this.getItem(key)||'{}').liveHarness?.workflowRequests||{},after=JSON.parse(value).liveHarness?.workflowRequests||{};
    if(Object.keys(before).some(id=>!Object.hasOwn(after,id))){sessionStorage.setItem('action-ack-fault-seen','1');throw new Error('Owned durable action ACK retirement fault');}
   }
   return originalWrite.call(this,key,value);
  };
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const url=new URL(String(args[0]),location.href),match=url.pathname.match(/\/schedules\/[^/]+\/(pause|enable|run-now)$/),response=await originalFetch(...args);
   if(match&&args[1]?.method==='POST'){
    const rows=JSON.parse(sessionStorage.getItem('action-ack-observations')||'[]');rows.push({kind:match[1],command:JSON.parse(String(args[1]?.body)),status:response.status});sessionStorage.setItem('action-ack-observations',JSON.stringify(rows));
    if(match[1]===actionKind&&response.ok)sessionStorage.setItem('action-ack-server-accepted','1');
   }
   return response;
  };
 },kind);
 await browser.reload();
}
async function assertRecoveryVisible(browser:Browser,screen:Screen,title:string):Promise<void>{
 await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('action-ack-fault-seen'))).toBe('1');
 await expect(browser.locator('[data-live-routine-error]')).not.toHaveText('');
 await expect(screen.getByRole('dialog',title,{exact:true}).getByRole('button','Ontvangst controleren',{exact:false})).toBeVisible();
 expect(await browser.evaluate(()=>sessionStorage.getItem('action-ack-server-accepted'))).toBe('1');
}
async function allowRecovery(browser:Browser):Promise<void>{await browser.evaluate(()=>sessionStorage.setItem('action-ack-recovered','1'));}

test('failed pause ACK retirement visibly recovers across reload before a fresh enable and pause',async({browser,screen,app})=>{
 const title='Owned pause ACK routine';await createRoutine(screen,title);const first=(await canonical(browser)).schedules[0];
 await installRetirementFault(browser,'pause');await openRoutine(screen,title);await screen.getByRole('button','Pauzeren',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).schedules[0].enabled).toBe(false);await assertRecoveryVisible(browser,screen,title);
 const journal=await pending(browser),original=(await actions(browser))[0];expect(Object.keys(journal)).toHaveLength(1);expect(original.status).toBe(200);
 await browser.reload();await openRoutine(screen,title);expect(await pending(browser)).toEqual(journal);await expect(screen.getByRole('dialog',title,{exact:true}).getByRole('button','Ontvangst controleren',{exact:false})).toBeVisible();
 await allowRecovery(browser);
 await screen.getByRole('dialog',title,{exact:true}).getByRole('button','Ontvangst controleren',{exact:false}).click();
 await expect(screen.getByRole('dialog',title,{exact:true}).getByRole('button','Ontvangst controleren',{exact:false})).toBeHidden();
 expect(Object.keys(await pending(browser))).toHaveLength(0);expect((await canonical(browser)).schedules[0].revision).toBe(2);
 const recovered=await actions(browser);expect(recovered).toHaveLength(2);expect(recovered[1].command).toEqual(original.command);
 await screen.getByRole('button','Hervatten',{exact:true}).click();await expect(browser.locator('[data-live-routine-status]')).toHaveText('Actief');
 await screen.getByRole('button','Pauzeren',{exact:true}).click();await expect(browser.locator('[data-live-routine-status]')).toHaveText('Gepauzeerd');
 const after=(await canonical(browser)).schedules[0];expect(after.id).toBe(first.id);expect(after.enabled).toBe(false);expect(after.revision).toBe(4);
 const pauses=(await actions(browser)).filter(row=>row.kind==='pause');expect(pauses).toHaveLength(3);expect(pauses[2].command.requestId).not.toBe(original.command.requestId);expect(pauses[2].command.expectedRevision).toBe(3);
 await app.screenshot('action-ack-pause-recovered-and-fresh-pause');
});

test('failed run-now ACK retirement recovers one occurrence and a later explicit run-now admits exactly one more',async({browser,screen,app})=>{
 const title='Owned run-now ACK routine';await createRoutine(screen,title);const schedule=(await canonical(browser)).schedules[0];
 await installRetirementFault(browser,'run-now');await openRoutine(screen,title);await screen.getByRole('button','Nu uitvoeren',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(1);await assertRecoveryVisible(browser,screen,title);
 const original=(await actions(browser))[0],journal=await pending(browser);expect(Object.keys(journal)).toHaveLength(1);
 await browser.reload();await openRoutine(screen,title);expect(await pending(browser)).toEqual(journal);await allowRecovery(browser);
 await screen.getByRole('dialog',title,{exact:true}).getByRole('button','Ontvangst controleren',{exact:false}).click();
 await expect(screen.getByRole('dialog',title,{exact:true}).getByRole('button','Ontvangst controleren',{exact:false})).toBeHidden();
 expect(Object.keys(await pending(browser))).toHaveLength(0);expect((await canonical(browser)).queue).toHaveLength(1);
 const recovered=await actions(browser);expect(recovered).toHaveLength(2);expect(recovered[1].command).toEqual(original.command);
 await screen.getByRole('button','Nu uitvoeren',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(2);
 const after=await canonical(browser),sent=await actions(browser);expect(after.schedules[0].revision).toBe(schedule.revision);expect(sent).toHaveLength(3);
 expect(sent[2].command.requestId).not.toBe(original.command.requestId);expect(Object.keys(sent[2].command).sort()).toEqual(['expectedRevision','requestId']);
 expect(after.queue[0].id).not.toBe(after.queue[1].id);expect(after.queue.map(row=>row.source.scheduleId)).toEqual([schedule.id,schedule.id]);
 expect(new Set(after.queue.map(row=>row.source.occurrenceKey)).size).toBe(2);await app.screenshot('action-ack-run-now-recovered-once-and-fresh-invocation');
});

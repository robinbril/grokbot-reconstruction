// Protocol UI tests only. The fixture executes the real production ledger/HTTP/runtime path,
// but its explicit Protocol fixture output is never evidence of installed-model reasoning.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {expectComposerText} from './fixtures/composer-assertions';
import {readFile} from 'node:fs/promises';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer({port:18902});await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});

type QueueRow={id:string;status:string;payload:{text:string;attachmentRefs?:{attachmentId:string;sha256:string;size:number}[]};runId?:string;source?:{scheduleId?:string}};
type Schedule={id:string;title:string;revision:number;status:string;enabled:boolean;payload:{text:string};rule:{kind:string;at?:string;timeZone:string};nextDueAt:string|null};
type Snapshot={conversationId:string;queue:QueueRow[];schedules:Schedule[];runs:{id:string;status:string}[];entries:{role:string;text:string;attachmentRefs?:{attachmentId:string;sha256:string;size:number}[]}[];workflow?:{hold?:unknown}};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];
 if(!id)throw new Error('No canonical live conversation identity');const result=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!result.ok)throw new Error('Canonical GET '+result.status);return result.json();
});}

test('live routines create edit enable pause and canonical history survive reload',async({app,screen,browser,agent})=>{
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Routines through the Bot Details panel for the selected Marketing Agent.');
 await expect(screen.getByRole('dialog','Routines')).toContainText('Echte harness');
 await expect(screen.getByRole('dialog','Routines')).not.toContainText('Dagelijkse marktscan');
 await screen.getByRole('button','Routine toevoegen').click();await screen.getByRole('dialog','Routine toevoegen').getByRole('textbox','Naam').fill('Protocol routine exact');await screen.getByRole('textbox','Opdracht').fill('PROTOCOL_ROUTINE_ORIGINAL');
 await screen.getByLabel('Herhaling').selectOption({value:'once'});const future=new Date(Date.now()+86_400_000).toISOString();await screen.getByLabel('Datum en tijd').fill(future);await screen.getByRole('textbox','Tijdzone').fill('Europe/Amsterdam');
 await expect(screen.getByRole('checkbox','Inschakelen na opslaan')).not.toBeChecked();await screen.getByRole('button','Routine opslaan').click();
 await expect.poll(async()=>(await canonical(browser)).schedules?.[0]?.status).toBe('paused');let saved=(await canonical(browser)).schedules[0];expect(saved.payload.text).toBe('PROTOCOL_ROUTINE_ORIGINAL');expect(saved.rule.at).toBe(future);expect(saved.rule.timeZone).toBe('Europe/Amsterdam');
 await browser.reload();await screen.getByRole('button','Routines',{exact:false}).click();await screen.getByRole('button','Routine openen: Protocol routine exact').click();
 await expect(screen.getByRole('dialog','Protocol routine exact')).toContainText('Europe/Amsterdam');await screen.getByRole('button','Bewerken',{exact:true}).click();await screen.getByRole('textbox','Opdracht').fill('PROTOCOL_ROUTINE_EDITED');await screen.getByRole('button','Routine opslaan').click();
 await expect.poll(async()=>(await canonical(browser)).schedules[0]?.revision).toBe(saved.revision+1);await expect.poll(async()=>(await canonical(browser)).schedules[0]?.payload.text).toBe('PROTOCOL_ROUTINE_EDITED');
 await screen.getByRole('dialog','Protocol routine exact',{exact:true}).getByRole('button','Hervatten',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).schedules[0]?.enabled).toBe(true);
 await screen.getByRole('dialog','Protocol routine exact',{exact:true}).getByRole('button','Pauzeren',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).schedules[0]?.status).toBe('paused');
 await screen.getByRole('dialog','Protocol routine exact',{exact:true}).getByRole('button','Nu uitvoeren',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue?.filter(row=>row.source?.scheduleId===saved.id).length).toBe(1);
 await expect.poll(async()=>{const s=await canonical(browser),row=s.queue.find(row=>row.source?.scheduleId===saved.id);return s.runs.find(run=>run.id===row?.runId)?.status;},{timeout:60_000}).toBe('completed');
 await expect(screen.getByRole('dialog','Protocol routine exact')).toContainText('Voltooid');await app.screenshot('live-routine-server-history');
});

test('busy explicit FIFO queues with Shift Enter cancels unsent third and reload retains second',async({app,screen,browser})=>{
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot');await input.fill('FIXTURE_DEFER PROTOCOL_FIFO_FIRST');await input.press('Enter');await expect.poll(async()=>(await canonical(browser)).runs?.[0]?.status,{timeout:60_000}).toBe('running');
 await input.fill('PROTOCOL_FIFO_SECOND');await input.press('Shift+Enter');await expect.poll(async()=>(await canonical(browser)).queue?.[0]?.status).toBe('queued');
 await expectComposerText(browser,'');expect((await canonical(browser)).queue.map(row=>row.payload.text)).toEqual(['PROTOCOL_FIFO_SECOND']);
 await input.fill('PROTOCOL_FIFO_THIRD');await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue?.length).toBe(2);
 await screen.getByRole('region','Echte wachtrij',{exact:true}).getByRole('button','Annuleren: PROTOCOL_FIFO_THIRD',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue?.[1]?.status).toBe('cancelled');
 const before=await canonical(browser);
 // Hold the real initial history response so persisted message IDs render before canonical run state.
 await browser.addInitScript(()=>{
  const original=window.fetch.bind(window);let released=false;
  const gate=new Promise<void>(resolve=>window.addEventListener('workflow-release-reload-snapshot',()=>{released=true;resolve();},{once:true}));
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const response=await original(...args),path=new URL(String(args[0]),location.href).pathname;
   if((args[1]?.method||'GET')==='GET'&&/^\/api\/harness\/conversations\/[^/]+$/.test(path)&&!released){sessionStorage.setItem('workflow-reload-snapshot-held','yes');await gate;}
   return response;
  };
 });
 await browser.reload();await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('workflow-reload-snapshot-held'))).toBe('yes');
 const runStatus=browser.locator(`[data-live-run="${before.runs[0].id}"]`);
 await expect(runStatus).toHaveCount(1);await expect(runStatus).toHaveAttribute('hidden','');await expect(runStatus).toBeHidden();
 expect(await browser.evaluate(()=>{const node=document.querySelector('.live-run-status');return node?getComputedStyle(node).display:null;})).toBe('none');
 await browser.evaluate(()=>window.dispatchEvent(new Event('workflow-release-reload-snapshot')));
 await expect(screen.getByRole('button','Stoppen',{exact:true}).first()).toBeVisible();
 await expect(screen.getByRole('region','Echte wachtrij')).toContainText('PROTOCOL_FIFO_SECOND');expect((await canonical(browser)).queue.map(row=>row.id)).toEqual(before.queue.map(row=>row.id));
 await screen.getByRole('button','Stoppen',{exact:true}).first().click();await expect.poll(async()=>{const s=await canonical(browser);return s.runs.find(run=>run.id===s.queue[0]?.runId)?.status;},{timeout:60_000}).toBe('completed');
 const after=await canonical(browser);expect(after.queue.map(row=>row.payload.text)).toEqual(['PROTOCOL_FIFO_SECOND','PROTOCOL_FIFO_THIRD']);expect(after.queue[1].runId).toBeFalsy();expect(after.queue).toHaveLength(2);expect(after.entries.filter(entry=>entry.role==='user'&&entry.text==='PROTOCOL_FIFO_SECOND')).toHaveLength(1);expect(after.entries.some(entry=>entry.role==='assistant'&&entry.text.includes('Protocol fixture output: PROTOCOL_FIFO_SECOND'))).toBe(true);await app.screenshot('live-fifo-real-ledger');
});

test('upload fails retries same reservation and exact original download survives attachment-only acceptance',async({app,screen,browser})=>{
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();
 let failed=false;await browser.route('**/attachments/*/content',async route=>{if(!failed){failed=true;await route.abort();}else await route.continue();});
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
 await expect(screen.getByRole('button','Upload opnieuw proberen: pipeline.txt')).toBeVisible();const input=screen.getByRole('textbox','Bericht sturen naar Bot');await expectComposerText(browser,'');
 await screen.getByRole('button','Upload opnieuw proberen: pipeline.txt',{exact:true}).click();await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 const identity=await browser.locator('[data-live-upload-id]').getAttribute('data-live-upload-id');expect(identity).toBeTruthy();await browser.reload();await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');expect(await browser.locator('[data-live-upload-id]').getAttribute('data-live-upload-id')).toBe(identity);
 await screen.getByRole('button','Bericht sturen',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).runs?.length).toBe(1);
 const accepted=await canonical(browser),ref=accepted.entries.find(entry=>entry.role==='user')?.attachmentRefs?.[0];expect(ref?.attachmentId).toBe(identity);await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toHaveCount(0);await expect(browser.locator('.message.user a[data-live-attachment-download]')).toHaveCount(1);
 const bytes=await browser.evaluate(async()=>{const link=document.querySelector<HTMLAnchorElement>('.message.user a[data-live-attachment-download]');if(!link)throw new Error('Missing original download');const response=await fetch(link.href);if(!response.ok)throw new Error('Download failed');return [...new Uint8Array(await response.arrayBuffer())];});
 expect(bytes).toEqual([...await readFile(new URL('./fixtures/pipeline.txt',import.meta.url))]);await app.screenshot('live-attachment-safe-original-download');
});

test('due one-off runs while page is away and returns exactly one real linked occurrence',async({app,screen,browser})=>{
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();await screen.getByRole('button','Gespreksdetails',{exact:true}).first().click();await screen.getByRole('button','Routines',{exact:false}).click();await screen.getByRole('button','Routine toevoegen').click();
 await screen.getByRole('dialog','Routine toevoegen').getByRole('textbox','Naam').fill('Protocol due once');await screen.getByRole('textbox','Opdracht').fill('PROTOCOL_DUE_PAGE_AWAY');await screen.getByLabel('Herhaling').selectOption({value:'once'});const dueAt=new Date(Date.now()+86_400_000).toISOString();await screen.getByLabel('Datum en tijd').fill(dueAt);await screen.getByRole('textbox','Tijdzone').fill('Europe/Amsterdam');await screen.getByRole('checkbox','Inschakelen na opslaan').check();
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).schedules?.[0]?.enabled).toBe(true);
 const beforeAway=await canonical(browser);expect(beforeAway.queue).toHaveLength(0);expect(beforeAway.runs).toHaveLength(0);const conversationId=beforeAway.conversationId;await browser.goto(protocol.baseUrl+'/missing-test-page');await protocol.advanceTo(Date.parse(dueAt)+1);
 await expect.poll(()=>browser.evaluate(async id=>{const state=await fetch('/api/harness/conversations/'+id).then(r=>r.json());return state.runs?.[0]?.status;},conversationId),{timeout:60_000,interval:500}).toBe('completed');
 await browser.goto(protocol.baseUrl);await expect.poll(async()=>(await canonical(browser)).queue?.length).toBe(1);const state=await canonical(browser);expect(state.queue[0].source?.scheduleId).toBe(state.schedules[0].id);expect(state.queue[0].runId).toBe(state.runs[0].id);expect(state.entries.some(entry=>entry.text.includes('Protocol fixture output: PROTOCOL_DUE_PAGE_AWAY'))).toBe(true);await app.screenshot('live-due-with-page-away');
});

test('uncertain provider interruption holds later accepted work until explicit continue without replay',async({app,screen,browser})=>{
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();const input=screen.getByRole('textbox','Bericht sturen naar Bot');
 await input.fill('FIXTURE_DEFER PROTOCOL_UNCERTAIN_FIRST');await input.press('Enter');await expect.poll(async()=>(await canonical(browser)).runs?.[0]?.status,{timeout:60_000}).toBe('running');
 await input.fill('PROTOCOL_AFTER_UNCERTAIN');await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue?.length).toBe(1);const before=await canonical(browser);
 await protocol.interrupt(before.conversationId);await expect.poll(async()=>Boolean((await canonical(browser)).workflow?.hold),{timeout:30_000}).toBe(true);await expect(screen.getByRole('button','Wachtrij voortzetten')).toBeVisible();
 expect((await canonical(browser)).queue[0].runId).toBeFalsy();await browser.reload();await expect(screen.getByRole('button','Wachtrij voortzetten')).toBeVisible();
 await screen.getByRole('region','Echte wachtrij',{exact:true}).getByRole('button','Wachtrij voortzetten',{exact:true}).click();await expect.poll(async()=>Boolean((await canonical(browser)).workflow?.hold)).toBe(false);
 await expect.poll(async()=>{const state=await canonical(browser);return state.runs.find(run=>run.id===state.queue[0]?.runId)?.status;},{timeout:60_000}).toBe('completed');const after=await canonical(browser);expect(after.queue).toHaveLength(1);expect(after.runs.filter(run=>run.id===before.runs[0].id)).toHaveLength(1);expect(after.runs[0].status).toBe('interrupted');await app.screenshot('live-uncertainty-explicit-continue');
});

test('lost durable queue ACK preserves newer same-text different-file draft and pinned original',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);let lost=false;window.fetch=async(...args:Parameters<typeof fetch>)=>{const response=await original(...args);if(!lost&&new URL(String(args[0]),location.href).pathname.endsWith('/queue')&&args[1]?.method==='POST'&&response.ok){lost=true;sessionStorage.setItem('workflow-real-lost-ack',JSON.stringify(await response.clone().json()));throw new TypeError('Test-only lost response after REAL durable acceptance');}return response;};});
 await browser.reload();
 await screen.getByRole('button','Marketing Agent').click();await screen.getByRole('radio','Echte harness').check();const input=screen.getByRole('textbox','Bericht sturen naar Bot');
 await input.fill('FIXTURE_DEFER PROTOCOL_PIN_FIRST');await input.press('Enter');await expect.poll(async()=>(await canonical(browser)).runs?.[0]?.status,{timeout:60_000}).toBe('running');
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');const oldId=await browser.locator('[data-live-upload-id]').getAttribute('data-live-upload-id');
 await input.fill('SAME_TEXT_NEW_FILE');await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect(screen.getByRole('button','Ontvangst controleren')).toBeVisible();await expect.poll(async()=>(await canonical(browser)).queue?.length).toBe(1);
 await screen.getByRole('button','Bijlage verwijderen: pipeline.txt').click();
 await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/source-table.csv']);
 const replacement=browser.locator('.live-upload-chip').filter({has:screen.getByRole('button','Bijlage verwijderen: source-table.csv',{exact:true})});
 await expect(replacement).toHaveCount(1);await expect(replacement.getByText('Gereed',{exact:true})).toBeVisible();await expect(replacement).toHaveAttribute('data-live-upload-id');
 const newId=await replacement.getAttribute('data-live-upload-id');expect(newId).toBeTruthy();expect(newId).not.toBe(oldId);
 await screen.getByRole('button','Ontvangst controleren',{exact:true}).click();await expect(screen.getByRole('button','Ontvangst controleren')).toBeHidden();
 await expectComposerText(browser,'SAME_TEXT_NEW_FILE');await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();expect((await canonical(browser)).queue).toHaveLength(1);expect((await canonical(browser)).queue[0].payload.attachmentRefs?.[0].attachmentId).toBe(oldId);await app.screenshot('live-accepted-file-pinned-newer-draft');
});

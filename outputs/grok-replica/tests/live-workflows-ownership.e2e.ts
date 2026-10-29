// Real UI and production workflow ledger; explicit protocol fixture, not model reasoning proof.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type Schedule={id:string;title:string;revision:number;enabled:boolean;status:string;payload:{text:string};rule:{kind:string;at?:string;timeZone:string}};
type Snapshot={conversationId:string;schedules:Schedule[];queue:{id:string;status:string;payload:{text:string}}[];runs:{id:string;status:string}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];
 if(!saved.selected||!id)throw new Error('Routine has no visible owned conversation');
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw new Error('Canonical snapshot '+response.status);return response.json();
});}
async function openPlan(screen:Screen):Promise<void>{await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Taak plannen',{exact:true}).click();}
async function fillPlan(screen:Screen,title:string,prompt:string,at:string):Promise<void>{
 const dialog=screen.getByRole('dialog');
 await dialog.getByRole('textbox','Naam',{exact:true}).fill(title);await dialog.getByRole('textbox','Opdracht',{exact:true}).fill(prompt);
 await dialog.getByLabel('Herhaling',{exact:true}).selectOption({value:'once'});await dialog.getByLabel('Datum en tijd',{exact:true}).fill(at);await dialog.getByRole('textbox','Tijdzone',{exact:true}).fill('Europe/Amsterdam');
 await dialog.getByRole('checkbox','Inschakelen na opslaan',{exact:true}).check();
}
async function openMarketing(screen:Screen):Promise<void>{await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();}
const future=()=>new Date(Date.now()+172_800_000).toISOString();

test('planning from the live landing promotes a visible conversation and survives reload',async({app,screen,browser,agent})=>{
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').selected??null)).toBe(null);
 await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await agent.act('Open Taak plannen through the Bijvoegen menu in this new live chat.');
 await expect(screen.getByRole('dialog')).toContainText('Routine toevoegen');
 const at=future();await fillPlan(screen,'Owned landing routine','OWNED_LANDING_PROMPT',at);
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).schedules?.length).toBe(1);
 const saved=await canonical(browser);expect(saved.schedules[0].title).toBe('Owned landing routine');expect(saved.schedules[0].enabled).toBe(true);expect(saved.schedules[0].payload.text).toBe('OWNED_LANDING_PROMPT');
 await expect(screen.getByRole('dialog','Owned landing routine',{exact:true})).toBeVisible();
 const conversation=saved.conversationId;await browser.reload();
 await expect.poll(async()=>(await canonical(browser)).conversationId).toBe(conversation);expect((await canonical(browser)).schedules).toHaveLength(1);
 await screen.getByRole('button','Gespreksdetails',{exact:true}).first().click();await screen.getByRole('button','Routines',{exact:false}).click();
 await expect(screen.getByRole('button','Routine openen: Owned landing routine',{exact:true})).toBeVisible();await app.screenshot('ownership-landing-promoted-and-reloaded');
});

test('lost real schedule-save ACK close reopen retry and reload keep exactly one enabled routine',async({app,screen,browser})=>{
 await openMarketing(screen);
 // Install before reload so createLiveHarnessClient captures the wrapped fetch.
 // The wrapper loses only a response after the real server has accepted it.
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(...args:Parameters<typeof fetch>)=>{
  const response=await original(...args);const url=new URL(String(args[0]),location.href);
  if(!sessionStorage.getItem('ownership-lost-save-ack')&&url.pathname.endsWith('/schedules')&&args[1]?.method==='POST'&&response.ok){sessionStorage.setItem('ownership-lost-save-ack',JSON.stringify(await response.clone().json()));throw new TypeError('Owned test lost response after real durable schedule acceptance');}
  return response;
 };});
 await browser.reload();await openPlan(screen);const at=future();await fillPlan(screen,'Owned ACK routine','OWNED_ACK_PROMPT',at);
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();
 await expect.poll(()=>browser.evaluate(()=>Boolean(sessionStorage.getItem('ownership-lost-save-ack')))).toBe(true);
 await expect(browser.locator('[data-live-routine-error]')).toContainText('Owned test lost response');
 expect((await canonical(browser)).schedules).toHaveLength(1);await screen.getByRole('button','Sluiten',{exact:true}).click();
 await openPlan(screen);await fillPlan(screen,'Owned ACK routine','OWNED_ACK_PROMPT',at);
 await screen.getByRole('dialog','Routine toevoegen',{exact:true}).getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Owned ACK routine',{exact:true})).toBeVisible();
 const saved=await canonical(browser);expect(saved.schedules).toHaveLength(1);expect(saved.schedules[0].enabled).toBe(true);expect(saved.schedules[0].payload.text).toBe('OWNED_ACK_PROMPT');
 await browser.reload();await expect.poll(async()=>(await canonical(browser)).schedules.length).toBe(1);expect((await canonical(browser)).schedules[0].id).toBe(saved.schedules[0].id);await app.screenshot('ownership-lost-save-ack-exactly-once');
});

test('delayed accepted routine response preserves a newer form after switching conversation',async({app,screen,browser,agent})=>{
 await openMarketing(screen);
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);let released=false;window.fetch=async(...args:Parameters<typeof fetch>)=>{
  const response=await original(...args);const url=new URL(String(args[0]),location.href);
  if(!sessionStorage.getItem('ownership-delayed-save')&&url.pathname.endsWith('/schedules')&&args[1]?.method==='POST'&&response.ok){sessionStorage.setItem('ownership-delayed-save',JSON.stringify(await response.clone().json()));await new Promise<void>(resolve=>window.addEventListener('ownership-release-save',()=>{released=true;resolve();},{once:true}));}
  if(released&&args[1]?.method!=='POST'&&/^\/api\/harness\/conversations\/[^/]+$/.test(url.pathname)){await response.clone().json();sessionStorage.setItem('ownership-post-release-snapshot','yes');}
  return response;
 };});
 await browser.reload();await openPlan(screen);await fillPlan(screen,'Owned delayed A','OWNED_DELAYED_A',future());
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();await expect.poll(()=>browser.evaluate(()=>Boolean(sessionStorage.getItem('ownership-delayed-save')))).toBe(true);
 const original=await canonical(browser);expect(original.schedules).toHaveLength(1);await screen.getByRole('button','Sluiten',{exact:true}).click();
 await screen.getByRole('button','Find Customers',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await agent.act('Open Taak plannen through Bijvoegen for the selected Find Customers conversation.');
 await expect(screen.getByRole('dialog')).toContainText('Routine toevoegen');await fillPlan(screen,'Owned newer B unsaved','OWNED_NEWER_B_UNSAVED',future());
 await expect(screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true})).toHaveValue('Owned newer B unsaved');
 await browser.evaluate(()=>window.dispatchEvent(new Event('ownership-release-save')));
 await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('ownership-post-release-snapshot'))).toBe('yes');
 // Wait for the response processing to reach a paint, rather than assert before its callback.
 await browser.evaluate(()=>new Promise<boolean>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))));
 await expect(screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true})).toHaveValue('Owned newer B unsaved');
 await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('OWNED_NEWER_B_UNSAVED');
 expect((await canonical(browser)).schedules).toHaveLength(0);expect((await canonical(browser)).conversationId).not.toBe(original.conversationId);await app.screenshot('ownership-delayed-save-keeps-new-form');
});

test('actual stale revision retains local edits and the next save succeeds with the refreshed revision',async({app,screen,browser})=>{
 await openMarketing(screen);await openPlan(screen);await fillPlan(screen,'Owned stale routine','OWNED_STALE_ORIGINAL',future());
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Owned stale routine',{exact:true})).toBeVisible();
 const created=await canonical(browser);expect(created.schedules).toHaveLength(1);const first=created.schedules[0];expect(first.payload.text).toBe('OWNED_STALE_ORIGINAL');
 await screen.getByRole('button','Bewerken',{exact:true}).click();await expect(browser.locator('input[name="scheduleId"]')).toHaveValue(first.id);
 await screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true}).fill('OWNED_STALE_LOCAL_EDIT');
 // A second actor changes the real production record through the public owner/CSRF API.
 const changed=await browser.evaluate(async({id,revision})=>{
  const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),conversation=saved.liveHarness.serverIds[saved.selected],status=await fetch('/api/harness/status').then(response=>response.json());
  const response=await fetch('/api/harness/conversations/'+conversation+'/schedules/'+id+'/pause',{method:'POST',headers:{'Content-Type':'application/json','x-harness-csrf':status.csrfToken},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:revision})});
  if(!response.ok)throw new Error('Owned second actor failed '+response.status);return response.json();
 },{id:first.id,revision:first.revision});
 expect(changed.schedule.revision).toBe(first.revision+1);
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();await expect(browser.locator('[data-live-routine-error]')).toContainText('Schedule changed');
 await expect(screen.getByRole('dialog').getByRole('textbox','Opdracht',{exact:true})).toHaveValue('OWNED_STALE_LOCAL_EDIT');
 await screen.getByRole('dialog').getByRole('button','Routine opslaan',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).schedules[0].payload.text).toBe('OWNED_STALE_LOCAL_EDIT');expect((await canonical(browser)).schedules[0].revision).toBe(first.revision+2);await app.screenshot('ownership-stale-revision-recovered');
});

test('live queue upload chips and planner stay contained in light dark desktop and 390px layouts',async({app,screen,browser,agent})=>{
 await openMarketing(screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('FIXTURE_DEFER OWNED_LAYOUT_PREDECESSOR');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status,{timeout:60_000}).toBe('running');await input.fill('OWNED_LAYOUT_QUEUED');await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(1);
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 for(const theme of ['light','dark']){
  await browser.setViewport({width:1033,height:748});await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Instellingen',{exact:true}).click();await screen.getByRole('combobox','Thema',{exact:true}).selectOption({value:theme});await screen.getByRole('button','Sluiten',{exact:true}).click();
  expect(await browser.evaluate(()=>document.documentElement.dataset.theme||'')).toBe(theme);
  for(const width of [1033,390]){
   await browser.setViewport({width,height:844});await expect(screen.getByRole('region','Echte wachtrij',{exact:true})).toContainText('OWNED_LAYOUT_QUEUED');await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
   const layout=await browser.evaluate(()=>({page:document.documentElement.scrollWidth<=innerWidth+1,parts:['[data-live-queue-mount]','.composer','.live-upload-chip'].map(selector=>{const node=document.querySelector<HTMLElement>(selector);if(!node)return false;const box=node.getBoundingClientRect();return box.width>0&&box.left>=-1&&box.right<=innerWidth+1&&node.scrollWidth<=node.clientWidth+1;})}));
   expect(layout.page).toBe(true);expect(layout.parts).toEqual([true,true,true]);await app.screenshot('ownership-'+theme+'-'+width+'-queue-upload');
   await agent.act('Open Taak plannen through Bijvoegen without sending the ready pipeline.txt attachment.');
   await expect(screen.getByRole('dialog')).toContainText('Routine toevoegen');await fillPlan(screen,'Owned layout form','OWNED_LAYOUT_FORM',future());
   const formLayout=await browser.evaluate(()=>({page:document.documentElement.scrollWidth<=innerWidth+1,fields:['#live-routine-title','#live-routine-prompt','#live-routine-kind','#live-routine-at','#live-routine-zone'].map(selector=>{const node=document.querySelector<HTMLElement>(selector);if(!node)return false;const box=node.getBoundingClientRect();return box.width>0&&box.left>=-1&&box.right<=innerWidth+1;})}));
   expect(formLayout.page).toBe(true);expect(formLayout.fields).toEqual([true,true,true,true,true]);await expect(screen.getByRole('dialog').getByRole('textbox','Naam',{exact:true})).toHaveValue('Owned layout form');await app.screenshot('ownership-'+theme+'-'+width+'-planner');await screen.getByRole('button','Sluiten',{exact:true}).click();
  }
 }
 expect((await canonical(browser)).schedules).toHaveLength(0);expect((await canonical(browser)).queue).toHaveLength(1);
});

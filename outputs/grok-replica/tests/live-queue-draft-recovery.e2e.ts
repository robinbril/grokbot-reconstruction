import {expectComposerText} from './fixtures/composer-assertions';
// Scripted inference; real production queue, HTTP, receipts, uploads and browser storage.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

type QueueRow={id:string;requestId:string;status:string;runId?:string;payload:{text:string;attachmentRefs?:{attachmentId:string;sha256:string;size:number}[]}};
type Snapshot={conversationId:string;queue:QueueRow[];runs:{id:string;status:string}[]};
type Saved={drafts:Record<string,string>;replyDrafts:Record<string,unknown>;composerSkillReferences:Record<string,unknown[]>;liveHarness:{serverIds:Record<string,string>;queuedDrafts?:Record<string,unknown>;workflowRequests?:Record<string,{requestId:string}>;pendingSends?:Record<string,unknown>}};
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer({port:18881});await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
const input=(screen:Screen)=>screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
const saved=(browser:Browser)=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}') as Saved);
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds.marketing;
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw Error('Canonical GET failed');return response.json();
});}
async function openLive(screen:Screen){await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();}
async function holdPredecessor(browser:Browser,screen:Screen){
 await input(screen).fill('FIXTURE_DEFER LIVE_RECOVERY_PREDECESSOR');await input(screen).press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs.at(-1)?.status,{timeout:60_000}).toBe('running');
}
async function enqueue(browser:Browser,screen:Screen,text:string,composed=false){
 if(!composed)await input(screen).fill(text);await expectComposerText(browser,text);await screen.getByRole('button','In wachtrij',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(1);
 await expectComposerText(browser,'');
 return (await canonical(browser)).queue[0];
}
async function editorSnapshot(browser:Browser){return browser.evaluate(async()=>{
 const path='/composer-input.js';return (await import(path)).readComposerInput(document.querySelector('#message-input')) as {text:string;richText:string;references:{id:string;label:string;revision?:number}[]};
});}
// Exact-byte fixture hydration; a multiline clipboard paste creates paragraph separators.
async function appendExactSuffix(browser:Browser,suffix:string){
 const accepted=await browser.evaluate(async text=>{
  const path='/composer-input.js',module=await import(path),controller=module.composerController(document.querySelector('#message-input'));
  if(!controller)throw Error('Missing genuine rich composer');const end=controller.getSnapshot().text.length;
  return controller.replaceRangeText({start:end,end},text);
 },suffix);expect(accepted).toBe(true);
}
async function expectSkillAtom(browser:Browser,label:string){
 const editor=await editorSnapshot(browser),ref=editor.references.find(reference=>reference.label===label);
 expect(ref).toBeTruthy();expect(editor.references).toHaveLength(1);
 const chip=browser.locator('#message-input [data-type="skill-reference"]');
 await expect(chip).toHaveCount(1);await expect(chip).toHaveText('@'+label);await expect(chip).toHaveAttribute('contenteditable','false');await expect(chip).toHaveAttribute('data-id',ref!.id);
 const doc=JSON.parse(editor.richText) as {content:{content?:{type:string;attrs?:{id:string;label:string}}[]}[]};
 expect(doc.content.flatMap(paragraph=>(paragraph.content??[]).filter(node=>node.type==='workflowReference').map(node=>({id:node.attrs!.id,label:node.attrs!.label})))).toEqual([{id:ref!.id,label}]);
 return editor;
}
async function createSkill(browser:Browser,screen:Screen){
 await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Apps en vaardigheden beheren',{exact:true}).click();
 await screen.getByRole('dialog','Plug-ins en vaardigheden beheren').getByRole('button','Toevoegen',{exact:true}).click();
 const form=screen.getByRole('dialog','Privéskills');await form.getByLabel('Naam',{exact:true}).fill('LiveRecoverySkill');await form.getByLabel('Instructies',{exact:true}).fill('Synthetic recovery context only.');await form.getByRole('button','Skill opslaan',{exact:true}).click();
 await expect(form).toContainText('LiveRecoverySkill');await form.getByRole('button','Sluiten',{exact:true}).click();
 await input(screen).fill('/LiveRecoverySkill');await input(screen).press('Tab');await expectSkillAtom(browser,'LiveRecoverySkill');
}
const recoverButton=(screen:Screen)=>screen.getByRole('region','Echte wachtrij',{exact:true}).getByRole('button','Terug naar concept',{exact:false});
const receiptButton=(screen:Screen)=>screen.getByRole('region','Echte wachtrij',{exact:true}).getByRole('button','Ontvangst controleren: Terug naar concept',{exact:false});

test('real model queue restores the complete original draft and requeues one new execution',async({browser,screen,agent,app})=>{
 await openLive(screen);await input(screen).fill('LIVE_RECOVERY_REPLY_SOURCE');await input(screen).press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status,{timeout:60_000}).toBe('completed');
 await holdPredecessor(browser,screen);
 await browser.locator('.message.user').first().click();await screen.getByRole('toolbar','Berichtknoppen').getByRole('button','Beantwoorden',{exact:true}).click();
 await createSkill(browser,screen);await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 const suffix='  LIVE_QUEUE_RECOVER\nexact original payload  ',raw='@LiveRecoverySkill '+suffix;await appendExactSuffix(browser,suffix);await expectComposerText(browser,raw);
 const originalEditor=await expectSkillAtom(browser,'LiveRecoverySkill'),before=await saved(browser),row=await enqueue(browser,screen,raw,true);
 expect(originalEditor.text.slice('@LiveRecoverySkill '.length)).toBe(suffix);expect(originalEditor.references).toEqual(before.composerSkillReferences.marketing);expect((row.payload as {richText?:string}).richText).toBe(originalEditor.richText);
 expect(before.replyDrafts.marketing).toMatchObject({text:'LIVE_RECOVERY_REPLY_SOURCE'});
 expect(row.status).toBe('queued');const originalRef=row.payload.attachmentRefs?.[0];expect(originalRef).toBeTruthy();
 await browser.reload();await expect(recoverButton(screen)).toBeVisible();
 await agent.act('Haal alleen LIVE_QUEUE_RECOVER uit de Echte wachtrij terug met Terug naar concept. Stop de huidige taak niet en verzend niets.');
 await expectComposerText(browser,raw);await expect(screen.getByRole('region','Antwoordcontext')).toBeVisible();
 await expect(screen.getByRole('region','Antwoordcontext')).toContainText('LIVE_RECOVERY_REPLY_SOURCE');
 await expectSkillAtom(browser,'LiveRecoverySkill');await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 const restoredEditor=await expectSkillAtom(browser,'LiveRecoverySkill');expect(restoredEditor).toEqual(originalEditor);
 const restored=await saved(browser),cancelled=(await canonical(browser)).queue[0];expect(cancelled.status).toBe('cancelled');expect(cancelled.runId).toBeFalsy();
 expect(restored.replyDrafts.marketing).toEqual(before.replyDrafts.marketing);expect(restored.composerSkillReferences.marketing).toEqual(before.composerSkillReferences.marketing);
 expect(Object.keys(restored.liveHarness.queuedDrafts||{})).toHaveLength(0);expect(Object.keys(restored.liveHarness.workflowRequests||{})).toHaveLength(0);
 await app.screenshot('real-queue-draft-restored');await browser.reload();await expectComposerText(browser,raw);expect(await expectSkillAtom(browser,'LiveRecoverySkill')).toEqual(originalEditor);
 await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(2);
 const again=(await canonical(browser)).queue[1];expect(again.requestId).not.toBe(row.requestId);expect(again.payload).toEqual(row.payload);
 await screen.getByRole('button','Stoppen',{exact:true}).first().click();
 await expect.poll(async()=>(await canonical(browser)).queue[1]?.status,{timeout:60_000}).toBe('completed');
 expect((await canonical(browser)).runs).toHaveLength(3);
 const actualHash=await browser.evaluate(async({id,attachmentId})=>{
  const response=await fetch('/api/harness/conversations/'+id+'/attachments/'+attachmentId+'/download');if(!response.ok)throw Error('Original file unavailable');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
 },{id:before.liveHarness.serverIds.marketing,attachmentId:originalRef!.attachmentId});
 expect(actualHash).toBe(createHash('sha256').update(await readFile(new URL('./fixtures/pipeline.txt',import.meta.url))).digest('hex'));
});

test('lost cancellation ACK and denied local retirement recover one cancelled task across reload',async({browser,screen,agent})=>{
 await openLive(screen);await holdPredecessor(browser,screen);const row=await enqueue(browser,screen,'LIVE_QUEUE_LOST_ACK');
 await expect(recoverButton(screen)).toBeVisible();
 await browser.addInitScript(()=>{
  const originalFetch=window.fetch.bind(window),write=Storage.prototype.setItem;
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const response=await originalFetch(...args),url=new URL(String(args[0]),location.href);
   if(args[1]?.method==='POST'&&/\/queue\/[^/]+\/cancel$/.test(url.pathname)&&response.ok){
    const calls=JSON.parse(sessionStorage.getItem('queue-recovery-cancel-calls')||'[]');calls.push(JSON.parse(String(args[1]?.body)));sessionStorage.setItem('queue-recovery-cancel-calls',JSON.stringify(calls));
    if(!sessionStorage.getItem('queue-recovery-lost-ack')){sessionStorage.setItem('queue-recovery-lost-ack','1');throw new TypeError('Synthetic lost cancellation ACK');}
   }
   return response;
  };
  Storage.prototype.setItem=function(key,value){
   if(key==='grok-local-replica-v1'&&!sessionStorage.getItem('queue-recovery-allow-retire')){
    const before=JSON.parse(this.getItem(key)||'{}').liveHarness?.workflowRequests||{},after=JSON.parse(value).liveHarness?.workflowRequests||{};
    if(Object.keys(before).some(id=>!Object.hasOwn(after,id))){sessionStorage.setItem('queue-recovery-denied-retire','1');throw new DOMException('Synthetic denied recovery retirement','QuotaExceededError');}
   }
   return write.call(this,key,value);
  };
 });
 await browser.reload();await agent.act('Klik eenmaal op Terug naar concept voor LIVE_QUEUE_LOST_ACK. Controleer daarna nog geen ontvangst en verzend niets.');
 await expect.poll(async()=>(await canonical(browser)).queue[0].status).toBe('cancelled');await expectComposerText(browser,'');
 const pending=(await saved(browser)).liveHarness.workflowRequests;expect(Object.keys(pending||{})).toHaveLength(1);await expect(receiptButton(screen)).toBeVisible();
 await browser.reload();expect((await saved(browser)).liveHarness.workflowRequests).toEqual(pending);
 await receiptButton(screen).click();await expect.poll(()=>browser.evaluate(()=>JSON.parse(sessionStorage.getItem('queue-recovery-cancel-calls')||'[]').length)).toBe(2);
 await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('queue-recovery-denied-retire'))).toBe('1');
 await expectComposerText(browser,'');expect((await saved(browser)).liveHarness.workflowRequests).toEqual(pending);
 await browser.evaluate(()=>sessionStorage.setItem('queue-recovery-allow-retire','1'));
 await receiptButton(screen).click();await expectComposerText(browser,'LIVE_QUEUE_LOST_ACK');
 expect(Object.keys((await saved(browser)).liveHarness.workflowRequests||{})).toHaveLength(0);
 const calls=await browser.evaluate(()=>JSON.parse(sessionStorage.getItem('queue-recovery-cancel-calls')||'[]'));
 expect(calls).toHaveLength(3);expect(calls[1]).toEqual(calls[0]);expect(calls[2]).toEqual(calls[0]);
 const after=await canonical(browser);expect(after.queue).toHaveLength(1);expect(after.queue[0].id).toBe(row.id);expect(after.queue[0].runId).toBeFalsy();expect(after.runs).toHaveLength(1);
});

test('newer live text and attachment block recovery before any server cancellation',async({browser,screen})=>{
 await openLive(screen);await holdPredecessor(browser,screen);await enqueue(browser,screen,'LIVE_QUEUE_OLDER_DRAFT');
 await input(screen).fill('LIVE_NEWER_DRAFT');await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/source-table.csv']);await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 const calls:string[]=[];await browser.route('**/queue/*/cancel',async route=>{calls.push(route.request.url);await route.continue();});
 await expect(recoverButton(screen)).toBeVisible();await recoverButton(screen).click();await expect(receiptButton(screen)).toBeVisible();
 await expectComposerText(browser,'LIVE_NEWER_DRAFT');await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();
 expect(calls).toEqual([]);expect((await canonical(browser)).queue[0].status).toBe('queued');
 await input(screen).focus();await input(screen).press('ControlOrMeta+a');await input(screen).press('Backspace');
 await expectComposerText(browser,'');await screen.getByRole('button','Bijlage verwijderen: source-table.csv').click();
 await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toHaveCount(0);
 await receiptButton(screen).click();await expectComposerText(browser,'LIVE_QUEUE_OLDER_DRAFT');expect(calls).toHaveLength(1);
});

test('a newer draft during cancellation survives and the pending recovery does not steal another conversation',async({browser,screen,agent})=>{
 await openLive(screen);await holdPredecessor(browser,screen);await enqueue(browser,screen,'LIVE_QUEUE_RACING_DRAFT');
 await browser.addInitScript(()=>{
  const original=window.fetch.bind(window);let released=false;
  const gate=new Promise<void>(resolve=>window.addEventListener('release-live-draft-ack',()=>{released=true;resolve();},{once:true}));
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const response=await original(...args);
   if(args[1]?.method==='POST'&&/\/queue\/[^/]+\/cancel$/.test(new URL(String(args[0]),location.href).pathname)&&response.ok&&!released){sessionStorage.setItem('live-draft-ack-held','1');await gate;}
   return response;
  };
 });
 await browser.reload();
 await expect(recoverButton(screen)).toBeVisible();await recoverButton(screen).click();
 await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('live-draft-ack-held'))).toBe('1');
 await input(screen).fill('LIVE_NEWER_DURING_ACK');await screen.getByRole('button','Find Customers',{exact:true}).click();await input(screen).fill('OTHER_CONVERSATION_DRAFT');
 await browser.evaluate(()=>window.dispatchEvent(new Event('release-live-draft-ack')));
 await expectComposerText(browser,'OTHER_CONVERSATION_DRAFT');await expect(input(screen)).toBeFocused();
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await expectComposerText(browser,'LIVE_NEWER_DURING_ACK');await expect(receiptButton(screen)).toBeVisible();
 expect((await canonical(browser)).queue[0].status).toBe('cancelled');
 await input(screen).fill('');await agent.act('Controleer de ontvangst van Terug naar concept voor LIVE_QUEUE_RACING_DRAFT. Verzend niets.');
 await expectComposerText(browser,'LIVE_QUEUE_RACING_DRAFT');
 expect((await saved(browser)).drafts.customers).toBe('OTHER_CONVERSATION_DRAFT');expect(Object.keys((await saved(browser)).liveHarness.workflowRequests||{})).toHaveLength(0);
});

test('a task that starts before cancellation reaches the server remains running and is never restored',async({browser,screen,agent})=>{
 await openLive(screen);await holdPredecessor(browser,screen);await enqueue(browser,screen,'FIXTURE_DEFER LIVE_QUEUE_ALREADY_STARTED');
 await browser.addInitScript(()=>{
  const original=window.fetch.bind(window);let released=false;
  const gate=new Promise<void>(resolve=>window.addEventListener('release-live-cancel-request',()=>{released=true;resolve();},{once:true}));
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   if(args[1]?.method==='POST'&&/\/queue\/[^/]+\/cancel$/.test(new URL(String(args[0]),location.href).pathname)&&!released){sessionStorage.setItem('live-cancel-request-held','1');await gate;}
   return original(...args);
  };
 });
 await browser.reload();
 await expect(recoverButton(screen)).toBeVisible();
 await agent.act('Klik eenmaal op Terug naar concept bij LIVE_QUEUE_ALREADY_STARTED. Laat de huidige uitvoering ongemoeid.');
 await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('live-cancel-request-held'))).toBe('1');
 await screen.getByRole('button','Stoppen',{exact:true}).first().click();
 await expect.poll(async()=>(await canonical(browser)).queue[0].status,{timeout:60_000}).toBe('running');
 await input(screen).fill('KEEP_AFTER_STARTED_RACE');
 await browser.evaluate(()=>window.dispatchEvent(new Event('release-live-cancel-request')));
 await expect.poll(async()=>Object.keys((await saved(browser)).liveHarness.workflowRequests||{}).length).toBe(0);
 await expectComposerText(browser,'KEEP_AFTER_STARTED_RACE');
 const row=(await canonical(browser)).queue[0];expect(row.status).toBe('running');expect(row.runId).toBeTruthy();
 await expect(receiptButton(screen)).toHaveCount(0);await expect(recoverButton(screen)).toHaveCount(0);
});

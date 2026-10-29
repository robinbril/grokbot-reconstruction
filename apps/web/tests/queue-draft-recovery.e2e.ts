import {expectComposerText} from './fixtures/composer-assertions';
import {test, type Browser} from '@e2e-dev/web';
import {expect, type Screen,type App} from 'e2e';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

type Saved = {
  drafts: Record<string,string>;
  replyDrafts: Record<string,unknown>;
  composerSkillReferences: Record<string,unknown[]>;
  attachmentConsumedIds: string[];
  messages: Record<string,unknown[]>;
  sendJournal: {records: {nonce:string;snapshot:{text:string;quote?:unknown;skillReferences?:unknown[];attachments:{id:string;name:string}[]}}[]};
};
const input = (screen:Screen) => screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
const saved = (browser:Browser) => browser.evaluate(() => JSON.parse(localStorage.getItem('grok-local-replica-v1') || '{}') as Saved);
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
async function boot(browser:Browser,screen:Screen,app:App) {
  await browser.addInitScript(() => {
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>sessionStorage.getItem('queue-recovery-offline')!=='1'});
  });
  await app.open('/?reset=1');
  await browser.evaluate(async () => {
    await (window as Window & {productSurfaces:{ready:Promise<void>}}).productSurfaces.ready;
    history.replaceState(null,'','/');
  });
  await screen.getByRole('button','Marketing Agent',{exact:true}).click();
}
async function offline(browser:Browser) {
  await browser.evaluate(() => {
    sessionStorage.setItem('queue-recovery-offline','1');
    window.dispatchEvent(new Event('offline'));
  });
}
async function originalAttachmentHash(browser:Browser,id:string) {
  return browser.evaluate(async id=>{
    const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('grok-local-attachments-v1',1);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try {
      const record=await new Promise<{blob:Blob}>((resolve,reject)=>{
        const request=database.transaction('files','readonly').objectStore('files').get(state.attachmentNamespace+':'+id);
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await record.blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
    } finally {database.close();}
  },id);
}

test('queued draft recovery restores exact text reply skill and original attachment across reload',async({browser,screen,agent,app})=>{
  await boot(browser,screen,app);
  await input(screen).fill('SYNTHETIC_REPLY_SOURCE');await input(screen).press('Enter');
  await expect(browser.locator('.message.bot')).toHaveCount(1);
  await browser.locator('.message.bot').click();
  await screen.getByRole('toolbar','Berichtknoppen').getByRole('button','Beantwoorden',{exact:true}).click();
  await screen.getByRole('button','Accountmenu',{exact:true}).click();
  await screen.getByRole('menuitem','Apps en vaardigheden beheren',{exact:true}).click();
  await screen.getByRole('dialog','Plug-ins en vaardigheden beheren').getByRole('button','Toevoegen',{exact:true}).click();
  const form=screen.getByRole('dialog','Privévaardigheid toevoegen');
  await form.getByLabel('Naam',{exact:true}).fill('RecoverySkill');
  await form.getByLabel('Instructies',{exact:true}).fill('Synthetic local recovery reference.');
  await form.getByRole('button','Opslaan',{exact:true}).click();
  await screen.getByRole('dialog','Plug-ins en vaardigheden beheren').getByRole('button','Sluiten',{exact:true}).click();
  await input(screen).fill('/RecoverySkill');await input(screen).press('Tab');
  await expectSkillAtom(browser,'RecoverySkill');
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toBeVisible();
  const suffix='  QUEUED_RECOVERY\nexact raw text  ',raw='@RecoverySkill '+suffix;await appendExactSuffix(browser,suffix);await expectComposerText(browser,raw);
  const originalEditor=await expectSkillAtom(browser,'RecoverySkill');expect(originalEditor.text.slice('@RecoverySkill '.length)).toBe(suffix);
  await offline(browser);await input(screen).press('Enter');
  await expectComposerText(browser,'');
  const before=await saved(browser),snapshot=before.sendJournal.records[0].snapshot;
  expect(snapshot.text).toBe(raw);expect((snapshot as {richText?:string}).richText).toBe(originalEditor.richText);expect(snapshot.skillReferences).toEqual(originalEditor.references);
  await browser.reload();await expect(browser.locator('.workflow-pending')).toHaveCount(1);
  await expect(screen.getByRole('button','Terug naar concept',{exact:true})).toBeVisible();
  await agent.act('Haal alleen het wachtende bericht QUEUED_RECOVERY terug met Terug naar concept. Verzend niets.');
  await expectComposerText(browser,snapshot.text);
  await expect(browser.locator('.workflow-pending')).toHaveCount(0);
  await expect(screen.getByRole('region','Antwoordcontext')).toBeVisible();
  await expectSkillAtom(browser,'RecoverySkill');
  await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toBeVisible();
  expect(await expectSkillAtom(browser,'RecoverySkill')).toEqual(originalEditor);
  const after=await saved(browser);
  expect(after.sendJournal.records).toEqual([]);expect(after.messages.marketing).toEqual(before.messages.marketing);
  expect(after.replyDrafts.marketing).toEqual(snapshot.quote);expect(after.composerSkillReferences.marketing).toEqual(snapshot.skillReferences);
  expect(after.attachmentConsumedIds).not.toContain(snapshot.attachments[0].id);
  await app.screenshot('recovered-draft-original-attachment');
  await browser.reload();await expectComposerText(browser,snapshot.text);expect(await expectSkillAtom(browser,'RecoverySkill')).toEqual(originalEditor);
  const original=await readFile(new URL('./fixtures/pipeline.txt',import.meta.url));
  expect(await originalAttachmentHash(browser,snapshot.attachments[0].id)).toBe(createHash('sha256').update(original).digest('hex'));
  await screen.getByRole('button','Bijlage openen: pipeline.txt',{exact:true}).click();
  await expect(screen.getByRole('dialog','pipeline.txt')).toContainText('exact bewaarde kandidaatpopulatie = 10.');
});

test('recovering an older queued message refuses to overwrite newer text or files',async({browser,screen,agent,app})=>{
  await boot(browser,screen,app);await offline(browser);
  await input(screen).fill('OLDER_QUEUED_DRAFT');await input(screen).press('Enter');
  await expectComposerText(browser,'');
  const before=await saved(browser);
  await input(screen).fill('NEWER_UNSENT_DRAFT');
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/source-table.csv']);
  await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();
  await expect(screen.getByRole('button','Terug naar concept',{exact:true})).toBeVisible();
  await agent.act('Klik Terug naar concept bij OLDER_QUEUED_DRAFT. Bewaar het huidige nieuwere concept; verzend niets.');
  await expectComposerText(browser,'NEWER_UNSENT_DRAFT');
  await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();
  expect((await saved(browser)).sendJournal).toEqual(before.sendJournal);
  await expect(browser.locator('.workflow-chat-feedback')).toContainText('Concept niet teruggezet');
  await input(screen).fill('');await screen.getByRole('button','Bijlage verwijderen: source-table.csv').click();
  await screen.getByRole('button','Terug naar concept',{exact:true}).click();
  await expectComposerText(browser,'OLDER_QUEUED_DRAFT');
  await expect(browser.locator('.workflow-pending')).toHaveCount(0);
});

test('a denied recovery write retains the queue and draft until an explicit successful retry',async({browser,screen,agent,app})=>{
  await boot(browser,screen,app);await offline(browser);
  await input(screen).fill('ATOMIC_RECOVERY_PROBE');await input(screen).press('Enter');
  await expectComposerText(browser,'');const before=await saved(browser);
  await expect(screen.getByRole('button','Terug naar concept',{exact:true})).toBeVisible();
  await browser.evaluate(() => {
    const write=Storage.prototype.setItem,state=window as Window & {denyRecovery:boolean};state.denyRecovery=true;
    Storage.prototype.setItem=function(key,value){
      const next=key==='grok-local-replica-v1'?JSON.parse(value):null;
      if(state.denyRecovery&&next?.sendJournal?.records?.length===0&&next.drafts?.marketing==='ATOMIC_RECOVERY_PROBE')throw new DOMException('Synthetic denied recovery','QuotaExceededError');
      return write.call(this,key,value);
    };
  });
  await agent.act('Probeer ATOMIC_RECOVERY_PROBE terug te halen met Terug naar concept. Verzend niets.');
  await expectComposerText(browser,'');
  expect((await saved(browser)).sendJournal).toEqual(before.sendJournal);
  await expect(browser.locator('.workflow-pending')).toHaveCount(1);
  await browser.evaluate(()=>{(window as Window & {denyRecovery:boolean}).denyRecovery=false;});
  await screen.getByRole('button','Terug naar concept',{exact:true}).click();
  await expectComposerText(browser,'ATOMIC_RECOVERY_PROBE');
  expect((await saved(browser)).sendJournal.records).toEqual([]);
});

test('recovering one conversation preserves an unrelated unsaved attachment for retry',async({browser,screen,agent,app})=>{
  await boot(browser,screen,app);await offline(browser);
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toBeVisible();
  await input(screen).fill('PRESERVE_OTHER_UPLOAD');await input(screen).press('Enter');
  await expectComposerText(browser,'');
  await screen.getByRole('button','Find Customers',{exact:true}).click();
  await browser.evaluate(()=>{
    const write=Storage.prototype.setItem,state=window as Window & {denyOtherAttachment:boolean};state.denyOtherAttachment=true;
    Storage.prototype.setItem=function(key,value){
      if(key==='grok-local-replica-v1'&&state.denyOtherAttachment)throw new DOMException('Synthetic unsaved upload','QuotaExceededError');
      return write.call(this,key,value);
    };
  });
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/source-table.csv']);
  await expect(screen.getByRole('button','Bijlagen opnieuw opslaan',{exact:true})).toBeVisible();
  await browser.evaluate(()=>{(window as Window & {denyOtherAttachment:boolean}).denyOtherAttachment=false;});
  await screen.getByRole('button','Marketing Agent',{exact:true}).click();
  await agent.act('Haal PRESERVE_OTHER_UPLOAD terug met Terug naar concept. Laat andere gesprekken en bijlagen ongemoeid.');
  await expectComposerText(browser,'PRESERVE_OTHER_UPLOAD');
  await screen.getByRole('button','Find Customers',{exact:true}).click();
  await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();
  await screen.getByRole('button','Bijlagen opnieuw opslaan',{exact:true}).click();
  await expect(screen.getByRole('button','Bijlagen opnieuw opslaan',{exact:true})).toHaveCount(0);
  await screen.getByRole('button','Bijlage openen: source-table.csv',{exact:true}).click();
  await expect(screen.getByRole('dialog','source-table.csv')).toContainText((await readFile(new URL('./fixtures/source-table.csv',import.meta.url))).toString('utf8'));
});

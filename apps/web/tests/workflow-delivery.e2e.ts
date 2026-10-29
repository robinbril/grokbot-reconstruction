import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

const input=(screen:any)=>screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
const saved=(browser:any)=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!));
async function boot(app:any,browser:any,screen:any,offline=false){
 await browser.addInitScript((offline:boolean)=>{const w=window as any;w.__workflowOffline=offline;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>!w.__workflowOffline});},offline);
 await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
}
async function online(browser:any){await browser.evaluate(()=>{(window as any).__workflowOffline=false;window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online'));});}

test('two offline messages survive reload and repeated reconnect delivers each nonce once in order',async({app,screen,browser,agent})=>{
 await boot(app,browser,screen,true);
 await input(screen).fill('eerste wachtrijbericht');await input(screen).press('Enter');await expectComposerText(browser,'');
 await expect(browser.locator('.message.user[data-workflow-nonce]')).toHaveCount(1);
 await input(screen).fill('tweede wachtrijbericht');await input(screen).press('Enter');await expect(browser.locator('.message.user[data-workflow-nonce]')).toHaveCount(2);
 const before=await saved(browser);expect(before.sendJournal.records).toHaveLength(2);expect(before.messages.marketing??[]).toEqual([]);const nonces=before.sendJournal.records.map((r:any)=>r.nonce);
 await browser.reload();await expect(browser.locator('.message.user[data-workflow-nonce]')).toHaveCount(2);
 await expect(browser.locator('.message.user[data-workflow-nonce]').first()).toContainText('Wacht op verbinding');
 await online(browser);
 await expect.poll(async()=>((await saved(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(2);
 await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);
 const after=await saved(browser),users=after.messages.marketing.filter((m:any)=>m.role==='user');expect(users.map((m:any)=>m.text)).toEqual(['eerste wachtrijbericht','tweede wachtrijbericht']);expect(users.map((m:any)=>m.clientNonce)).toEqual(nonces);
 await agent.act('Open het gesprek Find Customers in de zijbalk.');await expect(screen.getByRole('button','Gespreksdetails',{exact:true}).first()).toBeVisible();
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await browser.reload();expect((await saved(browser)).messages.marketing.filter((m:any)=>m.role==='user').map((m:any)=>m.clientNonce)).toEqual(nonces);
});

test('rejected durable enqueue keeps exact draft and reply and creates no pending or accepted message',async({app,screen,browser})=>{
 await boot(app,browser,screen);await input(screen).fill('bronbericht');await input(screen).press('Enter');await expect(browser.locator('.message.bot')).toHaveCount(1);
 await browser.locator('.message.bot').last().click();await screen.getByRole('toolbar','Berichtknoppen').getByRole('button','Beantwoorden',{exact:true}).click();
 await input(screen).fill('  concept mag niet verdwijnen  ');
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__denyEnqueue=true;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&(window as any).__denyEnqueue&&JSON.parse(v).sendJournal?.records?.length)throw new DOMException('Denied journal','QuotaExceededError');return write.call(this,k,v);};});
 await input(screen).press('Enter');await expectComposerText(browser,'  concept mag niet verdwijnen  ');await expect(screen.getByRole('region','Antwoordcontext')).toBeVisible();
 await expect(browser.locator('.message.user[data-workflow-nonce]')).toHaveCount(0);expect((await saved(browser)).messages.marketing.filter((m:any)=>m.role==='user')).toHaveLength(1);
 await browser.evaluate(()=>{(window as any).__denyEnqueue=false;});await input(screen).press('Enter');await expect.poll(async()=>((await saved(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(2);
 const s=await saved(browser),users=s.messages.marketing.filter((m:any)=>m.role==='user');expect(users[1].quote.text).toContain('lokale voorbeeldreactie');expect(s.replyDrafts.marketing??null).toBeNull();
});

test('failed acceptance retries the same message without clearing a newer draft',async({app,screen,browser})=>{
 await boot(app,browser,screen);
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__denyAcceptance=true;Storage.prototype.setItem=function(k,v){const s=k==='grok-local-replica-v1'?JSON.parse(v):null;if(s&&(window as any).__denyAcceptance&&(s.messages.marketing??[]).some((m:any)=>m.clientNonce))throw new DOMException('Denied acceptance','QuotaExceededError');return write.call(this,k,v);};});
 await input(screen).fill('herstel precies dit bericht');await input(screen).press('Enter');
 const row=browser.locator('.message.user[data-workflow-nonce]');await expect(row.getByRole('button','Opnieuw proberen',{exact:true})).toBeVisible();
 const before=await saved(browser),nonce=before.sendJournal.records[0].nonce;expect(before.messages.marketing??[]).toEqual([]);
 await input(screen).fill('nieuw concept blijft staan');await browser.evaluate(()=>{(window as any).__denyAcceptance=false;});await row.getByRole('button','Opnieuw proberen',{exact:true}).click();
 await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);await expectComposerText(browser,'nieuw concept blijft staan');
 const s=await saved(browser);expect(s.messages.marketing.filter((m:any)=>m.role==='user').map((m:any)=>({text:m.text,nonce:m.clientNonce}))).toEqual([{text:'herstel precies dit bericht',nonce}]);
});

test('persisted acceptance with rejected journal cleanup reconciles after reload without duplicate delivery',async({app,screen,browser})=>{
 await boot(app,browser,screen);
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){const s=k==='grok-local-replica-v1'?JSON.parse(v):null;if(s&&s.sendJournal?.records?.length===0&&(s.messages.marketing??[]).some((m:any)=>m.clientNonce))throw new DOMException('Denied cleanup','QuotaExceededError');return write.call(this,k,v);};});
 await input(screen).fill('eenmaal ondanks onzekere opruiming');await input(screen).press('Enter');
 await expect.poll(async()=>((await saved(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(1);
 const before=await saved(browser),user=before.messages.marketing.find((m:any)=>m.role==='user');expect(before.sendJournal.records.length).toBeGreaterThan(0);
 await browser.reload();await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);
 const after=await saved(browser);expect(after.messages.marketing.filter((m:any)=>m.role==='user')).toHaveLength(1);expect(after.messages.marketing.find((m:any)=>m.role==='user')).toEqual(user);expect(after.messages.marketing.filter((m:any)=>m.role==='bot')).toHaveLength(1);
});

test('offline attachments remain real previewable bytes and one durable reference after recovery',async({app,screen,browser})=>{
 await boot(app,browser,screen,true);
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
 await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toBeVisible();await input(screen).fill('bewaar de echte bijlage');await input(screen).press('Enter');
 await expectComposerText(browser,'');await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
 let s=await saved(browser);const ref=s.sendJournal.records[0].snapshot.attachments[0];expect(ref.name).toBe('pipeline.txt');
 await browser.reload();const queued=browser.locator('.message.user[data-workflow-nonce]');await expect(queued).toContainText('pipeline.txt');
 await online(browser);await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);
 s=await saved(browser);expect(s.messages.marketing.find((m:any)=>m.role==='user').attachments).toEqual([ref]);
 await browser.locator('.message.user').last().getByRole('button','Bijlage openen: pipeline.txt',{exact:true}).click();
 await expect(screen.getByRole('dialog','pipeline.txt')).toContainText('exact bewaarde kandidaatpopulatie = 10.');
});

test('clearing an offline conversation removes its queued work and reconnect cannot resurrect it',async({app,screen,browser})=>{
 await boot(app,browser,screen,true);await input(screen).fill('dit gesprek wordt gewist');await input(screen).press('Enter');await expect(browser.locator('.message.user[data-workflow-nonce]')).toHaveCount(1);
 await screen.getByRole('button','Gespreksopties',{exact:true}).click();await screen.getByRole('menuitem','Gesprek wissen',{exact:true}).click();
 await expect(browser.locator('.message.user[data-workflow-nonce]')).toHaveCount(0);await online(browser);await browser.reload();
 const s=await saved(browser);expect(s.sendJournal.records).toHaveLength(0);expect(s.messages.marketing??[]).toEqual([]);await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('deleting a failed queue head immediately drains its waiting successor without an unrelated wakeup',async({app,screen,browser})=>{
 await boot(app,browser,screen);
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__blockFirstSend=true;Storage.prototype.setItem=function(k,v){const s=k==='grok-local-replica-v1'?JSON.parse(v):null;if(s&&(window as any).__blockFirstSend&&(s.messages.marketing??[]).some((m:any)=>m.clientNonce))throw new DOMException('Denied delivery','QuotaExceededError');return write.call(this,k,v);};});
 await input(screen).fill('mislukte voorganger');await input(screen).press('Enter');await expect(browser.locator('.workflow-pending').getByRole('button','Verwijderen',{exact:true})).toBeVisible();
 await input(screen).fill('opvolger moet doorgaan');await input(screen).press('Enter');await expect(browser.locator('.workflow-pending')).toHaveCount(2);
 await expectComposerText(browser,'');await input(screen).press('Enter');expect((await saved(browser)).sendJournal.records).toHaveLength(2);
 const before=await saved(browser),secondNonce=before.sendJournal.records[1].nonce;
 await input(screen).fill('dit nieuwe concept blijft');await browser.evaluate(()=>{(window as any).__blockFirstSend=false;});
 await browser.locator('.workflow-pending').first().getByRole('button','Verwijderen',{exact:true}).click();
 await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);
 await expectComposerText(browser,'dit nieuwe concept blijft');
 const after=await saved(browser);expect(after.messages.marketing.filter((m:any)=>m.role==='user').map((m:any)=>({text:m.text,nonce:m.clientNonce}))).toEqual([{text:'opvolger moet doorgaan',nonce:secondNonce}]);
});

test('denied clear preserves both accepted transcript and queued intents in the same durable transaction',async({app,screen,browser})=>{
 await boot(app,browser,screen);await input(screen).fill('bestaand bevestigd bericht');await input(screen).press('Enter');await expect(browser.locator('.message.bot')).toHaveCount(1);
 await browser.evaluate(()=>{(window as any).__workflowOffline=true;window.dispatchEvent(new Event('offline'));});
 await input(screen).fill('nog niet ontvangen bericht');await input(screen).press('Enter');await expect(browser.locator('.workflow-pending')).toHaveCount(1);
 const before=await saved(browser);
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__denyClear=true;Storage.prototype.setItem=function(k,v){const s=k==='grok-local-replica-v1'?JSON.parse(v):null;if(s&&(window as any).__denyClear&&s.messages.marketing?.length===0)throw new DOMException('Denied conversation clear','QuotaExceededError');return write.call(this,k,v);};});
 await screen.getByRole('button','Gespreksopties',{exact:true}).click();await screen.getByRole('menuitem','Gesprek wissen',{exact:true}).click();
 await expect(browser.locator('.workflow-pending')).toHaveCount(1);await expect(browser.locator('.message.user:not([data-workflow-nonce])')).toHaveCount(1);
 let after=await saved(browser);expect(after.sendJournal).toEqual(before.sendJournal);expect(after.messages.marketing).toEqual(before.messages.marketing);
 await browser.evaluate(()=>{(window as any).__denyClear=false;});await screen.getByRole('button','Gespreksopties',{exact:true}).click();await screen.getByRole('menuitem','Gesprek wissen',{exact:true}).click();
 after=await saved(browser);expect(after.sendJournal.records).toHaveLength(0);expect(after.messages.marketing).toEqual([]);await online(browser);await browser.reload();await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('retry of an older attachment payload preserves newer same-text draft and later attachment',async({app,screen,browser})=>{
 await boot(app,browser,screen);
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__denyOldAttachment=true;Storage.prototype.setItem=function(k,v){const s=k==='grok-local-replica-v1'?JSON.parse(v):null;if(s&&(window as any).__denyOldAttachment&&(s.messages.marketing??[]).some((m:any)=>m.clientNonce))throw new DOMException('Denied attachment delivery','QuotaExceededError');return write.call(this,k,v);};});
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toBeVisible();
 await input(screen).fill('zelfde tekst voor ander bestand');await input(screen).press('Enter');await expect(browser.locator('.workflow-pending').getByRole('button','Opnieuw proberen',{exact:true})).toBeVisible();
 await expectComposerText(browser,'zelfde tekst voor ander bestand');
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/source-table.csv']);await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();
 await browser.evaluate(()=>{(window as any).__denyOldAttachment=false;});await browser.locator('.workflow-pending').getByRole('button','Opnieuw proberen',{exact:true}).click();
 await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);
 await expectComposerText(browser,'zelfde tekst voor ander bestand');await expect(screen.getByRole('button','Bijlage verwijderen: source-table.csv')).toBeVisible();await expect(screen.getByRole('button','Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
 const first=(await saved(browser)).messages.marketing.find((m:any)=>m.role==='user');expect(first.attachments.map((r:any)=>r.name)).toEqual(['pipeline.txt']);
 await input(screen).press('Enter');await expect.poll(async()=>((await saved(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(2);
 const users=(await saved(browser)).messages.marketing.filter((m:any)=>m.role==='user');expect(users[1].attachments.map((r:any)=>r.name)).toEqual(['source-table.csv']);expect(users[1].clientNonce).not.toBe(first.clientNonce);
});

test('background delivery updates the visible sidebar preview without switching the active conversation',async({app,screen,browser})=>{
 await boot(app,browser,screen,true);
 await input(screen).fill('achtergrondbericht voor Marketing');await input(screen).press('Enter');
 await expect(browser.locator('.workflow-pending')).toHaveCount(1);
 await screen.getByRole('button','Find Customers',{exact:true}).click();
 await expectComposerText(browser,'');
 await online(browser);
 await expect.poll(async()=>(await saved(browser)).sendJournal.records.length).toBe(0);
 await expect(screen.getByRole('button','Marketing Agent',{exact:true})).toContainText('achtergrondbericht voor Marketing');
 await expect(browser.locator('.agent-row.active')).toHaveAttribute('data-agent-id','customers');
 await expect(browser.locator('.message.user')).toHaveCount(0);
});

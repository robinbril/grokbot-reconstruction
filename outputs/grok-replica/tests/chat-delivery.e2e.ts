// PREP ONLY. Proposed menu/dialog UI; run-contract3 and frontend-contract own the oracles.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {expectComposerText,setComposerText} from './fixtures/composer-assertions';
async function boot(app:any,browser:any,screen:any){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});await screen.getByRole('button','Marketing Agent').click();}
async function configureOperation(screen:any,op='upper',style='short',layout='bubble'){
 await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Gespreksbewerking').click();const settings=screen.getByRole('dialog','Gespreksbewerking');
 await settings.getByLabel('Lokale bewerking').selectOption({value:op});await settings.getByLabel('Uitvoervorm').selectOption({value:style});await settings.getByLabel('Antwoordweergave').selectOption({value:layout});await settings.getByRole('button','Gebruiken').click();await expect(settings).toHaveCount(0);
}
async function operation(screen:any,browser:any,text:string,op='upper',style='short'){
 await configureOperation(screen,op,style);
 if(text.includes('\n'))await setComposerText(browser,text);else await screen.getByRole('textbox','Bericht sturen naar Bot').fill(text);await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
}
async function saved(browser:any){return browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);const runs=Object.values(s.chatRuns||{}) as any[],r=runs.find(r=>r.conversationId==='marketing');return {run:r??null,output:r?s.messages.marketing.find((m:any)=>m.id===r.outputEntryId):null,input:r?s.messages.marketing.find((m:any)=>m.id===r.inputEntryId):null,drafts:s.drafts};});}

// Own local text semantics: \S+ words, UTF16 length, newline split, toUpperCase exact whitespace.
for(const c of [{op:'upper',style:'short',input:'  één\tStraße\n😀  ',output:'  ÉÉN\tSTRASSE\n😀  '},
 {op:'count',style:'short',input:'een  twee\n😀',output:'3 woorden'},
 {op:'count',style:'full',input:'een  twee\n😀',output:`3 woorden · ${'een  twee\n😀'.length} tekens · 2 regels`}])
test(`main composer computes ${c.op}/${c.style} and atomically delivers one persisted result`,async({app,screen,browser})=>{
 await boot(app,browser,screen);await operation(screen,browser,c.input,c.op,c.style);
 await expect.poll(async()=>Boolean((await saved(browser)).run?.delivery)).toBe(true);const s=await saved(browser);
 expect(s.output.text).toBe(c.output);expect(s.input.text).toBe(c.input);
 expect(s.output.transcript).toMatchObject({kind:'send-message',status:'stable',generation:s.run.generation,revision:s.run.delivery.revision});
 expect(s.run).toMatchObject({phase:'delivered',delivery:{scope:'browser-local',entryId:s.output.id,generation:s.run.generation}});
 await expect(browser.locator(`[data-chat-entry-id="${s.output.id}"]`)).toContainText(c.output.trim());await expect(browser.locator(`.message[data-message-id="${s.output.id}"]`)).toContainText('Lokale berekening');
 await expect(browser.locator(`[data-chat-run-id="${s.run.id}"] [role="status"]`)).toContainText('Voltooid');
 await browser.reload();expect((await saved(browser)).output.text).toBe(c.output);
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return Object.values(s.chatRuns).length;})).toBe(1);
});

test('denied final delivery keeps exact final preview; save-only retry rebases unrelated drafts',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{const w=window as any,write=Storage.prototype.setItem;w.__denyFinal=true;w.__writes=[];w.__denied=[];
  Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'){const s=JSON.parse(v),runs=Object.values(s.chatRuns||{}) as any[];if(w.__denyFinal&&runs.some(r=>r.phase==='delivered')){w.__denied.push(s);throw new DOMException('Denied final','QuotaExceededError');}w.__writes.push(s);}return write.call(this,k,v);};
 });await boot(app,browser,screen);const input='  één\tStraße\n😀  ',output=input.toUpperCase();await operation(screen,browser,input);
 await expect(screen.getByText('Resultaat nog niet opgeslagen')).toBeVisible();const before=await saved(browser);expect(before.run.delivery).toBeNull();expect(before.run.phase).not.toBe('delivered');
 const pending=await browser.evaluate(()=>{const s=(window as any).__denied.at(-1),r=Object.values(s.chatRuns)[0] as any;return {run:r,output:s.messages.marketing.find((m:any)=>m.id===r.outputEntryId)};});expect(pending.output.text).toBe(output);expect(pending.output.transcript.kind).toBe('send-message');
 await expect(browser.locator(`[data-chat-entry-id="${pending.output.id}"]`)).toContainText(output.trim());
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('marketing concept behouden');
 await expect(screen.getByText('Tekst opgeslagen; afronden opnieuw proberen')).toBeVisible();expect((await saved(browser)).run.delivery).toBeNull();expect((await saved(browser)).output.transcript.status).toBe('streaming');
 await screen.getByRole('button','Find Customers').click();await screen.getByRole('textbox','Bericht sturen naar Bot').fill('ander gesprek behouden');await screen.getByRole('button','Marketing Agent').click();
 await browser.evaluate(()=>{(window as any).__denyFinal=false;});
 await screen.getByRole('button','Resultaat opslaan').click();await expect.poll(async()=>(await saved(browser)).run?.phase).toBe('delivered');
 const after=await saved(browser);expect(after.output.id).toBe(pending.output.id);expect(after.output.text).toBe(output);expect(after.output.transcript.kind).toBe('send-message');expect(after.run.id).toBe(pending.run.id);expect(after.run.delivery.id).toBe(pending.run.delivery.id);
 expect(after.drafts).toMatchObject({marketing:'marketing concept behouden',customers:'ander gesprek behouden'});
 expect(await browser.evaluate(()=>{const w=window as any;return w.__writes.filter((s:any)=>Object.values(s.chatRuns||{}).some((r:any)=>r.phase==='delivered')).every((s:any)=>Object.values(s.chatRuns).every((r:any)=>r.phase!=='delivered'||s.messages[r.conversationId].some((m:any)=>m.id===r.delivery.entryId&&m.transcript.status==='stable'&&m.transcript.revision===r.delivery.revision)));})).toBe(true);
 await browser.reload();const reloaded=await saved(browser);expect(reloaded.output.text).toBe(output);expect(reloaded.run.delivery.id).toBe(after.run.delivery.id);
});

test('acceptance failure retains real composer and reply without starting a run',async({app,screen,browser,agent})=>{
 await boot(app,browser,screen);await screen.getByRole('textbox','Bericht sturen naar Bot').fill('eerste bron');await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 await browser.locator('.message.bot').last().click();await expect(screen.getByRole('toolbar','Berichtknoppen')).toBeVisible();
 await agent.act('Klik op de zichtbare knop Beantwoorden van het geselecteerde lokale Botbericht.');await expect(screen.getByRole('region','Antwoordcontext')).toBeVisible();
 await configureOperation(screen,'upper');await screen.getByRole('textbox','Bericht sturen naar Bot').fill('blijft behouden');
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&Object.keys(JSON.parse(v).chatRuns||{}).length)throw new DOMException('Denied acceptance','QuotaExceededError');return write.call(this,k,v);};});
 await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');await expectComposerText(browser,'blijft behouden');await expect(screen.getByRole('region','Antwoordcontext')).toBeVisible();expect((await saved(browser)).run).toBeNull();
 await expect(browser.locator('[data-chat-run-id]')).toHaveCount(0);
});

test('conversation preferences survive switching reload and clear without changing the normal composer',async({app,screen,browser})=>{
 await boot(app,browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot');await input.fill('concept blijft behouden');
 const composer=()=>browser.evaluate(async()=>{const modulePath='/composer-input.js';const {readComposerInput}=await import(modulePath);const form=document.querySelector('#composer-form')!,rect=form.getBoundingClientRect(),style=getComputedStyle(form),field=form.querySelector('#message-input') as HTMLElement;return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,radius:style.borderRadius,background:style.backgroundColor,input:readComposerInput(field).text,textboxes:form.querySelectorAll('#message-input[data-rich-composer]').length,buttons:Array.from(form.querySelectorAll('button')).map(b=>b.getAttribute('aria-label'))};});const baseline=await composer();expect(baseline.textboxes).toBe(1);
 await configureOperation(screen,'markdown','full','elevated');await expect(screen.getByRole('button','Normaal bericht')).toBeVisible();await expect(browser.locator('.composer-wrap')).toContainText('Lokale bewerking');
 await screen.getByRole('button','Find Customers').click();await expect(screen.getByRole('button','Normaal bericht')).toHaveCount(0);await configureOperation(screen,'upper','short','bubble');
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).chatPreferences)).toMatchObject({marketing:{operation:'markdown',style:'full',layoutMode:'elevated'},customers:{operation:'upper',style:'short',layoutMode:'bubble'}});
 await screen.getByRole('button','Marketing Agent').click();await expectComposerText(browser,'concept blijft behouden');
 await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Gespreksbewerking').click();let dialog=screen.getByRole('dialog','Gespreksbewerking');await expect(dialog.getByLabel('Lokale bewerking')).toHaveValue('markdown');await expect(dialog.getByLabel('Uitvoervorm')).toHaveValue('full');await expect(dialog.getByLabel('Antwoordweergave')).toHaveValue('elevated');await browser.keyboard.press('Escape');
 await browser.reload();await expect(screen.getByRole('button','Normaal bericht')).toBeVisible();await expectComposerText(browser,'concept blijft behouden');
 await screen.getByRole('button','Normaal bericht').click();await expect(screen.getByRole('button','Normaal bericht')).toHaveCount(0);await expect.poll(async()=>{const current=await composer();return Math.max(...['x','y','width','height'].map(key=>Math.abs((current as any)[key]-(baseline as any)[key])));}).toBeLessThanOrEqual(1);const restored=await composer();
 expect({radius:restored.radius,background:restored.background,input:restored.input,textboxes:restored.textboxes,buttons:restored.buttons}).toEqual({radius:baseline.radius,background:baseline.background,input:baseline.input,textboxes:baseline.textboxes,buttons:baseline.buttons});for(const key of ['x','y','width','height'])expect(Math.abs((restored as any)[key]-(baseline as any)[key])).toBeLessThanOrEqual(1);
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {marketing:s.chatPreferences.marketing.operation,customers:s.chatPreferences.customers,runs:Object.keys(s.chatRuns||{}).length};})).toEqual({marketing:'normal',customers:{operation:'upper',style:'short',layoutMode:'bubble'},runs:0});
 await screen.getByRole('button','Find Customers').click();await expect(screen.getByRole('button','Normaal bericht')).toBeVisible();await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Gespreksbewerking').click();dialog=screen.getByRole('dialog','Gespreksbewerking');await expect(dialog.getByLabel('Lokale bewerking')).toHaveValue('upper');await expect(dialog.getByLabel('Antwoordweergave')).toHaveValue('bubble');
});

test('denied preference save retains actual dialog choices and retry commits once without starting work',async({app,screen,browser})=>{
 await boot(app,browser,screen);await browser.evaluate(()=>{const w=window as any,write=Storage.prototype.setItem;w.__denyChatPreference=true;w.__chatPreferenceRejected=0;w.__chatPreferenceSaved=0;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&JSON.parse(v).chatPreferences?.marketing?.operation==='markdown'){if(w.__denyChatPreference){w.__chatPreferenceRejected++;throw new DOMException('Denied preference','QuotaExceededError');}w.__chatPreferenceSaved++;}return write.call(this,k,v);};});
 await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Gespreksbewerking').click();const dialog=screen.getByRole('dialog','Gespreksbewerking');await dialog.getByLabel('Lokale bewerking').selectOption({value:'markdown'});await dialog.getByLabel('Uitvoervorm').selectOption({value:'full'});await dialog.getByLabel('Antwoordweergave').selectOption({value:'bubble'});await dialog.getByRole('button','Gebruiken').click();
 await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText('niet opgeslagen');await expect(dialog.getByLabel('Lokale bewerking')).toHaveValue('markdown');await expect(dialog.getByLabel('Uitvoervorm')).toHaveValue('full');await expect(dialog.getByLabel('Antwoordweergave')).toHaveValue('bubble');
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {operation:s.chatPreferences?.marketing?.operation??'normal',active:Array.from(document.querySelectorAll('.composer-wrap button')).some(b=>(b.getAttribute('aria-label')||b.textContent?.trim())==='Normaal bericht'),runs:Object.keys(s.chatRuns||{}).length,rejected:(window as any).__chatPreferenceRejected,saved:(window as any).__chatPreferenceSaved};})).toEqual({operation:'normal',active:false,runs:0,rejected:1,saved:0});
 await browser.evaluate(()=>{(window as any).__denyChatPreference=false;});await dialog.getByRole('button','Gebruiken').click();await expect(dialog).toHaveCount(0);await expect(screen.getByRole('button','Normaal bericht')).toBeVisible();
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {prefs:s.chatPreferences.marketing,runs:Object.keys(s.chatRuns||{}).length,rejected:(window as any).__chatPreferenceRejected,saved:(window as any).__chatPreferenceSaved};})).toEqual({prefs:{operation:'markdown',style:'full',layoutMode:'bubble'},runs:0,rejected:1,saved:1});
});

test('recovered acceptance clears its stale error only after actual successful local delivery',async({app,screen,browser})=>{
 await boot(app,browser,screen);await configureOperation(screen,'upper');await screen.getByRole('textbox','Bericht sturen naar Bot').fill('herstel dit bericht');
 await browser.evaluate(()=>{const w=window as any,write=Storage.prototype.setItem;w.__denyChatAccept=true;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&w.__denyChatAccept&&Object.keys(JSON.parse(v).chatRuns||{}).length)throw new DOMException('Denied acceptance','QuotaExceededError');return write.call(this,k,v);};});
 await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');await expect(screen.getByText('Bericht niet opgeslagen. Je concept blijft behouden.',{exact:true})).toBeVisible();await expectComposerText(browser,'herstel dit bericht');
 await browser.evaluate(()=>{(window as any).__denyChatAccept=false;});await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');await expect.poll(async()=>Boolean((await saved(browser)).run?.delivery)).toBe(true);
 await expect(screen.getByText('Bericht niet opgeslagen. Je concept blijft behouden.',{exact:true})).toHaveCount(0);expect((await saved(browser)).output.text).toBe('HERSTEL DIT BERICHT');await expectComposerText(browser,'');
});

test('queued normal draft cannot bypass a newly selected local operation',async({app,screen,browser})=>{
 await boot(app,browser,screen);const queueSettings=async(value:boolean)=>{await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Lokale wachtrij',{exact:true}).click();if(value)await screen.getByRole('switch','Offlinemodus',{exact:true}).check();else await screen.getByRole('switch','Offlinemodus',{exact:true}).uncheck();await screen.getByRole('dialog','Lokale wachtrij').getByRole('button','Sluiten',{exact:true}).first().click();await expect(screen.getByRole('dialog','Lokale wachtrij')).toHaveCount(0);};
 await queueSettings(true);const text='  bewaar deze wachtrijtekst  ';if(text.includes('\n'))await setComposerText(browser,text);else await screen.getByRole('textbox','Bericht sturen naar Bot').fill(text);await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');await expect(screen.getByRole('button','Wachtrij verzenden',{exact:true})).toBeVisible();await queueSettings(false);await configureOperation(screen,'upper','short','bubble');
 const before=await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {queue:s.localOutbox?.marketing??null,messages:s.messages.marketing??[],draft:s.drafts.marketing??'',pref:s.chatPreferences.marketing};});await screen.getByRole('button','Wachtrij verzenden',{exact:true}).click();await expectComposerText(browser,text);
 const after=await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {queue:s.localOutbox?.marketing??null,messages:s.messages.marketing??[],draft:s.drafts.marketing??'',pref:s.chatPreferences.marketing,runs:Object.keys(s.chatRuns||{}).length};});expect(after.messages).toEqual(before.messages);expect(after.draft).toBe(before.draft);expect(after.pref).toEqual(before.pref);expect(after.queue.id).toBe(before.queue.id);expect(after.queue.text).toBe(text);expect(after.queue.status).toBe('queued');expect(after.runs).toBe(0);
});

// Append to tests/chat-delivery.e2e.ts only after root ends the source freeze.
// Reuses boot/operation/saved. No direct controller calls or synthetic output.
test('denied keyboard delivery retry retains the original focused save control until storage recovers',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{
  const w=window as any,write=Storage.prototype.setItem,upper=String.prototype.toUpperCase;
  w.__keyboardDeliveryDenied=true;w.__keyboardDeliveryAttempts=[];w.__keyboardCommitted=[];w.__keyboardUpperCalls=0;
  // Observe genuine exact-input computation, preserving the native operation and its result.
  String.prototype.toUpperCase=function(){if(String(this)==='audit result')w.__keyboardUpperCalls++;return upper.call(this);};
  Storage.prototype.setItem=function(k,v){
   if(k!=='grok-local-replica-v1')return write.call(this,k,v);
   const candidate=JSON.parse(v),r=Object.values(candidate.chatRuns||{}).find((r:any)=>r.conversationId==='marketing') as any;
   if(r?.phase==='delivered'){
    const m=candidate.messages.marketing.find((m:any)=>m.id===r.outputEntryId);
    const attempt={bytes:v,durableBefore:localStorage.getItem(k),runId:r.id,inputId:r.inputEntryId,entryId:r.outputEntryId,generation:r.generation,revision:m.transcript.revision,receipt:r.delivery,text:m.text,draft:candidate.drafts.marketing,denied:w.__keyboardDeliveryDenied};
    w.__keyboardDeliveryAttempts.push(attempt);
    if(w.__keyboardDeliveryDenied)throw new DOMException('Denied actual keyboard result delivery','QuotaExceededError');
   }
   const result=write.call(this,k,v);w.__keyboardCommitted.push(v);return result;
  };
 });
 await boot(app,browser,screen);await operation(screen,browser,'audit result','upper','short');
 const status=browser.locator('.chat-run-status [role="status"]');
 const entry=browser.locator('.message.bot [data-chat-entry-id]');
 const save=screen.getByRole('button','Resultaat opslaan',{exact:true});
 const durableBytes=()=>browser.evaluate(()=>localStorage.getItem('grok-local-replica-v1'));
 const attempts=()=>browser.evaluate(()=>(window as any).__keyboardDeliveryAttempts);
 const actualComputations=()=>browser.evaluate(()=>(window as any).__keyboardUpperCalls);
 await expect(status.getByText('Resultaat nog niet opgeslagen',{exact:true})).toBeVisible();
 await expect(entry).toHaveText('AUDIT RESULT');await expect(save).toBeVisible();
 const initial=await saved(browser),firstAttempts=await attempts();
 expect(firstAttempts).toHaveLength(1);expect(firstAttempts[0].denied).toBe(true);
 expect(firstAttempts[0].text).toBe('AUDIT RESULT');expect(await actualComputations()).toBe(1);
 expect(initial.run.delivery).toBeNull();expect(initial.run.phase).not.toBe('delivered');
 expect(initial.output.text).toBe('');expect(await durableBytes()).toBe(firstAttempts[0].durableBefore);
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);

 // An actual composer edit must survive the later save-only retry and incidental checkpoint.
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('dit concept blijft behouden');
 await expect(status.getByText('Tekst opgeslagen; afronden opnieuw proberen',{exact:true})).toBeVisible();
 const checkpoint=await saved(browser),checkpointBytes=await durableBytes();
 expect(checkpoint.run).toMatchObject({id:firstAttempts[0].runId,phase:'final-pending-delivery',generation:firstAttempts[0].generation,delivery:null});
 expect(checkpoint.output).toMatchObject({id:firstAttempts[0].entryId,text:'AUDIT RESULT',transcript:{status:'streaming',kind:'send-message'}});
 expect(checkpoint.drafts.marketing).toBe('dit concept blijft behouden');
 expect(checkpoint.output.transcript.revision).toBe(firstAttempts[0].revision-1);
 await save.focus();await expect(save).toBeFocused();
 await browser.evaluate(()=>{
  const w=window as any,b=document.querySelector('.chat-run-status [data-action="chat-save"]')!;
  w.__keyboardSaveButton=b;w.__keyboardSaveRemovals=0;
  w.__keyboardSaveObserver=new MutationObserver(records=>{
   for(const record of records)for(const removed of record.removedNodes)if(removed===b||removed.contains(b))w.__keyboardSaveRemovals++;
  });
  w.__keyboardSaveObserver.observe(document.body,{childList:true,subtree:true});
 });
 const originalControl=()=>browser.evaluate(()=>{
  const w=window as any,b=w.__keyboardSaveButton;
  return {same:document.querySelector('.chat-run-status [data-action="chat-save"]')===b,connected:b.isConnected,focused:document.activeElement===b,removals:w.__keyboardSaveRemovals};
 });
 expect(await originalControl()).toEqual({same:true,connected:true,focused:true,removals:0});

 // Use existing native focus, without a locator press that could refocus a replacement.
 await browser.keyboard.press('Enter');
 await expect.poll(async()=>(await attempts()).length).toBe(2);
 await expect(save).toBeVisible();await expect(save).toBeEnabled();
 expect(await originalControl()).toEqual({same:true,connected:true,focused:true,removals:0});
 await expect(save).toBeFocused();
 const failedAttempts=await attempts();
 expect(failedAttempts.map((a:any)=>a.denied)).toEqual([true,true]);
 expect(failedAttempts[1]).toMatchObject({runId:firstAttempts[0].runId,inputId:firstAttempts[0].inputId,entryId:firstAttempts[0].entryId,generation:firstAttempts[0].generation,revision:firstAttempts[0].revision,text:'AUDIT RESULT',draft:'dit concept blijft behouden',durableBefore:checkpointBytes});
 expect(failedAttempts[1].receipt.id).toBe(firstAttempts[0].receipt.id);
 expect(await durableBytes()).toBe(checkpointBytes);expect(await saved(browser)).toEqual(checkpoint);
 expect(await actualComputations()).toBe(1);await expect(entry).toHaveText('AUDIT RESULT');
 await expect(status.getByText('Tekst opgeslagen; afronden opnieuw proberen',{exact:true})).toBeVisible();
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);

 // Ending observation permits the legitimate terminal removal of the save control.
 await browser.evaluate(()=>{const w=window as any;w.__keyboardSaveObserver.disconnect();w.__keyboardDeliveryDenied=false;});
 await browser.keyboard.press('Enter');
 await expect.poll(async()=>(await saved(browser)).run?.phase).toBe('delivered');
 await expect(status.getByText('Voltooid',{exact:true})).toBeVisible();await expect(save).toHaveCount(0);
 const final=await saved(browser),finalBytes=await durableBytes();
 expect(final.run).toMatchObject({id:firstAttempts[0].runId,inputEntryId:firstAttempts[0].inputId,outputEntryId:firstAttempts[0].entryId,generation:firstAttempts[0].generation,phase:'delivered'});
 expect(final.output).toMatchObject({id:firstAttempts[0].entryId,text:'AUDIT RESULT',transcript:{kind:'send-message',status:'stable',generation:firstAttempts[0].generation,revision:firstAttempts[0].revision}});
 expect(final.run.delivery).toMatchObject({id:firstAttempts[0].receipt.id,entryId:firstAttempts[0].entryId,generation:firstAttempts[0].generation,revision:firstAttempts[0].revision,scope:'browser-local'});
 expect(final.input.id).toBe(firstAttempts[0].inputId);expect(final.input.text).toBe('audit result');
 expect(final.drafts.marketing).toBe('dit concept blijft behouden');expect(await actualComputations()).toBe(1);
 await expect(entry).toHaveText('AUDIT RESULT');
 const evidence=await browser.evaluate(()=>{
  const w=window as any,s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any;
  return {attempts:w.__keyboardDeliveryAttempts,successfulBytes:w.__keyboardCommitted,runs:Object.keys(s.chatRuns).length,inputCount:s.messages.marketing.filter((m:any)=>m.id===r.inputEntryId).length,outputCount:s.messages.marketing.filter((m:any)=>m.id===r.outputEntryId).length,computations:w.__keyboardUpperCalls};
 });
 expect(evidence.attempts.map((a:any)=>a.denied)).toEqual([true,true,false]);
 expect(evidence.attempts[2].bytes).toBe(finalBytes);expect(evidence.successfulBytes.at(-1)).toBe(finalBytes);
 expect(evidence).toMatchObject({runs:1,inputCount:1,outputCount:1,computations:1});

 await browser.reload();await expect(entry).toHaveText('AUDIT RESULT');
 await expect(status.getByText('Voltooid',{exact:true})).toBeVisible();
 await expectComposerText(browser,'dit concept blijft behouden');
 expect(await saved(browser)).toEqual(final);expect(await durableBytes()).toBe(finalBytes);
});

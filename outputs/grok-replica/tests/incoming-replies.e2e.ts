import {expectComposerText} from './fixtures/composer-assertions';
import {expectOriginalJump} from './fixtures/transcript-navigation-assertions';
// Synthetic model, actual production HTTP/runtime, canonical replies and browser persistence.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {createWorkflowFixtureModel} from './fixtures/live-workflows-model.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{
 const fallback=createWorkflowFixtureModel();
 protocol=await startWorkflowProtocolServer({port:18882,model:{...fallback,async complete(input){
  const text=input.messages.findLast(message=>message.role==='user')?.content;
  if(text==='REPLY_LONG_SOURCE')return {text:'',toolCalls:[Array.from({length:36},(_,index)=>`Long first paragraph ${index+1}.`).join('\n\n'),'LOWER_REPLY_TARGET'].map(content=>({id:randomUUID(),name:'SendMessage',arguments:{text:{content}}}))};
  if(text==='REPLY_DUPLICATE_SOURCE')return {text:'',toolCalls:[0,1].map(()=>({id:randomUUID(),name:'SendMessage',arguments:{text:{content:'EQUAL_REPLY_CONTENT'}}}))};
  return fallback.complete(input);
 }}});await browser.goto(protocol.baseUrl);
});
afterEach(async()=>{await protocol?.close();});
type Entry={id:string;role:string;text:string;replyTo?:{messageId:string;entryId:string;text:string};messages?:{id:string;content:string}[]};
type Snapshot={entries:Entry[];runs:{status:string}[];queue:{id:string;status:string;payload:{replyToId?:string}}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const id=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').liveHarness.serverIds.marketing;
 const response=await fetch('/api/harness/conversations/'+id);if(!response.ok)throw Error('Canonical GET failed');return response.json();
});}
async function replyDraft(browser:Browser){return browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').replyDrafts.marketing);}

test('reply targets the selected second equal answer and survives authoritative reload',async({browser,screen,agent,app})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REPLY_DUPLICATE_SOURCE');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');
 const source=(await canonical(browser)).entries.find(entry=>entry.messages?.length===2)!;const second=source.messages![1].id;
 await agent.act('Kies Botbericht 2 met EQUAL_REPLY_CONTENT en gebruik Beantwoorden om een antwoordconcept op precies dat tweede botbericht te openen. Verzend niets.');
 await expect(screen.getByRole('region','Antwoordcontext')).toContainText('EQUAL_REPLY_CONTENT');
 expect((await replyDraft(browser)).replyToId).toBe(second);
 await browser.reload();expect((await replyDraft(browser)).replyToId).toBe(second);
 const first=browser.locator(`[data-live-message-id="${source.messages![0].id}"]`);await first.press('Shift+F10');
 await screen.getByRole('menuitem','Antwoorden',{exact:true}).click();expect((await replyDraft(browser)).replyToId).toBe(source.messages![0].id);
 await browser.locator(`[data-live-message-id="${second}"]`).press('Enter');
 await screen.getByRole('toolbar','Berichtknoppen').getByRole('button','Beantwoorden',{exact:true}).click();expect((await replyDraft(browser)).replyToId).toBe(second);
 await input.fill('REPLY_TO_SECOND');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[1]?.status).toBe('completed');
 const reply=(await canonical(browser)).entries.find(entry=>entry.role==='user'&&entry.text==='REPLY_TO_SECOND')!;
 expect(reply.replyTo).toMatchObject({messageId:second,entryId:source.id,text:'EQUAL_REPLY_CONTENT'});
 await browser.reload();const row=browser.locator(`[data-message-id="${reply.id}"]`);
 await expect(row).toContainText('EQUAL_REPLY_CONTENT');const original=row.getByRole('button','Naar oorspronkelijk bericht',{exact:true});
 await expectOriginalJump(browser,original,`[data-live-message-id="${second}"]`);await app.screenshot('canonical-reply-second-message');
});

test('queued reply restores its canonical target and cannot silently cross conversation bindings',async({browser,screen})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REPLY_USER_SOURCE');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');
 const source=(await canonical(browser)).entries.find(entry=>entry.role==='user')!;
 await input.fill('FIXTURE_DEFER REPLY_HOLD');await input.press('Enter');await expect.poll(async()=>(await canonical(browser)).runs[1]?.status).toBe('running');
 await browser.locator(`[data-message-id="${source.id}"]`).click();await screen.getByRole('toolbar','Berichtknoppen').getByRole('button','Beantwoorden',{exact:true}).click();
 const before=await replyDraft(browser);expect(before.replyToId).toBe(source.id);
 await input.fill('QUEUED_CANONICAL_REPLY');await screen.getByRole('button','In wachtrij',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(1);expect((await canonical(browser)).queue[0].payload.replyToId).toBe(source.id);
 await browser.reload();await screen.getByRole('region','Echte wachtrij',{exact:true}).getByRole('button','Terug naar concept',{exact:false}).click();
 await expectComposerText(browser,'QUEUED_CANONICAL_REPLY');expect(await replyDraft(browser)).toEqual(before);
 // Seed the invalid persisted binding before app boot: an active SSE commit
 // must not overwrite this fixture between a storage write and navigation.
 await browser.addInitScript(()=>{const key='grok-local-replica-v1',state=JSON.parse(localStorage.getItem(key)||'{}');state.replyDrafts.marketing.serverConversationId='foreign-conversation';localStorage.setItem(key,JSON.stringify(state));});
 await browser.reload();expect((await replyDraft(browser)).serverConversationId).toBe('foreign-conversation');
 await screen.getByRole('button','In wachtrij',{exact:true}).click();
 await expectComposerText(browser,'QUEUED_CANONICAL_REPLY');expect((await canonical(browser)).queue).toHaveLength(1);
 await expect(browser.locator('[data-live-send-error]')).toContainText('oorspronkelijke bericht');
});


test('reply toolbar follows the selected lower delivery after a tall first answer',async({browser,screen})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REPLY_LONG_SOURCE');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');
 await screen.getByRole('group','Botbericht 2',{exact:true}).click();
 await expect.poll(()=>browser.evaluate(()=>{
  const delivery=document.querySelector('[aria-label="Botbericht 2"]')!,row=delivery.closest('.message')!,tray=row.querySelector('.message-actions')!;
  const target=delivery.getBoundingClientRect(),buttons=tray.getBoundingClientRect();
  return Math.abs(target.top+target.height/2-buttons.top-buttons.height/2)<4;
 })).toBe(true);
 await screen.getByRole('toolbar','Berichtknoppen').getByRole('button','Beantwoorden',{exact:true}).click();
 await expect(screen.getByRole('region','Antwoordcontext')).toContainText('LOWER_REPLY_TARGET');
});

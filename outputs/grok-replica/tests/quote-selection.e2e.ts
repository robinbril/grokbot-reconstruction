import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {setComposerText,expectComposerText} from './fixtures/composer-assertions';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser){protocol=await startWorkflowProtocolServer({port:18899});await browser.goto(protocol.baseUrl);}
async function selectText(browser:Browser,selector:string){await browser.evaluate(selector=>{
 const target=document.querySelector(selector);if(!target)throw Error('Missing selection surface '+selector);
 if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
 const selection=document.getSelection(),range=document.createRange();range.selectNodeContents(target);selection?.removeAllRanges();selection?.addRange(range);document.dispatchEvent(new Event('selectionchange'));
},selector);}
async function snapshot(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));});}
async function saved(browser:Browser){return browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'));}

test('selected conversation text becomes a real inline quote at the current caret and survives send and reload',async({browser,screen,agent,app})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await setComposerText(browser,'SYNTHETIC selected text');await input.press('Enter');
 await expect(browser.locator('.message.user [data-composer-document]')).toHaveText('SYNTHETIC selected text');
 await setComposerText(browser,'left right');await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);module.setComposerSelection(document.querySelector('#message-input'),5);});
 await selectText(browser,'.message.user [data-composer-document]');
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();
 await agent.act('Voeg de geselecteerde gesprekstekst toe met de knop Toevoegen aan chat. Verzend geen bericht.');
 await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(1);
 await expect(input).toHaveText('left “SYNTHETIC selected t…” right');expect((await snapshot(browser)).text).toBe('left \n> SYNTHETIC selected text\n\n right');
 const state=await saved(browser);expect(state.replyDrafts?.marketing).toBeUndefined();
 const draft=await snapshot(browser);expect(JSON.parse(draft.richText).content[0].content[1]).toEqual({type:'quoteReference',attrs:{quote:'SYNTHETIC selected text'}});
 await app.screenshot('quote-inserted-at-caret');await input.press('Enter');await expectComposerText(browser,'');
 await expect(browser.locator('.message.user')).toHaveCount(2);
 const accepted=await saved(browser),entry=accepted.messages.marketing.filter((entry:{role:string})=>entry.role==='user').at(-1);expect(entry.text).toBe(draft.text);expect(entry.richText).toBe(draft.richText);
 await browser.reload();await expect(browser.locator('.message.user [data-inline-quote]')).toHaveCount(1);
 expect((await saved(browser)).messages.marketing.filter((entry:{role:string})=>entry.role==='user').at(-1).richText).toBe(draft.richText);
});

test('one transcript may span messages while editable inert modal and cross-surface selections cannot quote',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 for(const text of ['FIRST_SYNTHETIC_MESSAGE','SECOND_SYNTHETIC_MESSAGE']){await setComposerText(browser,text);await input.press('Enter');}
 await browser.evaluate(()=>{
  if(document.activeElement instanceof HTMLElement)document.activeElement.blur();const nodes=document.querySelectorAll('.message.user [data-composer-document]'),range=document.createRange();range.setStartBefore(nodes[0]);range.setEndAfter(nodes[1]);const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 });
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();
 await input.fill('EDITABLE_DRAFT');await selectText(browser,'#message-input');await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();
 await browser.evaluate(()=>document.querySelector('.transcript')?.setAttribute('inert',''));await selectText(browser,'.message.user [data-composer-document]');
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();await browser.evaluate(()=>document.querySelector('.transcript')?.removeAttribute('inert'));
 await selectText(browser,'.message.user [data-composer-document]');await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();
 await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Instellingen',{exact:true}).click();
 await selectText(browser,'.message.user [data-composer-document]');await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();
 await screen.getByRole('button','Sluiten',{exact:true}).click();
 await browser.evaluate(()=>{
  const transcript=document.querySelector('.message.user [data-composer-document]'),other=document.querySelector('.sidebar');if(!transcript||!other)throw Error('Missing cross-surface fixture');
  const range=document.createRange();range.setStartBefore(other);range.setEndAfter(transcript);const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 });
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();
});

test('stale selected text is retired on mutation or conversation switch and denied quote insertion keeps the accepted draft',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await setComposerText(browser,'SYNTHETIC source');await input.press('Enter');await setComposerText(browser,'original draft');
 await selectText(browser,'.message.user [data-composer-document]');await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();
 await browser.evaluate(()=>{document.querySelector('.message.user [data-composer-document]')!.textContent='changed source';});
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();
 await selectText(browser,'.message.user [data-composer-document]');await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();
 await screen.getByRole('button','Find Customers',{exact:true}).click();await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();await expectComposerText(browser,'');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await selectText(browser,'.message.user [data-composer-document]');
 const before=await snapshot(browser);await browser.evaluate(()=>{
  const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1'&&String(value).includes('quoteReference'))throw new DOMException('Synthetic denied quote','QuotaExceededError');return original.call(this,key,value);};
 });
 await screen.getByRole('button','Toevoegen aan chat',{exact:true}).click();await expectComposerText(browser,'original draft');
 expect(await snapshot(browser)).toEqual(before);await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);expect((await saved(browser)).messages.marketing.filter((entry:{role:string})=>entry.role==='user')).toHaveLength(1);
});


test('Escape suppresses an unchanged range and actual Mod-L quotes a new eligible selection',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await setComposerText(browser,'SYNTHETIC keyboard selection');await input.press('Enter');await selectText(browser,'.message.user [data-composer-document]');
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();await browser.keyboard.press('Escape');
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();await browser.evaluate(()=>document.dispatchEvent(new Event('selectionchange')));
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeHidden();
 await browser.evaluate(()=>{
  const node=document.querySelector('.message.user [data-composer-document]')!.firstChild!,range=document.createRange();range.setStart(node,0);range.setEnd(node,9);const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 });
 await expect(screen.getByRole('toolbar','Selectieacties',{exact:true})).toBeVisible();
 await browser.keyboard.press('ControlOrMeta+l');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveText('“SYNTHETIC”');
 expect((await snapshot(browser)).text).toBe('\n> SYNTHETIC\n\n ');await expect(input).toBeFocused();await expect(browser.locator('.message.user')).toHaveCount(1);
});

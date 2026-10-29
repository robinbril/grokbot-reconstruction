import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {setComposerText} from './fixtures/composer-assertions';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser){protocol=await startWorkflowProtocolServer({port:18898});await browser.goto(protocol.baseUrl);}
async function snapshot(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));});}
async function insert(browser:Browser,quote:string){return browser.evaluate(async quote=>{const path='/composer-input.js',module=await import(path);return module.composerController(document.querySelector('#message-input')).insertQuote(quote);},quote);}
async function select(browser:Browser,start:number,end=start){await browser.evaluate(async({start,end})=>{const path='/composer-input.js',module=await import(path);module.setComposerSelection(document.querySelector('#message-input'),start,end);},{start,end});}

test('quote atom inserts at the caret with exact native projection and survives reload and actual local send',async({browser,screen,app})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await setComposerText(browser,'before after');await select(browser,7);
 expect(await insert(browser,'one\n\ntwo')).toBe(true);
 const expected='before \n> one\n>\n> two\n\n after';
 expect((await snapshot(browser)).text).toBe(expected);expect((await snapshot(browser)).references).toEqual([]);
 await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveText('“one two”');
 const document=JSON.parse((await snapshot(browser)).richText);expect(document.content[0].content[1]).toEqual({type:'quoteReference',attrs:{quote:'one\n\ntwo'}});
 await input.pressSequentially('!');expect((await snapshot(browser)).text).toBe('before \n> one\n>\n> two\n\n !after');
 await browser.reload();await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(1);
 await input.press('Enter');await expect(input).toHaveText('');
 const sent=await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');return state.messages.marketing.find((message:{role:string})=>message.role==='user');});
 expect(sent.text).toBe('before \n> one\n>\n> two\n\n !after');expect(sent.richText).toContain('quoteReference');
 await expect(browser.locator('.message.user [data-inline-quote]')).toHaveCount(1);
 await app.screenshot('quote-native-local-delivery');
});

test('quote selection copying and pasting stays atomic and never becomes a skill reference',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});expect(await insert(browser,'copy\nquote')).toBe(true);
 const before=await snapshot(browser);await select(browser,0,before.text.length-1);
 const copied=await browser.evaluate(()=>{const element=document.querySelector('#message-input'),data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return {plain:data.getData('text/plain'),fragment:JSON.parse(data.getData('application/x-grok-composer-fragment+json'))};});
 expect(copied.plain).toBe('\n> copy\n> quote\n\n');expect(copied.fragment.references).toEqual([]);
 expect((await snapshot(browser)).text).toBe(before.text);await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(1);
 await browser.locator('#message-input [data-type="quote-reference"]').click();await input.press('Backspace');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);
 expect((await snapshot(browser)).text).toBe(' ');await input.press('ControlOrMeta+z');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(1);
 const context=await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerController(document.querySelector('#message-input')).getQueryContext();});expect(context.text.trim()).toBe('');
 await browser.reload();await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(1);expect((await snapshot(browser)).references).toEqual([]);
});

test('quote insertion rolls back on storage rejection and replaces an entire selected document safely',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await setComposerText(browser,'keep');
 await browser.evaluate(()=>{const state=window as Window&{__quoteWrite:Storage['setItem'];__denyQuote:boolean};state.__quoteWrite=Storage.prototype.setItem;state.__denyQuote=true;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1'&&state.__denyQuote)throw new DOMException('Synthetic quote quota','QuotaExceededError');return state.__quoteWrite.call(this,key,value);};});
 expect(await insert(browser,'not persisted')).toBe(false);expect((await snapshot(browser)).text).toBe('keep');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);
 await browser.evaluate(()=>{(window as Window&{__denyQuote:boolean}).__denyQuote=false;});await input.focus();await input.press('ControlOrMeta+a');expect(await insert(browser,'replacement')).toBe(true);
 expect((await snapshot(browser)).text).toBe('\n> replacement\n\n ');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(1);
 await input.press('ControlOrMeta+z');expect((await snapshot(browser)).text).toBe('keep');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);
});

test('nested quote projection retains list indentation and foreign HTML cannot inject quote identity',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('- item ');expect(await insert(browser,'first\nsecond')).toBe(true);
 expect((await snapshot(browser)).text).toBe('- item \n  > first\n  > second\n  \n   ');expect((await snapshot(browser)).references).toEqual([]);
 await input.focus();await input.press('ControlOrMeta+a');await input.press('Backspace');await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);await browser.evaluate(()=>{const element=document.querySelector('#message-input'),data=new DataTransfer();data.setData('text/plain','foreign');data.setData('text/html','<span data-type="quote-reference" data-quote="injected">foreign</span>');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);expect((await snapshot(browser)).text).toBe('foreign');
});

test('foreign quote HTML beside a plain URL cannot add hidden prompt content',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.focus();
 await browser.evaluate(()=>{const element=document.querySelector('#message-input'),data=new DataTransfer();data.setData('text/plain','https://example.test');data.setData('text/html','<span data-type="quote-reference" data-quote="HIDDEN_FOREIGN_QUOTE">https://example.test</span>');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect(browser.locator('#message-input [data-type="quote-reference"]')).toHaveCount(0);
 expect((await snapshot(browser)).text).toBe('https://example.test');expect((await snapshot(browser)).richText).not.toContain('HIDDEN_FOREIGN_QUOTE');
 await expect(browser.locator('#message-input a')).toHaveAttribute('href','https://example.test');
});

test('quote insertion inside a link emits unmarked atom and space and synchronizes the actual DOM caret',async({browser,screen})=>{
 await open(browser);await browser.evaluate(async()=>{
  const path='/composer-input.js',projectionPath='/composer-document.js',module=await import(path),projection=await import(projectionPath),controller=module.composerController(document.querySelector('#message-input'));
  const value={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'abcdef',marks:[{type:'link',attrs:{href:'https://example.test',target:'_blank',rel:'noopener noreferrer nofollow',class:null}}]}]}]};
  controller.restore({text:projection.projectComposerDocument(value),richText:JSON.stringify(value),references:[]},{resetHistory:true});controller.setSelection(3);
 });
 await screen.getByRole('button','Zoeken',{exact:true}).focus();
 const inserted=await browser.evaluate(async()=>{
  const path='/composer-input.js',module=await import(path),element=document.querySelector('#message-input'),controller=module.composerController(element);
  const accepted=controller.insertQuote('quote'),selection=window.getSelection();
  return {accepted,snapshot:controller.getSnapshot(),focused:document.activeElement===element,caretText:selection?.anchorNode?.textContent,caretOffset:selection?.anchorOffset};
 });
 expect(inserted.accepted).toBe(true);expect(inserted.focused).toBe(true);
 const content=JSON.parse(inserted.snapshot.richText).content[0].content,quote=content.find((node:{type:string})=>node.type==='quoteReference');
 expect(quote).toEqual({type:'quoteReference',attrs:{quote:'quote'}});
 const index=content.indexOf(quote);expect(content[index+1]).toEqual({type:'text',text:' '});
 expect(inserted.caretText).toBe(' ');expect(inserted.caretOffset).toBe(1);
});

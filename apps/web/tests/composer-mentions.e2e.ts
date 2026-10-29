import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {setComposerText} from './fixtures/composer-assertions';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser,screen:Screen){protocol=await startWorkflowProtocolServer({port:18910});await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();}
async function snapshot(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));});}
const menu='[data-member-menu]';

test('actual member menu inserts immutable mention atom without sending and local send/reload retains exact projection',async({browser,screen,agent})=>{
 await browser.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});});
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Amb');
 await expect(screen.getByRole('listbox','Vermelding',{exact:true})).toBeVisible();await expect(screen.getByRole('option','Ambitious Autonomous Agent',{exact:true})).toBeVisible();
 const geometry=await browser.evaluate(()=>{const m=document.querySelector('[data-member-menu]')!,r=m.getBoundingClientRect();return {width:r.width,inside:r.top>=0&&r.bottom<=innerHeight,painted:m.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});expect(geometry).toEqual({width:360,inside:true,painted:true});
 await agent.act('Choose Ambitious Autonomous Agent from the Vermelding suggestions, leaving the result as a draft.');
 expect((await snapshot(browser)).text).toBe('@Ambitious Autonomous Agent ');expect((await snapshot(browser)).references).toEqual([]);
 const atom=JSON.parse((await snapshot(browser)).richText).content[0].content[0];expect(atom.type).toBe('mention');expect(atom.attrs.label).toBe('Ambitious Autonomous Agent');expect(atom.attrs.mentionSuggestionChar).toBe('@');
 await expect(browser.locator('#message-input [data-type="mention"]')).toHaveText('Ambitious Autonomous Agent');await expect(browser.locator('.message.user')).toHaveCount(0);
 await browser.reload();expect((await snapshot(browser)).text).toBe('@Ambitious Autonomous Agent ');await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(1);
 expect(await browser.evaluate(()=>navigator.onLine)).toBe(true);
 await input.press('Enter');await expect(input).toHaveText('');await expect(browser.locator('.message.user [data-inline-mention]')).toHaveCount(1);
 const sent=await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}').messages.marketing.find((m:{role:string})=>m.role==='user'));
 expect(sent.text).toBe('@Ambitious Autonomous Agent ');expect(JSON.parse(sent.richText).content[0].content[0]).toEqual(atom);expect(sent.skillReferences??[]).toEqual([]);
 await browser.locator('.message.user button[data-inline-mention]').click();expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}').selected)).toBe(atom.attrs.id);
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await browser.locator('.message.user button[data-inline-mention]').focus();await browser.locator('.message.user button[data-inline-mention]').press('Enter');expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}').selected)).toBe(atom.attrs.id);
});

test('Enter Tab wrapping Backspace trigger undo and clipboard keep mention identity separate from skills',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@');await input.press('ArrowUp');
 await expect(browser.locator(`${menu} [role=option]`).last()).toHaveAttribute('aria-selected','true');await input.press('ArrowDown');await expect(screen.getByRole('option','Ambitious Autonomous Agent',{exact:true})).toHaveAttribute('aria-selected','true');await input.press('Tab');expect((await snapshot(browser)).text).toBe('@Ambitious Autonomous Agent ');
 await input.press('Backspace');await input.press('Backspace');expect((await snapshot(browser)).text).toBe('@');await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(0);
 await input.press('ControlOrMeta+z');await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(1);
 await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path),element=document.querySelector('#message-input'),controller=module.composerController(element);controller.setSelection(0,controller.getSnapshot().text.length);const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 expect((await snapshot(browser)).references).toEqual([]);await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(1);
 const context=await browser.evaluate(async()=>{const path='/composer-input.js',m=await import(path);return m.composerController(document.querySelector('#message-input')).getQueryContext();});expect(context.text.trim()).toBe('');
 await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('Escape remains dismissed within same anchor and forbidden prefix or link boundary cannot manufacture a member query',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Amb');await expect(browser.locator(menu)).toBeVisible();await input.press('Escape');await input.press('ArrowLeft');await expect(browser.locator(menu)).toHaveCount(0);
 await setComposerText(browser,'');await input.pressSequentially('mail@Amb');await expect(browser.locator(menu)).toHaveCount(0);
 await setComposerText(browser,'');await input.pressSequentially('(@Amb');await expect(browser.locator(menu)).toBeVisible();await input.press('Escape');
 await setComposerText(browser,'');await browser.evaluate(async()=>{const p='/composer-input.js',d='/composer-document.js',m=await import(p),projection=await import(d);const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'@',marks:[{type:'link',attrs:{href:'https://example.test',target:'_blank',rel:'noopener noreferrer nofollow',class:null}}]},{type:'text',text:'Amb'}]}]};const c=m.composerController(document.querySelector('#message-input'));c.restore({text:projection.projectComposerDocument(doc),richText:JSON.stringify(doc),references:[]},{resetHistory:true});c.setSelection(c.getSnapshot().text.length);});
 await input.focus();await input.press('ArrowLeft');await expect(browser.locator(menu)).toHaveCount(0);
});

test('rejected member insertion preserves literal query and focused draft then successful retry commits one mention',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Find');
 await browser.evaluate(()=>{const control=window as Window&{__mentionWrite:Storage['setItem'];__mentionDeny:boolean};control.__mentionWrite=Storage.prototype.setItem;control.__mentionDeny=true;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1'&&control.__mentionDeny)throw new DOMException('Synthetic mention quota','QuotaExceededError');return control.__mentionWrite.call(this,key,value);};});
 await input.press('Enter');expect((await snapshot(browser)).text).toBe('@Find');await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(0);await expect(browser.locator('.message.user')).toHaveCount(0);
 await browser.evaluate(()=>{(window as Window&{__mentionDeny:boolean}).__mentionDeny=false;});await input.press('Enter');expect((await snapshot(browser)).text).toBe('@Find Customers ');await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(1);
});

test('real group member IDs preserve order and everyone projects raw everyone while unrelated groups stay out',async({browser,screen})=>{
 await open(browser,screen);await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');state.agents.push({id:'synthetic-group',name:'Synthetic Group',group:true,memberIds:['dealfinder','marketing']},{id:'unrelated-group',name:'Unrelated Group',group:true,memberIds:['dealfinder']});state.selected='synthetic-group';state.mentionRecents='malformed legacy value';localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});await browser.reload();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@');const labels=await browser.locator(`${menu} [data-command-kind=mention]`).allTextContents();expect(labels.map(s=>s.replace(/\s+/g,' ').trim())).toEqual(['@ iedereen Bot','dealfinder Bot','Marketing Agent Bot']);
 await input.press('Enter');expect((await snapshot(browser)).text).toBe('@everyone ');await expect(browser.locator('#message-input [data-type="mention"] .mention-label')).toHaveText('iedereen');expect((await snapshot(browser)).references).toEqual([]);
});


test('live server admission and model input keep mention metadata while plain projection is delivered exactly once',async({browser,screen})=>{
 await open(browser,screen);await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Find');await input.press('Enter');expect((await snapshot(browser)).text).toBe('@Find Customers ');
 await input.press('Enter');await expect(input).toHaveText('');
 const canonical=()=>browser.evaluate(async()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}'),id=state.liveHarness?.serverIds?.[state.selected];if(!id)return null;const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));return response.ok?response.json():null;});
 await expect.poll(async()=>{const state=await canonical();return state?.runs?.[0]?.status;}).toBe('completed');
 const state=await canonical(),inputs=state.entries.filter((row:{role:string})=>row.role==='user');expect(inputs.length).toBe(1);expect(inputs[0].text).toBe('@Find Customers ');expect(JSON.parse(inputs[0].richText).content[0].content[0].type).toBe('mention');
 expect(state.entries.some((row:{role:string;text:string})=>row.role==='assistant'&&row.text.includes('Protocol fixture output: @Find Customers '))).toBe(true);expect(state.runs.length).toBe(1);
 await browser.reload();await expect(browser.locator('.message.user button[data-inline-mention]')).toHaveCount(1);
});

test('native localized labels keep raw identity and prompt empty-label fallback while foreign HTML stays literal',async({browser,screen})=>{
 await open(browser,screen);await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');state.agents.push({id:'synthetic-new',name:'New Bot',color:'#1680f3'});localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});await browser.reload();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Nieuwe');await browser.locator('[data-command-key="assistants:synthetic-new"]').click();
 expect((await snapshot(browser)).text).toBe('@New Bot ');await expect(browser.locator('#message-input [data-type="mention"] .mention-label')).toHaveText('Nieuwe Bot');
 await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path),controller=module.composerController(document.querySelector('#message-input'));const doc={type:'doc',content:[{type:'paragraph',content:[{type:'mention',attrs:{id:'synthetic-new',label:'',mentionSuggestionChar:'@'}}]}]};controller.restore({text:'@',richText:JSON.stringify(doc),references:[]},{resetHistory:true});});
 expect((await snapshot(browser)).text).toBe('@');await expect(browser.locator('#message-input [data-type="mention"] .mention-label')).toHaveText('synthetic-new');
 await setComposerText(browser,'');await input.focus();await browser.evaluate(()=>{const element=document.querySelector('#message-input'),data=new DataTransfer();data.setData('text/plain','foreign');data.setData('text/html','<span data-type="mention" data-id="synthetic-new" data-label="HIDDEN">foreign</span>');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect(browser.locator('#message-input [data-type="mention"]')).toHaveCount(0);expect((await snapshot(browser)).text).toBe('foreign');expect((await snapshot(browser)).references).toEqual([]);
});

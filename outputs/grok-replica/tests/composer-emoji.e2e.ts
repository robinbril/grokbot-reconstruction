import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {expectComposerText,setComposerText} from './fixtures/composer-assertions';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser){protocol=await startWorkflowProtocolServer({port:18900});await browser.goto(protocol.baseUrl);}
const menu='[data-composer-emoji-menu]';

test('native emoji grid selects with Enter and Tab without submitting and persists plain Unicode',async({browser,screen,agent})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially(':smile');await expect(browser.locator(menu)).toBeVisible();
 await expect(browser.locator(`${menu} [role=option]`).first()).toHaveAttribute('title',':smiley:');
 const geometry=await browser.evaluate(()=>{const menu=document.querySelector('[data-composer-emoji-menu]')!,box=menu.getBoundingClientRect(),point=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return {width:box.width,inside:box.top>=0&&box.bottom<=innerHeight,painted:!!point&&menu.contains(point)};});expect(geometry.width).toBe(294);expect(geometry.inside).toBe(true);expect(geometry.painted).toBe(true);
 await agent.act('Select the first emoji suggestion in the Emoji list, keeping it as a draft.');
 await expectComposerText(browser,'😃 ');await expect(browser.locator('.message.user')).toHaveCount(0);
 await input.pressSequentially(':thumbsup');await expect(browser.locator(menu)).toBeVisible();await input.press('Tab');
 await expectComposerText(browser,'😃 👍 ');await browser.reload();await expectComposerText(browser,'😃 👍 ');
 await expect(browser.locator('#message-input [data-type]')).toHaveCount(0);
});

test('bare colon forbidden prefixes uppercase and fifty-one chars do not open a menu',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 for(const value of [':','word:smile','/:smile','_:smile',':Smile',':'+ 'a'.repeat(51)]){
  await setComposerText(browser,value);await input.press('End');await expect(browser.locator(menu)).toHaveCount(0);
 }
 await setComposerText(browser,'(:smile');await input.press('End');await expect(browser.locator(menu)).toBeVisible();
 await input.press('Escape');await input.press('ArrowLeft');await expect(browser.locator(menu)).toHaveCount(0);await input.press('ArrowRight');
 await expect.poll(()=>browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerSelection(document.querySelector('#message-input')).start;})).toBe(7);
 await input.press('Tab');await expectComposerText(browser,'(:smile\t');
});

test('closed shortcodes replace without a space and unknown codes stay literal',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially(':smile');await expect(browser.locator(menu)).toBeVisible();await input.pressSequentially(':');
 await expectComposerText(browser,'😄');await input.pressSequentially(':thumbsup:');await expectComposerText(browser,'😄👍');
 await setComposerText(browser,':smileX');await input.press('End');await input.press('Shift+ArrowLeft');await input.pressSequentially(':');await expectComposerText(browser,'😄');
 await setComposerText(browser,'😄👍');await input.press('End');await input.pressSequentially(' :not_a_real_emoji_zz:');await expectComposerText(browser,'😄👍 :not_a_real_emoji_zz:');
 await input.press('ControlOrMeta+z');await expectComposerText(browser,'😄👍');
});

test('caret inside query replaces right continuation and arrow navigation clamps an eight-column grid',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially(':smile');await expect(browser.locator(menu)).toBeVisible();await input.press('ArrowUp');
 await expect(browser.locator(`${menu} [role=option]`).first()).toHaveAttribute('aria-selected','true');
 await input.press('ArrowDown');await expect(browser.locator(`${menu} [role=option]`).nth(8)).toHaveAttribute('aria-selected','true');
 await input.press('ArrowLeft');await expect(browser.locator(`${menu} [role=option]`).nth(7)).toHaveAttribute('aria-selected','true');
 await input.press('Escape');await setComposerText(browser,'');await setComposerText(browser,':thumbsup');await input.press('End');await input.press('ArrowLeft');await input.press('ArrowLeft');
 await expect(browser.locator(menu)).toBeVisible();await input.press('Enter');await expectComposerText(browser,'👍 ');
});

test('cold index defers Enter then selects once without sending',async({browser,screen})=>{
 await open(browser);let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 await browser.route('**/assets/vendor/emoji/index.json',async route=>{await hold;await route.continue();});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially(':smile');await input.press('Enter');
 await expectComposerText(browser,':smile');await expect(browser.locator('.message.user')).toHaveCount(0);release();
 await expectComposerText(browser,'😃 ');await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('cold shortcode chains replay once while edits cancel a deferred submit',async({browser,screen})=>{
 await open(browser);let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 await browser.route('**/assets/vendor/emoji/index.json',async route=>{await hold;await route.continue();});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('prefix');await input.press('Shift+Enter');await input.pressSequentially(':smile::thumbsup:');await input.press('Enter');
 await input.pressSequentially(' changed');release();await expectComposerText(browser,'prefix\n😄👍 changed');await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('cold loader loses authority after caret move or blur',async({browser,screen})=>{
 await open(browser);let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 await browser.route('**/assets/vendor/emoji/index.json',async route=>{await hold;await route.continue();});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially(':smile:');await input.press('Enter');await input.press('ArrowLeft');
 await screen.getByRole('button','Bijvoegen',{exact:true}).focus();release();await expectComposerText(browser,':smile:');await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('selection rejects a storage failure without sending and recents reorder deduplicate and cap at fifty',async({browser,screen})=>{
 await open(browser);await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');state.version=1;state.emojiRecents=['smile','smile',...Array.from({length:51},(_,i)=>`unknown-${i}`)];localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});
 await browser.reload();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially(':smile');await expect(browser.locator(`${menu} [role=option]`).first()).toHaveAttribute('title',':smile:');
 await browser.evaluate(()=>{const control=window as Window&{__emojiWrite:Storage['setItem'];__emojiBlocked:boolean};control.__emojiWrite=Storage.prototype.setItem;control.__emojiBlocked=true;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1'&&control.__emojiBlocked)throw new DOMException('Synthetic emoji quota','QuotaExceededError');return control.__emojiWrite.call(this,key,value);};});
 await input.press('Enter');await expectComposerText(browser,':smile');await expect(browser.locator('.message.user')).toHaveCount(0);
 await browser.evaluate(()=>{(window as Window&{__emojiBlocked:boolean}).__emojiBlocked=false;});
 await expect(browser.locator(menu)).toBeVisible();await input.press('Enter');await expectComposerText(browser,'😄 ');
 const recent=await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}').emojiRecents);
 expect(recent.length).toBe(50);expect(recent[0]).toBe('smile');expect(recent.filter((id:string)=>id==='smile').length).toBe(1);
});

test('Shift Enter keeps a draft and IME Enter does not select or send',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially(':smile');await expect(browser.locator(menu)).toBeVisible();
 await input.press('Shift+Enter');await expectComposerText(browser,':smile\n');await expect(browser.locator('.message.user')).toHaveCount(0);
 await setComposerText(browser,':smile');await input.press('End');await expect(browser.locator(menu)).toBeVisible();
 await browser.evaluate(()=>{const input=document.querySelector('#message-input');input?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));});
 await expectComposerText(browser,':smile');await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('cold Tab chooses the top result while a sibling list item keeps native indentation ownership',async({browser,screen})=>{
 await open(browser);let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 await browser.route('**/assets/vendor/emoji/index.json',async route=>{await hold;await route.continue();});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially('- first');await input.press('Shift+Enter');await input.pressSequentially(':thumbsup');await input.press('Tab');
 await expect(browser.locator('#message-input ul ul li')).toHaveCount(1);await expect(input).toHaveText('first :thumbsup');await expect.poll(()=>browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input')).text;})).toBe('- first\n  - :thumbsup');
 await setComposerText(browser,':thumbsup');await input.press('End');await input.press('Tab');await expectComposerText(browser,':thumbsup');release();
 await expectComposerText(browser,'👍 ');await expect(browser.locator('.message.user')).toHaveCount(0);
});


test('cold selected suffix replacement uses the input range before replay',async({browser,screen})=>{
 await open(browser);let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 await browser.route('**/assets/vendor/emoji/index.json',async route=>{await hold;await route.continue();});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await setComposerText(browser,':smileX');await input.focus();
 await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);module.composerController(document.querySelector('#message-input')).setSelection(6,7);});
 await input.pressSequentially(':');
 await expectComposerText(browser,':smile:');release();await expectComposerText(browser,'😄');
 await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('closed shortcode replaces fully selected inline atoms through the native input range',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially(':smile');await expect(browser.locator(menu)).toBeVisible();
 for(const kind of ['mention','workflowReference','quoteReference']){
 const rejected=await browser.evaluate(async(kind:string)=>{
  const path='/composer-input.js',projectionPath='/composer-document.js',module=await import(path),projection=await import(projectionPath),controller=module.composerController(document.querySelector('#message-input'));
  const attrs=kind==='mention'?{id:'marketing',label:'Marketing Agent',mentionSuggestionChar:'@'}:kind==='workflowReference'?{id:'synthetic-emoji',label:'Synthetic Emoji',iconId:null,iconUrl:null}:{quote:'Synthetic emoji quote'};
  const value={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:':smile'},{type:kind,attrs}]}]};
  const text=projection.projectComposerDocument(value),references=kind==='workflowReference'?[{id:'synthetic-emoji',label:'Synthetic Emoji',revision:1,description:'Synthetic emoji identity.'}]:[];
  controller.restore({text,richText:JSON.stringify(value),references},{resetHistory:true});
  const ordinary=controller.replaceRangeText({start:6,end:text.length},'bad'),partial=controller.replaceRangeText({start:7,end:text.length},'bad',{allowSelectedAtoms:true});
  controller.setSelection(6,text.length);return {ordinary,partial};
 },kind);
 expect(rejected).toEqual({ordinary:false,partial:false});await input.pressSequentially(':');await expectComposerText(browser,'😄');
 expect(await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerController(document.querySelector('#message-input')).getSnapshot().references;})).toEqual([]);
 }
 await expect(browser.locator('#message-input [data-type]')).toHaveCount(0);await expect(browser.locator('.message.user')).toHaveCount(0);
});

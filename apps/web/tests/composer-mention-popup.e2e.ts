import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {setComposerText} from './fixtures/composer-assertions';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser,screen:Screen){protocol=await startWorkflowProtocolServer({port:18924});await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();}
const menu='[data-member-menu]';
async function expectCanonical(browser:Browser,text:string){await expect.poll(()=>browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input')).text;})).toBe(text);}
async function geometry(browser:Browser){return browser.evaluate(()=>{
 const input=document.querySelector('#message-input')!,popup=document.querySelector('[data-member-menu]')!;
 const walker=document.createTreeWalker(input,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.textContent?.includes('@'))break;
 const range=document.createRange(),text=node.textContent!;range.setStart(node,text.lastIndexOf('@'));range.setEnd(node,text.length);
 const anchor=range.getBoundingClientRect(),box=popup.getBoundingClientRect(),style=getComputedStyle(popup);
 const list=popup.querySelector('[role=listbox]')!,active=popup.querySelector('[aria-selected=true]')!,row=active.getBoundingClientRect();
 return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height,anchorLeft:anchor.left,anchorTop:anchor.top,anchorBottom:anchor.bottom,viewport:innerWidth,position:style.position,z:style.zIndex,body:popup.parentElement===document.body,painted:popup.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)),heading:!!popup.querySelector('.composer-command-heading'),activePainted:popup.contains(document.elementFromPoint(row.left+row.width/2,row.top+row.height/2)),scroll:list.scrollTop,listHeight:list.clientHeight,rowHeight:row.height};
});}

test('member popup anchors to the matched query across lines and paints above the composer',async({browser,screen,agent})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially('Synthetische eerste regel');await input.press('Shift+Enter');await input.pressSequentially('lange tweede regel @Find');
 await expect(screen.getByRole('listbox','Vermelding',{exact:true})).toBeVisible();
 let box:Awaited<ReturnType<typeof geometry>>;await expect.poll(async()=>{box=await geometry(browser);return Math.abs(box.left-Math.round(Math.max(8,Math.min(box.anchorLeft-17,box.viewport-box.width-8))))<=1;}).toBe(true);
expect(box.body).toBe(true);expect(box.position).toBe('fixed');expect(box.z).toBe('2000');expect(box.width).toBe(360);expect(box.heading).toBe(false);expect(box.painted).toBe(true);
expect(box.bottom).toBeLessThanOrEqual(box.anchorTop-5);
 await agent.act('Choose Find Customers in the Vermelding suggestion list and leave the message as a draft.');
 await expectCanonical(browser,'Synthetische eerste regel\nlange tweede regel @Find Customers ');await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('member popup shifts inside a narrow viewport and follows editor scrolling and resize',async({browser,screen})=>{
 await browser.setViewport({width:670,height:540});await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await setComposerText(browser,Array.from({length:14},(_,i)=>'Synthetische regel '+i).join('\n')+'\nprefix prefix @Find');await input.focus();await input.press('ControlOrMeta+End');
 await expect(browser.locator(menu)).toBeVisible();const before=await geometry(browser);expect(before.left).toBeGreaterThanOrEqual(8);expect(before.right).toBeLessThanOrEqual(662);expect(before.painted).toBe(true);
 await browser.setViewport({width:520,height:480});await expect.poll(async()=>{const box=await geometry(browser);return box.right<=512&&box.left>=8&&box.painted;}).toBe(true);
 await browser.evaluate(()=>{const input=document.querySelector('#message-input')!;input.scrollTop=0;input.dispatchEvent(new Event('scroll'));});
 await expect.poll(async()=>{const box=await geometry(browser);return Math.abs(box.left-Math.round(Math.max(8,Math.min(box.anchorLeft-17,box.viewport-box.width-8))))<=1;}).toBe(true);
 await input.press('Escape');await expect(browser.locator(menu)).toHaveCount(0);await input.press('ArrowLeft');await expect(browser.locator(menu)).toHaveCount(0);
});

test('member list uses native row pitch and height while keyboard scrolling keeps the active row painted',async({browser,screen})=>{
 await open(browser,screen);await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');state.agents.push(...Array.from({length:40},(_,i)=>({id:'synthetic-popup-'+i,name:'Synthetic Popup '+i,color:'#1680f3'})));localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});await browser.reload();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Synthetic Popup');await expect(browser.locator(menu)).toBeVisible();
 expect(await browser.locator(menu+' [role=option]').count()).toBeLessThan(30);
 const initial=await geometry(browser);expect(initial.listHeight).toBe(320);expect(initial.rowHeight).toBe(28);
 const pitch=await browser.evaluate(()=>{const rows=document.querySelectorAll('[data-member-menu] [role=option]');return rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().top;});expect(pitch).toBe(30);
 await input.press('ArrowUp');const last=await geometry(browser);expect(last.scroll).toBeGreaterThan(0);expect(last.activePainted).toBe(true);await expect(browser.locator(menu+' [role=option]').last()).toHaveAttribute('aria-selected','true');await expect(browser.locator(menu+' [role=option]').last()).toHaveAttribute('aria-posinset','40');await expect(browser.locator(menu+' [role=option]').last()).toHaveAttribute('aria-setsize','40');
 await browser.evaluate(()=>{const list=document.querySelector('[data-member-menu] [role=listbox]')!;list.scrollTop=0;list.dispatchEvent(new Event('scroll'));});await expect(browser.locator(menu+' [aria-posinset="40"]')).toBeAttached();expect(await browser.locator(menu+' [role=option]').count()).toBeLessThan(30);
 await input.press('Tab');await expectCanonical(browser,'@Synthetic Popup 39 ');await expect(browser.locator('.message.user')).toHaveCount(0);
 await setComposerText(browser,'');await input.pressSequentially('@Find');await expect(browser.locator(menu)).toBeVisible();await screen.getByRole('button','Bijvoegen',{exact:true}).focus();await expect(browser.locator(menu)).toHaveCount(0);
});

test('member popup prefers below a query when the composer has room and clears on conversation change',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await setComposerText(browser,'@Find\n'+Array.from({length:12},(_,i)=>'Synthetische onderregel '+i).join('\n'));await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);module.composerController(document.querySelector('#message-input')).setSelection(1);});await input.focus();await input.press('ArrowRight');
 await expect(browser.locator(menu)).toBeVisible();await expect.poll(async()=>{const box=await geometry(browser);return Math.round(box.top)-Math.round(box.anchorBottom+6);}).toBe(0);
 await screen.getByRole('button','Find Customers',{exact:true}).click();await expect(browser.locator(menu)).toHaveCount(0);await expect(input).toHaveText('');
});

test('native empty states Escape multiword no-results and blur retain session dismissal without sending',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially('@zzzzunknown');await expect(browser.locator(menu)).toBeVisible();await expect(browser.locator(menu)).toContainText('Geen overeenkomsten voor “zzzzunknown”');await expect(input).toHaveAttribute('aria-expanded','false');
 await input.press('Escape');await input.pressSequentially('x');await expect(browser.locator(menu)).toHaveCount(0);
 await setComposerText(browser,'');await input.pressSequentially('@zzzzunknown');await expect(browser.locator(menu)).toBeVisible();await input.pressSequentially(' x');await expect(browser.locator(menu)).toHaveCount(0);
 await input.press('Backspace');await input.press('Backspace');await expect(browser.locator(menu)).toBeVisible();
 await screen.getByRole('button','Bijvoegen',{exact:true}).focus();await expect(browser.locator(menu)).toHaveCount(0);await input.focus();await input.pressSequentially('x');await expect(browser.locator(menu)).toHaveCount(0);
 await setComposerText(browser,'');await input.pressSequentially('@Find');await expect(browser.locator(menu)).toBeVisible();await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('query geometry stays exact after inline atoms surrogate emoji and link projection suffixes',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await browser.evaluate(async()=>{const path='/composer-input.js',documentPath='/composer-document.js',module=await import(path),projection=await import(documentPath),controller=module.composerController(document.querySelector('#message-input'));
 const richText={type:'doc',content:[{type:'paragraph',content:[{type:'mention',attrs:{id:'customers',label:'Find Customers',mentionSuggestionChar:'@'}},{type:'text',text:' 😄 '},{type:'text',text:'Bron',marks:[{type:'link',attrs:{href:'https://example.test',target:'_blank',rel:'noopener noreferrer nofollow',class:null}}]},{type:'text',text:' @Amb'}]}]};
 const text=projection.projectComposerDocument(richText);controller.restore({text,richText:JSON.stringify(richText),references:[]},{resetHistory:true});controller.setSelection(text.length);});
 await input.focus();await input.press('ArrowLeft');await expect(browser.locator(menu)).toBeVisible();
 await expect.poll(async()=>{const box=await geometry(browser);return Math.abs(box.left-Math.round(Math.max(8,Math.min(box.anchorLeft-17,box.viewport-box.width-8))))<=1;}).toBe(true);
 await input.press('Tab');await expect(browser.locator('#message-input [data-type=mention]')).toHaveCount(2);await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('ordinary at-skill extension keeps its existing Escape edit and refocus behavior',async({browser,screen})=>{
 await open(browser,screen);await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');state.privateSkills.push({id:'synthetic-popup-skill',name:'Zebra Explicit Task',description:'Synthetic local skill.'});localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});await browser.reload();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Zebra');await expect(screen.getByRole('option','Zebra Explicit Task',{exact:true})).toBeVisible();await input.press('Escape');await expect(browser.locator(menu)).toHaveCount(0);
 await input.pressSequentially(' ');await expect(screen.getByRole('option','Zebra Explicit Task',{exact:true})).toBeVisible();await screen.getByRole('button','Bijvoegen',{exact:true}).focus();await expect(browser.locator(menu)).toHaveCount(0);await input.focus();await input.press('ArrowLeft');await expect(screen.getByRole('option','Zebra Explicit Task',{exact:true})).toBeVisible();await expect(browser.locator('.message.user')).toHaveCount(0);
});


test('member popup follows the real composer padding motion at its midpoint and completion',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Find');await expect(browser.locator(menu)).toBeVisible();
 await browser.evaluate(async()=>{const pad=document.querySelector('[data-ui-composer-padding]')!;await Promise.allSettled(pad.getAnimations().map(animation=>animation.finished));});
 await input.press('ArrowLeft');await input.press('ArrowRight');
 await browser.evaluate(async()=>{const path='/ui-motion.js',module=await import(path),pad=document.querySelector('[data-ui-composer-padding]')!;const motion=module.createUIMotion({root:document.body});const animation=motion.composerPadding(pad,{fromPadding:getComputedStyle(pad).padding,toPadding:'10px 12px 46px'});animation.pause();animation.currentTime=150;});
 await expect.poll(async()=>{const box=await geometry(browser);return Math.abs(box.left-Math.round(Math.max(8,Math.min(box.anchorLeft-17,box.viewport-box.width-8))))<=1&&box.painted;}).toBe(true);
 await browser.evaluate(()=>{const pad=document.querySelector('[data-ui-composer-padding]')!;const animation=pad.getAnimations().find(animation=>animation.id==='ui-motion:composerPadding')!;animation.finish();});
 await expect.poll(async()=>{const box=await geometry(browser);return Math.abs(box.left-Math.round(Math.max(8,Math.min(box.anchorLeft-17,box.viewport-box.width-8))))<=1&&box.painted;}).toBe(true);
 await input.press('Escape');await expect(browser.locator(menu)).toHaveCount(0);await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('member popup query geometry keeps the latest partial edit on storage failure and inserts after recovery',async({browser,screen})=>{
 await open(browser,screen);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Find');await expect(browser.locator(menu)).toBeVisible();
 await browser.evaluate(async()=>{const pad=document.querySelector('[data-ui-composer-padding]')!;await Promise.allSettled(pad.getAnimations().map(animation=>animation.finished));});await input.press('ArrowLeft');await input.press('ArrowRight');
 const durable=await browser.evaluate(()=>localStorage.getItem('grok-local-replica-v1'));
 await browser.evaluate(()=>{const save=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1')throw new DOMException('Synthetic range storage failure','QuotaExceededError');return save.call(this,key,value);};(window as Window&{__rangeRestore:()=>void}).__rangeRestore=()=>{Storage.prototype.setItem=save;};});
 await input.press('Shift+ArrowLeft');await input.press('Backspace');await expectCanonical(browser,'@Fin');
 await expect(browser.locator('[data-composer-save-status]')).toBeVisible();
 await expect(browser.locator('[data-composer-save-status]')).toContainText('Je nieuwste tekst blijft zichtbaar');
 await expect(input).toHaveAttribute('data-composer-persistence-error','');
 expect(await browser.evaluate(()=>localStorage.getItem('grok-local-replica-v1'))).toBe(durable);
 expect(JSON.parse(durable!).drafts.marketing).toBe('@Find');
 await input.press('ArrowRight');await expect(browser.locator(menu)).toBeVisible();
 await expect.poll(async()=>{const box=await geometry(browser);return Math.abs(box.left-Math.round(Math.max(8,Math.min(box.anchorLeft-17,box.viewport-box.width-8))))<=1&&box.painted;}).toBe(true);
 await browser.evaluate(()=>{(window as Window&{__rangeRestore:()=>void}).__rangeRestore();});await input.press('Enter');await expectCanonical(browser,'@Find Customers ');await expect(browser.locator('.message.user')).toHaveCount(0);
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).drafts.marketing)).toBe('@Find Customers ');
 await expect(browser.locator('[data-composer-save-status]')).toBeHidden();
});

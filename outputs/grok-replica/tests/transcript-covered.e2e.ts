import {test,type Browser} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';

type ExchangeWindow=Window&{exchangeRestoreStorage?:()=>void;productSurfaces:{ready:Promise<void>;setReducedMotion(value:boolean):void};exchangeCloseReceipts:{at:number;inert:boolean;hidden:string|null;closing:boolean}[]};
async function boot(app:App,browser:Browser,screen:Screen,reduced:boolean){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as ExchangeWindow).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),peer={kind:'agent',id:'find',name:'Find Customers'},other={kind:'agent',id:'dealfinder',name:'dealfinder'};
  state.messages.marketing=Array.from({length:35},(_,i)=>({id:'exchange-filler-'+i,role:'bot',text:`SYNTHETIC_BASE_${i}\n\n`+'Actual persisted reading position. '.repeat(10)}));
  state.messages.marketing.push({id:'exchange-out',role:'bot',text:'SYNTHETIC_EXCHANGE_OUTBOUND_4738',toAgent:peer},{id:'exchange-in',role:'bot',text:'SYNTHETIC_EXCHANGE_INBOUND_6824',fromAgent:peer},{id:'exchange-unrelated',role:'bot',text:'SYNTHETIC_OTHER_PEER_9912',toAgent:other});
  state.drafts.marketing='SYNTHETIC_UNSENT_EXCHANGE_DRAFT';localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
 });
 await browser.reload();await expect(browser.locator('.transcript .message')).toHaveCount(38);
 await browser.evaluate(reduced=>(window as ExchangeWindow).productSurfaces.setReducedMotion(reduced),reduced);
}
async function mainState(browser:Browser){return browser.evaluate(()=>{
 const viewport=document.querySelector('.transcript')!,state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);
 return {top:viewport.scrollTop,key:state.selected,draft:state.drafts.marketing,inert:viewport.hasAttribute('inert'),hidden:viewport.getAttribute('aria-hidden')};
});}

for(const reduced of [false,true])test(`actual peer exchange covers only its base viewport and closes ${reduced?'immediately with reduced motion':'after native sheet exit'}`,async({app,browser,screen})=>{
 await boot(app,browser,screen,reduced);
 const trigger=browser.locator('[data-message-id="exchange-in"] [data-action="product-exchange-open"]');
 await expect(trigger).toBeVisible();const before=await mainState(browser);
 await trigger.click();
 const dialog=screen.getByRole('dialog',{name:'Bot-uitwisseling',exact:true});await expect(dialog).toBeVisible();
 const log=dialog.getByRole('log',{name:'Transcript van Bot-uitwisseling',exact:true});await expect(log).toBeVisible();
 await expect(log.getByText('SYNTHETIC_EXCHANGE_OUTBOUND_4738',{exact:true})).toBeVisible();await expect(log.getByText('SYNTHETIC_EXCHANGE_INBOUND_6824',{exact:true})).toBeVisible();
 await expect(log.getByText('SYNTHETIC_OTHER_PEER_9912',{exact:true})).toHaveCount(0);await expect(log.getByRole('textbox')).toHaveCount(0);
 expect(await mainState(browser)).toEqual({...before,inert:true,hidden:'true'});
 await browser.evaluate(()=>{
  const w=window as ExchangeWindow;w.exchangeCloseReceipts=[];
  const viewport=document.querySelector('.transcript')!;
  const capture=()=>w.exchangeCloseReceipts.push({at:performance.now(),inert:viewport.hasAttribute('inert'),hidden:viewport.getAttribute('aria-hidden'),closing:Boolean(document.querySelector('[data-exchange-sheet][data-exiting]'))});
  document.querySelector('[data-action="product-exchange-close"]')!.addEventListener('click',()=>{capture();requestAnimationFrame(capture);});
  new MutationObserver(capture).observe(viewport,{attributes:true,attributeFilter:['inert','aria-hidden']});
 });
 const animation=await browser.evaluate(()=>{const sheet=document.querySelector('.sand-exchange-sheet__sheet')!;return {duration:getComputedStyle(sheet).animationDuration,real:sheet.getAnimations().some(animation=>animation.effect!.getTiming().duration===300)};});
 if(!reduced)expect(animation).toEqual({duration:'0.3s',real:true});
 await dialog.getByRole('button',{name:'Chat sluiten',exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(browser.locator('.transcript')).not.toHaveAttribute('inert','');
 const after=await mainState(browser);expect(after).toEqual(before);
 const receipts=await browser.evaluate(()=>(window as ExchangeWindow).exchangeCloseReceipts);
 if(!reduced){const closing=receipts.find(item=>item.closing&&item.inert),uncovered=receipts.find(item=>!item.inert);expect(Boolean(closing)).toBe(true);expect(Boolean(uncovered)).toBe(true);expect(uncovered!.at-closing!.at).toBeGreaterThan(150);}
 await expect(screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true})).toHaveText(before.draft);
 await app.screenshot('agent-exchange-closed-'+(reduced?'reduced':'normal'));
});

test('ordinary catalog dialog does not cover the transcript or fabricate agent-exchange state',async({app,browser,screen})=>{
 await boot(app,browser,screen,false);
 await screen.getByRole('button',{name:'Apps verbinden',exact:true}).click();await expect(screen.getByRole('dialog',{name:'Apps verbinden',exact:true})).toBeVisible();
 expect((await mainState(browser)).inert).toBe(false);expect((await mainState(browser)).hidden).toBe(null);await expect(browser.locator('[data-exchange-sheet]')).toHaveCount(0);
});

test('exchange opening clears the actual reply draft and close restores the same peer action after its render replacement',async({app,browser,screen})=>{
 await boot(app,browser,screen,true);
 await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);state.replyDrafts.marketing={messageId:'exchange-filler-1',title:'Synthetic reply',text:'SYNTHETIC_BASE_1'};localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});
 await browser.reload();await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toBeVisible();
 await browser.evaluate(()=>(window as ExchangeWindow).productSurfaces.setReducedMotion(true));
 await browser.locator('[data-message-id="exchange-in"] [data-action="product-exchange-open"]').click();
 const dialog=screen.getByRole('dialog',{name:'Bot-uitwisseling',exact:true});await expect(dialog).toBeVisible();
 expect(await browser.evaluate(()=>Boolean(JSON.parse(localStorage.getItem('grok-local-replica-v1')!).replyDrafts.marketing))).toBe(false);
 await dialog.getByRole('button',{name:'Chat sluiten',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(browser.locator('[data-message-id="exchange-in"] [data-action="product-exchange-open"]')).toBeFocused();
 await expect(screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true})).toHaveText('SYNTHETIC_UNSENT_EXCHANGE_DRAFT');
});


test('exchange preserves reply and draft on rejected durable clear and permits a successful retry',async({app,browser,screen})=>{
 await boot(app,browser,screen,true);
 await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);state.replyDrafts.marketing={messageId:'exchange-filler-1',title:'Synthetic reply',text:'SYNTHETIC_BASE_1'};localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));});
 await browser.reload();await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toBeVisible();
 await browser.evaluate(()=>{
  (window as ExchangeWindow).productSurfaces.setReducedMotion(true);
  const original=Storage.prototype.setItem;
  (window as ExchangeWindow).exchangeRestoreStorage=()=>{Storage.prototype.setItem=original;};
  Storage.prototype.setItem=function(key:string,value:string){if(key==='grok-local-replica-v1')throw new DOMException('Synthetic storage quota boundary','QuotaExceededError');return original.call(this,key,value);};
 });
 const trigger=browser.locator('[data-message-id="exchange-in"] [data-action="product-exchange-open"]');await trigger.click();
 const dialog=screen.getByRole('dialog',{name:'Bot-uitwisseling',exact:true});await expect(dialog).toHaveCount(0);
 await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>Boolean(JSON.parse(localStorage.getItem('grok-local-replica-v1')!).replyDrafts.marketing))).toBe(true);
 await expect(screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true})).toHaveText('SYNTHETIC_UNSENT_EXCHANGE_DRAFT');
 await expect(browser.locator('.storage-feedback')).toHaveText('Opslaan in deze browser is niet beschikbaar. Wijzigingen blijven bewaard tot je herlaadt.');
 await expect(trigger).toBeFocused();
 await browser.evaluate(()=>(window as ExchangeWindow).exchangeRestoreStorage!());
 await trigger.click();await expect(dialog).toBeVisible();
 expect(await browser.evaluate(()=>Boolean(JSON.parse(localStorage.getItem('grok-local-replica-v1')!).replyDrafts.marketing))).toBe(false);
 await dialog.getByRole('button',{name:'Chat sluiten',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true})).toHaveText('SYNTHETIC_UNSENT_EXCHANGE_DRAFT');
});

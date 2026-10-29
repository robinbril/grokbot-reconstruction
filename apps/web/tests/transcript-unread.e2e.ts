import {test,type Browser} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';

type UnreadWindow=Window&{productSurfaces:{ready:Promise<void>;diagnostics():{modules:Array<{id:string;unread?:{boundaryAt:number|null;hasSeen:boolean;hasDismissed:boolean;showsPill:boolean}}>}}};
async function seed(app:App,browser:Browser,screen:Screen,total=30){
 await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as UnreadWindow).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.evaluate(total=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);state.selected='marketing';
  state.messages.marketing=Array.from({length:total},(_,index)=>({id:'unread-source-'+index,role:'bot',createdAt:100+index,text:`SYNTHETIC_UNREAD_${index}\n\n`+'Read the actual source row. '.repeat(12)}));
  localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
  localStorage.setItem('grok-local-unread-v1',JSON.stringify({version:1,conversations:[{key:'marketing',lastViewedAt:105,seenIds:state.messages.marketing.map((item:{id:string})=>item.id),receipts:state.messages.marketing.map((item:{id:string;createdAt:number})=>({id:item.id,entryId:item.id,timestampMs:item.createdAt,eligible:true}))}]}));
 },total);
 await browser.reload();await expect.poll(()=>browser.evaluate(()=>document.querySelectorAll('.message').length)).toBe(Math.min(total,500));
 await expect(screen.getByRole('button',{name:'Naar ongelezen berichten',exact:true})).toBeVisible();
 await expect(browser.locator('[data-unread-count]')).toHaveText(`${total-6} nieuwe berichten`);
}
async function unread(browser:Browser){return browser.evaluate(()=>{
 const value=(window as UnreadWindow).productSurfaces.diagnostics().modules.find(module=>module.id==='transcript-coordinator')?.unread;
 if(!value)throw Error('Actual unread surface is not registered');return JSON.parse(JSON.stringify(value)) as typeof value;
});}

test('unread pill jumps to the exact source divider with native smooth owner and preserves the actual draft',async({app,browser,screen})=>{
 await seed(app,browser,screen);const input=screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true});await input.fill('SYNTHETIC_DRAFT_STAYS');
 await screen.getByRole('region',{name:'Gesprek',exact:true}).getByRole('button',{name:'Naar ongelezen berichten',exact:true}).click();
 await expect(screen.getByRole('separator',{name:'Nieuwe berichten',exact:true})).toBeVisible();
 await expect.poll(async()=>browser.evaluate(()=>{
  const node=document.querySelector('[data-unread-divider]')!,view=document.querySelector('.transcript')!,box=view.getBoundingClientRect(),row=node.getBoundingClientRect();
  const target=Math.max(0,Math.min(view.scrollHeight-view.clientHeight,view.scrollTop+row.top+row.height/2-box.top-view.clientHeight/2));return Math.abs(view.scrollTop-target);
 })).toBeLessThanOrEqual(1);
 await expect.poll(async()=>(await unread(browser)).hasSeen).toBe(true);
 await expect(screen.getByRole('button',{name:'Naar ongelezen berichten',exact:true})).toHaveCount(0);await expect(input).toHaveText('SYNTHETIC_DRAFT_STAYS');
 await app.screenshot('unread-source-divider-after-real-jump');
});

test('dismissing the unread pill retains the divider and a real reopen uses the persisted read receipt',async({app,browser,screen})=>{
 await seed(app,browser,screen);
 await screen.getByRole('region',{name:'Gesprek',exact:true}).getByRole('button',{name:'Ongelezen melding sluiten',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Naar ongelezen berichten',exact:true})).toHaveCount(0);
 expect((await unread(browser)).hasDismissed).toBe(true);await expect(screen.getByRole('separator',{name:'Nieuwe berichten',exact:true})).toHaveCount(1);
 await screen.getByRole('button',{name:'Find Customers',exact:true}).click();await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await expect(screen.getByRole('separator',{name:'Nieuwe berichten',exact:true})).toHaveCount(0);await browser.reload();
 await expect(screen.getByRole('button',{name:'Naar ongelezen berichten',exact:true})).toHaveCount(0);
 expect((await unread(browser)).boundaryAt).toBe(null);await app.screenshot('unread-dismiss-and-persisted-read-reopen');
});

test('unread pill above the actual history window loads older rows before centering the real divider',async({app,browser,screen})=>{
 await seed(app,browser,screen,600);await expect(browser.locator('[data-message-id="unread-source-6"]')).toHaveCount(0);await expect(screen.getByRole('separator',{name:'Nieuwe berichten',exact:true})).toHaveCount(0);
 await screen.getByRole('region',{name:'Gesprek',exact:true}).getByRole('button',{name:'Naar ongelezen berichten',exact:true}).click();
 await expect(browser.locator('[data-message-id="unread-source-6"]')).toBeVisible();await expect(screen.getByRole('separator',{name:'Nieuwe berichten',exact:true})).toBeVisible();
 await expect.poll(async()=>browser.evaluate(()=>{
  const row=document.querySelector('[data-unread-divider]')!.getBoundingClientRect(),viewport=document.querySelector('.transcript')!,box=viewport.getBoundingClientRect();
  return Math.abs(row.top+row.height/2-box.top-viewport.clientHeight/2);
 })).toBeLessThanOrEqual(1);
 await expect.poll(async()=>(await unread(browser)).hasSeen).toBe(true);await expect.poll(()=>browser.evaluate(()=>document.querySelectorAll('.message').length)).toBe(600);
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).messages.marketing.length)).toBe(600);
 await app.screenshot('unread-history-reveal-exact-source-divider');
});

test('unread jump hands keyboard focus to the first source action anchor after the divider',async({app,browser,screen})=>{
 await seed(app,browser,screen);const source=browser.locator('[data-message-id="unread-source-6"]');
 await screen.getByRole('region',{name:'Gesprek',exact:true}).getByRole('button',{name:'Naar ongelezen berichten',exact:true}).click();
 await expect(source).toBeFocused();await expect(source).toBeVisible();await expect.poll(async()=>(await unread(browser)).hasSeen).toBe(true);
 await app.screenshot('unread-native-keyboard-focus-handoff');
});

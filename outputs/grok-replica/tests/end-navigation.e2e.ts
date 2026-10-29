import {test,type Browser} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';

async function boot(app:App,browser:Browser,screen:Screen){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as Window&{productSurfaces:{ready:Promise<void>}}).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);
  state.messages.marketing=Array.from({length:35},(_,index)=>({id:'end-'+index,role:'bot',text:index===34?'FINAL_END_MESSAGE_19049':'Synthetic reader paragraph '+index+'\n\n'+'Read without sending. '.repeat(40)}));
  localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
 });
 await browser.reload();await expect(browser.locator('.message.bot')).toHaveCount(35);
}
async function observeNavigation(browser:Browser){
 await browser.evaluate(()=>{
  const transcript=document.querySelector('.transcript')!,original=transcript.scrollTo.bind(transcript);
  const calls:{behavior:ScrollBehavior|undefined;remaining:number;lastInside:boolean}[]=[];
  (window as Window&{endCalls:typeof calls}).endCalls=calls;
  Object.defineProperty(transcript,'scrollTo',{value:(options:ScrollToOptions)=>{
   original(options);const viewport=transcript.getBoundingClientRect(),last=transcript.querySelector('.message:last-child')!.getBoundingClientRect();
   calls.push({behavior:options.behavior,remaining:transcript.scrollHeight-transcript.clientHeight-transcript.scrollTop,lastInside:last.top>=viewport.top-1&&last.bottom<=viewport.bottom+1});
  }});
 });
}
async function readOlder(browser:Browser){
 await browser.locator('.message.bot').nth(10).focus();
 await browser.evaluate(()=>{const transcript=document.querySelector('.transcript')!;transcript.scrollTop=1500;transcript.dispatchEvent(new Event('scroll'));});
}
async function calls(browser:Browser){return browser.evaluate(()=>(window as Window&{endCalls:{behavior:string;remaining:number;lastInside:boolean}[]}).endCalls);}

test('actual End in a reloaded transcript instantly reveals its final message and survives whole app render',async({app,browser,screen})=>{
 await boot(app,browser,screen);await observeNavigation(browser);await readOlder(browser);
 await expect(screen.getByRole('button',{name:'Naar laatste bericht',exact:true})).toBeVisible();
 await browser.keyboard.press('End');
 let navigations=await calls(browser);expect(navigations).toHaveLength(1);expect(navigations[0].behavior).toBe('instant');expect(Math.abs(navigations[0].remaining)).toBeLessThanOrEqual(1);expect(navigations[0].lastInside).toBe(true);
 await expect(screen.getByText('FINAL_END_MESSAGE_19049',{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>(document.activeElement as HTMLElement).dataset.messageId)).toBe('end-10');
 await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();
 await observeNavigation(browser);await readOlder(browser);await browser.keyboard.press('End');
 navigations=await calls(browser);expect(navigations).toHaveLength(1);expect(navigations[0].behavior).toBe('instant');expect(Math.abs(navigations[0].remaining)).toBeLessThanOrEqual(1);expect(navigations[0].lastInside).toBe(true);
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).messages.marketing.length)).toBe(35);
});

test('End leaves transcript modifiers and composer sidebar menu and dialog workflows with their actual owners',async({app,browser,screen})=>{
 await boot(app,browser,screen);await observeNavigation(browser);
 for(const key of ['Shift+End','Alt+End']){await readOlder(browser);await browser.keyboard.press(key);expect(await calls(browser)).toEqual([]);}
 const composer=screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true});await composer.fill('  preserve End draft  ');await composer.press('Home');await composer.press('End');
 expect(await calls(browser)).toEqual([]);
 expect(await browser.evaluate(async()=>{const path='/composer-input.js';return (await import(path)).readComposerInput(document.querySelector('#message-input')).text;})).toBe('  preserve End draft  ');
 await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();const command=screen.getByRole('menuitem',{name:'Gespreksbewerking',exact:true});await command.focus();await browser.keyboard.press('End');expect(await calls(browser)).toEqual([]);
 await command.click();const dialog=screen.getByRole('dialog',{name:'Gespreksbewerking',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Annuleren',exact:true}).focus();await browser.keyboard.press('End');expect(await calls(browser)).toEqual([]);await dialog.getByRole('button',{name:'Annuleren',exact:true}).click();
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).focus();await browser.keyboard.press('End');expect(await calls(browser)).toEqual([]);
 expect(await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {count:state.messages.marketing.length,draft:state.drafts.marketing};})).toEqual({count:35,draft:'  preserve End draft  '});
});

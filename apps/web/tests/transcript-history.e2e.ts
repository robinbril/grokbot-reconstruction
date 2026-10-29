import {test,type Browser} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';
import {mkdir,writeFile} from 'node:fs/promises';

const dossier='.e2e/artifacts/history';
type HistoryDiagnostics={pending:unknown;total:number;visible:number;hasOlder:boolean;isLoadingOlder:boolean};
type HistoryWindow=Window&{historyProbeOffset?:number;productSurfaces:{ready:Promise<void>;diagnostics():{modules:{id:string;history?:HistoryDiagnostics}[]}}};
async function boot(app:App,browser:Browser,screen:Screen,kind:'same'|'cross'|'scroll',alreadyOpen=false){
 if(!alreadyOpen)await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as HistoryWindow).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.evaluate(kind=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);
  const rows=(prefix:string,count:number)=>Array.from({length:count},(_,index)=>({id:prefix+index,role:'bot',text:`SYNTHETIC_HISTORY_${prefix}${index}\n\n`+'Owned persisted source. '.repeat(4),createdAt:1000+index}));
  state.messages.marketing=kind==='cross'?[]:rows('history-',750);
  if(kind==='cross')state.messages.customers=rows('other-history-',650);
  if(kind!=='scroll')state.messages.marketing.push({id:'history-quote',role:'user',text:'SYNTHETIC_HISTORY_QUOTE',quote:{messageId:kind==='cross'?'other-history-20':'history-20',...(kind==='cross'?{agentId:'customers'}:{}),title:'Synthetic original source',text:kind==='cross'?'SYNTHETIC_HISTORY_other-history-20':'SYNTHETIC_HISTORY_history-20'}});
  localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
 },kind);
 await browser.reload();await expect(screen.getByRole('button',{name:'Gespreksopties',exact:true})).toBeVisible();
}
async function state(browser:Browser){return browser.evaluate(()=>{
 const viewport=document.querySelector('.transcript')!,modules=(window as HistoryWindow).productSurfaces.diagnostics().modules;
 return {selected:JSON.parse(localStorage.getItem('grok-local-replica-v1')!).selected,rows:viewport.querySelectorAll('.message').length,top:viewport.scrollTop,remaining:viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop,history:modules.find(module=>module.id==='transcript-coordinator')!.history!};
});}
async function centered(browser:Browser,id:string){return browser.evaluate(id=>{
 const viewport=document.querySelector('.transcript')!,row=document.querySelector(`[data-message-id="${id}"]`)!,v=viewport.getBoundingClientRect(),r=row.getBoundingClientRect(),target=Math.max(0,Math.min(viewport.scrollHeight-viewport.clientHeight,viewport.scrollTop+r.top+r.height/2-v.top-viewport.clientHeight/2));
 return {error:Math.abs(viewport.scrollTop-target),inside:r.top>=v.top-1&&r.bottom<=v.bottom+1};
},id);}
async function save(browser:Browser,name:string){await mkdir(dossier,{recursive:true});await writeFile(`${dossier}/${name}.json`,JSON.stringify(await state(browser),null,2)+'\n');}

for(const kind of ['same','cross'] as const)test(`actual ${kind} conversation quote loads older persisted history and centers its exact original`,async({app,browser,screen})=>{
 await boot(app,browser,screen,kind);
 const id=kind==='same'?'history-20':'other-history-20',source=browser.locator(`[data-message-id="${id}"]`);
 await expect(source).toHaveCount(0);if(kind==='same')await expect.poll(async()=>(await state(browser)).rows).toBe(500);
 const quote=screen.getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true});
 await quote.click();
 await expect(source).toBeVisible();await expect(quote).toHaveCount(kind==='same'?1:0);
 await expect.poll(async()=>(await state(browser)).selected).toBe(kind==='same'?'marketing':'customers');
 await expect.poll(async()=>(await centered(browser,id)).error).toBeLessThanOrEqual(1);expect((await centered(browser,id)).inside).toBe(true);
 await expect.poll(async()=>(await state(browser)).history.pending).toBe(null);
 if(kind==='same'){await expect(quote).toBeFocused();expect((await state(browser)).history.visible).toBe(751);}
 else expect((await state(browser)).history.visible).toBe(650);
 await save(browser,`browser-${kind}-quote`);await app.screenshot(`actual-${kind}-older-history-source`);
});

test('physical scrolling near the native600px boundary loads a real older page and preserves the current row anchor',async({app,browser,screen,agent})=>{
 await app.open('/?reset=1');await agent.act('Open Marketing Agent zonder een bericht te verzenden.');
 await expect(screen.getByRole('button',{name:'Gespreksopties',exact:true})).toBeVisible();
 await boot(app,browser,screen,'scroll',true);await expect.poll(async()=>(await state(browser)).rows).toBe(500);
 await expect.poll(async()=>(await state(browser)).remaining).toBeLessThanOrEqual(1);
 const box=await browser.locator('.transcript').boundingBox();if(!box)throw Error('Real transcript has no viewport');await browser.mouse.move(box.x+box.width/2,box.y+box.height/2);
 const bottom=await state(browser);await browser.mouse.wheel(0,650-bottom.top);
 await expect.poll(async()=>Math.abs((await state(browser)).top-650)).toBeLessThanOrEqual(1);
 await expect.poll(async()=>(await state(browser)).rows).toBe(500);
 await browser.evaluate(()=>{
  document.addEventListener('scroll',event=>{
   if(!(event.target instanceof Element)||!event.target.matches('.transcript')||event.target.scrollTop>600||(window as HistoryWindow).historyProbeOffset!==undefined)return;
   const row=document.querySelector('[data-message-id="history-250"]') as HTMLElement;if(!row)return;
   (window as HistoryWindow).historyProbeOffset=row.getBoundingClientRect().top-event.target.getBoundingClientRect().top;
  },{capture:true});
 });
 await browser.mouse.wheel(0,-60);
 await expect.poll(async()=>(await state(browser)).rows).toBe(600);
 await expect(browser.locator('[data-message-id="history-150"]')).toHaveCount(1);
 await expect(browser.locator('[data-message-id="history-149"]')).toHaveCount(0);
 await expect.poll(()=>browser.evaluate(()=>{
  const row=document.querySelector('[data-message-id="history-250"]') as HTMLElement,viewport=document.querySelector('.transcript')!;
  const captured=(window as HistoryWindow).historyProbeOffset;if(captured===undefined)return 100000;
  return Math.abs(row.getBoundingClientRect().top-viewport.getBoundingClientRect().top-captured);
 })).toBeLessThanOrEqual(1);
 expect((await state(browser)).history.hasOlder).toBe(true);await save(browser,'browser-physical-load');await app.screenshot('physical-scroll-loads-real-preceding-history');
});

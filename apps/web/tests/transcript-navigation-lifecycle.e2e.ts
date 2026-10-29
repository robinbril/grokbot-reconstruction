import {test,type Browser} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';
import {mkdir,writeFile} from 'node:fs/promises';

const dossier='.e2e/artifacts/navigation';
const target='[data-message-id="lifecycle-26"]';
type Reader={navigation:{kind:string;navigationId?:number;resolvedTarget?:{targetScrollTopPx:number}};completion?:{navigationId:number;outcome:{kind:string}};mode:{kind:string;rowId?:string};isPinnedToBottom:boolean};
type Gesture={type:string;beforeKind:string;beforeTop:number;afterKind?:string;outcome?:string};
type LifecycleWindow=Window&{productSurfaces:{ready:Promise<void>;setReducedMotion(value:boolean):void;diagnostics():{reader:Reader}};lifecycleGestures:Gesture[]};

async function boot(app:App,browser:Browser,screen:Screen,agent:{act(goal:string):Promise<unknown>}){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as LifecycleWindow).productSurfaces.ready;history.replaceState(null,'','/');});
 await agent.act('Open Marketing Agent zonder een bericht te verzenden.');
 await expect(screen.getByRole('button',{name:'Gespreksopties',exact:true})).toBeVisible();
 await browser.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);
  state.messages.marketing=Array.from({length:30},(_,index)=>({id:'lifecycle-'+index,role:'bot',text:`SYNTHETIC_LIFECYCLE_${index}\n\n`+'Read synthetic source. '.repeat(10)}));
  state.messages.marketing.push({id:'lifecycle-quote',role:'user',text:'SYNTHETIC_LIFECYCLE_QUOTE',quote:{messageId:'lifecycle-26',title:'Synthetic lifecycle source',text:'SYNTHETIC_LIFECYCLE_26'}});
  localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
 });
 await browser.reload();await expect(browser.locator('.message')).toHaveCount(31);
 await browser.evaluate(()=>{
  const w=window as LifecycleWindow,events=new WeakMap<Event,Gesture>();w.productSurfaces.setReducedMotion(false);w.lifecycleGestures=[];
  for(const type of ['wheel','pointerdown'])document.addEventListener(type,event=>{
   if(!(event.target instanceof Element)||!event.target.closest(type==='wheel'?'.transcript':'[data-product-jump-dock]'))return;
   const viewport=document.querySelector('.transcript')!,receipt:Gesture={type,beforeKind:w.productSurfaces.diagnostics().reader.navigation.kind,beforeTop:viewport.scrollTop};
   w.lifecycleGestures.push(receipt);events.set(event,receipt);
  },{capture:true});
  for(const type of ['wheel','pointerdown'])document.addEventListener(type,event=>{const receipt=events.get(event);if(!receipt)return;const reader=w.productSurfaces.diagnostics().reader;receipt.afterKind=reader.navigation.kind;receipt.outcome=reader.completion?.outcome.kind;});
 });
 await expect.poll(async()=>(await observe(browser)).remaining).toBeLessThanOrEqual(1);
}

async function observe(browser:Browser){return browser.evaluate(target=>{
 const w=window as LifecycleWindow,viewport=document.querySelector('.transcript')!,row=document.querySelector(target)!,box=viewport.getBoundingClientRect(),rect=row.getBoundingClientRect();
 const result={reader:w.productSurfaces.diagnostics().reader,top:viewport.scrollTop,remaining:viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop,centerError:Math.abs(rect.top+rect.height/2-box.top-viewport.clientHeight/2),height:rect.height,gestures:w.lifecycleGestures};
 return JSON.parse(JSON.stringify(result)) as typeof result;
},target);}

async function start(browser:Browser,screen:Screen){
 const before=await observe(browser);expect(before.centerError).toBeGreaterThan(80);expect(before.centerError).toBeLessThanOrEqual(599);
 await screen.getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true}).click();
 const active=await observe(browser);expect(active.reader.navigation.kind).toBe('smooth');return active;
}

async function framePositions(browser:Browser){return browser.evaluate(()=>new Promise<number[]>(resolve=>{
 const positions:number[]=[];const sample=()=>{positions.push(document.querySelector('.transcript')!.scrollTop);if(positions.length===8)resolve(positions);else requestAnimationFrame(sample);};requestAnimationFrame(sample);
}));}

async function save(browser:Browser,name:string){await mkdir(dossier,{recursive:true});await writeFile(`${dossier}/lifecycle-${name}.json`,JSON.stringify(await observe(browser),null,2)+'\n');}

test('actual wheel cancels an acquired near spring and retains the observed reader offset',async({app,browser,screen,agent})=>{
 await boot(app,browser,screen,agent);const active=await start(browser,screen);
 await browser.mouse.wheel(0,-60);
 await expect.poll(async()=>(await observe(browser)).reader.completion?.outcome.kind).toBe('user-cancelled');
 const cancelled=await observe(browser),wheel=cancelled.gestures.findLast(event=>event.type==='wheel')!;
 expect(wheel.beforeKind).toBe('smooth');expect(wheel.afterKind).toBe('idle');expect(wheel.outcome).toBe('user-cancelled');
 expect(cancelled.reader.completion?.navigationId).toBe(active.reader.navigation.navigationId);
 const released=await framePositions(browser);expect(Math.max(...released)-Math.min(...released)).toBeLessThanOrEqual(1);
 const stopped=await observe(browser);expect(stopped.reader.navigation.kind).toBe('idle');expect(stopped.reader.isPinnedToBottom).toBe(false);
 expect(stopped.centerError).toBeGreaterThan(1);expect(Math.abs(released.at(-1)!-stopped.top)).toBeLessThanOrEqual(1);
 await browser.mouse.wheel(0,-60);
 await expect.poll(async()=>Math.abs((await observe(browser)).top-(stopped.top-60))).toBeLessThanOrEqual(1);
 const later=await framePositions(browser);expect(Math.max(...later)-Math.min(...later)).toBeLessThanOrEqual(1);expect(Math.abs(later.at(-1)!-(stopped.top-60))).toBeLessThanOrEqual(1);
 expect((await observe(browser)).gestures.findLast(event=>event.type==='wheel')?.beforeKind).toBe('idle');
 await save(browser,'wheel-cancel');await app.screenshot('navigation-wheel-cancelled-at-reader-offset');
});

test('synthetic row geometry growth retargets an acquired spring then preserves the arrived semantic anchor',async({app,browser,screen,agent})=>{
 await boot(app,browser,screen,agent);const active=await start(browser,screen);
 const changed=await browser.evaluate(()=>{
  const reader=(window as LifecycleWindow).productSurfaces.diagnostics().reader;if(reader.navigation.kind!=='smooth')throw Error('Geometry fixture missed active navigation');
  const row=document.querySelector('[data-message-id="lifecycle-25"]') as HTMLElement,height=row.getBoundingClientRect().height;row.dataset.syntheticGeometry='growth-before-target';row.style.minHeight=(height+180)+'px';return height;
 });
 await expect.poll(async()=>(await observe(browser)).reader.navigation.resolvedTarget?.targetScrollTopPx??0).toBeGreaterThan(active.reader.navigation.resolvedTarget!.targetScrollTopPx+170);
 await expect.poll(async()=>(await observe(browser)).reader.completion?.outcome.kind).toBe('target-reached');
 const arrived=await observe(browser);expect(arrived.reader.completion?.navigationId).toBe(active.reader.navigation.navigationId);expect(arrived.reader.mode).toMatchObject({kind:'anchored',rowId:'lifecycle-26'});expect(arrived.centerError).toBeLessThanOrEqual(1);
 await browser.evaluate(height=>{(document.querySelector('[data-message-id="lifecycle-25"]') as HTMLElement).style.minHeight=(height+300)+'px';},changed);
 await expect.poll(async()=>(await observe(browser)).top).toBeGreaterThan(arrived.top+110);
 await expect.poll(async()=>(await observe(browser)).centerError).toBeLessThanOrEqual(1);
 expect((await observe(browser)).reader.mode).toMatchObject({kind:'anchored',rowId:'lifecycle-26'});
 await save(browser,'geometry-retarget');await app.screenshot('navigation-retargeted-and-semantic-anchor-preserved');
});

test('actual latest dock pointerdown cancels navigation and its click repins through synthetic observed row growth',async({app,browser,screen,agent})=>{
 await boot(app,browser,screen,agent);await start(browser,screen);
 const latest=screen.getByRole('button',{name:'Naar laatste bericht',exact:true});await expect(latest).toBeVisible();
 const box=await latest.boundingBox();if(!box)throw Error('Latest dock has no actual clickable box');
 await browser.mouse.move(box.x+box.width/2,box.y+box.height/2);
 expect((await observe(browser)).reader.navigation.kind).toBe('smooth');await browser.mouse.down();
 try{
  const interrupted=await observe(browser),down=interrupted.gestures.findLast(event=>event.type==='pointerdown')!;
  expect(down.beforeKind).toBe('smooth');expect(interrupted.reader.navigation.kind).toBe('idle');expect(interrupted.reader.completion?.outcome.kind).toBe('user-cancelled');expect(interrupted.reader.isPinnedToBottom).toBe(false);
 }finally{await browser.mouse.up();}
 await expect.poll(async()=>(await observe(browser)).reader.isPinnedToBottom).toBe(true);await expect.poll(async()=>(await observe(browser)).remaining).toBeLessThanOrEqual(1);
 const before=await observe(browser);
 await browser.evaluate(()=>{
  const observed=document.querySelector('[data-message-id="lifecycle-quote"] .bubble')!,growth=document.createElement('div');growth.dataset.syntheticGeometry='observed-row-growth-after-repin';growth.textContent='SYNTHETIC_OBSERVED_ROW_GROWTH';growth.style.height='360px';observed.append(growth);
 });
 await expect(screen.getByText('SYNTHETIC_OBSERVED_ROW_GROWTH',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await observe(browser)).top).toBeGreaterThan(before.top+300);await expect.poll(async()=>(await observe(browser)).remaining).toBeLessThanOrEqual(1);
 expect((await observe(browser)).reader.isPinnedToBottom).toBe(true);await save(browser,'latest-dock-repin');await app.screenshot('navigation-latest-repin-survives-synthetic-row-growth');
});

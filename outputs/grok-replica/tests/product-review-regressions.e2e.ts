import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
async function boot(app:any,browser:any,screen:any,select=true){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});if(select)await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();}
async function team(screen:any){await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Team-Bots',exact:true}).click();await screen.getByRole('button',{name:'Team instellen',exact:true}).click();await screen.getByRole('textbox',{name:'Teamnaam',exact:true}).fill('Betrouwbaar team');}
async function task(screen:any){await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');await screen.getByRole('button',{name:'Taak starten',exact:true}).click();}

test('draft started from empty chat obtains a durable reachable conversation owner',async({app,screen,browser})=>{
 await boot(app,browser,screen,false);await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'E-mailconcept',exact:true}).click();
 await screen.getByRole('textbox',{name:'Onderwerp',exact:true}).fill('Blijft bereikbaar');await screen.getByRole('textbox',{name:'Conceptinhoud',exact:true}).fill('Deze tekst verdwijnt niet in een verborgen gesprek');await screen.getByRole('button',{name:'Concept bewaren',exact:true}).click();
 await expect(screen.getByText('Deze tekst verdwijnt niet in een verborgen gesprek',{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {owner:s.agents.some((a:any)=>a.id===s.selected),draft:s.messages[s.selected].some((m:any)=>m.localDraft?.body==='Deze tekst verdwijnt niet in een verborgen gesprek')};})).toEqual({owner:true,draft:true});
 await app.open('/');await expect(screen.getByText('Deze tekst verdwijnt niet in een verborgen gesprek',{exact:true})).toBeVisible();
});

test('rapid team step navigation retires only the outgoing live body',async({app,screen,browser})=>{
 await boot(app,browser,screen);await team(screen);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 expect(await browser.evaluate(()=>[...document.querySelectorAll('[data-team-step] [data-team-body]')].filter(n=>!n.closest('[inert]')).map(n=>n.querySelector('h2')?.textContent??''))).toEqual(['Team voorbereiden']);
});

test('team write failure retains setup instead of acknowledging an unsaved team',async({app,screen,browser})=>{
 await boot(app,browser,screen);await team(screen);await screen.getByRole('button',{name:'Volgende',exact:true}).click();await screen.getByRole('checkbox',{name:'Marketing Agent toevoegen',exact:true}).check();await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 await browser.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1')throw new DOMException('Local test denial','QuotaExceededError');return original.call(this,k,v);};});
 await screen.getByRole('button',{name:'Team maken',exact:true}).click();
 await expect(screen.getByRole('heading',{name:'Team voorbereiden',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).agents.some((a:any)=>a.name==='Betrouwbaar team'))).toBe(false);
});

test('switching reduced motion settles an in-flight onboarding transform',async({app,screen,browser})=>{
 await boot(app,browser,screen);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Introductie',exact:true}).click();
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 expect(await browser.evaluate(()=>{const a=document.querySelector('#overlay')!.getAnimations({subtree:true}).find(a=>a.effect?.getTiming().duration===691&&a.effect!.getKeyframes().some(f=>f.transform!==undefined));if(!a)return false;a.pause();a.currentTime=345.5;return true;})).toBe(true);
 await browser.evaluate(()=>(window as any).productSurfaces.setReducedMotion(true));
 expect(await browser.evaluate(()=>document.querySelector('#overlay')!.getAnimations({subtree:true}).filter(a=>['running','paused'].includes(a.playState)&&a.effect!.getKeyframes().some(f=>f.transform!==undefined)&&Number(a.effect!.getTiming().duration)>1).filter(a=>!((a.effect as KeyframeEffect).target?.matches('.product-demo-block')&&a.effect!.getTiming().duration===150)).map(a=>({target:(a.effect as KeyframeEffect).target?.getAttribute('class')??null,duration:a.effect!.getTiming().duration})))).toEqual([]);
});

test('same running task status retains its actual animation and time through info toggle',async({app,screen,browser})=>{
 await boot(app,browser,screen);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await task(screen);
 const state=await browser.evaluate(()=>{
  const status=document.querySelector('[data-product-run-status]')!;const a=status.getAnimations({subtree:true}).find(a=>Number.isFinite(Number(a.effect!.getTiming().iterations))&&Number(a.effect!.getTiming().duration)>0);
  if(!a)return {hadAnimation:false,sameNode:false,sameAnimation:false,time:null};a.pause();a.currentTime=Number(a.effect!.getTiming().duration)/2;const before=a.currentTime;
  document.querySelector<HTMLElement>('.header-buttons [data-action=toggle-context]')!.click();const next=document.querySelector('[data-product-run-status]');
  return {hadAnimation:true,sameNode:status===next,sameAnimation:Boolean(next?.getAnimations({subtree:true}).includes(a)),time:a.currentTime===before};
 });expect(state).toEqual({hadAnimation:true,sameNode:true,sameAnimation:true,time:true});
});

test('reader departure keeps exclusive source exit branch after global rebinding',async({app,screen,browser})=>{
 await boot(app,browser,screen);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await task(screen);await screen.getByRole('button',{name:'Stoppen',exact:true}).last().click();
 expect(await browser.evaluate(()=>{const disc=document.querySelector('.product-reader-disc');return {exists:Boolean(disc),name:disc?getComputedStyle(disc).animationName:null,duration:disc?getComputedStyle(disc).animationDuration:null,enter:disc?.getAttribute('data-source-instance')?.includes('INSTANCE-204')??false};})).toEqual({exists:true,name:'sand-196fsjt-B',duration:'0.16s',enter:false});
});

test('voice transcript double reversal preserves actual intermediate geometry',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Spraakmemo',exact:true}).click();await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await screen.getByRole('button',{name:'Transcript tonen',exact:true}).click();
 const result=await browser.evaluate(()=>{
  const region=document.querySelector('[aria-label="Spraakmemotranscript"]')!;const toggle=document.querySelector<HTMLElement>('[data-action=product-voice-transcript]')!;
  const midpoint=()=>{const effects=region.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().duration===300);effects.forEach(a=>{a.pause();a.currentTime=150;});return effects.length;};
  const effects=midpoint(),first=region.getBoundingClientRect().height;toggle.click();const after=region.getBoundingClientRect().height;midpoint();const second=region.getBoundingClientRect().height;toggle.click();
  return {effects,firstJump:Math.abs(first-after),secondJump:Math.abs(second-region.getBoundingClientRect().height)};
 });expect(result.effects).toBeGreaterThan(0);expect(result.firstJump).toBeLessThan(.5);expect(result.secondJump).toBeLessThan(.5);
});

test('a new task owns its active status while the previous exit is retained',async({app,screen,browser})=>{
 await boot(app,browser,screen);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await task(screen);await screen.getByRole('button',{name:'Stoppen',exact:true}).last().click();await task(screen);
 expect(await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);const last=state.messages.marketing.filter((m:any)=>m.localRun).at(-1).localRun;const active=[...document.querySelectorAll<HTMLElement>('[data-product-run-status]:not([data-exiting])')];const exiting=[...document.querySelectorAll<HTMLElement>('[data-product-run-status][data-exiting]')];return {active:active.length,owner:active[0]?.dataset.productRunStatus===last.id,exitInert:exiting.every(n=>n.inert&&n.getAttribute('aria-hidden')==='true')};})).toEqual({active:1,owner:true,exitInert:true});
});

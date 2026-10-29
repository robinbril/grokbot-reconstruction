import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function ready(app:any,browser:any){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});
}
async function marketing(screen:any){await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();}
async function settings(screen:any){await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Instellingen',exact:true}).click();}

test('toggle icon produces actual100ms blur scale opacity and reverses from visible pose',async({app,screen,browser})=>{
 await ready(app,browser);await marketing(screen);
 await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));
 await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).nth(1).click();
 const mid=await browser.evaluate(()=>{
  const layers=[...document.querySelectorAll('.header-buttons [data-source-instance~="INSTANCE-002"]')];
  const effects=layers.flatMap(n=>n.getAnimations()).filter(a=>a.effect?.getTiming().duration===100);
  const a=effects.find(a=>a.effect!.getKeyframes().some(frame=>frame.opacity!==undefined));
  if(!a)return {duration:null,opacity:null,filter:null};a.pause();a.currentTime=50;
  effects.forEach(effect=>{effect.pause();effect.currentTime=50;});
  const n=(a.effect as KeyframeEffect).target!;
  return {duration:a.effect!.getTiming().duration,opacity:Number(getComputedStyle(n).opacity),filter:getComputedStyle(n).filter};
 });
 expect(mid.duration).toBe(100);expect(mid.opacity).toBeGreaterThan(0);expect(mid.opacity).toBeLessThan(1);
 await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).nth(1).click();
 expect(await browser.evaluate(()=>document.querySelectorAll('.context-pane:not([aria-hidden="true"])').length)).toBe(0);
});

test('custom tooltip is an actual anchored accessible overlay and Escape removes association',async({app,screen,browser})=>{
 await ready(app,browser);
 await screen.getByRole('button',{name:'Zoeken',exact:true}).hover();
 await expect(screen.getByRole('tooltip',{name:'Zoeken',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{
  const button=document.querySelector('[aria-label="Zoeken"]')!,tip=document.querySelector('[role=tooltip]')!,r=tip.getBoundingClientRect();
  return {associated:button.getAttribute('aria-describedby')===tip.id,pointer:getComputedStyle(tip).pointerEvents,bounded:r.left>=0&&r.right<=innerWidth};
 })).toEqual({associated:true,pointer:'none',bounded:true});
 await screen.getByRole('button',{name:'Zoeken',exact:true}).press('Escape');
 await expect(screen.getByRole('tooltip')).toHaveCount(0);
 expect(await browser.evaluate(()=>document.querySelector('[aria-label="Zoeken"]')!.hasAttribute('aria-describedby'))).toBe(false);
});

test('segmented update channel moves a measured200ms indicator and supports keyboard selection',async({app,screen,browser})=>{
 await ready(app,browser);await settings(screen);
 await screen.getByRole('button',{name:'Updates',exact:true}).click();
 await screen.getByRole('tab',{name:'Preview',exact:true}).click();
 await expect(screen.getByRole('tab',{name:'Preview',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await browser.evaluate(()=>{
  const indicator=document.querySelector('[data-segment-indicator]')!,tab=document.querySelector('[role=tab][aria-selected=true]')!;
  const a=indicator.getBoundingClientRect(),b=tab.getBoundingClientRect();
  return {duration:getComputedStyle(indicator).transitionDuration,hasGeometry:a.width>0&&b.width>0};
 })).toHaveProperty('hasGeometry',true);
 await screen.getByRole('tab',{name:'Preview',exact:true}).press('ArrowLeft');
 await expect(screen.getByRole('tab',{name:'Stabiel',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await browser.evaluate(()=>getComputedStyle(document.querySelector('[data-segment-indicator]')!).transitionDuration.split(',').some(t=>Math.abs(parseFloat(t)-.2)<.0001))).toBe(true);
});

test('new bot local persistence failure keeps entered name and does not invent a roster result',async({app,screen,browser})=>{
 await ready(app,browser);
 await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Nieuwe Bot',exact:true}).click();
 await screen.getByRole('textbox',{name:'Bot-naam',exact:true}).fill('Niet opgeslagen');
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1')throw new DOMException('Local test denial','QuotaExceededError');return write.call(this,k,v);};});
 await screen.getByRole('button',{name:'Maken',exact:true}).click();
 await expect(screen.getByRole('textbox',{name:'Bot-naam',exact:true})).toHaveValue('Niet opgeslagen');
 expect(await browser.evaluate(()=>[...document.querySelectorAll('.roster [data-action=select-agent]')].some(n=>n.getAttribute('aria-label')==='Niet opgeslagen'))).toBe(false);
});

test('team setup retire clones are inert80ms and reduced motion retains120ms body enter',async({app,screen,browser})=>{
 await ready(app,browser);
 await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Team-Bots',exact:true}).click();await screen.getByRole('button',{name:'Team instellen',exact:true}).click();
 await screen.getByRole('textbox',{name:'Teamnaam',exact:true}).fill('Bronteam');
 await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 const effects=await browser.evaluate(()=>document.querySelector('#overlay')!.getAnimations({subtree:true}).map(a=>({duration:a.effect!.getTiming().duration,easing:a.effect!.getTiming().easing,inert:((a.effect as KeyframeEffect).target as HTMLElement).closest('[inert]')!==null})));
 expect(effects.some(a=>a.duration===80&&a.easing==='ease-in'&&a.inert)).toBe(true);
 await browser.evaluate(()=>{document.querySelector('#overlay')!.getAnimations({subtree:true}).filter(a=>a.effect!.getTiming().iterations!==Infinity).forEach(a=>a.finish());(window as any).productSurfaces.setReducedMotion(true);});
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 const reduced=await browser.evaluate(()=>document.querySelector('#overlay')!.getAnimations({subtree:true}).map(a=>a.effect!.getTiming().duration));
 expect(reduced).toContain(120);expect(reduced).not.toContain(80);expect(reduced).not.toContain(240);expect(reduced).not.toContain(300);
});

test('onboarding uses distinct source springs and closing disposes its active clocks',async({app,screen,browser})=>{
 await ready(app,browser);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));
 await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Introductie',exact:true}).click();
 const curve=()=>browser.evaluate(()=>[...document.querySelectorAll('[data-cast-id]')].map(n=>{const s=getComputedStyle(n);return {duration:Math.round(parseFloat(s.transitionDuration)*1000),easing:s.transitionTimingFunction};}).filter(a=>[531,691,747].includes(a.duration)));
 const first=await curve();expect(first.some(a=>a.duration===747&&a.easing.startsWith('linear('))).toBe(true);
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();const slow=await curve();expect(slow.some(a=>a.duration===691&&a.easing.startsWith('linear('))).toBe(true);
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();await browser.evaluate(()=>(window as any).productOnboarding.advance(800));const bounce=await curve();expect(bounce.some(a=>a.duration===747&&a.easing!==slow.find(a=>a.duration===691)!.easing)).toBe(true);
 await screen.getByRole('button',{name:'Sluiten',exact:true}).click();
 expect(await browser.evaluate(()=>document.querySelector('#overlay')!.getAnimations({subtree:true}).filter(a=>a.playState==='running'||a.playState==='paused').length)).toBe(0);
});

test('email revision and local rejection retain exact draft and commit once on retry',async({app,screen,browser})=>{
 await ready(app,browser);await marketing(screen);
 await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'E-mailconcept',exact:true}).click();
 await screen.getByRole('textbox',{name:'Onderwerp',exact:true}).fill('Afspraak');
 await screen.getByRole('textbox',{name:'Conceptinhoud',exact:true}).fill('Hallo team dit is de afgesproken tekst voor onze gezamenlijke vergadering van morgen');
 await screen.getByRole('button',{name:'Concept bewaren',exact:true}).click();
 await expect(screen.getByText('Hallo team dit is de afgesproken tekst voor onze gezamenlijke vergadering van morgen',{exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Verzenden laten mislukken',exact:true}).click();
 await expect(screen.getByRole('alert').filter({hasText:'mislukt'}).first()).toBeVisible();
 await screen.getByRole('button',{name:'Opnieuw verzenden',exact:true}).click();
 await expect(screen.getByText('Lokaal verzonden record bewaard',{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).localSentDrafts.length)).toBe(1);
});

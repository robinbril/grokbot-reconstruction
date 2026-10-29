// Source-bound actual product regression:  source-oracle M11–M15. Main application workflows only.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
// Immutable native light :root/.sand-1wuigm2 palette; do not inject missing production tokens.
async function expectColor(browser:any,value:string,expected:number[]){
 // Browser-native, non-rasterizing conversion preserves alpha and source precision.
 // CSS Color5 relative color syntax: https://www.w3.org/TR/css-color-5/#relative-color-syntax
 if(value.startsWith('oklab('))value=await browser.evaluate((color:string)=>{
  const css=`color(from ${color} srgb r g b / alpha)`;if(!CSS.supports('color',css))throw Error('Browser lacks lossless relative color normalization');
  const probe=document.createElement('span');probe.hidden=true;probe.style.color=css;document.body.append(probe);
  try{return getComputedStyle(probe).color;}finally{probe.remove();}
 },value);
 const srgb=value.match(/^color\(srgb\s+([^)]*)\)$/);let actual:number[];
 if(srgb){const [rgb,alpha]=srgb[1].split('/');actual=[...rgb.trim().split(/\s+/).map(n=>Number(n)*255),alpha===undefined?1:Number(alpha.trim())];}
 else{const match=value.match(/^rgba?\(([^)]*)\)$/);if(!match)throw Error('Unexpected actual computed color: '+value);actual=match[1].split(',').map(Number);if(actual.length===3)actual.push(1);}
 for(let i=0;i<3;i++)expect(actual[i]).toBeCloseTo(expected[i],1);expect(Math.round(actual[3]*255)).toBe(Math.round(expected[3]*255));
}

async function boot(app:any,b:any,s:any,reduced=false){await app.open('/?reset=1');await b.evaluate(async(r:boolean)=>{await (window as any).productSurfaces.ready;(window as any).productSurfaces.setReducedMotion(r);},reduced);await s.getByRole('button',{name:'Marketing Agent',exact:true}).click();}
async function finish(b:any){await b.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(Number(a.effect?.getTiming().iterations)))try{a.finish();}catch{}});}
async function arm(b:any,selector:string,property:string){await b.evaluate(({selector,property}:any)=>{const w=window as any;w.__motion=null;const listener=(e:TransitionEvent)=>{const n=e.target as Element;if(!n.matches(selector)||e.propertyName!==property||e.pseudoElement)return;const a=n.getAnimations().find(a=>a instanceof CSSTransition&&a.transitionProperty===property&&(a.effect as KeyframeEffect).target===n&&(a.effect as KeyframeEffect).pseudoElement===null);if(!a)return;a.pause();a.currentTime=0;w.__motion={a,n};document.removeEventListener('transitionrun',listener,true);};document.addEventListener('transitionrun',listener,true);}, {selector,property});}
async function motion(b:any,property:string){await expect.poll(()=>b.evaluate(()=>Boolean((window as any).__motion))).toBe(true);return b.evaluate((property:string)=>{const {a,n}=(window as any).__motion,t=a.effect.getTiming(),child=n.querySelector('.product-quote-preview'),childPoses:string[]=[],poses=[0,.5,1].map(p=>{a.currentTime=Number(t.duration)*p;if(child)childPoses.push(getComputedStyle(child).getPropertyValue(property));return getComputedStyle(n).getPropertyValue(property);});a.finish();return {duration:t.duration,easing:getComputedStyle(n).transitionTimingFunction,poses,childPoses};},property);}
async function send(s:any,text:string){await s.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).fill(text);await s.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).press('Enter');}

// M11 actual gallery bytes; hold completion of its REAL decode, never a fake loader timer.
test('M11 real gallery skeleton owns1400ms shimmer then actual decoded image reveals180ms',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/profile.png']);await browser.evaluate(()=>{const w=window as any;w.__originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){const p=w.__originalDecode.call(this);if(!this.matches('[data-media-image]'))return p;return p.then(()=>new Promise<void>(resolve=>{w.__releaseMediaDecode=resolve;}));};(window as any).productSurfaces.setInspect(true);});
  await screen.getByRole('button',{name:'Bijlage openen: profile.png',exact:true}).click();await expect(browser.locator('[data-media-skeleton]')).toHaveCount(1);
  const m=await browser.evaluate(()=>{const n=document.querySelector('[data-media-skeleton]')!,s=getComputedStyle(n),a=n.getAnimations().find(a=>a instanceof CSSAnimation&&a.animationName==='sand-1fny1my-B');const poses=a?[0,700,1399.999].map(t=>{a.pause();a.currentTime=t;return getComputedStyle(n).backgroundPosition;}):[];return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,iterations:s.animationIterationCount,poses,gradient:s.backgroundImage,size:s.backgroundSize};});
  expect(m.gradient).toContain('linear-gradient(100deg');expect(m.size).toBe('200% 100%');if(reduced)expect(m.name).toBe('none');else{expect(m.name).toBe('sand-1fny1my-B');expect(m.duration).toBe('1.4s');expect(m.easing).toBe('ease-in-out');expect(m.iterations).toBe('infinite');expect(parseFloat(m.poses[0])).toBe(200);expect(parseFloat(m.poses[1])).toBeCloseTo(0,3);expect(parseFloat(m.poses[2])).toBeCloseTo(-200,3);}
  await finish(browser);await expect.poll(()=>browser.evaluate(()=>typeof(window as any).__releaseMediaDecode)).toBe('function');await arm(browser,'[data-media-image]','opacity');await browser.evaluate(()=>{const w=window as any;HTMLImageElement.prototype.decode=w.__originalDecode;w.__releaseMediaDecode();});const reveal=await motion(browser,'opacity');expect(reveal.duration).toBe(180);expect(reveal.easing).toBe('ease');expect(reveal.poses[0]).toBe('0');expect(reveal.poses[2]).toBe('1');await expect(browser.locator('[data-media-skeleton]')).toBeHidden();
  expect(await browser.evaluate(()=>{const n=document.querySelector('[data-media-image]') as HTMLImageElement;return {decoded:n.naturalWidth===1,blob:n.src.startsWith('blob:')};})).toEqual({decoded:true,blob:true});
 }
});

// M12 native197 onUserBubble branch:color80% of user text ->100%,120ms ease.
// A real main-conversation bot entry is generated from an actual user message.
test('M12 actual sent reply quote hovers with120ms color and jumps to its exact original',async({app,screen,browser})=>{
 await boot(app,browser,screen);await send(screen,'Maak een origineel voor dit antwoord');await finish(browser);
 const original=await browser.locator('.message.bot').last().getAttribute('data-message-id');await browser.locator('.message.bot').last().click();await browser.locator('.message.bot').last().hover();await browser.locator('.message.bot').last().getByRole('button',{name:'Beantwoorden',exact:true}).click();await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toBeVisible();await send(screen,'Dit is mijn echte antwoord');await finish(browser);await browser.mouse.move(1,1);
 const quote=screen.getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true});await expect(quote).toHaveAttribute('data-quote-message-id',original!);const parentStyle=await browser.evaluate(()=>{const n=document.querySelector('.reply-quote > .product-quote-jump')!.closest('.bubble')!;const s=getComputedStyle(n);return {background:s.backgroundColor,text:s.color};});await expectColor(browser,parentStyle.background,[28,28,28,1]);await expectColor(browser,parentStyle.text,[255,255,255,1]);await arm(browser,'.reply-quote > .product-quote-jump','color');await quote.hover();const m=await motion(browser,'color');expect(m.duration).toBe(120);expect(m.easing).toBe('ease');expect(m.poses[0]).not.toBe(m.poses[2]);expect(m.poses[1]).not.toBe(m.poses[0]);await expectColor(browser,m.poses[0],[255,255,255,.8]);await expectColor(browser,m.poses[2],[255,255,255,1]);expect(m.childPoses).toHaveLength(3);expect(m.childPoses).toEqual(m.poses);
 await quote.press('Enter');await expect(browser.locator('.message.product-quote-flash')).toHaveAttribute('data-message-id',original!);
});

// M13 main conversation outline259. No help conversation examples or task258 aliases.
test('M13 actual conversation outline tab background transitions120ms and filters its real items',async({app,screen,browser})=>{
 await boot(app,browser,screen);await send(screen,'Vind deze eigen tekst in mijn inhoud');await finish(browser);await screen.getByRole('button',{name:'Gespreksopties',exact:true}).click();await screen.getByRole('menuitem',{name:'Gespreksinhoud',exact:true}).click();await finish(browser);await browser.mouse.move(1,1);
 await arm(browser,'[data-action=product-outline-tab][data-value=messages]','background-color');await screen.getByRole('tab',{name:'Berichten',exact:true}).hover();const m=await motion(browser,'background-color');expect(m.duration).toBe(120);expect(m.easing).toBe('ease');expect(m.poses[0]).not.toBe(m.poses[2]);await expectColor(browser,m.poses[2],[28,28,28,.07]);
 await screen.getByRole('tab',{name:'Berichten',exact:true}).click();await expect(screen.getByRole('tab',{name:'Berichten',exact:true})).toHaveAttribute('aria-selected','true');await expect(screen.getByRole('tree')).toContainText('Vind deze eigen tekst');await screen.getByRole('tab',{name:'Berichten',exact:true}).press('End');await expect(screen.getByRole('tab',{name:'Taken',exact:true})).toHaveAttribute('aria-selected','true');await expect(screen.getByText('Geen items in deze categorie.',{exact:true})).toBeVisible();
});

// M14 exported308 popup style is compatible generic role, caller remains source frontier.
// Timing source100ms; reduced duration .01ms. Local300ms opening timer is NOT a source oracle.
test('M14 actual anchored tooltip enters at scale0.98 over100ms or reduced0.01ms',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await screen.getByRole('button',{name:'Zoeken',exact:true}).hover();await expect(screen.getByRole('tooltip',{name:'Zoeken',exact:true})).toHaveCount(1);
  const m=await browser.evaluate(()=>{const n=document.querySelector('[role=tooltip]')!,s=getComputedStyle(n),a=n.getAnimations().find(a=>(a as CSSAnimation).animationName==='ui-1j3rbwo-B');let scales:number[]=[];if(a){a.pause();scales=[0,100].map(t=>{a.currentTime=t;return new DOMMatrix(getComputedStyle(n).transform).a;});a.finish();}return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,transition:s.transitionDuration,scales,associated:document.querySelector('[aria-label="Zoeken"]')!.getAttribute('aria-describedby')===n.id,pointer:s.pointerEvents};});
  expect(m.name).toBe('ui-1j3rbwo-B');expect(parseFloat(m.duration)*1000).toBe(reduced?.01:100);expect(parseFloat(m.transition)*1000).toBe(reduced?.01:100);expect(m.easing).toBe('cubic-bezier(0.16, 1, 0.3, 1)');expect(m.associated).toBe(true);expect(m.pointer).toBe('none');if(!reduced)expect(m.scales).toEqual([.98,1]);
  await screen.getByRole('button',{name:'Zoeken',exact:true}).press('Escape');await expect(screen.getByRole('tooltip')).toHaveCount(0);await expect(screen.getByRole('button',{name:'Zoeken',exact:true})).not.toHaveAttribute('aria-describedby');
 }
});

// M15 source323 has150ms default ease, no reduced override class in actual close style.
test('M15 actual settings close control owns150ms hover then closes and restores invoker',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Instellingen',exact:true}).click();await finish(browser);await browser.mouse.move(1,1);await arm(browser,'#overlay [data-action=close-modal]','background-color');await screen.getByRole('button',{name:'Sluiten',exact:true}).hover();const m=await motion(browser,'background-color');expect(m.duration).toBe(150);expect(m.easing).toBe('ease');expect(m.poses[0]).not.toBe(m.poses[2]);expect(m.poses[1]).not.toBe(m.poses[0]);await expectColor(browser,m.poses[2],[28,28,28,15/255]);await screen.getByRole('button',{name:'Sluiten',exact:true}).click();await expect(screen.getByRole('dialog',{name:'Instellingen',exact:true})).toHaveCount(0);await expect(screen.getByRole('button',{name:'Accountmenu',exact:true})).toBeFocused();
});

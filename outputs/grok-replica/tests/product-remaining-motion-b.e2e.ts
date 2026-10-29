// Source-bound actual product regression:  independent source-oracle cases M06–M10. No execution/pass claim.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
// Immutable native light :root/.sand-1wuigm2 palette; do not inject missing production tokens.
function expectColor(value:string,expected:number[]){
 const srgb=value.match(/^color\(srgb\s+([^)]*)\)$/);let actual:number[];
 if(srgb){const [rgb,alpha]=srgb[1].split('/');actual=[...rgb.trim().split(/\s+/).map(n=>Number(n)*255),alpha===undefined?1:Number(alpha.trim())];}
 else{const match=value.match(/^rgba?\(([^)]*)\)$/);if(!match)throw Error('Unexpected actual computed color: '+value);actual=match[1].split(',').map(Number);if(actual.length===3)actual.push(1);}
 for(let i=0;i<3;i++)expect(actual[i]).toBeCloseTo(expected[i],1);expect(Math.round(actual[3]*255)).toBe(Math.round(expected[3]*255));
}

async function boot(app:any,b:any,s:any,reduced=false){await app.open('/?reset=1');await b.evaluate(async(r:boolean)=>{await (window as any).productSurfaces.ready;(window as any).productSurfaces.setReducedMotion(r);},reduced);await s.getByRole('button',{name:'Marketing Agent',exact:true}).click();}
async function finish(b:any){await b.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(Number(a.effect?.getTiming().iterations)))try{a.finish();}catch{}});}
async function arm(b:any,selector:string,property:string){await b.evaluate(({selector,property}:any)=>{const w=window as any;w.__motion=null;const listener=(e:TransitionEvent)=>{const n=e.target as Element;if(!n.matches(selector)||e.propertyName!==property||e.pseudoElement)return;const a=n.getAnimations().find(a=>a instanceof CSSTransition&&a.transitionProperty===property&&(a.effect as KeyframeEffect).target===n&&(a.effect as KeyframeEffect).pseudoElement===null);if(!a)return;a.pause();a.currentTime=0;w.__motion={a,n};document.removeEventListener('transitionrun',listener,true);};document.addEventListener('transitionrun',listener,true);}, {selector,property});}
async function motion(b:any,property:string){await expect.poll(()=>b.evaluate(()=>Boolean((window as any).__motion))).toBe(true);return b.evaluate((property:string)=>{const {a,n}=(window as any).__motion,t=a.effect.getTiming(),poses=[0,.5,1].map(p=>{a.currentTime=Number(t.duration)*p;return getComputedStyle(n).getPropertyValue(property);});a.finish();return {duration:t.duration,easing:getComputedStyle(n).transitionTimingFunction,poses};},property);}

// M06 source Kt=80; compact is translateY36 scale.7, top origin; reduced none/0s.
test('M06 saved team actual detail mark animates200ms into child compact pose normal and reduced',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Team-Bots',exact:true}).click();await screen.getByRole('button',{name:'Team instellen',exact:true}).click();await screen.getByRole('textbox',{name:'Teamnaam',exact:true}).fill('Motion team');await screen.getByRole('button',{name:'Volgende',exact:true}).click();await screen.getByRole('checkbox',{name:'Marketing Agent toevoegen',exact:true}).check();await screen.getByRole('button',{name:'Volgende',exact:true}).click();await screen.getByRole('button',{name:'Team maken',exact:true}).click();
  await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Team-Bots',exact:true}).click();await screen.getByRole('dialog',{name:'Team-Bots',exact:true}).getByRole('button',{name:'Motion team',exact:true}).click();await finish(browser);
  expect(await browser.evaluate(()=>{const n=document.querySelector('[data-team-detail-mark]')!,s=getComputedStyle(n);return {width:s.width,height:s.height,origin:s.transformOrigin};})).toEqual({width:'80px',height:'80px',origin:'40px 0px'});
  if(!reduced)await arm(browser,'[data-team-detail-mark]','transform');await screen.getByRole('button',{name:'Vaardigheden',exact:true}).click();await expect(screen.getByRole('heading',{name:'Vaardigheden',exact:true})).toBeVisible();
  if(!reduced){const m=await motion(browser,'transform');expect(m.duration).toBe(200);expect(m.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');expect(m.poses[0]).toBe('matrix(1, 0, 0, 1, 0, 0)');expect(m.poses[2]).toBe('matrix(0.7, 0, 0, 0.7, 0, 36)');expect(m.poses[1]).not.toBe(m.poses[0]);}else{expect(await browser.evaluate(()=>getComputedStyle(document.querySelector('[data-team-detail-mark]')!).transitionProperty)).toBe('none');expect(await browser.evaluate(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('[data-team-detail-mark]')!).transform);return {scale:m.a,y:m.f};})).toEqual({scale:.7,y:36});}
  await screen.getByRole('button',{name:'Terug naar teamoverzicht',exact:true}).click();await finish(browser);expect(await browser.evaluate(()=>new DOMMatrix(getComputedStyle(document.querySelector('[data-team-detail-mark]')!).transform).a)).toBe(1);
 }
});

// M07 real image.decode is allowed to do its work; only its completion is held.
// Upload adds this successfully decoded image to cache:065 immediate-load is legitimate.
test('M07 actual profile overlay transitions140ms and remains visible while real decode is pending',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Profielfoto wijzigen',exact:true}).click();await finish(browser);await browser.mouse.move(1,1);
 await arm(browser,'[data-testid=account-photo-overlay]','opacity');await screen.getByRole('button',{name:'Profielfoto wijzigen',exact:true}).hover();const m=await motion(browser,'opacity');expect(m.duration).toBe(140);expect(m.easing).toBe('ease');expect(m.poses.map(Number)).toEqual([0,Number(m.poses[1]),1]);expect(Number(m.poses[1])).toBeGreaterThan(0);expect(Number(m.poses[1])).toBeLessThan(1);
 await browser.evaluate(()=>{const w=window as any;w.__originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){const p=w.__originalDecode.call(this);if(!this.src.startsWith('data:image/'))return p;return p.then(()=>new Promise<void>(resolve=>{w.__releaseProfileDecode=resolve;}));};});
 await browser.locator('[data-profile-input]').setInputFiles(['tests/fixtures/profile.png']);await expect(screen.getByRole('button',{name:'Profielfoto wijzigen',exact:true})).toHaveAttribute('aria-busy','true');await browser.mouse.move(1,1);await finish(browser);expect(await browser.evaluate(()=>getComputedStyle(document.querySelector('[data-testid=account-photo-overlay]')!).opacity)).toBe('1');
 await expect.poll(()=>browser.evaluate(()=>typeof(window as any).__releaseProfileDecode)).toBe('function');await browser.evaluate(()=>{const w=window as any;HTMLImageElement.prototype.decode=w.__originalDecode;w.__releaseProfileDecode();});await expect(screen.getByRole('status').filter({hasText:'Profielfoto opgeslagen.'})).toBeVisible();
 expect(await browser.evaluate(()=>{const n=document.querySelector('.product-profile-photo-button [data-profile-image]') as HTMLImageElement;return {loaded:n.hasAttribute('data-loaded'),decoded:n.naturalWidth>0,opacity:getComputedStyle(n).opacity};})).toEqual({loaded:true,decoded:true,opacity:'1'});
});

// M08 actual bubble question080 and custom-submit082; no elevated081 union.
test('M08 question and custom answer own their source entry poses normal and reduced',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');await screen.getByRole('checkbox',{name:'Uitvoervorm kiezen',exact:true}).check();await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));await screen.getByRole('button',{name:'Taak starten',exact:true}).click();
  await expect(browser.locator('.product-output-question')).toHaveCount(1);
  const m=await browser.evaluate(()=>{const n=document.querySelector('.product-output-question [data-source-instance~="INSTANCE-080"]')!,s=getComputedStyle(n),a=n.getAnimations().find(a=>a instanceof CSSAnimation&&a.animationName===s.animationName);if(!a)throw Error('Missing real widget entry');a.pause();a.currentTime=0;const start={o:Number(getComputedStyle(n).opacity),matrix:getComputedStyle(n).transform};a.finish();return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,fill:s.animationFillMode,start,endOpacity:Number(getComputedStyle(n).opacity)};});
  expect(m.name).toBe(reduced?'sand-18re5ia-B':'sand-168qp9p-B');expect(m.duration).toBe(reduced?'0.12s':'0.32s');expect(m.easing).toBe(reduced?'ease-out':'cubic-bezier(0.22, 1, 0.36, 1)');expect(m.fill).toBe('backwards');expect(m.start.o).toBe(0);expect(m.endOpacity).toBe(1);if(!reduced)expect(m.start.matrix).toBe('matrix(0.985, 0, 0, 0.985, 0, 8)');
  // Finish every finite ancestor reveal before trying to click within clipped content.
  await finish(browser);await screen.getByRole('textbox',{name:'Eigen inleiding',exact:true}).fill('Mijn antwoord');await screen.getByRole('button',{name:'Eigen antwoord gebruiken',exact:true}).click();await browser.evaluate(()=>(window as any).productSurfaces.setInspect(false));await expect(browser.locator('[data-run-output]').last()).toContainText('Mijn antwoord');await expect(browser.locator('[data-run-output]').last()).toContainText('3 woorden');
 }
});

// M09 a real checkbox input configures task behavior. Native indicator internals are frontier.
test('M09 actual task checkbox changes background with fast100ms or reduced0.01ms',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();await finish(browser);if(!reduced)await arm(browser,'input[name=chooseFormat]','background-color');await screen.getByRole('checkbox',{name:'Uitvoervorm kiezen',exact:true}).check();await expect(screen.getByRole('checkbox',{name:'Uitvoervorm kiezen',exact:true})).toBeChecked();if(!reduced){const m=await motion(browser,'background-color');expect(m.duration).toBe(100);expect(m.easing).toBe('ease');expect(m.poses[0]).not.toBe(m.poses[2]);}else{const css=await browser.evaluate(()=>{const n=document.querySelector('input[name=chooseFormat]') as HTMLInputElement,s=getComputedStyle(n);return {duration:s.transitionDuration,checked:n.checked};});expect(parseFloat(css.duration)*1000).toBe(.01);expect(css.checked).toBe(true);}
  await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('echte keuze');await screen.getByRole('button',{name:'Taak starten',exact:true}).click();await expect(screen.getByText('Hoe wil je het resultaat zien?',{exact:true})).toBeVisible();
 }
});

// M10 source153 resize LINE hover, retained120ms under reduced; then real pointer resize.
test('M10 actual info resize line transitions120ms on hover and pointer drag persists width',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();await finish(browser);await browser.mouse.move(1,1);await arm(browser,'.product-info-resize-line','background-color');await screen.getByRole('separator',{name:'Breedte van gespreksdetails',exact:true}).hover();const m=await motion(browser,'background-color');expect(m.duration).toBe(120);expect(m.easing).toBe('ease');expect(m.poses[0]).not.toBe(m.poses[2]);expectColor(m.poses[0],[28,28,28,20/255]);expectColor(m.poses[2],[28,28,28,61/255]);
 const grip=screen.getByRole('separator',{name:'Breedte van gespreksdetails',exact:true});await grip.press('Home');await expect(grip).toHaveAttribute('aria-valuenow','240');await expect.poll(()=>browser.evaluate(()=>document.querySelector('.context-pane')!.getBoundingClientRect().width)).toBeCloseTo(240,1);const box=await browser.locator('.product-info-resize').boundingBox();if(!box)throw Error('Missing actual info resize grip');await browser.mouse.move(box.x+box.width/2,box.y+box.height/2);await browser.mouse.down();await browser.mouse.move(box.x+box.width/2-40,box.y+box.height/2);await browser.mouse.up();await expect(grip).toHaveAttribute('aria-valuenow','280');await app.open('/');expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).infoPaneWidth)).toBe(280);
});

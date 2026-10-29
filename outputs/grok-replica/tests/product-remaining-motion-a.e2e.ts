// Source-bound actual product regression:  adopt under tests/ after independent source review; never a pass receipt.
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
async function pane(s:any,name:string){await s.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();await s.getByRole('tab',{name,exact:true}).click();}
async function attach(s:any,name:string){await s.getByRole('button',{name:'Bijvoegen',exact:true}).click();await s.getByRole('menuitem',{name,exact:true}).click();}
async function finish(b:any){await b.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(Number(a.effect?.getTiming().iterations)))try{a.finish();}catch{}});}
// Capture the browser's REAL CSS transition before wall-clock delay can consume it.
async function arm(b:any,selector:string,property:string,pseudo=''){await b.evaluate(({selector,property,pseudo}:any)=>{const w=window as any;w.__motion=null;const listener=(e:TransitionEvent)=>{const n=e.target as Element;if(!n.matches(selector)||e.propertyName!==property||e.pseudoElement!==pseudo)return;const a=n.getAnimations({subtree:true}).find(a=>a instanceof CSSTransition&&a.transitionProperty===property&&(a.effect as KeyframeEffect).target===n&&(a.effect as KeyframeEffect).pseudoElement===(pseudo||null));if(!a)return;a.pause();a.currentTime=0;w.__motion={a,n,pseudo};document.removeEventListener('transitionrun',listener,true);};document.addEventListener('transitionrun',listener,true);}, {selector,property,pseudo});}
async function motion(b:any,property:string){await expect.poll(()=>b.evaluate(()=>Boolean((window as any).__motion))).toBe(true);return b.evaluate((property:string)=>{const {a,n,pseudo}=(window as any).__motion,t=a.effect.getTiming(),poses=[0,.5,1].map(p=>{a.currentTime=Number(t.duration)*p;return getComputedStyle(n,pseudo||null).getPropertyValue(property);});a.finish();return {duration:t.duration,easing:getComputedStyle(n,pseudo||null).transitionTimingFunction,poses};},property);}

// M01:017 is genuinely asleep, not the unrelated preview cursor or recording055.
test('M01 main computer asleep avatar owns2400ms breath or reduced none and opens its actual preview',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await pane(screen,'Computer');
  const poses=await browser.evaluate(()=>{const n=document.querySelector('.product-computer-asleep-wrapper')!,s=getComputedStyle(n),a=n.getAnimations().find(a=>(a as CSSAnimation).animationName==='sand-12vywve-B');if(!a)return {name:s.animationName};a.pause();const pose=(t:number)=>{a.currentTime=t;const s=getComputedStyle(n);return {opacity:Number(s.opacity),scale:new DOMMatrix(s.transform).a};};return {name:s.animationName,duration:a.effect!.getTiming().duration,easing:s.animationTimingFunction,iterations:String(a.effect!.getTiming().iterations),p:[pose(0),pose(1200),pose(2400)]};});
  if(reduced)expect(poses.name).toBe('none');else expect(poses).toEqual({name:'sand-12vywve-B',duration:2400,easing:'ease-in-out',iterations:'Infinity',p:[{opacity:.85,scale:1},{opacity:1,scale:1.04},{opacity:.85,scale:1}]});
  await screen.getByRole('button',{name:'Computervoorbeeld openen',exact:true}).click();await expect(screen.getByRole('button',{name:'Opname starten',exact:true})).toBeVisible();
 }
});

// M02: source hn(direction=above) selects +4px ui-gcq4cg-B, NOT both animation names.
test('M02 actual document selection enters once and formatting changes selected text normal and reduced',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await pane(screen,'Bibliotheek');await screen.getByRole('button',{name:'Nieuw document',exact:true}).click();await screen.getByRole('textbox',{name:'Documentinhoud',exact:true}).fill('exacte selectie');
  await browser.evaluate(()=>{(window as any).productSurfaces.setInspect(true);const e=document.querySelector('[aria-label="Documentinhoud"]')!,r=document.createRange();r.selectNodeContents(e);getSelection()!.removeAllRanges();getSelection()!.addRange(r);e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  const result=await browser.evaluate(()=>{const n=document.querySelector('[data-document-selection-actions]')!,s=getComputedStyle(n),a=n.getAnimations().find(a=>a instanceof CSSAnimation&&a.animationName===s.animationName);let poses:any[]=[];if(a){a.pause();poses=[0,100].map(t=>{a.currentTime=t;const s=getComputedStyle(n);return {o:Number(s.opacity),y:new DOMMatrix(s.transform).f};});}return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,fill:s.animationFillMode,poses};});
  if(reduced)expect(result.name).toBe('none');else expect(result).toEqual({name:'ui-gcq4cg-B',duration:'0.1s',easing:'cubic-bezier(0.165, 0.84, 0.44, 1)',fill:'both',poses:[{o:0,y:4},{o:1,y:0}]});
  await finish(browser);await screen.getByRole('button',{name:'Vetmaken',exact:true}).click();await expect(browser.locator('[aria-label="Documentinhoud"] strong')).toHaveText('exacte selectie');await expect(screen.getByRole('button',{name:'Vetmaken',exact:true})).toHaveAttribute('aria-pressed','true');
 }
});

// M03:028 arrow is a real child of byte-backed draft artifact; anchor pseudo025 remains separate.
test('M03 saved draft artifact arrow reveals with120ms ease-out before actual failure and retry',async({app,screen,browser})=>{
 await boot(app,browser,screen);
 // Observe the actual Blob behind the real user-visible URL. Reading the Blob
 // object avoids a test-only fetch blocked by the app's intentional CSP.
 await browser.evaluate(()=>{const w=window as any;w.__draftURLOriginal=URL.createObjectURL;w.__draftURLBlobs=new Map();URL.createObjectURL=function(blob:Blob){const url=w.__draftURLOriginal.call(URL,blob);w.__draftURLBlobs.set(url,blob);return url;};});
 try{await attach(screen,'E-mailconcept');await screen.getByRole('textbox',{name:'Aan',exact:true}).fill('test@example.test');await screen.getByRole('textbox',{name:'Onderwerp',exact:true}).fill('Onderwerp');await screen.getByRole('textbox',{name:'Conceptinhoud',exact:true}).fill('Behoud mijn concept');await screen.getByRole('button',{name:'Concept bewaren',exact:true}).click();await finish(browser);
 const sel='[data-draft-artifact] [data-source-instance~="INSTANCE-028"]';await browser.mouse.move(1,1);
 //025 is the actual anchor ::before;028 is its arrow. Independently capture both channels.
 expect(await browser.evaluate(()=>({arrow:Number(getComputedStyle(document.querySelector('[data-draft-artifact] [data-source-instance~="INSTANCE-028"]')!).opacity),ring:Number(getComputedStyle(document.querySelector('[data-draft-artifact]')!,'::before').opacity)}))).toEqual({arrow:0,ring:0});
 await arm(browser,'[data-draft-artifact]','opacity','::before');await browser.locator('[data-draft-artifact]').hover();const pseudo=await motion(browser,'opacity');expect(pseudo.duration).toBe(120);expect(pseudo.easing).toBe('ease-out');expect(pseudo.poses[0]).toBe('0');expect(pseudo.poses[2]).toBe('1');expect(Number(pseudo.poses[1])).toBeGreaterThan(0);expect(Number(pseudo.poses[1])).toBeLessThan(1);const pseudoStyle=await browser.evaluate(()=>{const s=getComputedStyle(document.querySelector('[data-draft-artifact]')!,'::before');return {content:s.content,bg:s.backgroundColor};});expect(pseudoStyle.content).toBe('\"\"');expectColor(pseudoStyle.bg,[28,28,28,15/255]);
 await browser.mouse.move(1,1);await finish(browser);await arm(browser,sel,'opacity');await browser.locator('[data-draft-artifact]').hover();const m=await motion(browser,'opacity');expect(m.duration).toBe(120);expect(m.easing).toBe('ease-out');expect(Number(m.poses[0])).toBe(0);expect(Number(m.poses[1])).toBeGreaterThan(0);expect(Number(m.poses[1])).toBeLessThan(1);expect(Number(m.poses[2])).toBe(1);
 expect(await browser.evaluate(async()=>{const a=document.querySelector('[data-draft-artifact]') as HTMLAnchorElement;return {blob:a.href.startsWith('blob:'),body:JSON.parse(await (window as any).__draftURLBlobs.get(a.href).text()).body};})).toEqual({blob:true,body:'Behoud mijn concept'});
 await screen.getByRole('button',{name:'Verzenden laten mislukken',exact:true}).click();await expect(screen.getByRole('alert')).toContainText('Lokaal verzenden mislukt');await screen.getByRole('button',{name:'Opnieuw verzenden',exact:true}).click();await expect(screen.getByRole('status').filter({hasText:'Lokaal verzonden record bewaard'})).toBeVisible();
 }finally{await browser.evaluate(()=>{const w=window as any;URL.createObjectURL=w.__draftURLOriginal;w.__draftURLBlobs.clear();});}
});

// M04: real filepath+callback header029, not a plain pre/code sibling.
test('M04 computed filename header hover has100ms ease-in-out and opens real result',async({app,screen,browser})=>{
 await boot(app,browser,screen);await attach(screen,'Lokale taak');await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');await screen.getByRole('button',{name:'Taak starten',exact:true}).click();await expect(screen.getByText('Voltooid',{exact:true}).first()).toBeVisible();await screen.getByRole('button',{name:'Ruwe uitvoer tonen',exact:true}).click();await finish(browser);await browser.mouse.move(1,1);
 await arm(browser,'[data-action=product-task-document]','background-color');await screen.getByRole('button',{name:'Taakresultaat.txt',exact:true}).hover();const m=await motion(browser,'background-color');expect(m.duration).toBe(100);expect(m.easing).toBe('ease-in-out');expect(m.poses[0]).not.toBe(m.poses[2]);expect(m.poses[1]).not.toBe(m.poses[0]);expectColor(m.poses[2],[28,28,28,15/255]);
 await screen.getByRole('button',{name:'Taakresultaat.txt',exact:true}).click();await expect(screen.getByRole('textbox',{name:'Documentinhoud',exact:true})).toContainText('3 woorden');
});

// M05: actual scrolled file toolbar054. Source reduced changes duration0s, not property.
test('M05 real CSV scrolling animates toolbar shadow120ms and reduced settles immediately',async({app,screen,browser})=>{
 for(const reduced of [false,true]){
  await boot(app,browser,screen,reduced);await pane(screen,'Bibliotheek');await browser.locator('[data-document-csv]').setInputFiles(['tests/fixtures/source-table.csv']);await expect(screen.getByRole('columnheader',{name:'Naam',exact:true})).toBeVisible();await finish(browser);
  const sel='.product-table-toolbar';if(!reduced)await arm(browser,sel,'box-shadow');const b=await browser.locator('.product-csv-wrap').boundingBox();if(!b)throw Error('Missing real CSV viewport');await browser.mouse.move(b.x+b.width/2,b.y+b.height/2);await browser.mouse.wheel(0,420);await expect(browser.locator(sel)).toHaveAttribute('data-scrolled','');
  if(!reduced){const m=await motion(browser,'box-shadow');expect(m.duration).toBe(120);expect(m.easing).toBe('ease');expect(m.poses[0]).not.toBe(m.poses[2]);expect(m.poses[1]).not.toBe(m.poses[0]);}else expect(await browser.evaluate(()=>getComputedStyle(document.querySelector('.product-table-toolbar')!).transitionDuration)).toBe('0s');
  // Exact native aa.inline three-layer pose, parsed to avoid browser rgba whitespace/rounding differences.
  const shadow=await browser.evaluate(()=>getComputedStyle(document.querySelector('.product-table-toolbar')!).boxShadow);
  const layers=shadow.split(/,(?![^()]*\))/).map((v:string)=>({px:[...v.matchAll(/(-?[\d.]+)px/g)].map(x=>Number(x[1])),rgba:v.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number)}));
  expect(layers.map((v:any)=>v.px)).toEqual([[0,4,12,-1],[0,2,4,-2],[0,0,0,1]]);for(const [i,alpha]of [20/255,15/255,1/255].entries()){expect(layers[i].rgba?.slice(0,3)).toEqual([28,28,28]);expect(Math.round((layers[i].rgba?.[3]??-1)*255)).toBe(Math.round(alpha*255));}

  expect(await browser.evaluate(()=>document.querySelectorAll('.product-csv-wrap tr').length)).toBe(102);
 }
});

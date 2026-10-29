import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
async function intro(app:any,browser:any,screen:any){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;(window as any).productSurfaces.setInspect(true);});await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Introductie',exact:true}).click();}
test('onboarding source clocks drive real typing demo jobs and owned outgoing steps',async({app,screen,browser})=>{
 await intro(app,browser,screen);await expect(screen.getByRole('heading',{name:'Maak kennis met Grok Bot',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;if(!api)return null;api.advance(700);return {count:api.snapshot().typedCount,step:api.snapshot().step};})).toEqual({count:0,step:'meet'});
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;api.advance(35);return {count:api.snapshot().typedCount,text:document.querySelector('[data-intro-typed]')?.textContent??null};})).toEqual({count:1,text:'G'});
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;return {step:api.snapshot().step,beat:api.snapshot().demoBeat,outgoing:document.querySelectorAll('[data-onboarding-outgoing][inert]').length};})).toEqual({step:'computer-demo',beat:-1,outgoing:1});
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;api.advance(200);return document.querySelectorAll('[data-onboarding-outgoing]').length;})).toBe(0);
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;api.advance(699);return api.snapshot().demoBeat;})).toBe(-1);
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;api.advance(1);return {beat:api.snapshot().demoBeat,dom:document.querySelector('[data-demo-beat]')?.getAttribute('data-demo-beat')??null};})).toEqual({beat:0,dom:'0'});
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;api.advance(799);return api.snapshot().jobsBeat;})).toBe(0);
 expect(await browser.evaluate(()=>{const api=(window as any).productOnboarding;api.advance(1);return {beat:api.snapshot().jobsBeat,dom:document.querySelector('[data-jobs-beat]')?.getAttribute('data-jobs-beat')??null};})).toEqual({beat:1,dom:'1'});
 await screen.getByRole('button',{name:'Sluiten',exact:true}).click();expect(await browser.evaluate(()=>(window as any).productOnboarding.snapshot().pendingClocks)).toBe(0);
});
test('reduced onboarding jumps source scenes and removes every active clock',async({app,screen,browser})=>{
 await intro(app,browser,screen);await browser.evaluate(()=>(window as any).productSurfaces.setReducedMotion(true));
 expect(await browser.evaluate(()=>{const a=(window as any).productOnboarding;if(!a)return null;const s=a.snapshot();return {fullyTyped:s.typedCount===s.graphemeCount,send:s.sendState,thinking:s.isThinking,pending:s.pendingClocks};})).toEqual({fullyTyped:true,send:'sent',thinking:true,pending:0});
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();expect(await browser.evaluate(()=>(window as any).productOnboarding.snapshot().demoBeat)).toBe(7);
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();expect(await browser.evaluate(()=>(window as any).productOnboarding.snapshot().jobsBeat)).toBe(2);
});

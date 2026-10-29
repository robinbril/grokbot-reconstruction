import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('product platform mounts real lifecycle and preserves no-animation application dialogs', async ({app,agent,screen,browser}) => {
  await app.open('/?reset=1');
  await agent.act('Open Apps verbinden');
  await expect(screen.getByRole('dialog',{name:'Apps verbinden',exact:true})).toBeVisible();
  expect(await browser.evaluate(()=>getComputedStyle(document.querySelector('#overlay')!).animationName)).toBe('none');
  expect(await browser.evaluate(()=>typeof (window as any).productSurfaces?.setInspect)).toBe('function');
  await screen.getByRole('button',{name:'Sluiten',exact:true}).click();
  await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
  const toggle=screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first();
  await toggle.click();
  await expect(screen.getByRole('tab',{name:'Computer',exact:true})).toBeVisible();
  expect(await browser.evaluate(()=>document.querySelectorAll('[data-swap-active]').length)).toBeGreaterThan(0);
});

test('source switch has real120ms thumb and setting survives reload',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();
 await screen.getByRole('menuitem',{name:'Instellingen',exact:true}).click();
 const sw=screen.getByRole('switch',{name:'Spelling controleren tijdens het typen',exact:true});
 await sw.click();
 expect(await browser.evaluate(()=>{
 const e=document.querySelector('[role=switch][aria-label="Spelling controleren tijdens het typen"]')!;
 return [e,...e.querySelectorAll('*')].some(n=>getComputedStyle(n).transitionDuration.split(',').some(t=>Math.abs(parseFloat(t)-.12)<.0001));
 })).toBe(true);
 await screen.getByRole('button',{name:'Sluiten',exact:true}).click();
 await app.open('/');
 await expect(screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true})).toHaveAttribute('spellcheck','false');
});

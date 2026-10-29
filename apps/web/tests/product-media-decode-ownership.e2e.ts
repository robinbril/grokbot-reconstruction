// Actual gallery decoder generation ownership regression.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('gallery A B A ignores stale real decoder completion while latest choice remains pending',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 // The same real PNG file imported twice creates two independent byte-backed IDs.
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/profile.png','tests/fixtures/profile.png']);
 await expect(screen.getByRole('button',{name:'Bijlage openen: profile.png',exact:true})).toHaveCount(2);
 await browser.evaluate(()=>{
  const w=window as any;w.__reviewDecodeOriginal=HTMLImageElement.prototype.decode;w.__reviewDecodeHeld=[];
  HTMLImageElement.prototype.decode=function(){
   const actual=w.__reviewDecodeOriginal.call(this);
   if(!this.matches('[data-media-image]'))return actual;
   const owned={ready:false,released:false,release:null as null|(()=>void)};
   w.__reviewDecodeHeld.push(owned);
   // Perform the real decoder first; hold only its successful completion boundary.
   return actual.then(()=>new Promise<void>(resolve=>{owned.ready=true;owned.release=()=>{owned.released=true;resolve();};}));
  };
 });
 try{
  await screen.getByRole('button',{name:'Bijlage openen: profile.png',exact:true}).first().click();
  await expect.poll(()=>browser.evaluate(()=>Boolean((window as any).__reviewDecodeHeld[0]?.ready))).toBe(true);
  await screen.getByRole('button',{name:'Afbeelding 2 van 2',exact:true}).click();
  await expect.poll(()=>browser.evaluate(()=>Boolean((window as any).__reviewDecodeHeld[1]?.ready))).toBe(true);
  await screen.getByRole('button',{name:'Afbeelding 1 van 2',exact:true}).click();
  await expect.poll(()=>browser.evaluate(()=>Boolean((window as any).__reviewDecodeHeld[2]?.ready))).toBe(true);
  const held=await browser.evaluate(()=>({count:(window as any).__reviewDecodeHeld.length,opacity:getComputedStyle(document.querySelector('[data-media-image]')!).opacity,skeletonVisible:!(document.querySelector('[data-media-skeleton]') as HTMLElement).hidden}));
  expect(held).toEqual({count:3,opacity:'0',skeletonVisible:true});
  await browser.evaluate(()=>{(window as any).__reviewDecodeHeld[0].release();});
  // Drain real callbacks/reveal frames. No fake pending duration is added to the app.
  await browser.evaluate(async()=>{await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));for(const a of document.querySelector('[data-media-image]')!.getAnimations())if(Number.isFinite(Number(a.effect?.getTiming().iterations)))a.finish();await Promise.resolve();});
  expect(await browser.evaluate(()=>({latestHeld:!(window as any).__reviewDecodeHeld[2].released,opacity:getComputedStyle(document.querySelector('[data-media-image]')!).opacity,skeletonVisible:!(document.querySelector('[data-media-skeleton]') as HTMLElement).hidden}))).toEqual({latestHeld:true,opacity:'0',skeletonVisible:true});
  await browser.evaluate(()=>{(window as any).__reviewDecodeHeld[2].release();});
  await expect.poll(()=>browser.evaluate(()=>getComputedStyle(document.querySelector('[data-media-image]')!).opacity)).toBe('1');
  await expect(browser.locator('[data-media-skeleton]')).toBeHidden();
  await browser.evaluate(()=>{(window as any).__reviewDecodeHeld[1].release();});
  await expect(screen.getByRole('button',{name:'Afbeelding 1 van 2',exact:true})).toHaveAttribute('aria-current','true');
  expect(await browser.evaluate(()=>{const n=document.querySelector('[data-media-image]') as HTMLImageElement;return {realImage:n.naturalWidth===1&&n.src.startsWith('blob:'),opacity:getComputedStyle(n).opacity};})).toEqual({realImage:true,opacity:'1'});
 }finally{
  await browser.evaluate(()=>{const w=window as any;HTMLImageElement.prototype.decode=w.__reviewDecodeOriginal;for(const held of w.__reviewDecodeHeld)if(!held.released)held.release?.();});
 }
});

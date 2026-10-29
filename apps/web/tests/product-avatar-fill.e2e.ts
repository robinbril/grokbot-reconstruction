import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
test('actual main hero normalizes native baseline zoom without shrinking the silhouette twice',async({app,screen,browser})=>{
 await app.open('/?reset=1');await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Nieuwe Bot',exact:true}).click();await screen.getByRole('button',{name:'Vorm van personage klaver',exact:true}).click();
 const state=await browser.evaluate(async()=>{const api=await import('/avatar-motion.js');await api.loadMotionData();const n=document.querySelector('[data-bot-hero] .avatar') as HTMLElement;const c=api.controllerFor(n);c.pause();c.setClip('Idle_B');const snap=c.snapshot();const path=n.querySelector('[data-avatar-body]') as SVGGraphicsElement;return {size:n.getBoundingClientRect().width,zoom:snap.zoom,bodyWidth:path.getBBox().width,playing:snap.playing,pointer:n.dataset.pointer};});
 expect(Math.abs(state.size-96)).toBeLessThan(.05);expect(Math.abs(state.zoom-1)).toBeLessThan(.00001);expect(state.bodyWidth).toBeGreaterThan(80);expect(state.bodyWidth).toBeLessThanOrEqual(100);expect(state.playing).toBe(false);expect(state.pointer).toBe('auto');
});

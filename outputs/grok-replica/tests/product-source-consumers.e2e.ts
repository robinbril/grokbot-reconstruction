import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
async function boot(app:any,browser:any,screen:any){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});await screen.getByRole('button','Marketing Agent').click();}

test('avatar pulse belongs to real pending generation and the decoded candidate persists',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button','Gespreksdetails').first().click();await screen.getByRole('button','Bot-avatar wijzigen').click();await screen.getByRole('button','Avatar bewerken').click();
 const before=await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).agents.find((a:any)=>a.id==='marketing').shape);
 await expect(browser.locator('[data-avatar-generation-pulse]')).toHaveCount(0);
 await browser.evaluate(()=>{const w=window as any,original=HTMLImageElement.prototype.decode;w.__generationDecodeCount=0;HTMLImageElement.prototype.decode=function(){const real=original.call(this);if(!this.src.startsWith('blob:'))return real;w.__generationDecodeCount++;return real.then(()=>new Promise<void>(resolve=>{w.__releaseGenerationDecode=resolve;}));};});
 await screen.getByRole('button','Personage variëren').click();await expect(screen.getByRole('status','Personage wordt gemaakt')).toBeVisible();await expect(screen.getByRole('button','Gebruiken')).toBeDisabled();await expect(screen.getByRole('button','Personage variëren')).toBeDisabled();
 await expect.poll(()=>browser.evaluate(()=>(window as any).__generationDecodeCount)).toBe(1);
 const pulse=await browser.evaluate(()=>{const n=document.querySelector('[data-avatar-generation-pulse]')!,a=n.getAnimations()[0];if(!a)throw Error('Real generation pulse missing');a.pause();const poses=[0,1200,2400].map(t=>{a.currentTime=t;return Number(getComputedStyle(n).opacity);});return {width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,name:getComputedStyle(n).animationName,duration:a.effect!.getTiming().duration,easing:getComputedStyle(n).animationTimingFunction,poses};});
 expect(pulse.width).toBe(96);expect(pulse.height).toBe(96);expect(pulse.name).toBe('sand-2t3rfm-B');expect(pulse.duration).toBe(2400);expect(pulse.easing).toBe('ease-in-out');expect(pulse.poses[0]).toBeCloseTo(1,2);expect(pulse.poses[1]).toBeCloseTo(.55,2);expect(pulse.poses[2]).toBeCloseTo(1,2);
 await expect.poll(()=>browser.evaluate(()=>typeof(window as any).__releaseGenerationDecode),{timeout:5000}).toBe('function');
 await browser.evaluate(()=>(window as any).__releaseGenerationDecode());await expect(screen.getByRole('status','Personage wordt gemaakt')).toHaveCount(0);await expect(screen.getByRole('button','Gebruiken')).toBeEnabled();await screen.getByRole('button','Gebruiken').click();
 const after=await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).agents.find((a:any)=>a.id==='marketing').shape);expect(after).not.toBe(before);await app.open('/');expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).agents.find((a:any)=>a.id==='marketing').shape)).toBe(after);
});

test('platform Dialog Close owns the close consumer while ordinary save buttons retain their own role',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button','Accountmenu').click();await screen.getByRole('menuitem','Instellingen').click();
 const close=screen.getByRole('button','Sluiten');await expect(close).toBeVisible();
 expect((await close.getAttribute('data-source-instance')||'').split(' ')).toContain('INSTANCE-323');
 expect(await browser.evaluate(()=>[...document.querySelectorAll('#overlay .primary-button,#overlay .outline-button')].filter(n=>!n.matches('.modal-close')).every(n=>!n.getAttribute('data-source-instance')?.includes('INSTANCE-323')))).toBe(true);
 await close.click();await expect(screen.getByRole('dialog','Instellingen')).toHaveCount(0);await expect(screen.getByRole('button','Accountmenu')).toBeFocused();
});

test('local digest drives separate keyed update readout headline progress and action consumers',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button','Accountmenu').click();await screen.getByRole('menuitem','Instellingen').click();await screen.getByRole('button','Updates').click();
 await browser.evaluate(()=>{const w=window as any,original=crypto.subtle.digest.bind(crypto.subtle);w.__digestIntercepted=false;crypto.subtle.digest=((...args:any[])=>{const real=original(...args as [AlgorithmIdentifier,BufferSource]);if(w.__digestIntercepted)return real;w.__digestIntercepted=true;return real.then(result=>new Promise<ArrayBuffer>(resolve=>{w.__releaseBuildDigest=()=>resolve(result);}));}) as any;(window as any).productSurfaces.setInspect(true);});
 await screen.getByRole('button','Controleren op updates').click();await browser.evaluate(()=>{const row=document.querySelector('[data-update-progress-row]');if(row){void getComputedStyle(row).gridTemplateRows;for(const a of row.getAnimations({subtree:true}).filter(a=>a.effect!.getTiming().duration===280))a.finish();}return Boolean(row);});await expect(screen.getByRole('progressbar','Lokale updatecontrole')).toHaveAttribute('aria-busy','true');await expect(screen.getByRole('progressbar','Lokale updatecontrole')).not.toHaveAttribute('aria-valuenow');
 await expect(browser.locator('[data-update-readout-key]')).toBeVisible();
 expect(await browser.evaluate(()=>{const readout=document.querySelector('[data-update-readout-key]')!,row=document.querySelector('[data-update-progress-row]')!;return {readoutDuration:getComputedStyle(readout).animationDuration,readoutName:getComputedStyle(readout).animationName,rowDuration:getComputedStyle(row).transitionDuration,misplaced:document.querySelector('.product-update-details')?.getAttribute('data-source-instance')?.includes('INSTANCE-276')??false,loop:[...document.querySelector('[role=progressbar][aria-label="Lokale updatecontrole"]')!.getAnimations({subtree:true})].some(a=>a.effect!.getTiming().duration===1350)};})).toEqual({readoutDuration:'0.24s',readoutName:'sand-gcq4cg-B',rowDuration:'0.28s',misplaced:false,loop:true});
 await expect.poll(()=>browser.evaluate(()=>typeof(window as any).__releaseBuildDigest)).toBe('function');await browser.evaluate(()=>(window as any).__releaseBuildDigest());await expect(screen.getByRole('button','Buildgegevens openen')).toBeVisible();await expect(screen.getByRole('progressbar','Lokale updatecontrole')).toHaveAttribute('aria-valuenow','100');
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return /^[0-9a-f]{64}$/.test(s.lastLocalUpdateCheck.sha256);})).toBe(true);
});

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
async function boot(app:any,browser:any,screen:any){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();}
test('PCM waveform uses exact bar geometry and pointer drag seeks actual audio while a tap does not',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('menuitem',{name:'Spraakmemo',exact:true}).click();
 expect(await browser.evaluate(()=>{const w=document.querySelector('[data-voice-memo-waveform]') as SVGSVGElement;return {viewBox:w.getAttribute('viewBox'),bars:w.dataset.bars};})).toEqual({viewBox:'0 0 254 20',bars:'64'});
 const box=await browser.locator('[data-voice-memo-waveform]').boundingBox();if(!box)throw Error('No actual waveform geometry');await browser.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await browser.mouse.down();await browser.mouse.up();
 expect(await browser.evaluate(()=>document.querySelector('audio')!.currentTime)).toBe(0);
 await browser.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await browser.mouse.down();await browser.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await browser.mouse.up();
 expect(await browser.evaluate(()=>Math.abs(document.querySelector('audio')!.currentTime-1)<.05)).toBe(true);
 expect(await browser.evaluate(()=>{const w=document.querySelector('[data-voice-memo-waveform]') as HTMLElement,p=w.querySelector('[data-voice-memo-waveform-played]')!;return {bars:Number(w.dataset.played),clip:(p as SVGElement).style.clipPath};})).toEqual({bars:32,clip:'inset(0px 128px 0px 0px) view-box'});
});
test('multi selection is persisted and genuinely changes computed result',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');await screen.getByRole('checkbox',{name:'Meerdere uitvoeronderdelen kiezen',exact:true}).check();await screen.getByRole('button',{name:'Taak starten',exact:true}).click();
 await screen.getByRole('checkbox',{name:'Woorden',exact:true}).check();await screen.getByRole('checkbox',{name:'Regels',exact:true}).check();await screen.getByRole('button',{name:'Keuze gebruiken',exact:true}).click();await expect(screen.getByText('Voltooid',{exact:true}).first()).toBeVisible();
 expect(await browser.evaluate(()=>{const r=JSON.parse(localStorage.getItem('grok-local-replica-v1')!).messages.marketing.find((m:any)=>m.localRun).localRun;return {parts:r.replyParts??null,output:r.output??null};})).toEqual({parts:['words','lines'],output:'3 woorden · 1 regel'});
 await expect(screen.getByText('Gekozen: Woorden, Regels',{exact:true})).toBeVisible();await app.open('/');await expect(screen.getByText('Gekozen: Woorden, Regels',{exact:true})).toBeVisible();
});

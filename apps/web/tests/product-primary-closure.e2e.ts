import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
async function boot(app:any,browser:any,screen:any){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();}
test('account photo uploads decoded actual image bytes and survives reload',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Profielfoto wijzigen',exact:true}).click();
 await browser.locator('[aria-label="Profielfoto uploaden"]').setInputFiles(['tests/fixtures/profile.png']);
 await expect(screen.getByRole('image',{name:'Profielfoto',exact:true}).first()).toBeVisible();
 expect(await browser.evaluate(()=>{const image=document.querySelector('img[alt="Profielfoto"]') as HTMLImageElement|null;return {decoded:Boolean(image?.complete&&image.naturalWidth>0),bytes:Boolean(image?.src.startsWith('data:image/png')),bound:Boolean(document.querySelector('[data-source-instance~="INSTANCE-064"],[data-source-instance~="INSTANCE-065"]'))};})).toEqual({decoded:true,bytes:true,bound:true});
 await app.open('/');await expect(screen.getByRole('image',{name:'Profielfoto',exact:true}).first()).toBeVisible();
 expect(await browser.evaluate(()=>{const image=document.querySelector('img[alt="Profielfoto"]') as HTMLImageElement|null;return Boolean(image?.src.startsWith('data:image/png'));})).toBe(true);
});
test('source153 is actual info pane grip and keyboard width uses persisted geometry',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();
 const grip=screen.getByRole('separator',{name:'Breedte van gespreksdetails',exact:true});await grip.press('Home');
 expect(await browser.evaluate(()=>{const grip=document.querySelector('[data-info-resize]')!;return {bound:grip.matches('[data-source-instance~="INSTANCE-153"]')||Boolean(grip.querySelector('[data-source-instance~="INSTANCE-153"]')),width:JSON.parse(localStorage.getItem('grok-local-replica-v1')!).infoPaneWidth};})).toEqual({bound:true,width:240});
 await grip.press('ArrowLeft');expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).infoPaneWidth)).toBe(260);
});
test('computed task file header source029 opens its actual output document',async({app,screen,browser})=>{
 await boot(app,browser,screen);await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');await screen.getByRole('button',{name:'Taak starten',exact:true}).click();
 await expect(screen.getByText('Voltooid',{exact:true}).first()).toBeVisible();await screen.getByRole('button',{name:'Ruwe uitvoer tonen',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Taakresultaat.txt',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{const header=document.querySelector('[data-source-instance~="INSTANCE-029"]');return {button:header?.tagName??null,label:header?.textContent?.trim()??null};})).toEqual({button:'BUTTON',label:'Taakresultaat.txt'});
 await screen.getByRole('button',{name:'Taakresultaat.txt',exact:true}).click();await expect(screen.getByRole('textbox',{name:'Documentinhoud',exact:true})).toContainText('3 woorden');
});

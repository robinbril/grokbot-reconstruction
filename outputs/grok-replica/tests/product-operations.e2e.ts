import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function start(app:any,browser:any,screen:any){await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();}
async function attach(screen:any,label:string){await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:label,exact:true}).click();}
async function library(screen:any){await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();await screen.getByRole('tab',{name:'Bibliotheek',exact:true}).click();}

test('local PCM actually decodes plays seeks and pauses without a microphone',async({app,screen,browser})=>{
 await start(app,browser,screen);await attach(screen,'Spraakmemo');
 await screen.getByRole('button',{name:'Afspelen',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Pauzeren',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{const a=document.querySelector('audio')!;return {error:a.error?.code||null,ready:a.readyState>=2,blob:a.src.startsWith('blob:'),paused:a.paused};})).toEqual({error:null,ready:true,blob:true,paused:false});
 await screen.getByRole('button',{name:'Afspeelsnelheid',exact:true}).click();
 await screen.getByRole('menuitemradio',{name:'1.5×',exact:true}).click();
 expect(await browser.evaluate(()=>document.querySelector('audio')!.playbackRate)).toBe(1.5);
 await screen.getByRole('button',{name:'Pauzeren',exact:true}).click();
 expect(await browser.evaluate(()=>document.querySelector('audio')!.paused)).toBe(true);
});

test('roster keyboard reorders actual bots and saves order across reload',async({app,screen,browser})=>{
 await start(app,browser,screen);
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).press('Alt+ArrowDown');
 const order=()=>browser.evaluate(()=>[...document.querySelectorAll('.roster [data-agent-id]')].map(n=>(n as HTMLElement).dataset.agentId));
 expect((await order()).slice(0,2)).toEqual(['autonomous','marketing']);
 await app.open('/');expect((await order()).slice(0,2)).toEqual(['autonomous','marketing']);
});

test('offline queue preserves a real draft and commits exactly one user message',async({app,screen,browser})=>{
 await start(app,browser,screen);await attach(screen,'Lokale wachtrij');
 await screen.getByRole('switch',{name:'Offlinemodus',exact:true}).click();
 await screen.getByRole('button',{name:'Sluiten',exact:true}).first().click();
 await screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).fill('Bewaar deze tekst eenmaal');
 await screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).press('Enter');
 await expect(screen.getByRole('button',{name:'Wachtrij verzenden',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).localOutbox.marketing.text)).toBe('Bewaar deze tekst eenmaal');
 await app.open('/');await expectComposerText(browser,'Bewaar deze tekst eenmaal');
 await attach(screen,'Lokale wachtrij');await screen.getByRole('switch',{name:'Offlinemodus',exact:true}).click();await screen.getByRole('button',{name:'Sluiten',exact:true}).first().click();
 await screen.getByRole('button',{name:'Wachtrij verzenden',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Wachtrij verzenden',exact:true})).toHaveCount(0);
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).messages.marketing.filter((m:any)=>m.role==='user'&&m.text==='Bewaar deze tekst eenmaal').length)).toBe(1);
});

test('document formatting acts on real selection and failed save retains edited content',async({app,screen,browser})=>{
 await start(app,browser,screen);await library(screen);await screen.getByRole('button',{name:'Nieuw document',exact:true}).click();
 await screen.getByRole('textbox',{name:'Documentinhoud',exact:true}).fill('Bewaar mijn opmaak');
 await browser.evaluate(()=>{const e=document.querySelector('[aria-label="Documentinhoud"]')!;const range=document.createRange();range.selectNodeContents(e);const s=getSelection()!;s.removeAllRanges();s.addRange(range);e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 await screen.getByRole('button',{name:'Vet',exact:true}).click();
 expect(await browser.evaluate(()=>document.querySelector('[aria-label="Documentinhoud"] strong')?.textContent)).toBe('Bewaar mijn opmaak');
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1')throw new DOMException('Local test denial','QuotaExceededError');return write.call(this,k,v);};});
 await screen.getByRole('button',{name:'Document opslaan',exact:true}).click();
 await expect(screen.getByRole('status').filter({hasText:'niet opgeslagen'}).first()).toBeVisible();
 await expect(screen.getByRole('textbox',{name:'Documentinhoud',exact:true})).toContainText('Bewaar mijn opmaak');
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).workspaceDocuments?.length||0)).toBe(0);
});

test('paused computer recording holds the real rendered PNG frame',async({app,screen,browser})=>{
 await start(app,browser,screen);await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();await screen.getByRole('tab',{name:'Computer',exact:true}).click();await screen.getByRole('button',{name:'Computervoorbeeld openen',exact:true}).click();
 await screen.getByRole('button',{name:'Opname starten',exact:true}).click();
 await screen.getByRole('textbox',{name:'Computernotitie',exact:true}).fill('Dit staat werkelijk in het frame');
 await screen.getByRole('button',{name:'Opname pauzeren',exact:true}).click();
 expect(await browser.evaluate(()=>{const frame=document.querySelector('img[data-held-frame]') as HTMLImageElement|null;const canvas=document.querySelector('[data-computer-screen] canvas') as HTMLCanvasElement|null;return {image:Boolean(frame?.src.startsWith('data:image/png')),matchesCanvas:Boolean(frame&&canvas&&frame.src===canvas.toDataURL('image/png'))};})).toEqual({image:true,matchesCanvas:true});
 await screen.getByRole('button',{name:'Opname stoppen',exact:true}).click();
 expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).localComputerRecordings.at(-1).note)).toBe('Dit staat werkelijk in het frame');
});

test('task question is a real input to the subsequent computation',async({app,screen,browser})=>{
 await start(app,browser,screen);await attach(screen,'Lokale taak');
 await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');
 await screen.getByRole('checkbox',{name:'Uitvoervorm kiezen',exact:true}).check();
 await screen.getByRole('button',{name:'Taak starten',exact:true}).click();
 await expect(screen.getByText('Hoe wil je het resultaat zien?',{exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Uitgebreid',exact:true}).click();
 await expect(screen.getByText('3 woorden',{exact:true}).first()).toBeVisible();
 await expect(screen.getByText('Voltooid',{exact:true}).first()).toBeVisible();
 expect(await browser.evaluate(()=>{const m=JSON.parse(localStorage.getItem('grok-local-replica-v1')!).messages.marketing.find((m:any)=>m.localRun);return {answer:m.localRun.replyStyle??null,complete:m.localRun.status==='complete',output:m.localRun.output??null};})).toEqual({answer:'full',complete:true,output:'3 woorden · 13 tekens · 1 regel'});
});

test('menu arrows and Escape keep one focus owner and restore invoker',async({app,screen,browser})=>{
 await start(app,browser,screen);await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();
 await expect(screen.getByRole('menu')).toHaveCount(1);
 await screen.getByRole('menuitem',{name:'Instellingen',exact:true}).press('ArrowDown');
 expect(await browser.evaluate(()=>document.activeElement?.textContent?.trim())).toBe('Apparaten');
 await screen.getByRole('menuitem',{name:'Apparaten',exact:true}).press('ArrowDown');
 expect(await browser.evaluate(()=>document.activeElement?.textContent?.trim())).toBe('Apps en vaardigheden beheren');
 await screen.getByRole('menuitem',{name:'Apps en vaardigheden beheren',exact:true}).press('Escape');
 await expect(screen.getByRole('menu')).toHaveCount(0);
 expect(await browser.evaluate(()=>document.activeElement?.getAttribute('aria-label'))).toBe('Accountmenu');
});

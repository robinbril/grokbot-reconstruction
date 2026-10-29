import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function boot(app:any,browser:any,screen:any){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
}
const saved=(browser:any)=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!));

test('slash bot creation uses the canonical character picker and persists the chosen identity',async({app,browser,screen,agent})=>{
 await boot(app,browser,screen);
 await agent.act('Toon de slashsuggestie Nieuwe Bot door /bot in het berichtveld te typen.');
 await expect(screen.getByRole('option','Nieuwe Bot',{exact:true})).toBeVisible();
 await screen.getByRole('option','Nieuwe Bot',{exact:true}).click();
 const dialog=screen.getByRole('dialog','Nieuwe Bot maken',{exact:true});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button','Personage',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('group','Vorm van personage',{exact:true}).getByRole('button')).toHaveCount(13);
 await expect(dialog.getByRole('button','Maken',{exact:true})).toBeDisabled();
 await dialog.getByRole('textbox','Bot-naam',{exact:true}).fill('Slash Identity');
 await dialog.getByRole('button','Vorm van personage zeshoek',{exact:true}).click();
 const color=dialog.getByRole('group','Kleur van personage',{exact:true}).getByRole('button').first();
 const chosenColor=await color.getAttribute('data-value');await color.click();
 await dialog.getByRole('button','Maken',{exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(screen.getByRole('button','Slash Identity',{exact:true})).toBeVisible();
 let bots=(await saved(browser)).agents.filter((a:any)=>a.name==='Slash Identity');
 expect(bots).toHaveLength(1);expect(bots[0].shape).toBe(12);expect(bots[0].color).toBe(chosenColor);
 const id=bots[0].id;await browser.reload();
 await expect(screen.getByRole('button','Slash Identity',{exact:true})).toBeVisible();
 bots=(await saved(browser)).agents.filter((a:any)=>a.name==='Slash Identity');expect(bots).toHaveLength(1);expect(bots[0].id).toBe(id);expect(bots[0].shape).toBe(12);expect(bots[0].color).toBe(chosenColor);
});

test('slash bot storage refusal retains the creation form and retry creates exactly one durable bot',async({app,browser,screen,agent})=>{
 await boot(app,browser,screen);
 await agent.act('Toon de slashsuggestie Nieuwe Bot door /bot in het berichtveld te typen.');
 await expect(screen.getByRole('option','Nieuwe Bot',{exact:true})).toBeVisible();
 await screen.getByRole('option','Nieuwe Bot',{exact:true}).click();
 const dialog=screen.getByRole('dialog'),name=dialog.getByRole('textbox',/^(Bot-naam|Naam)$/);
 await expect(name).toBeVisible();await name.fill('SlashSaveDenied');
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__denySlashBot=true;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&(window as any).__denySlashBot&&JSON.parse(v).agents?.some((a:any)=>a.name==='SlashSaveDenied'))throw new DOMException('Denied bot creation','QuotaExceededError');return write.call(this,k,v);};});
 await dialog.getByRole('button',/^(Maken|Opslaan)$/).click();
 await expect(dialog).toBeVisible();await expect(name).toHaveValue('SlashSaveDenied');
 await expect(dialog.getByRole('status')).toContainText('Bot niet opgeslagen');
 await expect(screen.getByRole('button','SlashSaveDenied',{exact:true})).toHaveCount(0);
 expect((await saved(browser)).agents.filter((a:any)=>a.name==='SlashSaveDenied')).toHaveLength(0);
 await browser.evaluate(()=>{(window as any).__denySlashBot=false;});
 await dialog.getByRole('button','Maken',{exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(screen.getByRole('button','SlashSaveDenied',{exact:true})).toBeVisible();
 expect((await saved(browser)).agents.filter((a:any)=>a.name==='SlashSaveDenied')).toHaveLength(1);
 await browser.reload();await expect(screen.getByRole('button','SlashSaveDenied',{exact:true})).toBeVisible();
 expect((await saved(browser)).agents.filter((a:any)=>a.name==='SlashSaveDenied')).toHaveLength(1);
});

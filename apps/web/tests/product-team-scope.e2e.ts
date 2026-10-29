import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
test('new chat Team-Bots scope really filters selectable bots and has a hover removal chip',async({app,screen,browser})=>{
 await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});
 await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Team-Bots',exact:true}).click();await screen.getByRole('button',{name:'Team instellen',exact:true}).click();await screen.getByRole('textbox',{name:'Teamnaam',exact:true}).fill('Scope team');await screen.getByRole('button',{name:'Volgende',exact:true}).click();await screen.getByRole('checkbox',{name:'Marketing Agent toevoegen',exact:true}).check();await screen.getByRole('button',{name:'Volgende',exact:true}).click();await screen.getByRole('button',{name:'Team maken',exact:true}).click();
 await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Team-Bots zoeken',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Scope team',exact:true}).last()).toBeVisible();
 expect(await browser.evaluate(()=>{const results=document.querySelector('#recipient-results');return {team:results?.textContent?.includes('Scope team')??false,ordinary:results?.textContent?.includes('Marketing Agent')??false,chip:Boolean(document.querySelector('[data-source-instance~="INSTANCE-035"]'))};})).toEqual({team:true,ordinary:false,chip:true});
 await screen.getByRole('button',{name:'Team-Bots sluiten',exact:true}).focus();
 expect(await browser.evaluate(()=>{const n=document.querySelector('[data-source-instance~="INSTANCE-035"]');return n?getComputedStyle(n).opacity:null;})).toBe('1');
 await screen.getByRole('button',{name:'Team-Bots sluiten',exact:true}).click();
 expect(await browser.evaluate(()=>document.querySelector('#recipient-results')?.textContent?.includes('Marketing Agent')??false)).toBe(true);
});

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
test('actual audio receipt reveals decoded facts and persists nudge choice with source roles',async({app,screen,browser})=>{
 await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;});await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Spraakmemo',exact:true}).click();
 await screen.getByRole('button',{name:'Audiogegevens tonen',exact:true}).click();await expect(screen.getByRole('region',{name:'Audiogegevens',exact:true})).toContainText('8000 Hz');
 expect(await browser.evaluate(()=>{const r=document.querySelector('[aria-label="Audiogegevens"]');return {bound:r?.getAttribute('data-source-instance')??null,duration:r?getComputedStyle(r).transitionDuration:null};})).toEqual({bound:'INSTANCE-077',duration:'0.38s'});
 await screen.getByRole('button',{name:'Audio-opties',exact:true}).click();await screen.getByRole('menuitemcheckbox',{name:'Aanwijzingen tonen',exact:true}).click();
 await screen.getByRole('button',{name:'Audio-opties',exact:true}).click();await expect(screen.getByRole('menuitemcheckbox',{name:'Aanwijzingen tonen',exact:true})).toBeChecked();await screen.getByRole('menuitemcheckbox',{name:'Aanwijzingen tonen',exact:true}).press('Escape');
 await expect(screen.getByText(/330 Hz.*440 Hz/).first()).toBeVisible();await app.open('/');await expect(screen.getByRole('button',{name:'Audiogegevens verbergen',exact:true})).toBeVisible();await expect(screen.getByText(/330 Hz.*440 Hz/).first()).toBeVisible();
});

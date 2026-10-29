import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('local processing uses actual input and produces cancellable task progress in conversation',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await agent.act('Open via Bijvoegen de lokale taakuitvoering');
 await expect(screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true})).toBeVisible();
 await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill('een twee drie');
 await screen.getByRole('button',{name:'Taak starten',exact:true}).click();
 await expect(screen.getByRole('progressbar',{name:'Taakvoortgang',exact:true})).toBeVisible();
 await expect(screen.getByText('3 woorden',{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>document.querySelectorAll('.transcript [data-local-run]').length)).toBe(1);
});

test('voice memo local player reveals real transcript without microphone access',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();
 await screen.getByRole('menuitem',{name:'Spraakmemo',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Transcript tonen',exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Transcript tonen',exact:true}).click();
 await expect(screen.getByRole('region',{name:'Spraakmemotranscript',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{
 const n=document.querySelector('[aria-label="Spraakmemotranscript"]')!;
 return getComputedStyle(n).transitionDuration.includes('0.3s')||n.getAnimations({subtree:true}).some(a=>a.effect?.getTiming().duration===300);
 })).toBe(true);
});

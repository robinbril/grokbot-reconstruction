import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('real bot create dialog has native shape and color choices and persists created bot',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 // Stable dialog-opening fixture only; restore native UUIDs before actual Bot creation.
 await browser.evaluate(()=>{const w=window as any,original=crypto.randomUUID;let serial=1;
  w.__restoreBotOpeningUUID=()=>{crypto.randomUUID=original;delete w.__restoreBotOpeningUUID;};
  crypto.randomUUID=(()=>`00000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`) as Crypto['randomUUID'];
 });
 try{await agent.act('Open Nieuwe Bot via het plusmenu linksboven');}finally{await browser.evaluate(()=>(window as any).__restoreBotOpeningUUID?.());}
 await expect(screen.getByRole('dialog',{name:'Nieuwe Bot maken',exact:true})).toBeVisible();
 await expect(screen.getByRole('button',{name:'Vorm van personage zeshoek',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(screen.getByRole('button',{name:'Violet',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await browser.evaluate(()=>document.querySelectorAll('[aria-label="Vorm van personage"] [aria-pressed]').length)).toBe(13);
 expect(await browser.evaluate(()=>document.querySelectorAll('[aria-label="Kleur van personage"] [aria-pressed]').length)).toBe(11);
 await screen.getByRole('textbox',{name:'Bot-naam',exact:true}).fill('Motion Onderzoek');
 await screen.getByRole('button',{name:'Maken',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Motion Onderzoek',exact:true}).first()).toBeVisible();
 await app.open('/');
 await expect(screen.getByRole('button',{name:'Motion Onderzoek',exact:true}).first()).toBeVisible();
});

test('team setup is an actual retained configuration workflow with entering bodies',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();
 await screen.getByRole('menuitem',{name:'Team-Bots',exact:true}).click();
 await screen.getByRole('button',{name:'Team instellen',exact:true}).click();
 await expect(screen.getByRole('textbox',{name:'Teamnaam',exact:true})).toBeVisible();
 await browser.evaluate(()=>(window as any).productSurfaces.setInspect(true));
 await screen.getByRole('textbox',{name:'Teamnaam',exact:true}).fill('Onderzoeksteam');
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 await expect(screen.getByRole('heading',{name:'Bots kiezen',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>document.querySelector('#overlay')!.getAnimations({subtree:true}).some(a=>a.effect?.getTiming().duration===120))).toBe(true);
});

test('introduction belongs to the product and moves between real wizard steps',async({app,screen})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();
 await screen.getByRole('menuitem',{name:'Introductie',exact:true}).click();
 await expect(screen.getByRole('heading',{name:'Maak kennis met Grok Bot',exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Volgende',exact:true}).click();
 await expect(screen.getByRole('heading',{name:'Grok Bot heeft een eigen computer en werkt net als jij',exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Terug',exact:true}).click();
 await expect(screen.getByRole('heading',{name:'Maak kennis met Grok Bot',exact:true})).toBeVisible();
});

test('library document edits persist through normal product navigation',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();
 await screen.getByRole('tab',{name:'Bibliotheek',exact:true}).click();
 await screen.getByRole('button',{name:'Nieuw document',exact:true}).click();
 await expect(screen.getByRole('textbox',{name:'Documentinhoud',exact:true})).toBeVisible();
 await screen.getByRole('textbox',{name:'Documentinhoud',exact:true}).fill('Dit document blijft lokaal bewaard.');
 await screen.getByRole('button',{name:'Document opslaan',exact:true}).click();
 await expect(screen.getByRole('status').filter({hasText:'Opgeslagen'}).first()).toBeVisible();
 await app.open('/');
 if(!await screen.getByRole('tab',{name:'Bibliotheek',exact:true}).count())await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();
 await screen.getByRole('tab',{name:'Bibliotheek',exact:true}).click();
 await screen.getByRole('button',{name:'Naamloos document',exact:true}).click();
 await expect(screen.getByRole('textbox',{name:'Documentinhoud',exact:true})).toContainText('Dit document blijft lokaal bewaard.');
});

test('computer preview has working local pause and held-frame lifecycle',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await screen.getByRole('button',{name:'Gespreksdetails',exact:true}).first().click();
 await screen.getByRole('tab',{name:'Computer',exact:true}).click();
 await screen.getByRole('button',{name:'Computervoorbeeld openen',exact:true}).click();
 await expect(screen.getByRole('dialog',{name:'Computer van de Bot',exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Opname starten',exact:true}).click();
 await screen.getByRole('button',{name:'Opname pauzeren',exact:true}).click();
 expect(await browser.evaluate(()=>{
 const frame=document.querySelector('[data-held-frame]');
 return Boolean(frame&&getComputedStyle(frame).transitionDuration.split(',').some(t=>Math.abs(parseFloat(t)-.12)<.0001));
 })).toBe(true);
 await screen.getByRole('button',{name:'Opname hervatten',exact:true}).click();
 await screen.getByRole('button',{name:'Opname stoppen',exact:true}).click();
 await expect(screen.getByRole('button',{name:'Opname starten',exact:true})).toBeVisible();
});

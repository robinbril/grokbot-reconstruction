import {test} from '@e2e-dev/web';
import {expect} from 'e2e';

test('source chat keeps the extracted rail inspector and composer geometry',async({app,screen,browser})=>{
 await app.open('/?reset=1#reference-chat');
 await expect(browser.locator('[data-reference-chat]')).toHaveCount(1);
 await expect(browser.locator('[data-original-avatar="0.75.5"] svg').first()).toBeVisible();
 const native=await browser.evaluate(()=>[...document.querySelectorAll('[data-original-avatar]')].map(n=>({svg:n.innerHTML,legacy:n.classList.contains('motion-avatar')})));
 expect(native.length).toBeGreaterThan(0);expect(native.every(n=>!n.legacy&&!/NaN|Infinity/.test(n.svg))).toBe(true);
 const fillRatio=await browser.evaluate(()=>{const host=document.querySelector('[data-original-avatar]')!;return host.querySelector('.source-native-avatar-canvas')!.getBoundingClientRect().width/host.getBoundingClientRect().width;});
 expect(Math.abs(fillRatio-0.92/0.6)).toBeLessThan(0.001);
 await expect(screen.getByRole('region','Synthetisch Gmail-verbindingsvoorbeeld')).toBeVisible();
 const geometry=await browser.evaluate(()=>{
  const box=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom};};
  return {rail:box('.sidebar'),inspector:box('.context-pane'),composer:box('.composer'),bubbles:[...document.querySelectorAll('.message.bot .sand-message-action-anchor')].map(n=>n.getBoundingClientRect().width),width:innerWidth,height:innerHeight};
 });
 expect(geometry.rail.width).toBe(88);expect(geometry.inspector.width).toBe(320);
 expect(geometry.inspector.right).toBe(geometry.width);
 expect(geometry.composer.right).toBeLessThanOrEqual(geometry.inspector.x);
 expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.height);
 expect(geometry.bubbles.length).toBeGreaterThan(0);
 expect(Math.max(...geometry.bubbles)).toBeLessThanOrEqual(560);
 await expect(browser.locator('[data-reference-delegation]')).toHaveCount(2);
 await app.screenshot('source-reference-chat-0755');
 await screen.getByRole('separator','Breedte van gespreksdetails').press('ArrowLeft');
 const resized=await browser.evaluate(()=>({width:document.querySelector('.context-pane')!.getBoundingClientRect().width,composerRight:document.querySelector('.composer')!.getBoundingClientRect().right,paneLeft:document.querySelector('.context-pane')!.getBoundingClientRect().left}));
 expect(resized.width).toBe(340);expect(resized.composerRight).toBeLessThanOrEqual(resized.paneLeft);
});

test('reference retry stays an explicit local demonstration',async({app,agent,screen})=>{
 await app.open('/?reset=1#reference-chat');
 await agent.act('Klik in het synthetische Gmail-verbindingsvoorbeeld op Opnieuw proberen.');
 await expect(screen.getByText('Synthetisch voorbeeld. Er is geen autorisatie gestart.',{exact:true})).toBeVisible();
});

test('reference storage cannot overwrite ordinary preferences or conversations',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Accountmenu').click();
 await screen.getByRole('menuitem','Instellingen').click();
 const settings=screen.getByRole('dialog','Instellingen');
 await settings.getByLabel('Thema').selectOption({value:'dark'});
 await settings.getByRole('button','Sluiten',{exact:true}).click();
 await app.open('/?reference=1#reference-chat');
 await expect(browser.locator('[data-reference-chat]')).toHaveCount(1);
 await screen.getByRole('button','Opnieuw proberen',{exact:true}).click();
 await app.open('/?return=1');
 await expect(browser.locator('[data-reference-chat]')).toHaveCount(0);
 expect(await browser.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 expect(await browser.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('/assets/vendor/grok-0755/')))).toBe(false);
 await expect(screen.getByRole('button','Voorbeeld Builder',{exact:true})).toHaveCount(0);
});

test('typed reply containers retain their own frame styling in compact inspector mode',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();
 await screen.getByRole('menuitem','Gespreksbewerking').click();
 const settings=screen.getByRole('dialog','Gespreksbewerking');
 await settings.getByLabel('Lokale bewerking').selectOption({value:'markdown'});
 await settings.getByLabel('Antwoordweergave').selectOption({value:'bubble'});
 await settings.getByRole('button','Gebruiken').click();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot');
 await input.fill('**Synthetische opmaakproef**');await input.press('Enter');
 const body=browser.locator('.message-body[data-chat-entry-id]').last();await expect(body).toBeVisible();
 const style=()=>browser.evaluate(()=>{const n=[...document.querySelectorAll('.message-body[data-chat-entry-id]')].at(-1)!;const s=getComputedStyle(n);return{padding:s.padding,borderRadius:s.borderRadius,background:s.backgroundColor};});
 const before=await style();
 await screen.getByRole('button','Accountmenu').click();
 await screen.getByRole('menuitem','Zijbalk inklappen').click();
 await browser.locator('.header-buttons button[data-action=toggle-context]').click();
 await expect(browser.locator('[data-source-chat-layout]')).toHaveCount(1);
 expect(await style()).toEqual(before);
});

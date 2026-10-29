import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('unified Cmd K filters themes, selects with keyboard, toggles and restores composer focus',async({app,screen,browser,agent})=>{
 await app.open('/?reset=1');
 const composer=screen.getByRole('textbox','Bericht sturen naar Bot');
 await composer.fill('REA palette draft');
 await composer.press('Meta+k');
 const dialog=screen.getByRole('dialog','Spring naar');
 const search=dialog.getByRole('combobox','Spring naar');
 await expect(dialog.getByRole('option','Nieuwe Bot')).toBeVisible();
 await expect(dialog.getByRole('option','Computer instellingen')).toBeVisible();
 await search.fill('theme');
 await expect(dialog.getByRole('option')).toHaveCount(3);
 await expect(dialog.getByRole('option','Licht')).toContainText('Huidig');
 await agent.act('Selecteer Donker in de geopende Spring naar palette om het donkere thema in te schakelen.');
 await expect(browser.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(dialog).toHaveCount(0);
 await expectComposerText(browser,'REA palette draft');
 await expect(composer).toBeFocused();
 await composer.press('Meta+k');await search.fill('theme');
 await expect(dialog.getByRole('option','Donker')).toContainText('Huidig');
 await search.press('Home');await search.press('Enter');
 await expect.poll(()=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').theme)).toBe('system');
 await composer.press('Meta+k');await search.fill('theme');await search.press('Escape');
 await expect(composer).toBeFocused();
 await expect(dialog).toHaveCount(0);
 await composer.press('Meta+k');await search.press('Meta+k');
 await expect(dialog).toHaveCount(0);await expect(composer).toBeFocused();
 await composer.press('Meta+Shift+f');
 await expect(screen.getByRole('dialog','Zoeken')).toBeVisible();
 await expect(screen.getByRole('textbox','Zoeken in Bots en gesprekken')).toBeFocused();
 await expect(screen.getByRole('dialog','Spring naar')).toHaveCount(0);
});

test('palette destinations open real settings, apps, new Bot and bot conversations',async({app,screen,browser,agent})=>{
 await app.open('/?reset=1');
 const composer=screen.getByRole('textbox','Bericht sturen naar Bot');
 const palette=screen.getByRole('dialog','Spring naar');
 const search=palette.getByRole('combobox','Spring naar');
 await composer.press('Meta+k');await search.fill('Computer');await search.press('Enter');
 await expect(screen.getByRole('dialog','Instellingen').getByRole('heading','Computer')).toBeVisible();
 await screen.getByRole('dialog','Instellingen').getByRole('button','Sluiten').click();
 await composer.press('Meta+k');await search.fill('connectors');await search.press('Enter');
 await expect(screen.getByRole('dialog','Apps verbinden')).toBeVisible();
 await screen.getByRole('dialog','Apps verbinden').getByRole('button','Sluiten').click();
 await composer.press('Meta+k');await search.fill('new bot');
 // Stabilize only the randomized picker defaults during this recorded action.
 await browser.evaluate(()=>{
  const fixture=window as Window & {restorePaletteUUID?:()=>void};
  const original=crypto.randomUUID;let serial=1;
  fixture.restorePaletteUUID=()=>{crypto.randomUUID=original;delete fixture.restorePaletteUUID;};
  crypto.randomUUID=(()=>`00000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`) as Crypto['randomUUID'];
 });
 try{await agent.act('Open Nieuwe Bot via het geselecteerde resultaat in de Spring naar palette.');}
 finally{await browser.evaluate(()=>(window as Window & {restorePaletteUUID?:()=>void}).restorePaletteUUID?.());}
 await expect(screen.getByRole('dialog','Nieuwe Bot maken')).toBeVisible();
 await screen.getByRole('dialog','Nieuwe Bot maken').getByRole('button','Sluiten').click();
 await composer.press('Meta+k');await search.fill('Marketing Agent');await search.press('Enter');
 await expect(screen.getByRole('region','Gesprek').getByText('Marketing Agent')).toBeVisible();
});

test('Pages filter opens saved local documents and Cmd K preserves an editable draft',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await browser.evaluate(()=>{const key='grok-local-replica-v1',state=JSON.parse(localStorage.getItem(key)||'{}');state.version=1;state.workspaceDocuments=[{id:'rea-palette-page',botId:'marketing',title:'REA Palette Pagina',html:'<p>REA PAGINA 2046</p>',revision:1}];localStorage.setItem(key,JSON.stringify(state));});
 await app.open('/');
 const composer=screen.getByRole('textbox','Bericht sturen naar Bot');
 await composer.press('Meta+k');
 const palette=screen.getByRole('dialog','Spring naar');
 await palette.getByRole('tab','Pagina’s').click();
 await expect(palette.getByRole('option')).toHaveCount(1);
 await expect(palette.getByRole('option','REA Palette Pagina')).toBeVisible();
 await palette.getByRole('combobox','Spring naar').press('Enter');
 const editor=screen.getByRole('textbox','Documentinhoud');
 await expect(editor).toContainText('REA PAGINA 2046');
 await editor.fill('REA ONOPGESLAGEN 2046');
 await editor.press('Meta+k');
 await expect(palette).toBeVisible();
 await palette.getByRole('combobox','Spring naar').press('Escape');
 await expect(editor).toBeFocused();
 await expect(editor).toContainText('REA ONOPGESLAGEN 2046');
});

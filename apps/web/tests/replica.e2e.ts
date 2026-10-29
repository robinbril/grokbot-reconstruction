import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('catalogus opent een plugin vanuit zoeken en keert terug', async ({ app, agent, screen }) => {
  await app.open('/?reset=1');
  await app.screenshot('shell');
  await agent.act('Open de appcatalogus via Apps verbinden en open de detailpagina van Notion. Voeg niets toe.');
  await expect(screen.getByRole('heading', { name: 'Notion', exact: true })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Toevoegen', exact: true })).toBeVisible();
  await app.screenshot('notion');
  await screen.getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(screen.getByRole('heading', { name: 'Apps verbinden', exact: true })).toBeVisible();
  await app.screenshot('apps-verbinden');
});

test('catalogus filtert de extra categorieën en toont een lege zoektoestand', async ({ app, agent, screen }) => {
  await app.open('/?reset=1');
  await agent.act('Open Apps verbinden en kies via Meer de categorie Onderzoek.');
  await expect(screen.getByRole('heading', { name: 'Onderzoek', exact: true })).toBeVisible();
  await screen.getByRole('combobox', { name: 'Zoeken in apps en vaardigheden', exact: true }).fill('zzzz-reconstruction-no-match');
  await expect(screen.getByText('Geen resultaten voor "zzzz-reconstruction-no-match"', { exact: true })).toBeVisible();
});

test('geïnstalleerde plugins onderscheiden authenticatie en foutstatus', async ({ app, agent, screen }) => {
  await app.open('/?reset=1');
  await agent.act('Open Apps verbinden en klik daarna op 10 verbonden om Plug-ins en vaardigheden beheren te openen.');
  await expect(screen.getByRole('heading', { name: 'Plug-ins en vaardigheden beheren', exact: true })).toBeVisible();
  await expect(screen.getByText('Privévaardigheden', { exact: true })).toBeVisible();
  await expect(screen.getByText('Kan connector niet laden', { exact: true })).toBeVisible();
});

test('botdetails houden bibliotheek en computer apart', async ({ app, agent, screen }) => {
  await app.open('/?reset=1');
  await agent.act('Open het gesprek met Marketing Agent en open de gespreksdetails.');
  await expect(screen.getByRole('tab', { name: 'Details', exact: true })).toBeVisible();
  await screen.getByRole('tab', { name: 'Bibliotheek', exact: true }).click();
  await expect(screen.getByText('Pagina’s, bestanden en apps die deze Bot maakt, verschijnen hier', { exact: true })).toBeVisible();
  await screen.getByRole('tab', { name: 'Computer', exact: true }).click();
  await expect(screen.getByText('De computer slaapt', { exact: true })).toBeVisible();
});

test('concepten blijven per gesprek bewaard bij tabs, wisselen en herladen', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Onverzonden concept voor Marketing');
  await screen.getByRole('button', 'Gespreksdetails').first().click();
  await screen.getByRole('tab', 'Bibliotheek').click();
  await expectComposerText(browser,'Onverzonden concept voor Marketing');
  await screen.getByRole('button', 'Find Customers').click();
  await expectComposerText(browser,'');
  await screen.getByRole('button', 'Marketing Agent').click();
  await expectComposerText(browser,'Onverzonden concept voor Marketing');
  await app.open('/');
  await expectComposerText(browser,'Onverzonden concept voor Marketing');
});

test('lokale plugininstallatie blijft behouden en wijzigt het aantal', async ({ app, screen }) => {
  await app.open('/?reset=1&plugin=notion');
  await expect(screen.getByRole('heading', 'Notion')).toBeVisible();
  await screen.getByRole('button', 'Toevoegen').click();
  await expect(screen.getByRole('button', 'Verwijderen')).toBeVisible();
  await app.open('/?plugin=notion');
  await expect(screen.getByRole('button', 'Verwijderen')).toBeVisible();
  await screen.getByRole('button', 'Terug').click();
  await expect(screen.getByRole('button', '11 verbonden')).toBeVisible();
});

test('thema wordt lokaal opgeslagen en blijft na herladen actief', async ({ app, agent, screen }) => {
  await app.open('/?reset=1');
  await agent.act('Open Instellingen via het accountmenu en stel Thema in op Donker.');
  await expect(screen.getByRole('combobox', 'Thema')).toHaveValue('dark');
  await app.screenshot('donkere-instellingen');
  await screen.getByRole('button', 'Sluiten').click();
  await app.open('/');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Instellingen').click();
  await expect(screen.getByRole('combobox', 'Thema')).toHaveValue('dark');
});

test('Escape sluit het appvenster en geeft het gesprek terug', async ({ app, screen }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Apps verbinden').click();
  await expect(screen.getByRole('dialog', 'Apps verbinden')).toBeVisible();
  await screen.getByRole('button', 'Sluiten').press('Escape');
  await expect(screen.getByRole('dialog', 'Apps verbinden')).toBeHidden();
  await expect(screen.getByRole('textbox', 'Bericht sturen naar Bot')).toBeVisible();
});

test('een lokale goedkeuring blijft bij het juiste bericht na herladen', async ({ app, screen, browser }) => {
  await browser.addInitScript(() => {
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
  });
  await app.open('/?reset=1');
  expect(await browser.evaluate(()=>navigator.onLine)).toBe(true);
  await screen.getByRole('button', 'Marketing Agent').click();
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Vraag toestemming voor de voorbeeldactie');
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').press('Enter');
  await expect(screen.getByRole('heading', 'Toestemming nodig')).toBeVisible();
  await screen.getByRole('button', 'Goedkeuren').click();
  await expect(screen.getByRole('heading', 'Lokaal goedgekeurd')).toBeVisible();
  await app.open('/');
  await expect(screen.getByRole('heading', 'Lokaal goedgekeurd')).toBeVisible();
  await expect(screen.getByRole('button', 'Goedkeuren')).toHaveCount(0);
});

test('voorbeeldgegevens herstellen blijft werken na een opgeslagen concept', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Weg te halen voorbeeldconcept');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', 'Voorbeeldgegevens herstellen').click();
  await expect(screen.getByRole('button', 'Marketing Agent')).toBeVisible();
  await expect(screen.getByRole('button', 'Start a chat with...')).toBeVisible();
  await expectComposerText(browser,'');
});

test('een bewerkte regel behoudt het gekozen gedrag', async ({ app, screen }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Instellingen').click();
  await screen.getByRole('button', 'Regel toevoegen').click();
  await screen.getByRole('textbox', 'Actie').fill('Voorbeeldbestand lezen');
  await screen.getByRole('combobox', 'Gedrag').selectOption('Altijd toestaan');
  await screen.getByRole('button', 'Opslaan').click();
  await screen.getByRole('button', 'Altijd toestaan').click();
  await expect(screen.getByRole('combobox', 'Gedrag')).toHaveValue('Altijd toestaan');
  await screen.getByRole('textbox', 'Actie').fill('Voorbeeldbestand opnieuw lezen');
  await screen.getByRole('button', 'Opslaan').click();
  await expect(screen.getByRole('button', 'Altijd toestaan')).toBeVisible();
  await expect(screen.getByText('Voorbeeldbestand opnieuw lezen', { exact: true })).toBeVisible();
});

test('de tweede routine opent en wijzigt haar eigen status', async ({ app, screen }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await screen.getByRole('button', 'Gespreksdetails').first().click();
  await screen.getByRole('button', /^Routines/).click();
  await screen.getByRole('button', 'Routine toevoegen').click();
  await screen.getByRole('dialog', 'Routine toevoegen').getByRole('textbox', 'Naam').fill('Tweede controlescan');
  await screen.getByRole('dialog', 'Routine toevoegen').getByRole('textbox', 'Planning').fill('Elke vrijdag om 11:00');
  await screen.getByRole('button', 'Opslaan').click();
  await screen.getByRole('button', 'Details bekijken').nth(1).click();
  await expect(screen.getByRole('heading', 'Tweede controlescan')).toBeVisible();
  await screen.getByRole('button', 'Pauzeren').click();
  await expect(screen.getByText('Gepauzeerd', { exact: true })).toBeVisible();
  await screen.getByRole('button', 'Sluiten').click();
  await screen.getByRole('button', /^Routines/).click();
  await screen.getByRole('button', 'Details bekijken').first().click();
  await expect(screen.getByRole('heading', 'Dagelijkse marktscan')).toBeVisible();
  await expect(screen.getByText('Actief', { exact: true })).toBeVisible();
});

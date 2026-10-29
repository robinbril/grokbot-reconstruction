import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('bijlage bewaart echte inhoud per concept en verzonden gesprek', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toBeVisible();
  await screen.getByRole('button', 'Find Customers').click();
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(0);
  await screen.getByRole('button', 'Marketing Agent').click();
  await app.open('/');
  await screen.getByRole('button', 'Bijlage openen: pipeline.txt').click();
  await expect(screen.getByRole('dialog', 'pipeline.txt')).toContainText('exact bewaarde kandidaatpopulatie = 10.');
  await screen.getByRole('button', 'Sluiten', { exact: true }).click();
  await screen.getByRole('button', 'Bericht sturen', { exact: true }).click();
  await expect(screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(1);
  await app.open('/');
  await screen.getByRole('button', 'Bijlage openen: pipeline.txt').click();
  await expect(screen.getByRole('dialog', 'pipeline.txt')).toContainText('A = 4; B = 6.');
  await app.screenshot('bijlage-met-inhoud');
});

test('verwijderde conceptbijlage keert na herladen niet terug', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt')).toBeVisible();
  await screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt').click();
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(0);
  await app.open('/');
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Spraakmodus')).toBeVisible();
});

test('onbeschikbare namespace-opslag houdt bestand en concept zichtbaar onverzonden', async ({ app, screen, browser }) => {
  await browser.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
  });
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Bewaar dit concept bij een opslagfout');
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button', 'Bijlagen opnieuw opslaan')).toBeVisible();
  await screen.getByRole('button', 'Bericht sturen').click();
  await expectComposerText(browser,'Bewaar dit concept bij een opslagfout');
  await expect(screen.getByRole('button', 'Bijlagen opnieuw opslaan')).toBeVisible();
  await expect(screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt')).toBeVisible();
  await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('mislukte bijlage-opruiming veroorzaakt geen dubbele conceptbijlage of verzending', async ({ app, screen, browser }) => {
  await browser.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    let writes = 0;
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (args[1] === 'readwrite' && ++writes >= 2) throw new DOMException('Synthetic cleanup failure', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    };
  });
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toBeVisible();
  await screen.getByRole('button', 'Bericht sturen').click();
  await expect(browser.locator('.message.user')).toHaveCount(1);
  await expect(screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(1);
  await app.open('/');
  await expect(browser.locator('.message.user')).toHaveCount(1);
  await expect(screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(1);
  await expect(screen.getByRole('button', 'Spraakmodus')).toBeVisible();
  await screen.getByRole('button', 'Gespreksopties').click();
  await screen.getByRole('menuitem', 'Gesprek wissen').click();
  await expect(browser.locator('.message.user')).toHaveCount(0);
  await app.open('/');
  await expect(browser.locator('.message.user')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Bijlage verwijderen: pipeline.txt')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Spraakmodus')).toBeVisible();
});

test('opslagherstel valideert bestaande plus nog niet opgeslagen bestanden opnieuw', async ({ app, screen, browser }) => {
  const files = Array(10).fill('tests/fixtures/pipeline.txt');
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Marketing Agent').click();
  await browser.locator('#attachment-input').setInputFiles(files);
  await expect(screen.getByRole('button', 'Bijlage openen: pipeline.txt')).toHaveCount(10);
  await browser.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    (window as any).__demoBlockIDB = true;
    IDBFactory.prototype.open = function (...args: any[]) {
      if ((window as any).__demoBlockIDB) throw new DOMException('Synthetic temporary database failure', 'InvalidStateError');
      return Reflect.apply(original, this, args);
    };
  });
  await app.open('/');
  await browser.locator('#attachment-input').setInputFiles(files);
  await expect(screen.getByRole('button', 'Bijlagen opnieuw opslaan')).toBeVisible();
  await browser.evaluate(() => { (window as any).__demoBlockIDB = false; });
  await screen.getByRole('button', 'Bijlagen opnieuw opslaan').click();
  await expect(screen.getByRole('status').filter({ hasText: 'maximaal 10 bestanden' })).toBeVisible();
  await expect(screen.getByRole('button', 'Bijlagen opnieuw opslaan')).toBeVisible();
  await screen.getByRole('button', 'Bericht sturen').click();
  await expect(browser.locator('.message.user')).toHaveCount(0);
});

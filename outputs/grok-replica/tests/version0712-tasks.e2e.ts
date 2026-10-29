import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function openFixture(app: any, screen: any) {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', { name: '0.71.2 voorbeelden openen', exact: true }).click();
  await expect(screen.getByRole('region', { name: 'Taken', exact: true })).toContainText('Onderzoek voorbereiden');
}

test('0712 taken vastzetten behoudt volgorde en identiteit na herladen', async ({ app, agent, screen, browser }) => {
  await app.open('/?reset=1');
  await agent.act('Open Help en feedback via het Accountmenu.');
  await expect(screen.getByRole('button', { name: '0.71.2 voorbeelden openen', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: '0.71.2 voorbeelden openen', exact: true }).click();
  await screen.getByRole('button', { name: 'Taak openen: Onderzoek voorbereiden', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Terug naar Bot: 0.71.2 voorbeelden', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: 'Taak vastmaken: Onderzoek voorbereiden', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Taak losmaken: Onderzoek voorbereiden', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await screen.getByRole('button', { name: 'Terug naar Bot: 0.71.2 voorbeelden', exact: true }).click();
  await screen.getByRole('button', { name: 'Taak openen: Resultaten controleren', exact: true }).click();
  await screen.getByRole('button', { name: 'Taak vastmaken: Resultaten controleren', exact: true }).click();
  await expect(screen.getByRole('button', { name: /^Vastgemaakte taak:/ })).toHaveCount(2);
  expect(await browser.evaluate(() => Array.from(document.querySelectorAll('[aria-label^="Vastgemaakte taak:"]'), element => element.getAttribute('aria-label')))).toEqual(['Vastgemaakte taak: Onderzoek voorbereiden', 'Vastgemaakte taak: Resultaten controleren']);
  await app.open('/');
  await expect(screen.getByRole('button', { name: /^Vastgemaakte taak:/ })).toHaveCount(2);
  await screen.getByRole('button', { name: 'Taak losmaken: Resultaten controleren', exact: true }).first().click();
  await expect(screen.getByRole('button', { name: 'Vastgemaakte taak: Resultaten controleren', exact: true })).toHaveCount(0);
  await expect(screen.getByRole('button', { name: 'Vastgemaakte taak: Onderzoek voorbereiden', exact: true })).toBeVisible();
  expect(await browser.evaluate(() => getComputedStyle(document.querySelector('.composer')!).borderTopLeftRadius)).toBe('20px');
  await app.screenshot('0712-task-pins');
});

test('0712 taakgesprekken houden eigen concept en berichten apart van hun Bot', async ({ app, screen, browser }) => {
  await openFixture(app, screen);
  await screen.getByRole('button', { name: 'Taak openen: Onderzoek voorbereiden', exact: true }).click();
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Concept bij onderzoek, uitsluitend lokaal');
  await screen.getByRole('button', { name: 'Terug naar Bot: 0.71.2 voorbeelden', exact: true }).click();
  await expectComposerText(browser,'');
  await screen.getByRole('button', { name: 'Taak openen: Resultaten controleren', exact: true }).click();
  await expectComposerText(browser,'');
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Ander taakconcept');
  await screen.getByRole('button', { name: 'Terug naar Bot: 0.71.2 voorbeelden', exact: true }).click();
  await screen.getByRole('button', { name: 'Taak openen: Onderzoek voorbereiden', exact: true }).click();
  await expectComposerText(browser,'Concept bij onderzoek, uitsluitend lokaal');
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').press('Enter');
  await expect(screen.getByRole('region', { name: 'Gesprek', exact: true })).toContainText('Concept bij onderzoek, uitsluitend lokaal');
  await app.open('/');
  await screen.getByRole('button', { name: 'Terug naar Bot: 0.71.2 voorbeelden', exact: true }).click();
  await screen.getByRole('button', { name: 'Taak openen: Resultaten controleren', exact: true }).click();
  await expectComposerText(browser,'Ander taakconcept');
  await expect(screen.getByRole('region', { name: 'Gesprek', exact: true })).not.toContainText('Concept bij onderzoek, uitsluitend lokaal');
  await screen.getByRole('button', { name: 'Taak sluiten', exact: true }).click();
  await expect(screen.getByRole('region', { name: 'Taken', exact: true })).toBeVisible();
});

test('0712 geweigerde taakopslag draait de pin terug en meldt de fout', async ({ app, screen, browser }) => {
  await openFixture(app, screen);
  await screen.getByRole('button', { name: 'Taak openen: Onderzoek voorbereiden', exact: true }).click();
  await browser.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('Synthetic task quota', 'QuotaExceededError'); }; });
  await screen.getByRole('button', { name: 'Taak vastmaken: Onderzoek voorbereiden', exact: true }).click();
  await expect(screen.getByRole('status')).toContainText('Taakwijziging kon niet worden opgeslagen.');
  await expect(screen.getByRole('button', { name: 'Taak vastmaken: Onderzoek voorbereiden', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(screen.getByRole('button', { name: /^Vastgemaakte taak:/ })).toHaveCount(0);
  await app.open('/');
  await expect(screen.getByRole('button', { name: 'Taak vastmaken: Onderzoek voorbereiden', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('0712 corrupte taaknamenruimtes worden verworpen zonder crash of nieuw-chat-alias', async ({ app, screen, browser }) => {
  await openFixture(app, screen);
  for (const conversationId of ['new', '__proto__', 'constructor', 'toString']) {
    await browser.evaluate((bad: string) => {
      const key = 'grok-local-replica-v1';
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.tasks = [{ id: 'invalid-saved-task', name: 'Corrupte taak', parentBotId: 'local-version-0712', conversationId: bad }];
      saved.selected = bad;
      localStorage.setItem(key, JSON.stringify(saved));
    }, conversationId);
    await app.open('/');
    await expect(screen.getByRole('textbox', 'Bericht sturen naar Bot')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Terug naar Bot: 0.71.2 voorbeelden', exact: true })).toHaveCount(0);
    await screen.getByRole('button', { name: '0.71.2 voorbeelden', exact: true }).click();
    await expect(screen.getByRole('button', { name: 'Taak openen: Corrupte taak', exact: true })).toHaveCount(0);
  }
});

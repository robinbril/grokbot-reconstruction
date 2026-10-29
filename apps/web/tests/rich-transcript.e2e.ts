import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function openExamples(app: any, screen: any) {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', 'Gespreksvoorbeelden openen').click();
}

test('rijke lokale voorbeelden tonen tabel code formule en veilige bronlinks', async ({ app, agent, screen, browser }) => {
  await app.open('/?reset=1');
  await agent.act('Open Help en feedback via het accountmenu en open Gespreksvoorbeelden openen.');
  await expect(screen.getByRole('heading', 'Pipelinekwaliteit')).toBeVisible();
  await expect(screen.getByRole('table')).toContainText('A 4 B 6');
  await expect(screen.getByRole('button', 'Code kopiëren').first()).toBeVisible();
  await expect(browser.locator('pre code').first()).toContainText('"total": 10');
  await expect(browser.locator('math').first()).toBeVisible();
  await expect(screen.getByRole('link', 'Bron: Vercel Workflow')).toHaveAttribute('href', 'https://vercel.com/docs/workflow');
  await expect(browser.locator('.message-body img, .message-body iframe, .message-body script, .message-body [onerror]')).toHaveCount(0);
  await expect(browser.locator('.message-body a[href^="javascript:"]')).toHaveCount(0);
  await expect(screen.getByText('Lokaal gespreksvoorbeeld · geen modeluitvoering', { exact: true })).toBeVisible();
  await app.screenshot('rijke-gespreksweergave');
});

test('antwoordcontext en vraagkeuze blijven per gesprek bewaard', async ({ app, screen, browser }) => {
  await openExamples(app, screen);
  await browser.locator('.message.bot').first().click();await screen.getByRole('button', 'Beantwoorden').first().click();
  await expect(screen.getByRole('region', 'Antwoordcontext')).toContainText('Pipelinekwaliteit');
  await screen.getByRole('button', 'Antwoordcontext verwijderen').click();
  await expect(screen.getByRole('region', 'Antwoordcontext')).toHaveCount(0);
  await browser.locator('.message.bot').first().click();await screen.getByRole('button', 'Beantwoorden').first().click();
  await expect(screen.getByRole('region', 'Antwoordcontext')).toContainText('Pipelinekwaliteit');
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Controleer deze populatie');
  await screen.getByRole('button', 'Marketing Agent').click();
  await expect(screen.getByRole('region', 'Antwoordcontext')).toHaveCount(0);
  await screen.getByRole('button', 'Gespreksvoorbeelden', { exact: true }).click();
  await expect(screen.getByRole('region', 'Antwoordcontext')).toContainText('Pipelinekwaliteit');
  await app.open('/');
  await expectComposerText(browser,'Controleer deze populatie');
  await expect(screen.getByRole('region', 'Antwoordcontext')).toBeVisible();
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').press('Enter');
  await expect(screen.getByRole('region', 'Antwoordcontext')).toHaveCount(0);
  // Quoted transcript context has an explicit accessible group, independent of visual markup.
  await expect(screen.getByRole('group', 'Antwoord op Pipelinekwaliteit')).toBeVisible();
  await screen.getByRole('radio', 'Databetrouwbaarheid').check();
  await screen.getByRole('button', 'Antwoord bevestigen').click();
  await expect(screen.getByText('Gekozen: Databetrouwbaarheid', { exact: true })).toBeVisible();
  await app.open('/');
  await expect(screen.getByText('Gekozen: Databetrouwbaarheid', { exact: true })).toBeVisible();
  await expect(screen.getByRole('group', 'Antwoord op Pipelinekwaliteit')).toBeVisible();
  await expect(screen.getByRole('button', 'Antwoord bevestigen')).toHaveCount(0);
});

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('lang rijk gesprek houdt het berichtvak binnen desktop en smal venster', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', 'Gespreksvoorbeelden openen').click();
  const input = screen.getByRole('textbox', 'Bericht sturen naar Bot');
  const desktop = await input.boundingBox();
  expect(desktop).not.toBeNull();
  expect(desktop!.y).toBeGreaterThanOrEqual(0);
  expect(desktop!.y + desktop!.height).toBeLessThanOrEqual(748);
  const scroll = await browser.evaluate(() => {
    const transcript = document.querySelector('.transcript')!;
    return { content: transcript.scrollHeight, viewport: transcript.clientHeight };
  });
  expect(scroll.content).toBeGreaterThan(scroll.viewport);
  await browser.locator('.message.bot').first().click();await screen.getByRole('button', 'Beantwoorden').first().click();
  await expect(screen.getByRole('region', 'Antwoordcontext')).toBeVisible();
  const replying = await input.boundingBox();
  expect(replying!.y + replying!.height).toBeLessThanOrEqual(748);
  await app.screenshot('desktop-rich-fixed-composer');
  await browser.setViewport({ width: 390, height: 740 });
  const narrow = await input.boundingBox();
  expect(narrow).not.toBeNull();
  expect(narrow!.x).toBeGreaterThanOrEqual(0);
  expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(390);
  expect(narrow!.y).toBeGreaterThanOrEqual(0);
  expect(narrow!.y + narrow!.height).toBeLessThanOrEqual(740);
  await app.screenshot('narrow-rich-fixed-composer');
});

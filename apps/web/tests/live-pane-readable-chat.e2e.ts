import { test, type Browser } from '@e2e-dev/web';
import { expect } from 'e2e';

// Measure rendered geometry, without assuming how the layout allocates its padding.
async function geometry(browser: Browser) {
  return browser.evaluate(() => {
    const rect = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) throw new Error(`Missing rendered layout element: ${selector}`);
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
    };
    const transcript = document.querySelector<HTMLElement>('.transcript')!;
    const conversation = document.querySelector<HTMLElement>('.conversation')!;
    return {
      transcript: rect('.transcript'),
      bot: rect('.message.bot .message-body'),
      user: rect('.message.user .bubble'),
      row: rect('.message.bot'),
      composer: rect('#composer-form'),
      pane: document.querySelector('.context-pane') ? rect('.context-pane') : null,
      transcriptOverflow: transcript.scrollWidth - transcript.clientWidth,
      conversationOverflow: conversation.scrollWidth - conversation.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}

for (const theme of ['light', 'dark']) {
  test(`${theme} Computer pane preserves readable chat at desktop and constrained widths`, async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1600, height: 900 });
    await app.open('/?reset=1');
    await browser.evaluate(async () => {
      await (window as unknown as { productSurfaces: { ready: Promise<void> } }).productSurfaces.ready;
      history.replaceState(null, '', '/');
    });
    await screen.getByRole('button', 'Marketing Agent').click();
    await screen.getByRole('button', 'Accountmenu').click();
    await screen.getByRole('menuitem', 'Instellingen').click();
    const settings = screen.getByRole('dialog', 'Instellingen');
    await settings.getByLabel('Thema').selectOption({ value: theme });
    await settings.getByRole('button', 'Sluiten', { exact: true }).click();
    await expect(browser.locator('html')).toHaveAttribute('data-theme', theme);

    // Actual local computation creates both messages through the existing composer UI.
    await screen.getByRole('button', 'Bijvoegen').click();
    await screen.getByRole('menuitem', 'Gespreksbewerking').click();
    const operation = screen.getByRole('dialog', 'Gespreksbewerking');
    await operation.getByLabel('Lokale bewerking').selectOption({ value: 'upper' });
    await operation.getByLabel('Uitvoervorm').selectOption({ value: 'short' });
    await operation.getByLabel('Antwoordweergave').selectOption({ value: 'bubble' });
    await operation.getByRole('button', 'Gebruiken').click();
    const text = 'Readable messages need enough room for a normal sentence while the Computer pane is open. '.repeat(4).trim();
    const input = screen.getByRole('textbox', 'Bericht sturen naar Bot');
    await input.fill(text);
    await input.press('Enter');
    await expect(browser.locator('.message.user .bubble')).toContainText(text);
    await expect(browser.locator('.message.bot .message-body')).toContainText(text.toUpperCase());
    await expect(browser.locator('[data-chat-run-id] [role="status"]')).toContainText('Voltooid');

    await screen.getByRole('radio', 'Echte harness').check();
    await expect(screen.getByRole('radio', 'Echte harness')).toBeChecked();
    await screen.getByRole('button', 'Computer openen').click();
    await expect(screen.getByRole('region', 'Echte harness computer')).toBeVisible();
    await expect(screen.getByRole('tab', 'Terminal')).toBeVisible();
    const grip = screen.getByRole('separator', 'Breedte van gespreksdetails');
    await grip.press('Home');
    for (let step = 0; step < 18; step++) await grip.press('ArrowLeft');
    await expect(grip).toHaveAttribute('aria-valuenow', '600');
    await expect.poll(async () => (await geometry(browser)).pane?.width).toBeCloseTo(600, 1);

    // Soft checks retain evidence for the narrow window and restored centering too.
    for (const width of [1600, 1240]) {
      if (width === 1240) {
        await browser.setViewport({ width, height: 900 });
        await grip.press('End');
        await expect.poll(async () => (await geometry(browser)).transcript.width).toBeCloseTo(424, 1);
      }
      const measured = await geometry(browser);
      console.log(`Computer pane ${theme} ${width}: ${JSON.stringify(measured)}`);
      await app.screenshot(`readable-chat-${theme}-${width}-computer`);
      expect.soft(measured.transcript.width, 'The pane leaves usable chat space').toBeGreaterThanOrEqual(424);
      expect.soft(measured.bot.width, `Bot prose stays readable: ${JSON.stringify(measured)}`).toBeGreaterThanOrEqual(width === 1600 ? 400 : 300);
      expect.soft(measured.user.width, 'A long user message retains readable line length').toBeGreaterThanOrEqual(width === 1600 ? 300 : 240);
      for (const content of [measured.bot, measured.user, measured.composer]) {
        expect.soft(content.left).toBeGreaterThanOrEqual(measured.transcript.left - 1);
        expect.soft(content.right).toBeLessThanOrEqual(measured.transcript.right + 1);
      }
      expect.soft(measured.composer.top).toBeGreaterThanOrEqual(0);
      expect.soft(measured.composer.bottom).toBeLessThanOrEqual(900);
      expect.soft(measured.transcriptOverflow).toBeLessThanOrEqual(1);
      expect.soft(measured.conversationOverflow).toBeLessThanOrEqual(1);
      expect.soft(measured.pageOverflow).toBeLessThanOrEqual(1);
    }

    await screen.getByRole('button', 'Details sluiten').click();
    await expect(browser.locator('.context-pane')).toHaveCount(0);
    await expect.poll(async () => (await geometry(browser)).row.width).toBeGreaterThanOrEqual(600);
    const closed = await geometry(browser);
    const leftGap = closed.row.left - closed.transcript.left;
    const rightGap = closed.transcript.right - closed.row.right;
    expect.soft(Math.abs(leftGap - rightGap), 'Closing Computer restores a centered message column').toBeLessThanOrEqual(3);
    expect.soft(closed.row.width).toBeLessThanOrEqual(741);
    expect.soft(closed.composer.bottom).toBeLessThanOrEqual(900);
    await app.screenshot(`readable-chat-${theme}-computer-closed`);
  });
}

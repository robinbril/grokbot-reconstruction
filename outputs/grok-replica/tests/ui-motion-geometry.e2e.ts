import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('native paneformule bewaart424px chat en gecentreerde driedelige headergrid', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', { name: 'Marketing Agent', exact: true }).click();
  await screen.getByRole('button', { name: 'Gespreksdetails', exact: true }).first().click();
  for (const [width, inset] of [[973, 0], [1033, 0], [1120, 180]]) {
    await browser.setViewport({ width, height: 748 });
    const measured = await browser.evaluate(async (inset: number) => {
      document.querySelector<HTMLElement>('#app')!.style.setProperty('--sand-window-controls-inset', String(inset) + 'px');
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      document.querySelector('#app')!.getAnimations({ subtree: true }).forEach(a => a.finish());
      const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect();
      const pane = document.querySelector('.context-pane')!.getBoundingClientRect();
      const chat = document.querySelector('.conversation')!.getBoundingClientRect();
      const identity = document.querySelector('[data-ui-header-identity]')!.getBoundingClientRect();
      const expected = Math.min(320 + Math.max(0, inset - 140), Math.max(0, innerWidth - sidebar.width - 424));
      const h = document.querySelector('.conversation-header')!, s = getComputedStyle(h);
      return { pane: pane.width, expected, chat: chat.width - pane.width, centerDelta: Math.abs((identity.left + identity.width / 2) - (chat.left + (chat.width - pane.width) / 2)), grid: s.display, identityColumn: getComputedStyle(document.querySelector('[data-ui-header-identity]')!).gridColumnStart, controlsColumn: getComputedStyle(document.querySelector('.header-buttons')!).gridColumnStart, sharedSidebarValid: Number.isFinite(parseFloat(getComputedStyle(document.querySelector('#app')!).getPropertyValue('--sand-sidebar-width'))) };
    }, inset);
    expect(Math.abs(measured.pane - measured.expected)).toBeLessThan(.5);
    expect(measured.chat).toBeGreaterThanOrEqual(424); expect(measured.centerDelta).toBeLessThan(.5);
    expect(measured.grid).toBe('grid'); expect(measured.identityColumn).toBe('2'); expect(measured.controlsColumn).toBe('3');
    expect(measured.sharedSidebarValid).toBe(true);
  }
  await app.screenshot('source-pane-clamp-and-grid');
});

import {expectComposerText} from './fixtures/composer-assertions';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('0712 alle13 ruimtelijke statussen tekenen werkelijk en kunnen pauzeren', async ({ app, agent, screen, browser }) => {
  await app.open('/?reset=1');
  await agent.act('Open Help en feedback via het Accountmenu.');
  await expect(screen.getByRole('button', { name: 'Bewegingslab openen', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: 'Bewegingslab openen', exact: true }).click();
  const kinds = { thinking: 'dots', orbit: 'orbit', radar: 'radar', progress: 'progress', spawning: 'gather', dictating: 'wave', sending: 'send', receiving: 'receive', uploading: 'dock', bouncing: 'ball', writing: 'pencil', alerting: 'bang', 'powering-down': 'standby' };
  for (const [name, kind] of Object.entries(kinds)) {
    await screen.getByRole('combobox', { name: 'Status', exact: true }).selectOption({ value: name });
    await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-morph-kind', kind);
    const visual = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"] [data-avatar-morphs]')?.innerHTML || '');
    if (kind !== 'ball') await expect.poll(visual).not.toBe('');
  }
  await screen.getByRole('switch', { name: 'Muis volgen', exact: true }).click();
  await screen.getByRole('combobox', { name: 'Status', exact: true }).selectOption({ value: 'bouncing' });
  const body = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"] [data-avatar-body]')?.getAttribute('d'));
  const ballStart = await body();
  await expect.poll(body).not.toBe(ballStart);
  await screen.getByRole('combobox', { name: 'Status', exact: true }).selectOption({ value: 'orbit' });
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-morph-kind', 'orbit');
  const current = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"] [data-avatar-morphs]')?.innerHTML);
  const active = await current();
  await expect.poll(current).not.toBe(active);
  await screen.getByRole('button', { name: 'Pauzeren', exact: true }).click();
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-playing', 'false');
  await browser.evaluate(async () => { for (let i = 0; i < 60; i++) await new Promise<void>(r => requestAnimationFrame(() => r())); });
  const first = await current();
  await browser.evaluate(async () => { for (let i = 0; i < 30; i++) await new Promise<void>(r => requestAnimationFrame(() => r())); });
  expect(await current()).toBe(first);
  await screen.getByRole('button', { name: 'Herstellen', exact: true }).click();
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-morph-amount', '0');
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-morph-kind', '');
  expect(await current()).toBe('');
  expect(await browser.evaluate(() => Array.from(document.querySelectorAll('[data-testid="motion-preview"] [data-avatar-eye]')).every(p => !!p.getAttribute('d')))).toBe(true);
  await app.screenshot('0712-orbit-particles-paused');
});

test('0712 een trage iconenbundel blokkeert de chat niet en behoudt concept en focus', async ({ app, screen, browser }) => {
  await browser.addInitScript(() => {
    const original = window.fetch.bind(window);
    let release: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    (window as any).releaseIconsFixture = () => release();
    window.fetch = async (...args) => {
      if (String(args[0]).includes('grok-icons.json')) await wait;
      return original(...args);
    };
  });
  await app.open('/?reset=1');
  const composer = screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true });
  await expect(composer).toBeVisible();
  await composer.fill('Dit concept blijft staan terwijl iconen laden.');
  await browser.evaluate(async () => {
    (window as any).releaseIconsFixture();
    await (await fetch('/assets/grok-icons.json')).json();
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await expectComposerText(browser,'Dit concept blijft staan terwijl iconen laden.');
  expect(await browser.evaluate(() => document.activeElement===document.querySelector('#message-input'))).toBe(true);
  await expect(screen.getByRole('button', 'Accountmenu')).toBeVisible();
});
test('0712 iconenlab toont808 echte broniconen in beide varianten en filtert op naam', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', { name: 'Iconenlab openen', exact: true }).click();
  await expect(screen.getByRole('dialog', { name: 'Iconenlab', exact: true })).toBeVisible();
  await expect(screen.getByTestId('icon-count')).toHaveText('808');
  const count = () => browser.evaluate(() => document.querySelectorAll('[data-testid="icon-grid"] [data-icon-name]').length);
  expect(await count()).toBe(808);
  expect(await browser.evaluate(() => document.querySelectorAll('[data-testid="icon-grid"] [data-icon-name] svg path').length)).toBe(808);
  await screen.getByRole('textbox', { name: 'Iconen zoeken', exact: true }).fill('account');
  expect(await browser.evaluate(() => document.querySelectorAll('[data-testid="icon-grid"] [data-icon-name="account"] svg path').length)).toBe(1);
  // Account intentionally shares the same source glyph in both variants.
  // Add has distinct source outlines and demonstrates a real visual switch.
  await screen.getByRole('textbox', { name: 'Iconen zoeken', exact: true }).fill('add');
  const path = () => browser.evaluate(() => document.querySelector('[data-testid="icon-grid"] [data-icon-name="add"] svg path')?.getAttribute('d'));
  expect(await path()).toBeTruthy();
  const outline = await path();
  await screen.getByRole('switch', { name: 'Gevulde iconen', exact: true }).click();
  await expect(screen.getByRole('switch', { name: 'Gevulde iconen', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(path).not.toBe(outline);
  await screen.getByRole('textbox', { name: 'Iconen zoeken', exact: true }).fill('__geen_iconen__');
  expect(await count()).toBe(0);
  await expect(screen.getByRole('status')).toHaveText('Geen iconen gevonden.');
});

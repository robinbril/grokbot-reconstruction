import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function openLab(app: any, screen: any) {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', { name: 'Bewegingslab openen', exact: true }).click();
  await expect(screen.getByRole('dialog', { name: 'Bewegingslab', exact: true })).toBeVisible();
}

test('0712 bewegingslab bevat25 vormen en28 clips en projecteert echte muisreactie', async ({ app, agent, screen, browser }) => {
  await app.open('/?reset=1');
  await agent.act('Open Help en feedback via het Accountmenu.');
  await expect(screen.getByRole('button', { name: 'Bewegingslab openen', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: 'Bewegingslab openen', exact: true }).click();
  await expect(screen.getByRole('combobox', { name: 'Vorm', exact: true }).getByRole('option')).toHaveCount(25);
  await expect(screen.getByRole('combobox', { name: 'Animatieclip', exact: true }).getByRole('option')).toHaveCount(28);
  await screen.getByRole('combobox', { name: 'Vorm', exact: true }).selectOption({ value: 'house' });
  await screen.getByRole('button', { name: 'Pauzeren', exact: true }).click();
  const preview = screen.getByTestId('motion-preview');
  const d = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"] [data-avatar-body]')?.getAttribute('d'));
  const before = await d();
  const box = await preview.boundingBox();
  if (!box) throw new Error('Motion preview has no visible geometry');
  await browser.mouse.move(box.x + 2, box.y + box.height / 2);
  await expect.poll(d).not.toBe(before);
  const left = await d();
  await browser.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await expect.poll(d).not.toBe(left);
  await screen.getByRole('combobox', { name: 'Muisbereik', exact: true }).selectOption({ value: 'global' });
  await expect(preview).toHaveAttribute('data-pointer-mode', 'global');
  const localPose = await d();
  await browser.mouse.move(5, 5);
  await expect.poll(d).not.toBe(localPose);
  await app.screenshot('0712-pointer-body-projection');
});

test('0712 clips spelen en pauzeren werkelijk en Herstellen geeft de beginpose terug', async ({ app, screen, browser }) => {
  await openLab(app, screen);
  await screen.getByRole('combobox', { name: 'Animatieclip', exact: true }).selectOption({ value: 'Working_A' });
  await screen.getByRole('button', { name: 'Afspelen', exact: true }).click();
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-playing', 'true');
  const frameCount = () => browser.evaluate(() => Number(document.querySelector('[data-testid="motion-preview"]')?.getAttribute('data-frame-count')));
  await expect.poll(frameCount).toBeGreaterThan(2);
  await screen.getByRole('switch', { name: 'Muis volgen', exact: true }).click();
  const clipTime = () => browser.evaluate(() => Number(document.querySelector('[data-testid="motion-preview"]')?.getAttribute('data-clip-time')));
  const firstTime = await clipTime();
  await expect.poll(clipTime).not.toBe(firstTime);
  const paths = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"] svg')?.innerHTML);
  const activeGeometry = await paths();
  await expect.poll(paths).not.toBe(activeGeometry);
  await screen.getByRole('button', { name: 'Pauzeren', exact: true }).click();
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-playing', 'false');
  await browser.evaluate(async () => { for (let i = 0; i < 60; i++) await new Promise<void>(r => requestAnimationFrame(() => r())); });
  const pausedTime = await clipTime(), pausedPath = await paths();
  await browser.evaluate(async () => { for (let i = 0; i < 30; i++) await new Promise<void>(r => requestAnimationFrame(() => r())); });
  expect(await clipTime()).toBe(pausedTime); expect(await paths()).toBe(pausedPath);
  await screen.getByRole('button', { name: 'Herstellen', exact: true }).click();
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-clip-time', '0');
  await app.screenshot('0712-clips-pause-reset');
  await screen.getByRole('button', { name: 'Bewegingslab sluiten', exact: true }).click();
  await expect(screen.getByRole('dialog', { name: 'Bewegingslab', exact: true })).toHaveCount(0);
});

test('0712 verminderde beweging houdt het poppetje statisch bij muisinput', async ({ app, screen, browser }) => {
  await browser.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query.includes('prefers-reduced-motion') ? ({ matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } } as MediaQueryList) : original(query);
  });
  await openLab(app, screen);
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-reduced-motion', 'true');
  const d = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"] [data-avatar-body]')?.getAttribute('d'));
  const before = await d();
  const box = await screen.getByTestId('motion-preview').boundingBox();
  if (!box) throw new Error('Motion preview missing');
  await browser.mouse.move(box.x + 2, box.y + box.height / 2);
  await browser.mouse.move(box.x + box.width - 2, box.y + 2);
  const count = () => browser.evaluate(() => document.querySelector('[data-testid="motion-preview"]')?.getAttribute('data-frame-count'));
  const beforeCount = await count();
  await browser.evaluate(async () => { for (let i = 0; i < 30; i++) await new Promise<void>(r => requestAnimationFrame(() => r())); });
  expect(await d()).toBe(before);
  expect(await count()).toBe(beforeCount);
  await expect(screen.getByTestId('motion-preview')).toHaveAttribute('data-playing', 'false');
});

test('0712 traag geladen bewegingsdata opent geen lab nadat Help is gesloten', async ({ app, screen, browser }) => {
  await browser.addInitScript(() => {
    const original = window.fetch.bind(window);
    let release: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    (window as any).releaseMotionFixture = async () => { release(); await wait; };
    window.fetch = async (...args) => {
      if (String(args[0]).includes('avatar-motion-data.json')) await wait;
      return original(...args);
    };
  });
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Accountmenu').click();
  await screen.getByRole('menuitem', 'Help en feedback').click();
  await screen.getByRole('button', { name: 'Bewegingslab openen', exact: true }).click();
  await screen.getByRole('button', { name: 'Sluiten', exact: true }).click();
  await expect(screen.getByRole('dialog')).toHaveCount(0);
  await browser.evaluate(async () => {
    await (window as any).releaseMotionFixture();
    const response = await fetch('/assets/avatar-motion-data.json'); await response.json();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(screen.getByRole('dialog')).toHaveCount(0);
  await expect(screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true })).toBeVisible();
});

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('overgangenlab toont echte bronduur en geometrie voor de gemeten layoutkanalen', async ({ app, screen, browser }) => {
  await app.open('/ui-motion.html');
  await expect(screen.getByRole('heading', { name: 'UI-overgangen', exact: true })).toBeVisible();
  await expect(screen.getByRole('switch', { name: 'Inspectiestand', exact: true })).toHaveAttribute('aria-checked', 'true');
  const cases = { section: 260, header: 400, reactionX: 300, reactionY: 300, lateShrink: 200, peek: 435, teamResize: 240, teamRetire: 80, teamEnter: 120, composerPadding: 300 };
  const sample = () => browser.evaluate(() => {
    const root = document.querySelector('[data-testid="ui-motion-preview"]')!;
    const animations = root.getAnimations({ subtree: true });
    const a = animations.find(a => (a.effect as KeyframeEffect)?.target?.hasAttribute('data-ui-motion-target'));
    if (!a) return null;
    const effect = a.effect as KeyframeEffect, target = effect.target as HTMLElement, r = target.getBoundingClientRect(), s = getComputedStyle(target);
    return { duration: effect.getTiming().duration, easing: effect.getTiming().easing, currentTime: a.currentTime, state: a.playState, keys: effect.getKeyframes(), visual: [r.x, r.y, r.width, r.height, s.opacity, s.paddingTop, s.getPropertyValue('--sand-ts-peek')] };
  });
  for (const [name, duration] of Object.entries(cases)) {
    await screen.getByRole('combobox', { name: 'Overgang', exact: true }).selectOption({ value: name });
    await screen.getByRole('button', { name: 'Starten', exact: true }).click();
    const first = await sample(); expect(first).not.toBeNull();
    expect(first!.duration).toBe(duration); expect(first!.state).toBe('paused');
    expect(first!.keys.length).toBeGreaterThanOrEqual(2);
    await screen.getByRole('button', { name: 'Halverwege', exact: true }).click();
    const halfway = await sample(); expect(halfway!.currentTime).toBeCloseTo(duration / 2, 1);
    expect(halfway!.visual).not.toEqual(first!.visual);
    if (['header', 'reactionX', 'reactionY', 'lateShrink', 'teamResize'].includes(name)) expect(halfway!.easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
    await screen.getByRole('button', { name: 'Voltooien', exact: true }).click();
    await expect.poll(() => browser.evaluate(() => document.querySelector('[data-testid="ui-motion-preview"]')!.getAnimations({ subtree: true }).length)).toBe(0);
  }
  await app.screenshot('source-ui-motion-runtime');
});

test('onderbroken headerbeweging blijft op zijn zichtbare plek en oude effecten verdwijnen', async ({ app, screen, browser }) => {
  await app.open('/ui-motion.html');
  await screen.getByRole('combobox', { name: 'Overgang', exact: true }).selectOption({ value: 'header' });
  await screen.getByRole('button', { name: 'Starten', exact: true }).click();
  await screen.getByRole('button', { name: 'Halverwege', exact: true }).click();
  const left = () => browser.evaluate(() => document.querySelector('[data-testid="ui-motion-preview"] [data-ui-motion-target]')!.getBoundingClientRect().left);
  const before = await left();
  await screen.getByRole('button', { name: 'Onderbreken', exact: true }).click();
  expect(Math.abs((await left()) - before)).toBeLessThan(.5);
  expect(await browser.evaluate(() => document.querySelector('[data-testid="ui-motion-preview"]')!.getAnimations({ subtree: true }).length)).toBe(1);
  await screen.getByRole('button', { name: 'Herstellen', exact: true }).click();
  expect(await browser.evaluate(() => document.querySelector('[data-testid="ui-motion-preview"]')!.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await browser.evaluate(() => document.querySelectorAll('[data-ui-motion-retiring]').length)).toBe(0);
});

test('runtime bewaakt brontriggers en laat horizontaal scrollende inhoud met rust', async ({ app, browser }) => {
  await app.open('/ui-motion.html');
  const actual = await browser.evaluate(async () => {
    const { createUIMotion } = await import('/ui-motion.js');
    const root = document.createElement('section'); root.style.cssText = 'position:fixed;left:10px;top:10px;width:300px;height:180px;'; document.body.append(root);
    const node = document.createElement('div'); node.style.cssText = 'height:60px;width:120px;'; root.append(node);
    const controller = createUIMotion({ root, inspect: true });
    const rect = node.getBoundingClientRect();
    const initial = controller.section(node, { fromHeight: 10, toHeight: 60, initial: true });
    const stale = controller.header(node, { visualLeft: rect.left + 100, clickedAtMs: performance.now() - 401, previousInfoOpen: false, isInfoOpen: true, reason: 'info-toggle' });
    const wrongTrigger = controller.header(node, { visualLeft: rect.left + 100, clickedAtMs: performance.now(), previousInfoOpen: false, isInfoOpen: true, reason: 'resize' });
    const ineligible = controller.lateShrink(node, { fromHeight: 100, toHeight: 60, eligible: false, committed: true });
    const uncommitted = controller.lateShrink(node, { fromHeight: 100, toHeight: 60, eligible: true, committed: false });
    const tiny = controller.lateShrink(node, { fromHeight: 60.9, toHeight: 60, eligible: true, committed: true });
    const skipped = [initial, stale, wrongTrigger, ineligible, uncommitted, tiny].every(a => a === null);
    const before = root.getAnimations({ subtree: true }).length;
    const host = document.createElement('div'); host.style.cssText = 'width:200px;height:80px;overflow:auto;'; root.append(host);
    const nested = document.createElement('div'); nested.style.cssText = 'width:80px;overflow-x:auto;'; nested.innerHTML = '<div style="width:300px;height:20px"></div>'; host.append(nested);
    const dispose = controller.bindPeek(host);
    nested.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true }));
    const nestedUnchanged = !host.hasAttribute('data-peeking') && !(parseFloat(getComputedStyle(host).getPropertyValue('--sand-ts-peek')) > 0);
    dispose(); const clean = controller.bindPeek(host);
    host.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 40, bubbles: true }));
    const verticalUnchanged = !host.hasAttribute('data-peeking');
    host.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true }));
    const realPeek = host.hasAttribute('data-peeking') && parseFloat(getComputedStyle(host).getPropertyValue('--sand-ts-peek')) > 0;
    controller.destroy();
    const after = root.getAnimations({ subtree: true }).length;
    host.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true }));
    const noLateMutation = !host.hasAttribute('data-peeking'); clean(); root.remove();
    return { skipped, before, nestedUnchanged, verticalUnchanged, realPeek, after, noLateMutation };
  });
  expect(actual).toEqual({ skipped: true, before: 0, nestedUnchanged: true, verticalUnchanged: true, realPeek: true, after: 0, noLateMutation: true });
});

test('verminderde beweging slaat layoutveren over en bewaart de echte120ms paddingovergang', async ({ app, screen, browser }) => {
  await app.open('/ui-motion.html');
  await screen.getByRole('switch', { name: 'Verminderde beweging', exact: true }).click();
  await expect(screen.getByRole('switch', { name: 'Verminderde beweging', exact: true })).toHaveAttribute('aria-checked', 'true');
  for (const name of ['section', 'header', 'reactionX', 'reactionY', 'lateShrink', 'peek']) {
    await screen.getByRole('combobox', { name: 'Overgang', exact: true }).selectOption({ value: name });
    await screen.getByRole('button', { name: 'Starten', exact: true }).click();
    expect(await browser.evaluate(() => document.querySelector('[data-testid="ui-motion-preview"]')!.getAnimations({ subtree: true }).length)).toBe(0);
  }
  await screen.getByRole('combobox', { name: 'Overgang', exact: true }).selectOption({ value: 'composerPadding' });
  await screen.getByRole('button', { name: 'Starten', exact: true }).click();
  const effect = await browser.evaluate(() => {
    const a = document.querySelector('[data-testid="ui-motion-preview"]')!.getAnimations({ subtree: true })[0];
    return { duration: a.effect!.getTiming().duration, easing: a.effect!.getTiming().easing };
  });
  expect(effect).toEqual({ duration: 120, easing: 'ease' });
});

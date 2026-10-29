import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('teamsetup vaste header draait als echte labanimatie met80ms backwards delay', async ({ app, screen, browser }) => {
  await app.open('/ui-motion.html');
  await screen.getByRole('combobox', { name: 'Overgang', exact: true }).selectOption({ value: 'teamPin' });
  await screen.getByRole('button', { name: 'Starten', exact: true }).click();
  const first = await browser.evaluate(() => {
    const t = document.querySelector('[data-testid="ui-motion-preview"] [data-ui-motion-target]')!;
    const a = t.getAnimations()[0]; const e = a.effect!;
    return { duration: e.getTiming().duration, delay: e.getTiming().delay, fill: e.getTiming().fill, left: t.getBoundingClientRect().top };
  });
  expect(first.duration).toBe(240); expect(first.delay).toBe(80); expect(first.fill).toBe('backwards');
  await screen.getByRole('button', { name: 'Halverwege', exact: true }).click();
  expect(await browser.evaluate(() => document.querySelector('[data-testid="ui-motion-preview"] [data-ui-motion-target]')!.getBoundingClientRect().top)).not.toBe(first.left);
});

test('teamsetup pinroute vereist werkelijk retirement en bewaart de exacte nulgrens en overlap', async ({ app, browser }) => {
  await app.open('/ui-motion.html');
  const actual = await browser.evaluate(async () => {
    const { createUIMotion } = await import('/ui-motion.js');
    const root = document.createElement('div'), node = document.createElement('div'); document.body.append(root); root.append(node);
    const c = createUIMotion({ root, inspect: true }); const top = node.getBoundingClientRect().top;
    const noRetirement = c.teamPin(node, { previousTop: top + 50, retiring: false });
    const zero = c.teamPin(node, { previousTop: top, retiring: true });
    const tiny = c.teamPin(node, { previousTop: top + .1, retiring: true });
    const shrink = c.teamPin(node, { previousTop: top + 30, retiring: true, collapse: true });
    const effects = node.getAnimations().map(a => ({ duration: a.effect!.getTiming().duration, delay: a.effect!.getTiming().delay }));
    c.setReducedMotion(true); const afterReduced = node.getAnimations().length;
    const reduced = c.teamPin(node, { previousTop: top + 50, retiring: true });
    c.setReducedMotion(false); node.remove(); const detached = c.teamPin(node, { previousTop: top + 50, retiring: true });
    c.destroy(); root.remove();
    return { skipped: noRetirement === null && zero === null && reduced === null && detached === null, tiny: Boolean(tiny), shrink: Boolean(shrink), effects, afterReduced };
  });
  expect(actual.skipped).toBe(true); expect(actual.tiny).toBe(true); expect(actual.shrink).toBe(true);
  expect(actual.effects).toEqual([{ duration: 240, delay: 80 }, { duration: 300, delay: 80 }]); expect(actual.afterReduced).toBe(0);
});

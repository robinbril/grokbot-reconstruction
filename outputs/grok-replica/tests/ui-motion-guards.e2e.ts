import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('team reduced motion verwijdert logisch zonder clone en behoudt enteronderscheid', async ({ app, browser }) => {
  await app.open('/ui-motion.html');
  const result = await browser.evaluate(async () => {
    const { createUIMotion } = await import('/ui-motion.js');
    const root = document.createElement('div'), node = document.createElement('div'); document.body.append(root); root.append(node);
    const c = createUIMotion({ root, inspect: true, reducedMotion: true });
    const resize = c.teamResize(node, { fromHeight: 20, toHeight: 40 });
    const retire = c.teamRetire(node);
    const clones = root.querySelectorAll('[data-ui-motion-retiring]').length;
    const removed = !node.isConnected;
    const entered = document.createElement('div'); root.append(entered);
    const enter = c.teamEnter(entered); const duration = enter?.effect?.getTiming().duration;
    c.setReducedMotion(false); c.teamResize(entered, { fromHeight: 10, toHeight: 50 });
    c.setReducedMotion(true);
    const resizeLeft = c.diagnostics().some(d => d.name === 'teamResize');
    c.destroy(); root.remove();
    return { noResize: resize === null, noRetire: retire === null, clones, removed, duration, resizeLeft };
  });
  expect(result).toEqual({ noResize: true, noRetire: true, clones: 0, removed: true, duration: 120, resizeLeft: false });
});

test('native gestureprovider bewaakt began ended en owned unsubscribe zonder timerlekkage', async ({ app, browser }) => {
  await app.open('/ui-motion.html');
  const result = await browser.evaluate(async () => {
    const { createUIMotion } = await import('/ui-motion.js');
    const root = document.createElement('div'); document.body.append(root);
    const c = createUIMotion({ root, inspect: true });
    let phase = 'began', subscriber: (() => void) | null = null, disposed = 0;
    const gestureState = { get: () => phase, subscribe: (fn: () => void) => { subscriber = fn; return () => { disposed++; subscriber = null; }; } };
    const originalSet = window.setTimeout, originalClear = window.clearTimeout;
    let id = 90000; const timers = new Map<number, () => void>(); const delays: number[] = [];
    window.setTimeout = ((fn: () => void, delay: number) => { if (delay !== 90) return originalSet(fn, delay); delays.push(delay); const key = ++id; timers.set(key, fn); return key; }) as any;
    window.clearTimeout = ((key: number) => { if (!timers.delete(key)) originalClear(key); }) as any;
    const flush = () => { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); };
    try {
      const cleanup = c.bindPeek(root, { gestureState });
      root.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, bubbles: true })); flush();
      const held = parseFloat(getComputedStyle(root).getPropertyValue('--sand-ts-peek'));
      const beganEffects = root.getAnimations().length;
      phase = 'ended'; subscriber?.(); flush();
      const endedEffects = root.getAnimations().map(a => a.effect!.getTiming().duration);
      c.destroy(); cleanup();
      return { held, beganEffects, endedEffects, disposed, timers: timers.size, hasSubscriber: Boolean(subscriber), delays };
    } finally { window.setTimeout = originalSet; window.clearTimeout = originalClear; c.destroy(); root.remove(); }
  });
  expect(result.held).toBe(40); expect(result.beganEffects).toBe(0); expect(result.endedEffects).toEqual([435]);
  expect(result.disposed).toBe(1); expect(result.timers).toBe(0); expect(result.hasSubscriber).toBe(false);
  expect(result.delays.length).toBeGreaterThan(0); expect(result.delays.every((d: number) => d === 90)).toBe(true);
});

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('broncatalogus ontsluit alle gevallen zonder inventaris voor runtimebewijs aan te zien', async ({ app, agent, screen, browser }) => {
  await app.open('/ui-motion-catalogue.html');
  await agent.act('Bekijk de broncatalogus voor UI-overgangen');
  await expect(screen.getByRole('heading', { name: 'Bronovergangen', exact: true })).toBeVisible();
  expect(await browser.evaluate(() => document.querySelectorAll('#catalogue-family option').length)).toBe(60);
  const result = await browser.evaluate(async () => {
    const api = (window as any).uiMotionCatalogue; await api.ready;
    const data = await (await fetch('/assets/ui-motion-recipes.json')).json();
    const all = [];
    for (const family of data.families) {
      await api.selectFamily(family.id);
      all.push(...[...document.querySelectorAll('#catalogue-instance option')].map((o: any) => o.value));
    }
    const frame = document.querySelector('#catalogue-stage') as HTMLIFrameElement;
    const unknown = await api.selectInstance('INSTANCE-NOT-REAL').then(() => false, () => true);
    return { unique: new Set(all).size, count: all.length, sandbox: frame.getAttribute('sandbox'), unknown, inspect: await api.inspect() };
  });
  expect(result.unique).toBe(332); expect(result.count).toBe(332); expect(result.unknown).toBe(true);
  expect(result.sandbox).toContain('allow-same-origin'); expect(result.sandbox).not.toContain('allow-scripts');
  expect(['source-only', 'rendered-static', 'observed-motion']).toContain(result.inspect.status);
  expect(result.inspect.counts.notObservedMotion + result.inspect.counts.observedMotion).toBe(332);
  expect(result.inspect.counts).not.toHaveProperty('sourceOnly');
  await app.screenshot('source-motion-catalogue');
});

test('exacte bronkeyframes draaien als echte CSSAnimation in een geisoleerd frame', async ({ app, browser }) => {
  await app.open('/ui-motion-catalogue.html');
  const sample = await browser.evaluate(async () => {
    const api = (window as any).uiMotionCatalogue; await api.ready; await api.selectInstance('INSTANCE-083'); await api.restart();
    const frame = document.querySelector('#catalogue-stage') as HTMLIFrameElement;
    const animations = frame.contentDocument!.getAnimations();
    const a = animations.find((a: any) => a.animationName === 'sand-1m9yt3f-B')!;
    if (!a) return null;
    a.pause(); a.currentTime = 100;
    const e = a.effect as KeyframeEffect;
    return { duration: e.getTiming().duration, effectEasing: e.getTiming().easing, easing: e.getKeyframes()[0].easing, computedEasing: frame.contentWindow!.getComputedStyle(e.target!).animationTimingFunction, keys: e.getKeyframes().length, outside: document.documentElement.style.cssText, status: (await api.inspect()).status };
  });
  expect(sample).not.toBeNull(); expect(sample!.duration).toBe(200);
  expect(sample!.effectEasing).toBe('linear');
  expect(sample!.computedEasing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  expect(sample!.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)'); expect(sample!.keys).toBeGreaterThanOrEqual(2);
  expect(sample!.outside).toBe(''); expect(sample!.status).toBe('observed-motion');
});

test('glyphstate gebruikt bronselectors en specifieke reduced-motion override', async ({ app, screen, browser }) => {
  await app.open('/ui-motion-catalogue.html');
  const normal = await browser.evaluate(async () => {
    const api = (window as any).uiMotionCatalogue; await api.ready; await api.selectInstance('INSTANCE-002');
    await api.setState('data-swap-active', false);
    const frame = document.querySelector('#catalogue-stage') as HTMLIFrameElement;
    const target = frame.contentDocument!.querySelector('.ui-nejef0')!;
    frame.contentDocument!.getAnimations().forEach(a => a.finish());
    const before = frame.contentWindow!.getComputedStyle(target).opacity;
    await api.setState('data-swap-active', true);
    frame.contentDocument!.getAnimations().forEach(a => a.finish());
    const s = frame.contentWindow!.getComputedStyle(target);
    return { before, after: s.opacity, duration: s.transitionDuration, easing: s.transitionTimingFunction };
  });
  expect(normal.before).toBe('0'); expect(normal.after).toBe('1');
  expect(normal.duration).toContain('0.1s'); expect(normal.easing).toBe('ease');
  await screen.getByRole('switch', { name: 'Verminderde beweging', exact: true }).click();
  const reduced = await browser.evaluate(() => {
    const f = document.querySelector('#catalogue-stage') as HTMLIFrameElement;
    return f.contentWindow!.getComputedStyle(f.contentDocument!.querySelector('.ui-nejef0')!).transitionProperty;
  });
  expect(reduced).toBe('none');
});

test('alle332 bronfixtures worden normaal en reduced daadwerkelijk gerenderd met eerlijke status', async ({ app, browser }) => {
  await app.open('/ui-motion-catalogue.html');
  const rows = await browser.evaluate(async () => {
    const api = (window as any).uiMotionCatalogue; await api.ready;
    const data = await (await fetch('/assets/ui-motion-recipes.json')).json();
    const results = [];
    for (const mode of ['normal', 'reduced']) {
      await api.setMode(mode);
      for (const instance of data.instances) {
        await api.selectInstance(instance.id); const s = await api.inspect();
        results.push({ instanceId: s.instanceId, familyId: s.familyId, mode: s.mode, status: s.status, matchedRules: s.matchedRules, unresolved: s.unresolved, animations: s.animations.map((a: any) => ({ name: a.name, type: a.type, timing: JSON.parse(JSON.stringify(a.timing, (_k, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)) })) });
      }
    }
    return results;
  });
  expect(rows.length).toBe(664);
  expect(new Set(rows.map((r: any) => r.instanceId)).size).toBe(332);
  expect(rows.every((r: any) => ['source-only', 'rendered-static', 'observed-motion'].includes(r.status))).toBe(true);
  expect(rows.some((r: any) => r.status === 'observed-motion')).toBe(true);
  const directory = resolve(process.cwd(), '.e2e/artifacts/ui-motion');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'source-fixture-sweep.json'), JSON.stringify({ scope: 'Local source CSS fixtures only; no proof of native activation or exact full component geometry.', rows }, null, 2));
});

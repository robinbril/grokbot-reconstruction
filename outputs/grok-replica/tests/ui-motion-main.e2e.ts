import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function prepare(app: any, screen: any, browser: any) {
  await app.open('/?reset=1');
  await screen.getByRole('button', { name: 'Marketing Agent', exact: true }).click();
  await browser.evaluate(() => (window as any).uiMotionMain.setInspect(true));
}
const sample = (browser: any) => browser.evaluate(() => [...document.querySelector('#app')!.getAnimations({ subtree: true })].map(a => ({ duration: a.effect!.getTiming().duration, easing: a.effect!.getTiming().easing, target: (a.effect as KeyframeEffect).target?.hasAttribute('data-ui-header-identity') })));

test('echte gespreksheader volgt uitsluitend detailpaneeltoggle met400ms', async ({ app, agent, screen, browser }) => {
  await app.open('/?reset=1');
  await agent.act('Open het gesprek Marketing Agent');
  await expect(screen.getByRole('button', { name: 'Gespreksdetails', exact: true }).first()).toBeVisible();
  await browser.evaluate(() => (window as any).uiMotionMain.setInspect(true));
  await screen.getByRole('button', { name: 'Gespreksdetails', exact: true }).first().click();
  const effects = await sample(browser);
  expect(effects.some((a: any) => a.target && a.duration === 400 && a.easing === 'cubic-bezier(0.2, 0, 0, 1)')).toBe(true);
  await expect(screen.getByRole('tab', { name: 'Details', exact: true })).toBeVisible();
  await browser.evaluate(() => document.querySelector('#app')!.getAnimations({ subtree: true }).forEach(a => a.finish()));
  await screen.getByRole('tab', { name: 'Bibliotheek', exact: true }).click();
  expect((await sample(browser)).some((a: any) => a.target)).toBe(false);
  await app.screenshot('main-source-info-pane');
});

test('zelfde gesprek houdt exact invoernode achterwaartse selectie en scroll bij render', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  const outcome = await browser.evaluate(async () => {
    const modulePath='/composer-input.js';
    const {replaceComposerText,setComposerSelection,composerSelection,readComposerInput}=await import(modulePath);
    const input = document.querySelector('#message-input') as HTMLElement;
    replaceComposerText(input,'Een concept met selectie'); input.focus(); setComposerSelection(input,4,11,'backward');
    const roster = document.querySelector('.roster')!; roster.scrollTop = 12; const rosterTop = roster.scrollTop;
    document.querySelector<HTMLElement>('[data-action="toggle-context"]')!.click();
    const next = document.querySelector('#message-input') as HTMLElement,selection=composerSelection(next);
    return { same: input === next, focused: document.activeElement === next, ...selection, value: readComposerInput(next).text, roster: rosterTop === document.querySelector('.roster')!.scrollTop };
  });
  expect(outcome).toEqual({ same: true, focused: true, start: 4, end: 11, direction: 'backward', value: 'Een concept met selectie', roster: true });
});

test('echte composerwissel gebruikt200ms en horizontaalwiel toont timestamps', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).fill('Lokaal testbericht');
  const glyph = await sample(browser);
  expect(glyph.some((a: any) => a.duration === 200 && a.easing === 'cubic-bezier(0.22, 1, 0.36, 1)')).toBe(true);
  await expect(screen.getByRole('button', { name: 'Bericht sturen', exact: true })).toHaveCount(1);
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).press('Enter');
  const peek = await browser.evaluate(() => {
    const host = document.querySelector('.transcript') as HTMLElement;
    host.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 0, bubbles: true }));
    return { peeking: host.hasAttribute('data-peeking'), value: parseFloat(getComputedStyle(host).getPropertyValue('--sand-ts-peek')), timestamps: host.querySelectorAll('[data-message-timestamp]').length };
  });
  expect(peek.peeking).toBe(true); expect(peek.value).toBeGreaterThan(0); expect(peek.timestamps).toBeGreaterThan(0);
});

test('bronsectie wisselt gemeten hoogte in260ms en reduced motion slaat header over', async ({ app, screen, browser }) => {
  await app.open('/?reset=1');
  await browser.evaluate(() => {
    const key = 'grok-local-replica-v1'; const state = JSON.parse(localStorage.getItem(key)!);
    state.sections = [{ id: 'test-motion-section', name: 'Onderzoek', collapsed: false }]; state.agents[0].section = 'test-motion-section';
    localStorage.setItem(key, JSON.stringify(state));
  });
  await app.open('/');
  await browser.evaluate(() => (window as any).uiMotionMain.setInspect(true));
  await screen.getByRole('button', { name: 'Onderzoek', exact: true }).click();
  const duration = await browser.evaluate(() => document.querySelector('[data-section-body][data-section-id="test-motion-section"]')!.getAnimations().map(a => a.effect!.getTiming().duration));
  expect(duration).toContain(260);
  await screen.getByRole('button', { name: 'Onderzoek', exact: true }).click();
  await browser.evaluate(() => document.querySelector('#app')!.getAnimations({ subtree: true }).forEach(a => a.finish()));
  await screen.getByRole('button', { name: 'Marketing Agent', exact: true }).click();
  await browser.evaluate(() => (window as any).uiMotionMain.setReducedMotion(true));
  await screen.getByRole('button', { name: 'Gespreksdetails', exact: true }).first().click();
  expect((await sample(browser)).some((a: any) => a.target)).toBe(false);
});

test('tekstdrag activeert geen bestandoverlay en echte File-drop slaat bytes op', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  const drag = (file: boolean) => browser.evaluate((isFile: boolean) => {
    const host = document.querySelector('.conversation')!; const data = new DataTransfer();
    if (isFile) data.items.add(new File(['motion-file-bytes'], 'motion-proof.txt', { type: 'text/plain' })); else data.setData('text/plain', 'slepen');
    host.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data }));
    const overlay = document.querySelector('[data-chat-drop-overlay]');
    const duration = overlay?.getAnimations().map(a => a.effect!.getTiming().duration) ?? [];
    const visible = Boolean(overlay); host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    return { visible, duration };
  }, file);
  expect((await drag(false)).visible).toBe(false);
  const file = await drag(true); expect(file.visible).toBe(true); expect(file.duration).toContain(120);
  await expect(screen.getByText('motion-proof.txt', { exact: true })).toBeVisible();
  await app.open('/');
  await expect(screen.getByText('motion-proof.txt', { exact: true })).toBeVisible();
});

test('echte reactiechip herschikt gemeten X in300ms en bewaart lokale reactie', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).fill('Test reactie');
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).press('Enter');
  await browser.locator('.message.bot').first().click();await screen.getByRole('button', { name: 'Reactie toevoegen', exact: true }).first().click();
  await screen.getByRole('menuitem', { name: 'Nuttig', exact: true }).click();
  await browser.locator('.message.bot').first().click();await screen.getByRole('button', { name: 'Reactie toevoegen', exact: true }).first().click();
  await screen.getByRole('menuitem', { name: 'Eens', exact: true }).click();
  await screen.getByRole('button', { name: 'Reactie: Nuttig', exact: true }).first().click();
  const durations = await browser.evaluate(() => document.querySelector('[data-reaction-id="agree"]')!.getAnimations().map(a => ({ duration: a.effect!.getTiming().duration, easing: a.effect!.getTiming().easing })));
  expect(durations.some((a: any) => a.duration === 300 && a.easing === 'cubic-bezier(0.2, 0, 0, 1)')).toBe(true);
  await app.open('/');
  await expect(screen.getByRole('button', { name: 'Reactie: Eens', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('button', { name: 'Reactie: Nuttig', exact: true })).toHaveCount(0);
});

test('detailtoggle bewaart werkelijk omhooggescrold transcript en steelt geen focus', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  await browser.evaluate(() => {
    const key = 'grok-local-replica-v1', s = JSON.parse(localStorage.getItem(key)!);
    s.messages.marketing = Array.from({ length: 30 }, (_, i) => ({ id: 'scroll-' + i, role: 'bot', text: 'Synthetische regel '.repeat(18) + i }));
    localStorage.setItem(key, JSON.stringify(s));
  });
  await app.open('/');
  const state = await browser.evaluate(() => {
    const t = document.querySelector('.transcript')!; t.scrollTop = 150;
    const before = t.scrollTop; const button = document.querySelector<HTMLButtonElement>('.header-buttons [data-action="toggle-context"]')!;
    button.focus(); button.click();
    return { before, after: document.querySelector('.transcript')!.scrollTop, inputFocused: document.activeElement === document.querySelector('#message-input') };
  });
  expect(state.before).toBe(150); expect(state.after).toBe(150); expect(state.inputFocused).toBe(false);
});

test('glyph beweegt zichtbaar tussen bronposes en keert zonder sprong om', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).fill('Wissel');
  const before = await browser.evaluate(() => {
    const glyph = document.querySelector('[data-composer-glyph="send"]')!;
    const a = glyph.getAnimations()[0]; const start = Number(getComputedStyle(glyph).opacity);
    a.currentTime = 100; const halfway = Number(getComputedStyle(glyph).opacity);
    return { start, halfway };
  });
  expect(before.start).toBe(0); expect(before.halfway).toBeGreaterThan(0); expect(before.halfway).toBeLessThan(1);
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).fill('');
  const after = await browser.evaluate(() => Number(getComputedStyle(document.querySelector('[data-composer-glyph="send"]')!).opacity));
  expect(Math.abs(after - before.halfway)).toBeLessThan(.01);
});

test('detailpaneel behoudt zichtbare positie bij tweemaal omkeren halverwege', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  const actual = await browser.evaluate(() => {
    const toggle = () => document.querySelector<HTMLElement>('.header-buttons [data-action="toggle-context"]')!.click();
    const pane = () => document.querySelector('.context-pane') as HTMLElement;
    const midpoint = () => { const a = pane().getAnimations()[0]; if (!a) throw new Error('Geen echt paneeleffect'); a.currentTime = 150; };
    toggle(); midpoint(); const opening = pane().getBoundingClientRect().left;
    toggle(); const closing = pane().getBoundingClientRect().left; midpoint();
    const closingHalf = pane().getBoundingClientRect().left;
    toggle(); const reopened = pane().getBoundingClientRect().left;
    return { firstJump: Math.abs(opening - closing), secondJump: Math.abs(closingHalf - reopened), panes: document.querySelectorAll('.context-pane').length };
  });
  expect(actual.firstJump).toBeLessThan(.5); expect(actual.secondJump).toBeLessThan(.5); expect(actual.panes).toBe(1);
});

test('reactie behoudt lopende300ms animatie bij ongewijzigde offset en nieuw renderen', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).fill('Reactie onderbreken');
  await screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true }).press('Enter');
  for (const name of ['Nuttig', 'Eens']) {
    await browser.locator('.message.bot').first().click();await screen.getByRole('button', { name: 'Reactie toevoegen', exact: true }).first().click();
    await screen.getByRole('menuitem', { name, exact: true }).click();
  }
  await screen.getByRole('button', { name: 'Reactie: Nuttig', exact: true }).first().click();
  const actual = await browser.evaluate(() => {
    const get = () => document.querySelector('[data-reaction-id="agree"]') as HTMLElement;
    const a = get().getAnimations()[0]; a.currentTime = 100;
    const before = get().getBoundingClientRect().left;
    document.querySelector<HTMLElement>('.header-buttons [data-action="toggle-context"]')!.click();
    const after = get().getBoundingClientRect().left;
    const restored = get().getAnimations()[0];
    return { jump: Math.abs(after - before), duration: restored?.effect?.getTiming().duration, time: restored?.currentTime };
  });
  expect(actual.jump).toBeLessThan(.5); expect(actual.duration).toBe(300); expect(actual.time).toBeCloseTo(100, 1);
});

test('bestandsdrag kan na renderen opnieuw een echte overlay aanmaken', async ({ app, browser }) => {
  await app.open('/?reset=1');
  const actual = await browser.evaluate(() => {
    const enter = () => { const data = new DataTransfer(); data.items.add(new File(['x'], 'owned-drag.txt')); document.querySelector('.conversation')!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data })); };
    enter(); const first = Boolean(document.querySelector('[data-chat-drop-overlay]'));
    document.querySelector<HTMLElement>('[data-action="select-agent"][data-id="marketing"]')!.click();
    enter(); const second = Boolean(document.querySelector('[data-chat-drop-overlay]'));
    return { first, second, count: document.querySelectorAll('[data-chat-drop-overlay]').length };
  });
  expect(actual).toEqual({ first: true, second: true, count: 1 });
});

test('hervatte header behoudt ResizeObserver en rebased zichtbare positie tijdens resize', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  const actual = await browser.evaluate(async () => {
    document.querySelector<HTMLElement>('.header-buttons [data-action="toggle-context"]')!.click();
    const header = () => document.querySelector('[data-ui-header-identity]') as HTMLElement;
    header().getAnimations()[0].currentTime = 150;
    document.querySelector<HTMLElement>('[data-action="context-tab"][data-id="library"]')!.click();
    const before = header().getBoundingClientRect().left;
    (document.querySelector('.conversation-header') as HTMLElement).style.width = 'calc(100% - 80px)';
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { jump: Math.abs(header().getBoundingClientRect().left - before), effects: header().getAnimations().length };
  });
  expect(actual.jump).toBeLessThan(.5); expect(actual.effects).toBe(1);
});

test('ongeldige eindige timestamp uit browseropslag crasht het gesprek niet', async ({ app, screen, browser }) => {
  await prepare(app, screen, browser);
  await browser.evaluate(() => {
    const key = 'grok-local-replica-v1', s = JSON.parse(localStorage.getItem(key)!);
    s.messages.marketing = [{ id: 'bad-time', role: 'bot', text: 'Bericht met ongeldige tijd', createdAt: 1e300 }];
    localStorage.setItem(key, JSON.stringify(s));
  });
  await app.open('/');
  await expect(screen.getByRole('textbox', { name: 'Bericht sturen naar Bot', exact: true })).toBeVisible();
  await expect(screen.getByText('Bericht met ongeldige tijd', { exact: true })).toBeVisible();
  expect(await browser.evaluate(() => document.querySelector('[data-message-timestamp]')!.getAttribute('datetime'))).toBe(null);
});

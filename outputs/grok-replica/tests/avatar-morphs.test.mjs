import test from 'node:test';
import assert from 'node:assert/strict';
import { MORPH_KINDS, createMorphDriver, solveMorphFrame, renderMorphParts } from '../avatar-morphs.js';

const driver = (kind, reduced = false) => {
  const d = createMorphDriver({ seed: 17, isReducedMotion: reduced });
  d.set(kind); d.settle(); return d;
};
test('all13 source morphs produce distinct finite drawable frames and hide the face', () => {
  assert.equal(Object.keys(MORPH_KINDS).length, 13);
  const frames = [];
  for (const [name, kind] of Object.entries(MORPH_KINDS)) {
    const d = driver(name); d.advance(.1);
    assert.equal(d.snapshot().kind, kind);
    const frame = solveMorphFrame(d.snapshot(), 120);
    assert.equal(frame.isFaceVisible, false, name);
    assert.ok(Number.isFinite(frame.zoom));
    assert.ok(Object.values(frame.core).filter(v => typeof v === 'number').every(Number.isFinite), name);
    const svg = renderMorphParts(frame.parts);
    assert.ok(!/NaN|Infinity|script|onload|foreignObject/i.test(svg), name);
    frames.push(JSON.stringify({ core: frame.core, parts: frame.parts }));
  }
  assert.equal(new Set(frames).size, 13);
  const orbit = solveMorphFrame(driver('orbit').snapshot(), 120);
  const radar = solveMorphFrame(driver('radar').snapshot(), 120);
  assert.equal(orbit.parts.filter(p => p.type === 'disc').length, 5);
  assert.equal(radar.parts.filter(p => p.type === 'ring').length, 3);
  assert.ok(solveMorphFrame(driver('progress').snapshot(), 120).parts.length > 0);
});

test('source numerical anchors pin orbit depth, radar phases, progress and pencil contour', () => {
  const sample = (kind, time = 0, shotTime = time) => solveMorphFrame({ kind, amount: 1, swap: 1, outgoingKind: null, clock: { stateTime: time, shotTime }, reducedMotion: false }, 120);
  const close = (a, b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
  const orbit = sample('orbit').parts;
  close(orbit[0].cx, 114.2705); close(orbit[0].cy, 92.4305); close(orbit[0].r, 12); close(orbit[0].opacity, 1);
  const radar = sample('radar').parts;
  close(radar[0].r, 19); close(radar[1].r, 47.33333333333333); close(radar[2].r, 75.66666666666666);
  close(radar[0].opacity, .9); close(radar[1].opacity, .6); close(radar[2].opacity, .3);
  const progress = sample('progress', 1.0625).parts;
  close(progress.find(p => p.arc).arc.fraction, .5);
  close(progress[0].r, 62); close(progress[0].width, 5);
  const pencil = sample('pencil', .5).core.ring;
  assert.equal(pencil.length, 96);
  assert.ok(pencil.every(p => p.length===2 && p.every(Number.isFinite)));
  const radii = pencil.map(([x,y]) => Math.hypot(x-114.2705,y-114.2705));
  assert.ok(Math.max(...radii)-Math.min(...radii)>10, 'pencil core must retain its rounded triangular profile');
  assert.notEqual(sample('ball', .5).core.dy, sample('ball', .1).core.dy);
});
test('morph switching retains outgoing state and independent clocks before returning to ordinary face', () => {
  const d = driver('orbit'); d.advance(.1);
  d.set('radar'); d.advance(1 / 120);
  const mixed = d.snapshot();
  assert.equal(mixed.kind, 'radar'); assert.equal(mixed.outgoingKind, 'orbit');
  assert.ok(mixed.swap > 0 && mixed.swap < 1);
  assert.ok(solveMorphFrame(mixed, 120).parts.length > 3);
  const before = mixed.clock.stateTime; d.advance(.02);
  assert.ok(d.snapshot().clock.stateTime > before);
  d.set(null); d.settle();
  assert.equal(d.snapshot().amount, 0);
  assert.equal(solveMorphFrame(d.snapshot(), 120).isFaceVisible, true);
});
test('reduced motion is deterministic and suppresses continuing spatial movement', () => {
  for (const kind of Object.keys(MORPH_KINDS)) {
    const d = driver(kind, true);
    const before = solveMorphFrame(d.snapshot(), 120);
    for (let i = 0; i < 20; i++) d.advance(.1);
    assert.deepEqual(solveMorphFrame(d.snapshot(), 120), before, kind);
    assert.equal(d.snapshot().reducedMotion, true);
  }
});

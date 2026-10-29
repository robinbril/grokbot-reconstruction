import test from 'node:test';
import assert from 'node:assert/strict';
import { gazeAlpha, pointerGaze, sampleTrack, renderAvatarFrame, PUBLIC_SHAPES, CANONICAL_SHAPES } from '../avatar-math.js';

test('0712 gaze converges equally over one second at30/60/120Hz', () => {
  const residual = hz => Array.from({ length: hz }).reduce(value => value * (1 - gazeAlpha(1 / hz)), 1);
  assert.ok(Math.abs(gazeAlpha(1 / 60) - 0.14) < 1e-12);
  assert.ok(Math.abs(residual(30) - residual(60)) < 1e-12);
  assert.ok(Math.abs(residual(120) - residual(60)) < 1e-12);
  assert.equal(gazeAlpha(100), gazeAlpha(0.1));
  assert.equal(gazeAlpha(-1), 0);
});

test('0712 eyelids close both projected eyes for every public shape including blob', () => {
  for (const shape of PUBLIC_SHAPES) {
    const open = renderAvatarFrame({ shape, expression: 'neutral', lids: 0 });
    const closed = renderAvatarFrame({ shape, expression: 'neutral', lids: 1 });
    assert.notDeepEqual(open.eyes, closed.eyes, shape);
    for (let i = 0; i < 2; i++) assert.notEqual(open.eyes[i], closed.eyes[i], `${shape} eye${i}`);
  }
});

test('0712 platform pointer uses twice width and clips interpolate at endpoints and midpoint', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(pointerGaze(rect, 250, -150), [1, 1]);
  assert.deepEqual(pointerGaze(rect, -2000, 2000), [-1, -1]);
  const track = [{ t: 0, v: [0, 2], ease: [0, 0, 1, 1] }, { t: 2, v: [8, 6], ease: [0, 0, 1, 1] }];
  assert.deepEqual(sampleTrack(track, 0, [99, 99]), [0, 2]);
  assert.ok(sampleTrack(track, 1, [99, 99]).every((v, i) => Math.abs(v - [4, 4][i]) < 1e-8));
  assert.deepEqual(sampleTrack(track, 2, [99, 99]), [8, 6]);
});

test('0712 every public shape produces finite projected paths and both eyes', () => {
  assert.equal(PUBLIC_SHAPES.length, 25);
  assert.equal(CANONICAL_SHAPES.length, 13);
  for (const shape of PUBLIC_SHAPES) {
    const a = renderAvatarFrame({ shape, rotation: [0, 0, 0], offset: [0, 0], squash: [1, 1], zoom: 1, expression: 'neutral', lids: 0 });
    const b = renderAvatarFrame({ shape, rotation: [12, -19, 0], offset: [0.03, -0.02], squash: [1, 1], zoom: 1, expression: 'neutral', lids: 0 });
    assert.ok(a.body.startsWith('M') && b.body.startsWith('M'), shape);
    assert.equal(a.eyes.length, 2, shape);
    assert.ok([...a.eyes, ...b.eyes, a.body, b.body].every(path => typeof path === 'string' && !/NaN|Infinity/.test(path)), shape);
    assert.notDeepEqual(a.eyes, b.eyes, shape);
  }
});

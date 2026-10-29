import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FAST_SPRING, PEEK_SPRING, UI_MOTION_RECIPES, resolveMotionRecipe, sampleLinear, flipDelta } from '../ui-motion-math.js';

test('sampled source springs preserve source knots, overshoot and non-unit endpoint', () => {
  assert.equal(createHash('sha256').update(FAST_SPRING).digest('hex'), '2af93a312df4147fa4ef52e7a4f40772a319c9d8522e77c89af04737cbff373e');
  assert.equal(createHash('sha256').update(PEEK_SPRING).digest('hex'), '03ab4163ee7bd342740f49ca5af39208e8fd9d43692e39261d2f87fbc43a404f');
  assert.ok(FAST_SPRING.startsWith('linear(0, 0.01588 2%'));
  assert.ok(PEEK_SPRING.includes('1.036 58%'));
  assert.equal(sampleLinear(FAST_SPRING, 0), 0);
  assert.equal(sampleLinear(FAST_SPRING, .2), .56683);
  assert.equal(sampleLinear(FAST_SPRING, 1), 1);
  assert.equal(sampleLinear(PEEK_SPRING, .58), 1.036);
  assert.equal(sampleLinear(PEEK_SPRING, 1), 1.001);
});

test('linear timing parser distributes omitted positions and double stops without executing text', () => {
  assert.equal(sampleLinear('linear(0, 0.4, 1)', .25), .2);
  assert.equal(sampleLinear('linear(0 0% 20%, 1 80% 100%)', .1), 0);
  assert.ok(Math.abs(sampleLinear('linear(0 0% 20%, 1 80% 100%)', .5) - .5) < 1e-12);
  assert.equal(sampleLinear('linear(0 0% 20%, 1 80% 100%)', .9), 1);
  for (const text of ['linear(0, NaN)', 'linear(0 2px, 1)', 'linear(0);alert(1)', 'linear(Infinity, 1)']) assert.throws(() => sampleLinear(text, .5));
  assert.throws(() => sampleLinear(FAST_SPRING, NaN));
});

test('source recipes retain separate measured layout timings and exact easing', () => {
  const values = { section: 260, header: 400, reactionX: 300, reactionY: 300, lateShrink: 200, peek: 435, teamRetire: 80, teamEnter: 120, teamResize: 240 };
  for (const [name, duration] of Object.entries(values)) {
    assert.ok(Object.hasOwn(UI_MOTION_RECIPES, name));
    const actual = resolveMotionRecipe(name);
    assert.equal(actual.duration, duration, name);
    assert.equal(actual.skip, false, name);
    assert.ok(typeof actual.easing === 'string' && actual.easing.length > 0, name);
  }
  assert.equal(resolveMotionRecipe('section').easing, FAST_SPRING);
  assert.equal(resolveMotionRecipe('peek').easing, PEEK_SPRING);
  assert.equal(resolveMotionRecipe('header').easing, 'cubic-bezier(0.2, 0, 0, 1)');
  assert.equal(resolveMotionRecipe('teamRetire').easing, 'ease-in');
  assert.equal(resolveMotionRecipe('teamEnter').easing, 'ease-out');
  assert.equal(resolveMotionRecipe('teamResize', { collapse: true }).duration, 300);
  assert.throws(() => resolveMotionRecipe('__not_a_recipe__'));
});

test('reduced motion skips layout displacement while retaining source120ms composer fallback', () => {
  for (const name of ['section', 'header', 'reactionX', 'reactionY', 'lateShrink', 'peek']) assert.equal(resolveMotionRecipe(name, { reducedMotion: true }).skip, true, name);
  const normal = resolveMotionRecipe('composerPadding');
  assert.equal(normal.duration, 300); assert.equal(normal.easing, FAST_SPRING);
  const reduced = resolveMotionRecipe('composerPadding', { reducedMotion: true });
  assert.equal(reduced.duration, 120); assert.equal(reduced.easing, 'ease'); assert.equal(reduced.skip, false);
});

test('layout deltas use measured geometry and threshold boundaries', () => {
  assert.deepEqual(flipDelta({ left: 120, top: 60 }, { left: 20, top: 40 }), { x: 100, y: 20, skip: false });
  assert.equal(flipDelta({ left: .49, top: -.49 }, { left: 0, top: 0 }).skip, true);
  assert.equal(flipDelta({ left: .5, top: 0 }, { left: 0, top: 0 }).skip, false);
  assert.throws(() => flipDelta({ left: NaN, top: 0 }, { left: 0, top: 0 }));
});

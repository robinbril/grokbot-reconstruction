import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMotionRecipe } from '../ui-motion-math.js';
test('teamsetup vaste header gebruikt de eigen240/300ms80ms bronroute', () => {
  assert.deepEqual(resolveMotionRecipe('teamPin'), { duration: 240, delay: 80, easing: 'cubic-bezier(0.2, 0, 0, 1)', skip: false });
  assert.equal(resolveMotionRecipe('teamPin', { collapse: true }).duration, 300);
  assert.equal(resolveMotionRecipe('teamPin', { reducedMotion: true }).skip, true);
});

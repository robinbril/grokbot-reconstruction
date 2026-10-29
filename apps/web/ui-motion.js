import { createMotionState } from './ui-motion-state.js';
import { createLayoutMotion } from './ui-motion-layout.js';
import { createEffectMotion } from './ui-motion-effects.js';
import { createTeamMotion } from './ui-motion-team.js';

export function createUIMotion({ root = document.body, reducedMotion = false, inspect = false } = {}) {
  const state = createMotionState({ root, reducedMotion, inspect });
  return {
    ...createLayoutMotion(state), ...createEffectMotion(state), ...createTeamMotion(state),
    cancel: state.cancel, destroy: state.destroy, diagnostics: state.diagnostics,
    setInspect: state.setInspect, setReducedMotion: state.setReducedMotion,
    get lastAnimation() { return state.lastAnimation; },
  };
}

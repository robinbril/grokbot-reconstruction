// Literal curves from the pinned inert 0.71.2 control-web-animation-api dossier.
// Recipe resolution does not imply source-trigger eligibility.
export const FAST_SPRING = "linear(0, 0.01588 2%, 0.05618 4%, 0.11201 6%, 0.1768 8%, 0.2458 10%, 0.31562 12%, 0.38392 14%, 0.44914 16%, 0.51029 18%, 0.56683 20%, 0.61852 22%, 0.66534 24%, 0.70743 26%, 0.74501 28%, 0.77838 30%, 0.80788 32%, 0.83383 34%, 0.85658 36%, 0.87645 38%, 0.89376 40%, 0.92183 44%, 0.94282 48%, 0.95838 52%, 0.96984 56%, 0.97823 60%, 0.98435 64%, 0.98878 68%, 0.99198 72%, 0.99594 80%, 0.99829 90%, 1 100%)";
export const PEEK_SPRING = "linear(0, 0.03866 4%, 0.133 8%, 0.2566 12%, 0.3901 15%, 0.5206 19%, 0.6396 23%, 0.7426 27%, 0.8278 31%, 0.8954 35%, 0.9467 38%, 0.9837 42%, 1.009 46%, 1.024 50%, 1.033 54%, 1.036 58%, 1.035 62%, 1.032 65%, 1.028 69%, 1.023 73%, 1.019 77%, 1.014 81%, 1.01 85%, 1.007 88%, 1.004 92%, 1.002 96%, 1.001)";

const LAYOUT_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const recipe = (duration, easing, options = {}) => Object.freeze({ duration, easing, delay: 0, ...options });

export const UI_MOTION_RECIPES = Object.freeze({
  section: recipe(260, FAST_SPRING, { reducedSkip: true }),
  header: recipe(400, LAYOUT_EASING, { reducedSkip: true }),
  reactionX: recipe(300, LAYOUT_EASING, { reducedSkip: true }),
  reactionY: recipe(300, LAYOUT_EASING, { reducedSkip: true }),
  lateShrink: recipe(200, LAYOUT_EASING, { reducedSkip: true }),
  peek: recipe(435, PEEK_SPRING, { reducedSkip: true }),
  teamRetire: recipe(80, 'ease-in', { reducedSkip: true }),
  teamEnter: recipe(120, 'ease-out'),
  teamResize: recipe(240, LAYOUT_EASING, { collapseDuration: 300, reducedSkip: true }),
  teamPin: recipe(240, LAYOUT_EASING, { delay: 80, collapseDuration: 300, reducedSkip: true }),
  composerPadding: recipe(300, FAST_SPRING, { reducedDuration: 120, reducedEasing: 'ease' }),
});

export function resolveMotionRecipe(name, { reducedMotion = false, collapse = false } = {}) {
  if (!Object.hasOwn(UI_MOTION_RECIPES, name)) throw new RangeError(`Unknown UI motion recipe: ${String(name)}`);
  const selected = UI_MOTION_RECIPES[name];
  const duration = reducedMotion && selected.reducedDuration !== undefined
    ? selected.reducedDuration
    : collapse && selected.collapseDuration !== undefined ? selected.collapseDuration : selected.duration;
  return {
    duration,
    easing: reducedMotion && selected.reducedEasing !== undefined ? selected.reducedEasing : selected.easing,
    delay: selected.delay,
    skip: Boolean(reducedMotion && selected.reducedSkip),
  };
}

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const STOP = new RegExp(`^(${NUMBER})(?:\\s+(${NUMBER})%)?(?:\\s+(${NUMBER})%)?$`);

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function parseLinear(easing) {
  if (typeof easing !== 'string') throw new TypeError('A CSS linear() string is required');
  const functionMatch = /^linear\(\s*([\s\S]*?)\s*\)$/.exec(easing.trim());
  if (!functionMatch) throw new SyntaxError('Invalid CSS linear() function');
  const stops = [];
  for (const raw of functionMatch[1].split(',')) {
    const match = STOP.exec(raw.trim());
    if (!match) throw new SyntaxError('Invalid CSS linear() stop');
    const value = finite(Number(match[1]), 'Stop value');
    const offsets = match.slice(2).filter(offset => offset !== undefined);
    if (!offsets.length) stops.push({ value, offset: undefined });
    for (const offset of offsets) stops.push({ value, offset: finite(Number(offset) / 100, 'Stop offset') });
  }
  if (stops.length < 2) throw new SyntaxError('CSS linear() needs at least two stops');
  if (stops[0].offset === undefined) stops[0].offset = 0;
  // CSS fixes decreasing explicit positions before distributing omitted runs.
  let previous = -Infinity;
  for (const stop of stops) {
    if (stop.offset !== undefined) {
      stop.offset = Math.max(previous, stop.offset);
      previous = stop.offset;
    }
  }
  const last = stops.length - 1;
  if (stops[last].offset === undefined) stops[last].offset = Math.max(1, previous);
  let start = 0;
  while (start < last) {
    let end = start + 1;
    while (stops[end].offset === undefined) end++;
    for (let index = start + 1; index < end; index++) {
      stops[index].offset = stops[start].offset + (stops[end].offset - stops[start].offset) * (index - start) / (end - start);
    }
    start = end;
  }
  return stops;
}

export function sampleLinear(easingString, progress) {
  finite(progress, 'Progress');
  const stops = parseLinear(easingString);
  let right = stops.findIndex(stop => stop.offset > progress);
  if (right === 0) {
    right = 1;
    while (right < stops.length && stops[right].offset === stops[0].offset) right++;
    if (right === stops.length) return stops[0].value;
    return interpolate(stops[0], stops[right], progress);
  }
  if (right === -1) {
    const last = stops.length - 1;
    if (progress === stops[last].offset) return stops[last].value;
    let left = last - 1;
    while (left >= 0 && stops[left].offset === stops[last].offset) left--;
    if (left < 0) return stops[last].value;
    return interpolate(stops[left], stops[last], progress);
  }
  return interpolate(stops[right - 1], stops[right], progress);
}

function interpolate(left, right, progress) {
  if (progress === left.offset) return left.value;
  if (progress === right.offset) return right.value;
  return left.value + (right.value - left.value) * (progress - left.offset) / (right.offset - left.offset);
}

export function flipDelta(before, after, threshold = .5) {
  finite(threshold, 'Threshold');
  if (threshold < 0) throw new RangeError('Threshold cannot be negative');
  const x = finite(before?.left, 'Before left') - finite(after?.left, 'After left');
  const y = finite(before?.top, 'Before top') - finite(after?.top, 'After top');
  finite(x, 'Horizontal delta');
  finite(y, 'Vertical delta');
  return { x, y, skip: Math.abs(x) < threshold && Math.abs(y) < threshold };
}

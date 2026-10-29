import { resolveMotionRecipe } from './ui-motion-math.js';

// Every owned record refers to a browser Animation, never a simulated timeline.
export function createMotionState({ root, reducedMotion = false, inspect = false }) {
  let destroyed = false, lastAnimation = null;
  const records = new Set(), disposers = new Set(), channels = new WeakMap();
  const read = value => typeof value === 'function' ? value() : value;

  function cancel(node, channel) {
    for (const record of [...records]) {
      if ((!node || record.node === node) && (!channel || record.channel === channel)) {
        record.animation.cancel();
        record.release(false);
      }
    }
  }

  function animate(node, name, keyframes, options = {}) {
    if (destroyed) return null;
    const selected = resolveMotionRecipe(name, { reducedMotion: read(reducedMotion), collapse: options.collapse });
    const channel = options.channel ?? name;
    cancel(node, channel);
    if (selected.skip) { options.cleanup?.(false); return null; }
    const animation = node.animate(keyframes, {
      ...(options.timing ?? {}),
      duration: selected.duration, easing: selected.easing,
      delay: options.delay ?? options.timing?.delay ?? selected.delay,
      fill: options.fill ?? options.timing?.fill ?? 'none', id: `ui-motion:${channel}`,
    });
    const map = channels.get(node) ?? new Map(); channels.set(node, map);
    const record = { node, name, channel, animation, meta: options.meta, release: null };
    let released = false;
    record.release = finished => {
      if (released) return;
      released = true; records.delete(record);
      if (map.get(channel) === record) map.delete(channel);
      animation.removeEventListener('finish', onfinish);
      animation.removeEventListener('cancel', oncancel);
      if (lastAnimation === animation) lastAnimation = null;
      animation.cancel();
      options.cleanup?.(finished);
      if (finished && !destroyed) options.onfinish?.();
    };
    const onfinish = () => record.release(true), oncancel = () => record.release(false);
    animation.addEventListener('finish', onfinish);
    animation.addEventListener('cancel', oncancel);
    records.add(record); map.set(channel, record); lastAnimation = animation;
    if (read(inspect)) { animation.pause(); animation.currentTime = 0; }
    return animation;
  }

  function diagnostics() {
    return [...records].filter(record => record.animation.playState !== 'idle').map(({ node, animation, name, channel }) => {
      const effect = animation.effect, style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return {
        name, channel, id: animation.id, currentTime: animation.currentTime, playState: animation.playState,
        timing: effect.getTiming(), computedTiming: effect.getComputedTiming(), keyframes: effect.getKeyframes(),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: { opacity: style.opacity, transform: style.transform, translate: style.translate,
          padding: style.padding, peek: style.getPropertyValue('--sand-ts-peek') },
      };
    });
  }

  function snapshot(node, channel) {
    const record = channels.get(node)?.get(channel), animation = record?.animation;
    if (!animation || !['running', 'paused'].includes(animation.playState)) return null;
    return { name: record.name, channel, meta: record.meta, keyframes: animation.effect.getKeyframes(),
      timing: animation.effect.getTiming(), currentTime: animation.currentTime, playbackRate: animation.playbackRate,
      playState: animation.playState, capturedAt: performance.now() };
  }

  function resume(node, saved) {
    if (!saved) return null;
    const animation = animate(node, saved.name, saved.keyframes, { channel: saved.channel, meta: saved.meta, timing: saved.timing });
    if (!animation) return null;
    animation.playbackRate = saved.playbackRate;
    if (saved.playState === 'paused') animation.pause();
    animation.currentTime = Number(saved.currentTime) + (saved.playState === 'running' ? (performance.now() - saved.capturedAt) * saved.playbackRate : 0);
    return animation;
  }

  return {
    root, animate, cancel, diagnostics, snapshot, resume,
    get destroyed() { return destroyed; },
    get reduced() { return Boolean(read(reducedMotion)); },
    get lastAnimation() { return lastAnimation; },
    record: (node, channel) => channels.get(node)?.get(channel),
    own(cleanup) {
      if (destroyed) { cleanup(); return () => {}; }
      disposers.add(cleanup);
      return () => { if (disposers.delete(cleanup)) cleanup(); };
    },
    setInspect(value) { inspect = value; },
    setReducedMotion(value) {
      reducedMotion = value;
      if (read(value)) for (const record of [...records]) {
        if (resolveMotionRecipe(record.name, { reducedMotion: true }).skip) cancel(record.node, record.channel);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of [...disposers]) dispose();
      disposers.clear(); cancel();
    },
  };
}

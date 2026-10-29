const SOURCE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function createMainEffects({ isReduced, isInspect }) {
  const records = new Set();
  function cancel(node, channel) {
    for (const record of [...records]) if ((!node || record.node === node) && (!channel || record.channel === channel)) record.release();
  }
  function animate(node, channel, keyframes, { duration, easing = 'ease', cleanup, timing = {}, id, currentTime, playState } = {}) {
    cancel(node, channel);
    if (isReduced()) { cleanup?.(); return null; }
    const animation = node.animate(keyframes, { ...timing, duration, easing, id: id ?? `ui-motion:${channel}` });
    const record = { node, animation, channel, release: null }; let released = false;
    record.release = () => {
      if (released) return;
      released = true; records.delete(record); animation.removeEventListener('finish', record.release);
      animation.removeEventListener('cancel', record.release); animation.cancel(); cleanup?.();
    };
    animation.addEventListener('finish', record.release); animation.addEventListener('cancel', record.release);
    records.add(record);
    if (isInspect() || playState === 'paused') { animation.pause(); animation.currentTime = 0; }
    if (typeof currentTime === 'number') animation.currentTime = currentTime;
    return animation;
  }
  function resume(node, saved, { cleanup } = {}) {
    if (!saved) return null;
    return animate(node, saved.id.replace('ui-motion:', ''), saved.keyframes, { timing: saved.timing,
      duration: saved.timing.duration, easing: saved.timing.easing, id: saved.id, playState: saved.playState,
      currentTime: Number(saved.currentTime) + (saved.playState === 'running' ? performance.now() - saved.capturedAt : 0), cleanup });
  }
  function glyph(button, hasPayload, previousPayload, previousGlyphs) {
    const before = new Map([...button.querySelectorAll('[data-composer-glyph]')].map(item => {
      const style = getComputedStyle(item); return [item.dataset.composerGlyph, { opacity: style.opacity, transform: style.transform }];
    }));
    button.dataset.hasPayload = String(hasPayload); button.dataset.action = hasPayload ? 'send-message' : 'voice';
    const label = hasPayload ? 'Bericht sturen' : 'Spraakmodus'; button.setAttribute('aria-label', label); button.title = label;
    if (hasPayload === previousPayload) {
      for (const item of button.querySelectorAll('[data-composer-glyph]')) resume(item, previousGlyphs?.get(item.dataset.composerGlyph)?.timeline);
      return;
    }
    for (const item of button.querySelectorAll('[data-composer-glyph]')) {
      const shown = item.dataset.composerGlyph === (hasPayload ? 'send' : 'mic');
      const visual = previousGlyphs?.get(item.dataset.composerGlyph) ?? before.get(item.dataset.composerGlyph);
      const beforeOpacity = visual.opacity, beforeTransform = visual.transform;
      item.style.opacity = shown ? '1' : '0'; item.style.visibility = shown ? 'visible' : 'hidden';
      item.style.transform = shown ? 'scale(1)' : 'scale(.5)';
      animate(item, 'composer-glyph', { opacity: [beforeOpacity, shown ? 1 : 0],
        visibility: ['visible', shown ? 'visible' : 'hidden'], transform: [beforeTransform, shown ? 'scale(1)' : 'scale(.5)'] },
      { duration: 200, easing: SOURCE_EASE });
    }
  }
  function pane(node, opening, { fromTransform = opening ? 'translateX(100%)' : 'translateX(0)' } = {}) {
    return animate(node, 'info-pane', { transform: [fromTransform, opening ? 'translateX(0)' : 'translateX(100%)'] },
      { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', cleanup: opening ? undefined : () => node.remove() });
  }
  function diagnostics() {
    return [...records].filter(({ animation }) => animation.playState !== 'idle').map(({ node, animation, channel }) => {
      const rect = node.getBoundingClientRect();
      return { channel, id: animation.id, currentTime: animation.currentTime, playState: animation.playState,
        timing: animation.effect.getTiming(), computedTiming: animation.effect.getComputedTiming(), keyframes: animation.effect.getKeyframes(),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    });
  }
  return { animate, resume, glyph, pane, cancel, diagnostics };
}

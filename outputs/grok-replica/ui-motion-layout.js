const px = value => `${value}px`;
const valid = (...values) => values.every(value => typeof value === 'number' && Number.isFinite(value));

export function createLayoutMotion(state) {
  const headerObservers = new WeakSet();

  function section(node, { fromHeight, toHeight, initial = false }) {
    if (!valid(fromHeight, toHeight) || initial || fromHeight === toHeight) return null;
    return state.animate(node, 'section', { height: [px(fromHeight), px(toHeight)], overflow: ['clip', 'clip'] });
  }

  function runHeader(node, visualLeft) {
    state.cancel(node, 'header');
    const naturalLeft = node.getBoundingClientRect().left, delta = visualLeft - naturalLeft;
    if (Math.abs(delta) < .5) return null;
    return state.animate(node, 'header', { transform: [`translateX(${delta}px)`, 'translateX(0)'] }, {
      meta: { naturalLeft, endsAt: performance.now() + 400 },
    });
  }

  function observeHeader(node) {
    if (headerObservers.has(node) || typeof ResizeObserver === 'undefined') return;
    headerObservers.add(node);
    const observer = new ResizeObserver(() => {
      const record = state.record(node, 'header');
      if (!record || performance.now() >= record.meta.endsAt) return;
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
      const naturalLeft = node.getBoundingClientRect().left - transform;
      if (Math.abs(naturalLeft - record.meta.naturalLeft) >= .5) runHeader(node, record.meta.naturalLeft + transform);
    });
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    state.own(() => { observer.disconnect(); headerObservers.delete(node); });
  }

  function header(node, { visualLeft, clickedAtMs, previousInfoOpen, isInfoOpen, reason }) {
    const age = performance.now() - clickedAtMs;
    if (!valid(visualLeft, clickedAtMs) || age < 0 || age > 400 || reason !== 'info-toggle'
      || previousInfoOpen === isInfoOpen || state.reduced || state.destroyed) return null;
    observeHeader(node);
    return runHeader(node, visualLeft);
  }

  function captureHeader(node) {
    return state.snapshot(node, 'header');
  }

  function resumeHeader(node, saved) {
    if (!saved || saved.name !== 'header' || state.reduced || state.destroyed) return null;
    observeHeader(node);
    return state.resume(node, saved);
  }

  function lateShrink(node, { fromHeight, toHeight, eligible = false, committed = false }) {
    if (!eligible || !committed || !valid(fromHeight, toHeight) || fromHeight - toHeight < 1) return null;
    let observer;
    const animation = state.animate(node, 'lateShrink', { height: [px(fromHeight), px(toHeight)], overflow: ['clip', 'clip'] }, {
      cleanup: () => observer?.disconnect(),
    });
    if (animation && typeof ResizeObserver !== 'undefined') {
      // The row's own height is animated. Its natural children reveal when
      // expanded details or feedback invalidate the captured destination.
      const children = [...node.children].map(child => ({ child, rect: child.getBoundingClientRect() }));
      observer = new ResizeObserver(() => {
        if (children.some(({ child, rect }) => {
          const next = child.getBoundingClientRect();
          return Math.abs(next.width - rect.width) >= .5 || Math.abs(next.height - rect.height) >= .5;
        })) state.cancel(node, 'lateShrink');
      });
      for (const { child } of children) observer.observe(child);
    }
    return animation;
  }

  function reactionX(node, { previousOffsetLeft }) {
    const left = node.offsetLeft;
    if (!valid(previousOffsetLeft) || previousOffsetLeft === left) return null;
    const translate = Number.parseFloat(getComputedStyle(node).translate) || 0;
    const delta = previousOffsetLeft - left + translate;
    return state.animate(node, 'reactionX', { translate: [`${delta}px 0`, '0 0'] }, { channel: 'reaction' });
  }

  function reactionY(node, { previousTop }) {
    if (!valid(previousTop)) return null;
    state.cancel(node, 'reaction');
    const delta = previousTop - node.getBoundingClientRect().top;
    if (Math.abs(delta) < .5) return null;
    return state.animate(node, 'reactionY', { translate: [`0 ${delta}px`, '0 0'] }, { channel: 'reaction' });
  }

  function teamResize(node, { fromHeight, toHeight, collapse = false, delay = 0, content = null }) {
    if (!valid(fromHeight, toHeight, delay) || fromHeight === toHeight) return null;
    return state.animate(node, 'teamResize', { height: [px(fromHeight), px(toHeight)] }, {
      collapse, delay, fill: 'backwards', onfinish: () => {
        const next = content?.offsetHeight;
        if (valid(next) && next !== toHeight) teamResize(node, { fromHeight: toHeight, toHeight: next, collapse, content });
      },
    });
  }

  return { section, header, captureHeader, resumeHeader, lateShrink, reactionX, reactionY, teamResize };
}

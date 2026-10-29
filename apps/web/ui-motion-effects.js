let peekRegistered = false;
const clampPeek = value => Math.max(0, Math.min(82, value));

function registerPeek() {
  if (peekRegistered || typeof CSS?.registerProperty !== 'function') return;
  peekRegistered = true;
  CSS.registerProperty({ name: '--sand-ts-peek', syntax: '<length>', inherits: true, initialValue: '0px' });
  CSS.registerProperty({ name: '--sand-ts-progress', syntax: '<number>', inherits: true, initialValue: '0' });
}

function nestedScroller(target, host) {
  for (let node = target instanceof Element ? target : null; node && node !== host; node = node.parentElement) {
    if (node.scrollWidth - node.clientWidth > 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) return true;
  }
  return false;
}

export function createEffectMotion(state) {
  function peek(host, { fromPeek }) {
    registerPeek();
    const previous = clampPeek(fromPeek);
    host.style.setProperty('--sand-ts-peek', '0px'); host.style.setProperty('--sand-ts-progress', '0');
    if (!previous || state.reduced) { host.removeAttribute('data-peeking'); return null; }
    return state.animate(host, 'peek', [{ '--sand-ts-peek': `${previous}px`, '--sand-ts-progress': String(previous / 82) },
      { '--sand-ts-peek': '0px', '--sand-ts-progress': '0' }], { cleanup: () => host.removeAttribute('data-peeking') });
  }

  function composerPadding(node, { fromPadding, toPadding }) {
    const from = typeof fromPadding === 'number' ? `${fromPadding}px` : fromPadding;
    const to = typeof toPadding === 'number' ? `${toPadding}px` : toPadding;
    node.style.padding = to;
    if (from === to) return null;
    return state.animate(node, 'composerPadding', { padding: [from, to] });
  }

  function teamEnter(node, { delay = 0 } = {}) {
    return state.animate(node, 'teamEnter', { opacity: [0, 1] }, { delay, fill: 'backwards' });
  }

  function teamRetire(node, { opacity = Number.parseFloat(getComputedStyle(node).opacity) } = {}) {
    if (state.destroyed) return null;
    const parent = node.parentElement;
    if (!parent) return null;
    // The source removes the logical row in either mode; reduced motion skips
    // the transient retirement clone entirely. Enter has no equivalent guard.
    if (state.reduced) { node.remove(); return null; }
    const rect = node.getBoundingClientRect(), bounds = parent.getBoundingClientRect(), clone = node.cloneNode(true);
    clone.removeAttribute('id');
    for (const identified of clone.querySelectorAll('[id]')) identified.removeAttribute('id');
    clone.inert = true; clone.setAttribute('aria-hidden', 'true'); clone.setAttribute('data-ui-motion-retiring', '');
    Object.assign(clone.style, { position: 'absolute', top: `${rect.top - bounds.top + parent.scrollTop - parent.clientTop}px`,
      left: `${rect.left - bounds.left + parent.scrollLeft - parent.clientLeft}px`, width: `${rect.width}px`, margin: '0', pointerEvents: 'none' });
    parent.append(clone); node.remove();
    return state.animate(clone, 'teamRetire', { opacity: [opacity, 0] }, { fill: 'forwards', cleanup: () => clone.remove() });
  }

  // Without a desktop gesture provider this is a wheel-only fallback: a pause
  // between wheel events cannot reveal whether the native gesture is still held.
  function bindPeek(host, { rtl = document.documentElement.dir === 'rtl', gestureState = null } = {}) {
    if (gestureState !== null && (typeof gestureState.get !== 'function' || typeof gestureState.subscribe !== 'function')) {
      throw new TypeError('gestureState must provide get() and subscribe()');
    }
    registerPeek();
    let mode = 'idle', value = 0, timer = null, disposed = false;
    const write = next => {
      value = next; host.style.setProperty('--sand-ts-peek', `${next}px`);
      host.style.setProperty('--sand-ts-progress', String(next / 82));
    };
    const done = () => host.removeAttribute('data-peeking');
    const settle = () => {
      timer = null;
      if (disposed || mode === 'idle' || gestureState?.get() === 'began') return;
      mode = 'idle'; host.style.removeProperty('overflow-y');
      if (!value || state.reduced) { write(0); done(); return; }
      const previous = value; write(0); peek(host, { fromPeek: previous });
    };
    const scheduleSettle = () => {
      if (disposed) return;
      clearTimeout(timer); timer = setTimeout(settle, 90);
    };
    const unsubscribe = gestureState?.subscribe(() => {
      if (gestureState.get() === 'ended') scheduleSettle();
    });
    const wheel = event => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (mode === 'idle') {
        if (!horizontal || Math.abs(event.deltaX) < 1.5) return;
        mode = nestedScroller(event.target, host) ? 'scroller' : 'peek';
        if (mode === 'peek') { host.setAttribute('data-peeking', ''); host.style.overflowY = 'hidden'; }
      } else if (!horizontal) return;
      scheduleSettle();
      if (mode === 'scroller') return;
      if (state.record(host, 'peek')) {
        const visual = Number.parseFloat(getComputedStyle(host).getPropertyValue('--sand-ts-peek'));
        state.cancel(host, 'peek'); write(clampPeek(Number.isFinite(visual) ? visual : value));
        host.setAttribute('data-peeking', '');
      }
      write(clampPeek(value + (rtl ? -event.deltaX : event.deltaX)));
    };
    host.addEventListener('wheel', wheel, { passive: true });
    return state.own(() => {
      disposed = true; clearTimeout(timer); unsubscribe?.();
      host.removeEventListener('wheel', wheel); state.cancel(host, 'peek');
      host.style.removeProperty('overflow-y'); host.style.removeProperty('--sand-ts-peek');
      host.style.removeProperty('--sand-ts-progress'); done();
    });
  }

  return { composerPadding, teamEnter, teamRetire, bindPeek, peek };
}

// WAAPI-03, Pe in the pinned inert team-setup source. This route belongs to
// persistent teamsetup headers displaced by retired content, never roster pins.
export function createTeamMotion(state) {
  let sequence = 0;

  function teamPin(node, { previousTop, retiring = false, collapse = false } = {}) {
    if (!node?.isConnected || !retiring || state.reduced || state.destroyed
      || typeof previousTop !== 'number' || !Number.isFinite(previousTop)) return null;
    const delta = previousTop - node.getBoundingClientRect().top;
    if (!Number.isFinite(delta) || delta === 0) return null;
    // Pe deliberately does not cancel an earlier pin animation or compensate its
    // computed transform. Unique ownership channels preserve that overlap while
    // still letting reduced-motion, cancel() and destroy() clean up every effect.
    return state.animate(node, 'teamPin', {
      transform: [`translateY(${delta}px)`, 'translateY(0)'],
    }, { collapse, fill: 'backwards', channel: `teamPin:${++sequence}` });
  }

  return { teamPin };
}

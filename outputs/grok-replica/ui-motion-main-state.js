import {composerSelection,readComposerInput,setComposerSelection,setComposerSnapshot} from './composer-input.js';
export function captureTimeline(node, id) {
  const animation = node?.getAnimations().find(effect => effect.id === id);
  if (!animation || !['running', 'paused'].includes(animation.playState)) return null;
  return { id: animation.id, keyframes: animation.effect.getKeyframes(), timing: animation.effect.getTiming(),
    currentTime: animation.currentTime, playState: animation.playState, capturedAt: performance.now() };
}

export function captureInputState(root) {
  const input = root.querySelector('#message-input'), active = document.activeElement;
  return {
    input, composer: input?readComposerInput(input):null, selection: input ? composerSelection(input) : null,
    inputScroll: input?.scrollTop, focused: active === input || Boolean(input?.contains?.(active)),
    focusId: root.contains(active) ? active.id : null,
    focusAction: root.contains(active) ? active.dataset?.action : null,
    focusItem: root.contains(active) ? active.dataset?.id : null,
    scrolls: ['.roster', '.context-body', '.transcript'].map(selector => {
      const node = root.querySelector(selector);
      return { selector, top: node?.scrollTop ?? 0, atEnd: node ? node.scrollHeight - node.clientHeight - node.scrollTop < 2 : true };
    }),
  };
}

export function restoreInputState(root, snapshot, { sameConversation, explicitSend, composing }) {
  const fresh = root.querySelector('#message-input');
  if (sameConversation && snapshot.input && fresh) {
    const old = snapshot.input, next=readComposerInput(fresh), changed=JSON.stringify(next)!==JSON.stringify(snapshot.composer);
    if (!composing.has(old) && changed) setComposerSnapshot(old,next,{resetHistory:explicitSend||(!next.text&&!next.references?.length)});
    old.spellcheck = fresh.spellcheck;
    fresh.replaceWith(old);
    if (!changed || composing.has(old)) setComposerSelection(old,snapshot.selection.start,snapshot.selection.end,snapshot.selection.direction);
    if (snapshot.focused) old.focus({ preventScroll: true });
    old.scrollTop = snapshot.inputScroll;
  }
  if (sameConversation && !snapshot.focused && snapshot.focusId) {
    root.querySelector(`#${CSS.escape(snapshot.focusId)}`)?.focus({ preventScroll: true });
  } else if (sameConversation && !snapshot.focused && snapshot.focusAction) {
    const candidates = root.querySelectorAll('[data-action]');
    [...candidates].find(node => node.dataset.action === snapshot.focusAction && (node.dataset.id ?? null) === snapshot.focusItem)?.focus({ preventScroll: true });
  }
  for (const saved of snapshot.scrolls) {
    const node = root.querySelector(saved.selector);
    if (!node || !sameConversation && saved.selector !== '.roster') continue;
    node.scrollTop = saved.selector === '.transcript' && (explicitSend || saved.atEnd) ? node.scrollHeight : saved.top;
  }
  if (!sameConversation) {
    const transcript = root.querySelector('.transcript');
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }
}

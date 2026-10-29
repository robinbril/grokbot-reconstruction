import {composerEventInput,composerText} from './composer-input.js';
import { createUIMotion } from './ui-motion.js';
import { captureInputState, restoreInputState, captureTimeline } from './ui-motion-main-state.js';
import { createMainEffects } from './ui-motion-main-effects.js';

// CSS serializes the source's four sides as these equivalent two/three-value shorthands.
const REST_PADDING = '0px 44px', EXPANDED_PADDING = '10px 12px 46px';

export function createMainMotion({ root, getConversationKey, onFiles }) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)'), composing = new WeakSet();
  let inspect = false, reduced = preference.matches, controller, pending = null, key = null;
  const effects = createMainEffects({ isReduced: () => reduced, isInspect: () => inspect });
  const newController = () => createUIMotion({ root, inspect: () => inspect, reducedMotion: () => reduced });
  controller = newController();
  let observedSidebar = null;
  const sidebarObserver = new ResizeObserver(syncSidebarWidth);
  function syncSidebarWidth() {
    const sidebar = root.querySelector('.sidebar');
    if (sidebar !== observedSidebar) {
      sidebarObserver.disconnect(); observedSidebar = sidebar;
      if (sidebar) sidebarObserver.observe(sidebar);
    }
    if (!sidebar) return;
    const measured = `${sidebar.getBoundingClientRect().width}px`;
    if (root.style.getPropertyValue('--sand-sidebar-width') !== measured) root.style.setProperty('--sand-sidebar-width', measured);
  }

  function capture(options = {}) {
    if (pending) { const captured = pending; pending = null; return { ...captured, ...options }; }
    const identity = root.querySelector('[data-ui-header-identity]'), composer = root.querySelector('[data-ui-composer-padding]');
    const pane = root.querySelector('.context-pane');
    const section = options.sectionId ? [...root.querySelectorAll('[data-section-body]')].find(node => node.dataset.sectionId === options.sectionId) : null;
    const selectedMessage = options.messageId ? [...root.querySelectorAll('.message[data-message-id]')].find(node => node.dataset.messageId === options.messageId) : null;
    return {
      ...options, ...captureInputState(root), key, dropOverlay, dragDepth, dropTimeline: captureTimeline(dropOverlay, 'ui-motion:chat-drop'), infoOpen: root.querySelector('.conversation')?.hasAttribute('data-info-open') ?? false,
      clickedAtMs: performance.now(), headerLeft: identity?.getBoundingClientRect().left,
      pane, paneTransform: pane ? getComputedStyle(pane).transform : undefined, paneClosing: pane?.hasAttribute('data-closing'),
      paneTimeline: captureTimeline(pane, 'ui-motion:info-pane'), headerTimeline: controller.captureHeader(identity),
      sectionHeight: section?.getBoundingClientRect().height,
      sections: new Map([...root.querySelectorAll('[data-section-body]')].map(body => [body.dataset.sectionId, captureTimeline(body, 'ui-motion:section')])),
      glyphs: new Map([...root.querySelectorAll('[data-composer-glyph]')].map(item => { const style = getComputedStyle(item); return [item.dataset.composerGlyph,{opacity:style.opacity,transform:style.transform,timeline:captureTimeline(item,'ui-motion:composer-glyph')}]; })),
      padding: composer ? getComputedStyle(composer).padding : null, payload: root.querySelector('.send-button')?.dataset.hasPayload === 'true',
      reactions: new Map([...root.querySelectorAll('[data-reaction-id]')].map(node => [`${node.closest('.message').dataset.messageId}:${node.dataset.reactionId}`,
        { offsetLeft: node.offsetLeft, translate: Number.parseFloat(getComputedStyle(node).translate) || 0, timeline: captureTimeline(node, 'ui-motion:reaction') }])),
      above: selectedMessage ? [...root.querySelectorAll('.message[data-message-id]')].filter(node => node.getBoundingClientRect().top < selectedMessage.getBoundingClientRect().top)
        .map(node => [node.dataset.messageId, node.getBoundingClientRect().top]) : [],
    };
  }

  function updateComposer({ hasPayload, previousPayload, previousGlyphs } = {}) {
    const button = root.querySelector('.send-button'), input = root.querySelector('#message-input'), pad = root.querySelector('[data-ui-composer-padding]');
    if (!button || !pad || !input) return;
    const previous = previousPayload ?? button.dataset.hasPayload === 'true';
    effects.glyph(button, hasPayload ?? button.dataset.hasPayload === 'true', previous, previousGlyphs);
    const expanded = composerText(input).includes('\n') || input.scrollHeight >= 39 || pad.dataset.expanded === 'true' && composerText(input).length > 0
      || Boolean(root.querySelector('.attachment-list,.reply-draft,.attachment-error'));
    const next = expanded ? EXPANDED_PADDING : REST_PADDING, before = getComputedStyle(pad).padding;
    pad.dataset.expanded = String(expanded);
    if (pad.style.padding !== next && before !== next) controller.composerPadding(pad, { fromPadding: before, toPadding: next });
    else pad.style.padding = next;
  }

  function restore(snapshot) {
    syncSidebarWidth();
    const currentKey = getConversationKey(), sameConversation = snapshot.key === currentKey;
    clearDrop(); controller.destroy(); effects.cancel(); controller = newController();
    restoreInputState(root, snapshot, { sameConversation, explicitSend: snapshot.explicitSend, composing });
    const input = root.querySelector('#message-input');
    if (input) { input.style.height = '20px'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; }
    const conversation = root.querySelector('.conversation'), infoOpen = conversation?.hasAttribute('data-info-open') ?? false;
    if (sameConversation && snapshot.dropOverlay && snapshot.dragDepth > 0 && conversation) {
      dropOverlay = snapshot.dropOverlay; dragDepth = snapshot.dragDepth; conversation.append(dropOverlay); effects.resume(dropOverlay, snapshot.dropTimeline);
    }
    if (sameConversation && snapshot.reason === 'info-toggle' && snapshot.infoOpen !== infoOpen) {
      const identity = root.querySelector('[data-ui-header-identity]');
      if (identity) controller.header(identity, { visualLeft: snapshot.headerLeft, clickedAtMs: snapshot.clickedAtMs,
        previousInfoOpen: snapshot.infoOpen, isInfoOpen: infoOpen, reason: snapshot.reason });
      const pane = root.querySelector('.context-pane');
      if (infoOpen && pane) effects.pane(pane, true, { fromTransform: snapshot.paneTransform });
      else if (snapshot.pane && conversation) {
        const retiring = snapshot.pane; retiring.dataset.closing = ''; retiring.inert = true; retiring.setAttribute('aria-hidden', 'true');
        conversation.append(retiring); effects.pane(retiring, false, { fromTransform: snapshot.paneTransform });
      }
    } else if (sameConversation) {
      const pane = root.querySelector('.context-pane'), identity = root.querySelector('[data-ui-header-identity]');
      if (pane) effects.resume(pane, snapshot.paneTimeline);
      else if (snapshot.paneClosing && snapshot.pane && snapshot.paneTimeline && conversation) {
        conversation.append(snapshot.pane); effects.resume(snapshot.pane, snapshot.paneTimeline, { cleanup: () => snapshot.pane.remove() });
      }
      if (identity) controller.resumeHeader(identity, snapshot.headerTimeline);
    }
    for (const body of root.querySelectorAll('[data-section-body]')) {
      if (snapshot.reason !== 'section-toggle' || body.dataset.sectionId !== snapshot.sectionId) effects.resume(body, snapshot.sections.get(body.dataset.sectionId));
    }
    if (snapshot.reason === 'section-toggle') {
      const body = [...root.querySelectorAll('[data-section-body]')].find(node => node.dataset.sectionId === snapshot.sectionId);
      if (body) controller.section(body, { fromHeight: snapshot.sectionHeight, toHeight: body.getBoundingClientRect().height });
    }
    if (sameConversation) {
      for (const chip of root.querySelectorAll('[data-reaction-id]')) {
        const before = snapshot.reactions.get(`${chip.closest('.message').dataset.messageId}:${chip.dataset.reactionId}`);
        if (!before) continue;
        if (before.offsetLeft === chip.offsetLeft) effects.resume(chip, before.timeline);
        else {
          chip.style.translate = `${before.translate}px 0`;
          controller.reactionX(chip, { previousOffsetLeft: before.offsetLeft }); chip.style.removeProperty('translate');
        }
      }
      for (const [id, previousTop] of snapshot.reason === 'reaction' ? snapshot.above : []) {
        const sibling = [...root.querySelectorAll('.message[data-message-id]')].find(node => node.dataset.messageId === id);
        if (sibling) controller.reactionY(sibling, { previousTop });
      }
    }
    const pad = root.querySelector('[data-ui-composer-padding]');
    if (sameConversation && snapshot.padding && pad) pad.style.padding = snapshot.padding;
    updateComposer({ previousPayload: sameConversation ? snapshot.payload : undefined, previousGlyphs: sameConversation ? snapshot.glyphs : undefined });
    if (sameConversation && snapshot.focused && input) input.scrollTop = snapshot.inputScroll;
    const transcript = root.querySelector('.transcript'); if (transcript) controller.bindPeek(transcript);
    key = currentKey;
  }

  let dragDepth = 0, dropOverlay = null;
  const clearDrop = () => { dragDepth = 0; if (dropOverlay) { effects.cancel(dropOverlay); dropOverlay.remove(); dropOverlay = null; } };
  const hostFor = event => event.target instanceof Element ? event.target.closest('.conversation') : null;
  const isFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
  function dragenter(event) {
    const host = hostFor(event); if (!host || !isFiles(event)) return;
    event.preventDefault(); dragDepth++;
    if (dropOverlay) return;
    dropOverlay = document.createElement('div'); dropOverlay.setAttribute('data-chat-drop-overlay', '');
    dropOverlay.setAttribute('role', 'status'); dropOverlay.textContent = 'Bestanden bijvoegen'; host.append(dropOverlay);
    effects.animate(dropOverlay, 'chat-drop', { opacity: [0, 1] }, { duration: 120 });
  }
  function dragleave(event) { if (hostFor(event) && isFiles(event) && --dragDepth <= 0) clearDrop(); }
  function dragover(event) { if (hostFor(event) && isFiles(event)) event.preventDefault(); }
  function drop(event) {
    const host = hostFor(event), files = [...(event.dataTransfer?.files ?? [])].filter(file => file instanceof File);
    clearDrop(); if (!host || !files.length) return;
    event.preventDefault(); onFiles(files, getConversationKey());
  }
  const compositionstart = event => {const input=composerEventInput(event.target);if(input)composing.add(input);}, compositionend = event => {const input=composerEventInput(event.target);if(input)composing.delete(input);};
  root.addEventListener('dragenter', dragenter); root.addEventListener('dragleave', dragleave); root.addEventListener('dragover', dragover); root.addEventListener('drop', drop);
  document.addEventListener('dragend', clearDrop); document.addEventListener('compositionstart', compositionstart); document.addEventListener('compositionend', compositionend);
  const setReducedMotion = value => { reduced = Boolean(value); controller.setReducedMotion(reduced); if (reduced) effects.cancel(); };
  const preferenceChange = event => setReducedMotion(event.matches); preference.addEventListener('change', preferenceChange);
  return {
    capture, restore, updateComposer, prepare(reason, details = {}) { pending = capture({ reason, ...details }); },
    setInspect(value) { inspect = Boolean(value); controller.setInspect(inspect); }, setReducedMotion,
    diagnostics: () => [...controller.diagnostics(), ...effects.diagnostics()],
    destroy() {
      clearDrop(); controller.destroy(); effects.cancel(); sidebarObserver.disconnect(); observedSidebar = null; root.style.removeProperty('--sand-sidebar-width'); preference.removeEventListener('change', preferenceChange);
      root.removeEventListener('dragenter', dragenter); root.removeEventListener('dragleave', dragleave); root.removeEventListener('dragover', dragover); root.removeEventListener('drop', drop);
      document.removeEventListener('dragend', clearDrop); document.removeEventListener('compositionstart', compositionstart); document.removeEventListener('compositionend', compositionend);
    },
  };
}

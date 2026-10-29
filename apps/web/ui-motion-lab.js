import { createUIMotion } from './ui-motion.js';
import { resolveMotionRecipe } from './ui-motion-math.js';

const $ = selector => document.querySelector(selector);
const preview = $('[data-testid="ui-motion-preview"]'), select = $('#motion-recipe');
let inspect = true, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let controller, node, currentAnimation, headerInfoOpen = false;

function observe() {
  const actual = controller.diagnostics(), first = actual[0];
  $('#motion-observed').textContent = JSON.stringify(actual, null, 2);
  $('#motion-play-state').textContent = first?.playState ?? 'Gereed';
  $('#observed-time').textContent = first ? `${Number(first.currentTime).toFixed(1)} / ${first.timing.duration} ms` : 'Geen effect';
  $('#observed-geometry').textContent = first ? `${first.rect.x.toFixed(1)}, ${first.rect.y.toFixed(1)} · ${first.rect.width.toFixed(1)} × ${first.rect.height.toFixed(1)}` : 'Geen effect';
}

function reset() {
  controller?.destroy();
  controller = createUIMotion({ root: preview, inspect: () => inspect, reducedMotion: () => reduced });
  preview.replaceChildren(); currentAnimation = null; headerInfoOpen = false;
  const rig = document.createElement('div'); rig.className = 'fixture-rig';
  node = document.createElement('div'); node.className = 'motion-specimen'; node.setAttribute('data-ui-motion-target', '');
  const title = document.createElement('strong'); title.textContent = select.selectedOptions[0].textContent;
  node.append(title);
  for (let index = 0; index < 3; index++) { const line = document.createElement('div'); line.className = 'fixture-line'; node.append(line); }
  rig.append(node); preview.append(rig);
  const selected = resolveMotionRecipe(select.value, { reducedMotion: reduced });
  $('#motion-name').textContent = title.textContent;
  $('#source-duration').textContent = selected.skip ? 'Overgeslagen' : `${selected.duration} ms`;
  $('#source-easing').textContent = selected.easing.startsWith('linear(') ? 'linear(), bronmonsters' : selected.easing;
  $('.fixture-note').textContent = select.value === 'teamPin'
    ? 'Lokale teamsetup-fixture: vaste header na retirement. 80 ms vertraging. Deze bronroute is niet aan de gewone vastgemaakte Bots of taken gekoppeld.'
    : 'Bronfixture. Dezelfde controller bestuurt de interface.';
  observe();
}

function start() {
  reset();
  switch (select.value) {
    case 'section':
      node.style.height = '150px';
      currentAnimation = controller.section(node, { fromHeight: 42, toHeight: 150 }); break;
    case 'header': {
      const visualLeft = node.getBoundingClientRect().left;
      node.style.left = '150px'; headerInfoOpen = true;
      currentAnimation = controller.header(node, { visualLeft, clickedAtMs: performance.now(), previousInfoOpen: false, isInfoOpen: true, reason: 'info-toggle' }); break;
    }
    case 'reactionX': {
      const previousOffsetLeft = node.offsetLeft; node.style.left = '150px';
      currentAnimation = controller.reactionX(node, { previousOffsetLeft }); break;
    }
    case 'reactionY': {
      const previousTop = node.getBoundingClientRect().top; node.style.top = '126px';
      currentAnimation = controller.reactionY(node, { previousTop }); break;
    }
    case 'lateShrink':
      node.style.height = '68px';
      currentAnimation = controller.lateShrink(node, { fromHeight: 164, toHeight: 68, eligible: true, committed: true }); break;
    case 'peek': {
      node.classList.add('fixture-peek'); node.style.left = '140px'; node.setAttribute('data-peeking', '');
      const stamp = document.createElement('span'); stamp.className = 'fixture-stamp'; stamp.textContent = '14:36'; node.append(stamp);
      currentAnimation = controller.peek(node, { fromPeek: 70 }); break;
    }
    case 'teamResize':
      node.style.height = '164px';
      currentAnimation = controller.teamResize(node, { fromHeight: 42, toHeight: 164 }); break;
    case 'teamPin': {
      const previousTop = node.getBoundingClientRect().top;
      node.querySelector('strong').textContent = 'Teamsetup: vaste header';
      node.style.height = '64px'; node.style.top = '126px';
      currentAnimation = controller.teamPin(node, { previousTop, retiring: true }); break;
    }
    case 'teamRetire': currentAnimation = controller.teamRetire(node); node = currentAnimation?.effect.target ?? node; break;
    case 'teamEnter': currentAnimation = controller.teamEnter(node); break;
    case 'composerPadding': currentAnimation = controller.composerPadding(node, { fromPadding: 8, toPadding: 36 }); break;
  }
  currentAnimation?.addEventListener('finish', observe, { once: true });
  observe();
}

function interrupt() {
  if (!currentAnimation || select.value !== 'header') return;
  const visualLeft = node.getBoundingClientRect().left, previousInfoOpen = headerInfoOpen;
  headerInfoOpen = !headerInfoOpen; node.style.left = headerInfoOpen ? '150px' : '24px';
  currentAnimation = controller.header(node, { visualLeft, clickedAtMs: performance.now(), previousInfoOpen, isInfoOpen: headerInfoOpen, reason: 'info-toggle' });
  observe();
}

select.addEventListener('change', reset);
$('#motion-start').addEventListener('click', start);
$('#motion-half').addEventListener('click', () => {
  if (currentAnimation) {
    const timing = currentAnimation.effect.getTiming();
    currentAnimation.pause(); currentAnimation.currentTime = Number(timing.delay) + Number(timing.duration) / 2;
  }
  observe();
});
$('#motion-finish').addEventListener('click', () => {
  for (const animation of preview.getAnimations({ subtree: true })) animation.finish();
  observe();
});
$('#motion-interrupt').addEventListener('click', interrupt);
$('#motion-reset').addEventListener('click', reset);
$('#motion-inspect').addEventListener('click', event => {
  inspect = !inspect; event.currentTarget.setAttribute('aria-checked', String(inspect)); controller.setInspect(() => inspect);
});
$('#motion-reduced').setAttribute('aria-checked', String(reduced));
$('#motion-reduced').addEventListener('click', event => {
  reduced = !reduced; event.currentTarget.setAttribute('aria-checked', String(reduced)); controller.setReducedMotion(() => reduced); reset();
});
window.addEventListener('pagehide', () => controller.destroy(), { once: true });
reset();

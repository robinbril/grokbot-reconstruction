import { source, bindWorkspace } from './product-workspace-utils.js';

// Local SVG generation is independent of the vendor's remote character service.
// Pending lasts for the real image decoder, never an artificial animation delay.
export function createAvatarGeneration(host, { avatar, getCandidate, acceptCandidate }) {
  let generation = 0, pending = false, previewURL = null;
  const resources = new Set();
  const revoke = url => { if (resources.delete(url)) URL.revokeObjectURL(url); };
  function controls(value) {
    for (const node of host.overlay.querySelectorAll('[data-action=product-avatar-generate],[data-action=product-avatar-save],[data-avatar-upload],[role=tab]')) node.disabled = value;
    const description = host.overlay.querySelector('[aria-label="Beschrijving van personage"]');
    if (description) description.readOnly = value;
  }
  function clear() {
    generation++; pending = false;
    host.overlay.querySelector('[data-avatar-generation-status]')?.remove();
    controls(false);
    for (const url of [...resources]) revoke(url);
    previewURL = null;
  }
  async function generate() {
    if (pending) return;
    const candidate = getCandidate();
    const preview = host.overlay.querySelector('[data-avatar-editor-preview]');
    if (!candidate || !preview) return;
    const request = ++generation, dialog = host.getDialogVersion();
    pending = true; controls(true);
    host.overlay.querySelector('[data-avatar-generation-error]')?.remove();
    const status = document.createElement('div');
    status.dataset.avatarGenerationStatus = '';
    status.setAttribute('role', 'status'); status.setAttribute('aria-label', 'Personage wordt gemaakt');
    status.innerHTML = `<span data-avatar-generation-pulse ${source(3)} data-source-classes="sand-13oubkp sand-jp8j0k sand-16rqkct sand-fwqdrz sand-c79vkq sand-1aquc0h sand-njfjcd sand-a4qsjk sand-4hg4is" aria-hidden="true"></span>`;
    preview.hidden = true; preview.after(status); bindWorkspace(host, status);
    let url;
    const isCurrent = () => request === generation && dialog === host.getDialogVersion() && preview.isConnected;
    try {
      const holder = document.createElement('div'); holder.innerHTML = avatar(candidate, 'static');
      const svg = holder.querySelector('svg');
      if (!svg) throw Error('Personage kon niet worden getekend');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', '96'); svg.setAttribute('height', '96');
      url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })); resources.add(url);
      const image = new Image(96, 96); image.alt = 'Nieuw lokaal personage'; image.src = url;
      await image.decode();
      if (!isCurrent()) { revoke(url); return; }
      if (previewURL) revoke(previewURL);
      previewURL = url; acceptCandidate(candidate);
      preview.replaceChildren(image);
    } catch {
      if (url) revoke(url);
      if (isCurrent()) {
        const error = document.createElement('p'); error.dataset.avatarGenerationError = ''; error.setAttribute('role', 'alert');
        error.textContent = 'Personage kon niet worden gemaakt. Je vorige keuze blijft beschikbaar; probeer opnieuw.';
        status.after(error);
      }
    } finally {
      if (isCurrent()) { pending = false; status.remove(); preview.hidden = false; controls(false); }
    }
  }
  return { generate, clear, get pending() { return pending; } };
}

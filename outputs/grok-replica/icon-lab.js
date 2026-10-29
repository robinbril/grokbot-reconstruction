import { fetchIconData, getIconNames, iconSvg } from './icon-library.js';
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export async function openIconLab({ showDialog, closeDialog, isCurrent = () => true }) {
 try { await fetchIconData(); } catch { if (!isCurrent()) return null; showDialog('small-dialog', 'Iconenlab', '<div class="form-dialog"><h1>Iconenlab</h1><p role="alert">Iconen konden niet worden geladen.</p></div>'); return () => {}; }
 if (!isCurrent()) return null;
 showDialog('icon-lab', 'Iconenlab', '<div class="icon-lab-content"><header><h1>Iconenlab</h1><p>Grok Bot 0.71.2. Alle 808 namen met de oorspronkelijke outline- en gevulde paden.</p></header><div class="icon-lab-controls"><label for="icon-search">Iconen zoeken</label><input id="icon-search" aria-label="Iconen zoeken" autocomplete="off"><span>Gevulde iconen</span><button class="switch" role="switch" aria-label="Gevulde iconen" aria-checked="false"></button><span data-testid="icon-count">808</span></div><div class="icon-grid" data-testid="icon-grid"></div><p role="status" class="small muted"></p><button class="outline-button" data-icon-close>Iconenlab sluiten</button></div>');
 const dialog = document.querySelector('dialog[aria-label="Iconenlab"]'), abort = new AbortController(); let filled = false;
 const render = () => {
  const names = getIconNames().filter(name => name.toLowerCase().includes(dialog.querySelector('input').value.trim().toLowerCase()));
  dialog.querySelector('[data-testid="icon-count"]').textContent = String(names.length);
  dialog.querySelector('[data-testid="icon-grid"]').innerHTML = names.map(name => `<div class="icon-sample" data-icon-name="${name}">${iconSvg(name, { filled, size: 28 })}<span>${escape(name)}</span></div>`).join('');
  dialog.querySelector('[role="status"]').textContent = names.length ? `${names.length} iconen. ${filled ? 'Gevulde' : 'Outline'} variant.` : 'Geen iconen gevonden.';
 };
 dialog.querySelector('input').addEventListener('input', render, { signal: abort.signal });
 dialog.querySelector('[role="switch"]').addEventListener('click', event => { filled = !filled; event.currentTarget.setAttribute('aria-checked', String(filled)); render(); }, { signal: abort.signal });
 dialog.querySelector('[data-icon-close]').addEventListener('click', closeDialog, { signal: abort.signal }); render();
 return () => abort.abort();
}

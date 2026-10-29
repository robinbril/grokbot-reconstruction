import { source, bindWorkspace } from './product-workspace-utils.js';

const TEMPLATES = [
  ['Marketing Agent', 'Een partner voor campagnes, content en onderzoek.', '#a57137'],
  ['Onderzoeksassistent', 'Verken onderwerpen en organiseer je bevindingen.', '#9354ff'],
  ['Programmeur', 'Werk samen aan code en technische vraagstukken.', '#1680f3'],
  ['Nieuwe Bot', 'Begin met een naam en pas de identiteit aan.', '#000000'],
];
export function createTemplateSurface(host, openCreate) {
  const { avatar, icon, esc } = host;
  let template = null, pane = 'root';
  const drafts = new Map();
  function renderPane() {
    if (!template) return;
    const body = host.overlay.querySelector('[data-template-pane]'), mark = host.overlay.querySelector('.product-template-mark');
    const heading = host.overlay.querySelector('[data-template-heading]'), back = host.overlay.querySelector('[data-template-back]');
    if (!body || !mark || !heading || !back) return;
    const compact = pane === 'settings';
    mark.toggleAttribute('data-compact', compact);
    // Source os: compact depends on Ae(pane), never pointer hover.
    mark.classList.toggle('sand-1ov92gx', compact);
    heading.textContent = compact ? 'Instellingen' : template.name;
    back.dataset.action = compact ? 'product-template-back' : 'templates';
    body.innerHTML = compact
      ? `<label class="field-label" for="template-instructions">Bot-instructies</label><textarea id="template-instructions" class="field-input" aria-label="Bot-instructies" rows="6" maxlength="12000" data-template-instructions>${esc(template.description)}</textarea><p class="product-local-boundary">Deze instructies worden met je nieuwe Bot in deze browser opgeslagen.</p>`
      : `<p>${esc(template.summary)}</p><button type="button" class="context-link" data-action="product-template-settings"><span>Instellingen</span>${icon('right')}</button><button type="button" class="primary-button" data-action="product-template-use">Deze Bot maken</button>`;
    bindWorkspace(host);
  }
  function open(id) {
    const index = TEMPLATES[Number(id)] ? Number(id) : 3, item = TEMPLATES[index];
    if (!drafts.has(index)) drafts.set(index, { name: item[0], summary: item[1], description: item[1], color: item[2] });
    template = drafts.get(index); pane = 'root';
    host.showDialog('small-dialog', template.name, `<div class="product-dialog-header"><button type="button" data-template-back data-action="templates" class="icon-button" aria-label="Terug">${icon('left')}</button><h1 data-template-heading>${esc(template.name)}</h1></div><div class="product-avatar-editor product-template-detail"><div class="product-template-mark" ${source(5)}>${avatar({ name: template.name, color: template.color, shape: 0, pointerMode: 'local' }, 'large')}</div><div data-template-pane></div></div>`);
    renderPane();
  }
  return {
    open,
    handleAction({ action }) {
      if (!template) return false;
      if (action === 'product-template-settings') { pane = 'settings'; renderPane(); return true; }
      if (action === 'product-template-back') { pane = 'root'; renderPane(); return true; }
      if (action === 'product-template-use') {
        const value = { ...template }; openCreate(value.name, { description: value.description, config: { instructions: value.description, template: value.name } }); return true;
      }
      return false;
    },
    handleInput(event) { if (template && event.target.matches('[data-template-instructions]')) template.description = event.target.value; },
  };
}

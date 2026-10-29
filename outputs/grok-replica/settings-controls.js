// Visible native labels from SW06, retained as a local preference, not a translation engine.
export const languages = Object.freeze([
  'Systeem volgen', 'Afrikaans', 'العربية', 'বাংলা', '繁體中文', '简体中文',
  'Dansk', 'Deutsch', 'English', 'Suomi', 'Français', 'Ελληνικά', 'Hausa',
  'עברית', 'हिन्दी', 'Magyar', 'Bahasa Indonesia', 'Italiano', '日本語', '한국어',
  'मराठी', 'Nederlands', 'Norsk bokmål', 'Українська', 'Polski', 'Português',
  'Русский', 'Español', 'Kiswahili', 'தமிழ்', 'తెలుగు', 'ไทย', 'Čeština',
  'Türkçe', 'اردو', 'Tiếng Việt', 'Svenska',
]);

export function normalizeSettingsPreferences(state) {
  if (!languages.includes(state.language)) state.language = 'Nederlands';
  if (!['bot', 'black'].includes(state.accentColor)) state.accentColor = 'bot';
  if (typeof state.spellcheck !== 'boolean') state.spellcheck = true;
}

export function applySettingsPreferences(state) {
  const root = document.documentElement;
  const color = state.accentColor === 'black' ? '#1c1c1c'
    : state.agents.find(agent => agent.id === state.selected)?.color || state.botColor;
  const dark = root.dataset.theme === 'dark';
  const monochrome = ['#000000', '#1c1c1c'].includes(color);
  // The monochrome preference follows the theme so links and focus rings remain visible.
  root.style.setProperty('--accent', dark && monochrome ? '#f5f5f5' : color);
  root.style.setProperty('--accent-thumb', dark && monochrome ? '#161616' : '#fff');
  const composer = document.querySelector('#message-input');
  if (composer) composer.spellcheck = state.spellcheck;
}

export function openLanguagePicker(trigger, state, persist, icon) {
  const dialog = document.createElement('dialog');
  dialog.className = 'language-picker';
  dialog.setAttribute('aria-label', 'Taal');
  dialog.innerHTML = `<header class="language-picker-header"><h2>Taal</h2><button type="button" class="icon-button" aria-label="Taalkiezer sluiten">${icon('close')}</button></header><label class="search-field">${icon('search')}<input aria-label="Taal zoeken" placeholder="Taal zoeken" autocomplete="off"></label><div class="language-options" role="listbox" aria-label="Taal"></div>`;
  const search = dialog.querySelector('input');
  const list = dialog.querySelector('[role="listbox"]');
  const close = () => { dialog.close(); dialog.remove(); if (trigger.isConnected) trigger.focus(); };
  const choose = language => {
    state.language = language;
    persist();
    trigger.setAttribute('aria-label', 'Taal, ' + language);
    trigger.querySelector('[data-language-label]').textContent = language;
    close();
  };
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    list.replaceChildren();
    for (const language of languages.filter(label => label.toLocaleLowerCase().includes(query))) {
      const option = document.createElement('button');
      option.type = 'button'; option.className = 'language-option'; option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(state.language === language));
      option.tabIndex = state.language === language ? 0 : -1;
      option.textContent = language; option.addEventListener('click', () => choose(language));
      list.append(option);
    }
    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'no-results'; empty.setAttribute('role', 'status'); empty.textContent = 'Geen talen gevonden';
      list.append(empty);
    } else if (!list.querySelector('[tabindex="0"]')) list.firstElementChild.tabIndex = 0;
  }
  search.addEventListener('input', filter);
  dialog.querySelector('[aria-label="Taalkiezer sluiten"]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  dialog.addEventListener('keydown', event => {
    const options = [...list.querySelectorAll('[role="option"]')];
    const index = options.indexOf(document.activeElement);
    if (!options.length) return;
    if (event.target === search && event.key === 'Enter' && options.length === 1) {
      event.preventDefault(); options[0].click(); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.target === search && !['ArrowDown', 'ArrowUp'].includes(event.key))) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options.forEach((option, i) => { option.tabIndex = i === next ? 0 : -1; });
    options[next].focus();
  });
  // Native nested modal provides focus containment while preserving the parent settings DOM.
  trigger.closest('dialog').append(dialog);
  filter(); dialog.showModal(); search.focus();
}

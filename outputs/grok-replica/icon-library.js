/* Inert recovered glyph outlines, independently validated and rendered. No font or target JS execution. */
let library = null, pending = null;
const validName = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const validPath = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/;
export function validateIconData(data) {
 if (!data || data.viewBox !== '0 0 300 300' || data.transform !== 'translate(0 300) scale(1 -1)') throw Error('Ongeldige iconengegevens');
 const outline = data.variants?.outline, filled = data.variants?.filled;
 if (!outline || !filled) throw Error('Ontbrekende iconenvariant');
 const names = Object.keys(outline).sort();
 if (names.length !== 808 || Object.keys(filled).length !== 808) throw Error('Onvolledige iconenbibliotheek');
 for (const name of names) {
  if (!validName.test(name) || !Object.hasOwn(filled, name)) throw Error('Ongeldige icoonnaam');
  for (const variant of [outline, filled]) {
   const icon = variant[name];
   if (!icon || typeof icon.path !== 'string' || !icon.path || icon.path.length > 200000 || !validPath.test(icon.path) || /NaN|Infinity/i.test(icon.path) || icon.unitsPerEm !== 300) throw Error('Ongeldig icoonpad');
   const numbers = icon.path.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) || [];
   if (!numbers.every(value => Number.isFinite(Number(value)))) throw Error('Ongeldige icooncoördinaten');
  }
 }
 if (Object.keys(filled).some(name => !validName.test(name) || !Object.hasOwn(outline, name))) throw Error('Ongeldige icoonnaam');
 return true;
}
export function loadIconData(data) { validateIconData(data); library = structuredClone(data); return getIconNames(); }
export function fetchIconData() {
 if (library) return Promise.resolve(getIconNames());
 if (!pending) pending = fetch(new URL('./assets/grok-icons.json', import.meta.url)).then(response => { if (!response.ok) throw Error('Iconen laden mislukt'); return response.json(); }).then(loadIconData).catch(error => { pending = null; throw error; });
 return pending;
}
export function iconsReady() { return library !== null; }
export function getIconNames() { return library ? Object.keys(library.variants.outline).sort() : []; }
export function getIcon(name, { filled = false } = {}) {
 const variant = library?.variants[filled ? 'filled' : 'outline'];
 if (!variant || !Object.hasOwn(variant, name)) throw Error('Onbekend icoon');
 return { ...variant[name] };
}
export function iconSvg(name, { filled = false, size = 24 } = {}) {
 const icon = getIcon(name, { filled });
 const pixels = Number.isFinite(size) ? Math.max(8, Math.min(300, size)) : 24;
 return `<svg viewBox="0 0 300 300" width="${pixels}" height="${pixels}" fill="currentColor" aria-hidden="true"><path transform="translate(0 300) scale(1 -1)" d="${icon.path}"/></svg>`;
}
export const SEMANTIC_ICONS = Object.freeze({ search: 'search', plus: 'add', close: 'close', down: 'chevron-down', right: 'chevron-right', left: 'chevron-left', arrow: 'arrow-right-up', more: 'dots-3-horizontal', mic: 'mic', send: 'arrow-up', download: 'cloud-arrow-down', panel: 'layout-sidebar-right', settings: 'cog', computer: 'device-desktop', file: 'file', copy: 'copy', pin: 'pin', trash: 'trash', check: 'check', clock: 'clock', shield: 'shield', logout: 'arrow-bracket-from-right', book: 'book-open', link: 'link', refresh: 'arrows-cw', folder: 'folder', bell: 'bell', group: 'people', edit: 'pencil', help: 'question', speaker: 'speaker-waves', pause: 'pause', play: 'play', key: 'key' });

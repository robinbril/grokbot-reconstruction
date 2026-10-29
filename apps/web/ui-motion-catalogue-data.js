// CSS evidence is data. Nothing in this module evaluates target JavaScript.
const unsafe = /(?:url\s*\(|@import|expression\s*\(|(?:javascript|vbscript|data)\s*:|<|\bbehavior\s*:|-moz-binding|\/\*)/i;
const decodeCSS = value => value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/\\(.)/gs, '$1');
export function assertInertCSS(value) {
  if (typeof value !== 'string' || unsafe.test(decodeCSS(value))) throw new TypeError('Active CSS rejected');
  return value;
}
export function validateCatalogueData(data) {
  if (!data || !Array.isArray(data.families) || !Array.isArray(data.instances) || !Array.isArray(data.rules)) throw new TypeError('Invalid source catalogue');
  const ids = new Set(data.instances.map(i => i.id));
  if (ids.size !== data.instances.length) throw new TypeError('Duplicate source instance');
  for (const family of data.families) for (const id of family.instances) if (!ids.has(id)) throw new TypeError('Unknown source instance');
  for (const rule of data.rules) {
    assertInertCSS(rule.selector);
    if (/[{};]/.test(rule.selector)) throw new TypeError('Invalid selector');
    for (const condition of rule.stateconditions || []) {
      assertInertCSS(condition);
      if (!/^@(media|container|supports|starting-style)\b/.test(condition) || /[{};]/.test(condition)) throw new TypeError('Invalid condition');
    }
    for (const declaration of rule.declarations) {
      if (!/^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/.test(declaration.property)) throw new TypeError('Invalid property');
      assertInertCSS(declaration.value);
      if (/[{};]/.test(declaration.value)) throw new TypeError('Invalid declaration');
    }
  }
  for (const frame of data.keyframes || []) {
    if (!/^[\w-]+$/.test(frame.name) || !frame.css.startsWith(`@keyframes ${frame.name}{`)) throw new TypeError('Invalid keyframe');
    assertInertCSS(frame.css);
  }
  for (const variable of data.custom_variables || []) {
    assertInertCSS(variable.selector); assertInertCSS(variable.value);
    if (/[{};]/.test(variable.selector + variable.value) || !/^--[\w-]+$/.test(variable.property)) throw new TypeError('Invalid variable');
    for (const c of variable.conditions || []) assertInertCSS(c);
  }
  return data;
}

export function sourceRuleCSS(rule, mode) {
  let css = `${rule.selector}{${rule.declarations.map(d => `${d.property}:${d.value}`).join(';')}}`;
  for (const raw of [...(rule.stateconditions || [])].reverse()) {
    let condition = raw;
    if (raw.includes('prefers-reduced-motion:reduce')) {
      condition = raw.replace(/\(prefers-reduced-motion:reduce\)/g, mode === 'reduced' ? '(min-width:0px)' : '(max-width:0px)');
    }
    css = `${condition}{${css}}`;
  }
  return css;
}

import { validateCatalogueData, sourceRuleCSS, assertInertCSS } from './ui-motion-catalogue-data.js';

const $ = id => document.getElementById(id);
const frame = $('catalogue-stage');
let data, descriptors, current, descriptor, stage, target, stylesheet, mode = 'normal';
let states = {}, allowedStates = new Map(), activeRules = [], generation = 0;
const visited = new Set(), observed = new Set();
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const properties = ['opacity','transform','translate','scale','filter','transition-property','transition-duration','transition-timing-function','animation-name','animation-duration','animation-timing-function','animation-delay','animation-fill-mode','width','height','max-height','margin-top','padding-top','clip-path','visibility','display','grid-template-rows','background-position'];
function element(tag, text, attrs = {}) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}
function option(value, text = value) { return element('option', text, { value }); }
function childElement(tag, classes = [], role) {
  const node = stage.createElement(tag); node.className = classes.join(' ');
  if (role) node.dataset.fixtureRole = role;
  return node;
}
function variablesCSS() {
  const merged = new Map();
  for (const v of [...data.custom_variables, ...descriptors.variables]) {
    assertInertCSS(v.selector); assertInertCSS(v.value);
    if (!/^--[\w-]+$/.test(v.property) || /[{};]/.test(v.value + v.selector)) continue;
    merged.set(`${v.selector}|${v.property}|${(v.conditions || []).join()}`, v);
  }
  return [...merged.values()].map(v => sourceRuleCSS({ selector: v.selector, declarations: [{ property: v.property, value: v.value }], stateconditions: v.conditions }, mode)).join('\n');
}
function rulesForInstance() {
  const classNames = new Set(descriptor.classes);
  const rules = new Map(data.rules.filter(r => current.rule_ids.includes(r.id)).map(r => [r.id,r]));
  for (const rule of descriptors.support_rules) {
    if ([...classNames].some(c => rule.selector.includes(`.${c}`))) rules.set(rule.id, rule);
  }
  return [...rules.values()].sort((a,b) => Number(a.id.slice(4))-Number(b.id.slice(4)));
}
function discoverStates() {
  allowedStates = new Map();
  for (const rule of activeRules) for (const match of rule.selector.matchAll(/\[(data-[\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
    if (['data-component','data-role','data-size','data-variant'].includes(match[1])) continue;
    if (!allowedStates.has(match[1])) allowedStates.set(match[1], new Set());
    if (match[2]) allowedStates.get(match[1]).add(match[2]);
  }
  if (current.id === 'INSTANCE-002') allowedStates.set('data-swap-active', new Set());
}
function applyStates() {
  const nodes = [...stage.querySelectorAll('[data-source-node]')];
  for (const [name, values] of allowedStates) {
    for (const node of nodes) node.removeAttribute(name);
    const value = states[name];
    if (value !== false && value !== undefined && value !== '') for (const node of nodes) node.setAttribute(name, values.size ? String(value) : '');
  }
  if (current.id === 'INSTANCE-002') {
    const first = stage.querySelector('[data-fixture-role="toggle-first"]');
    const second = stage.querySelector('[data-fixture-role="toggle-second"]');
    first.toggleAttribute('data-swap-active', Boolean(states['data-swap-active']));
    second.toggleAttribute('data-swap-active', !states['data-swap-active']);
  }
}
function buildStateControls() {
  $('catalogue-states').replaceChildren();
  for (const [name, values] of allowedStates) {
    const label = element('label', name);
    const input = values.size ? element('select', undefined, { 'aria-label':name }) : element('input', undefined, { type:'checkbox', 'aria-label':name });
    if (values.size) { input.append(option('', 'Niet ingesteld'), ...[...values].map(v => option(v))); input.value = states[name] || ''; }
    else input.checked = Boolean(states[name]);
    input.addEventListener('change', () => api.setState(name, values.size ? input.value : input.checked).catch(showError));
    label.append(input); $('catalogue-states').append(label);
  }
}
function buildFixture() {
  stage.body.replaceChildren();
  const surrounding = childElement('div', ['sand--default-marker','ui--default-marker'], 'source-context');
  surrounding.id = 'fixture-host'; surrounding.dataset.sourceNode = '';
  if (current.id === 'INSTANCE-002') {
    const source = descriptor.consumers.find(c => c.source.includes('data-swap-active'))?.source || '';
    const literalGroups = [...source.matchAll(/className:"([^"]+)"/g)].map(m => m[1].split(' '));
    const wrapper = childElement('span', literalGroups[0] || [], 'toggle-wrapper');
    for (let index = 0; index < 2; index++) {
      const glyph = childElement('span', literalGroups[index+1] || descriptor.classes, index ? 'toggle-second':'toggle-first');
      glyph.dataset.sourceNode = ''; glyph.textContent = index ? 'B' : 'A'; wrapper.append(glyph);
    }
    surrounding.append(wrapper); target = wrapper.firstElementChild;
  } else {
    target = childElement('div', descriptor.classes, 'source-slot'); target.dataset.sourceNode = '';
    target.tabIndex = 0; target.textContent = current.style_slot || current.family;
    surrounding.append(target);
    // Structural marker attributes are copied only when the literal consumer proves them.
    const consumerText = descriptor.consumers.map(c => c.source).join('\n');
    for (const name of ['data-component','data-role','data-size','data-variant']) {
      const match = consumerText.match(new RegExp(`"${name}":"([\\w-]+)"`));
      if (match) surrounding.setAttribute(name, match[1]);
    }
  }
  stage.body.append(surrounding); applyStates();
  surrounding.addEventListener('pointerup', scheduleInspection);
  surrounding.addEventListener('pointerover', scheduleInspection);
  surrounding.addEventListener('pointerout', scheduleInspection);
  surrounding.addEventListener('focusin', scheduleInspection);
  surrounding.addEventListener('focusout', scheduleInspection);
}
function scheduleInspection() { nextFrame().then(() => { if (target?.isConnected) renderInspection(); }); }
function computedFor(node) {
  const style = frame.contentWindow.getComputedStyle(node);
  const extra = activeRules.flatMap(r => r.declarations.map(d => d.property));
  return Object.fromEntries([...new Set([...properties,...extra])].map(p => [p,style.getPropertyValue(p)]));
}
function conditionActive(condition) {
  if (condition.startsWith('@media')) {
    if (condition.includes('prefers-reduced-motion')) return mode === 'reduced';
    return frame.contentWindow.matchMedia(condition.slice(6)).matches;
  }
  if (condition.startsWith('@supports')) return frame.contentWindow.CSS.supports(condition.slice(9).trim());
  return !condition.startsWith('@container');
}
function inspect() {
  if (!current || !stage || !target) return { status:'source-only', counts:{families:0,instances:0} };
  const animations = stage.getAnimations().map(animation => ({
    name:animation.animationName || animation.transitionProperty || '', type:animation.constructor.name,
    target:animation.effect?.target?.dataset?.fixtureRole || animation.effect?.target?.tagName,
    pseudoElement:animation.effect?.pseudoElement || null,
    currentTime:animation.currentTime, playState:animation.playState,
    timing:animation.effect?.getTiming(), computedTiming:animation.effect?.getComputedTiming(), keyframes:animation.effect?.getKeyframes()
  }));
  const matchedRules = [], unresolved = [];
  for (const rule of activeRules) {
    if (!rule.stateconditions.every(conditionActive)) continue;
    let matched = false;
    try { matched = [...stage.querySelectorAll(rule.selector)].length > 0; } catch { /* pseudo elements are inspected separately */ }
    if (!matched && /::?(before|after)/.test(rule.selector)) {
      try { matched = Boolean(stage.querySelector(rule.selector.replace(/::?(before|after)\b/g,''))); } catch { /* recorded unresolved */ }
    }
    if (matched) matchedRules.push(rule.id);
    else unresolved.push({ rule:rule.id, selector:rule.selector, reason:'Bronselector matcht de lokale fixture niet in deze toestand.' });
  }
  for (const rule of activeRules) for (const condition of rule.stateconditions) if (condition.startsWith('@container')) unresolved.push({ rule:rule.id,condition,reason:'Broncontainergeometrie niet bewezen.' });
  const style = computedFor(target);
  const missingVariables = new Set();
  for (const rule of activeRules) for (const d of rule.declarations) for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) if (!frame.contentWindow.getComputedStyle(target).getPropertyValue(m[1]).trim()) missingVariables.add(m[1]);
  for (const name of missingVariables) unresolved.push({variable:name,reason:'Dynamische bronwaarde ontbreekt.'});
  unresolved.push({ reason:'Native activatie en volledige componentgeometrie niet bewezen; dit is een lokaal bronslot.' });
  const status = animations.some(a => a.type === 'CSSAnimation' || a.type === 'CSSTransition') ? 'observed-motion' : matchedRules.length ? 'rendered-static' : 'source-only';
  visited.add(current.id); if (status === 'observed-motion') observed.add(current.id);
  const computed = { main:style };
  if (current.id === 'INSTANCE-002') { computed.first = style; computed.second = computedFor(stage.querySelector('[data-fixture-role="toggle-second"]')); }
  return { familyId:current.family,instanceId:current.id,mode,fixture:{ binding:descriptor.binding,classes:descriptor.classes,native_activation_proven:false,sourceEvidence:descriptor.styleEvidence },computed,animations,matchedRules,unresolved,status,counts:{families:data.families.length,instances:data.instances.length,reachable:332,visited:visited.size,observedMotion:observed.size,notObservedMotion:332-observed.size} };
}
function renderInspection() {
  const result = inspect();
  $('catalogue-runtime-status').textContent = result.status;
  $('catalogue-case-title').textContent = `${current.id} · ${current.style_slot || current.family}`;
  $('catalogue-coverage').textContent = `60 families · 332 brongevallen bereikbaar. ${result.counts.visited} bezocht · ${result.counts.observedMotion} met werkelijk waargenomen beweging in deze sessie.`;
  const evidence = $('catalogue-evidence'); evidence.replaceChildren();
  for (const text of [
    `${current.family} / ${current.style_binding || 'ongebonden'} / ${current.style_slot || 'directe plaatsing'}`,
    `Fixture: ${descriptor.binding}. ${result.matchedRules.length} bronregels matchen nu. ${result.animations.length} actuele browseranimaties.`,
    `Bron: ${current.sourceprovenance.file}`,
    `Normaal: ${current.normal_rule_ids.length} regels. Lokaal reduced-motion: ${current.reduced_rule_ids.length} regels.`,
    ...result.unresolved.map(u => [u.rule,u.variable,u.condition,u.reason].filter(Boolean).join(' '))
  ]) evidence.append(element('p',text));
  $('catalogue-inspection').textContent = JSON.stringify(result,null,2); return result;
}
async function restart() {
  const mine = ++generation;
  stage.getAnimations().forEach(a => a.cancel());
  stylesheet.textContent = variablesCSS()+'\n'+activeRules.map(r => sourceRuleCSS(r,mode)).join('\n')+'\n'+data.keyframes.map(k => k.css).join('\n');
  buildFixture(); void target.getBoundingClientRect();
  await nextFrame();
  if (mine !== generation) return inspect();
  return renderInspection();
}
async function selectInstance(id) {
  const instance = data.instances.find(i => i.id === id); if (!instance) throw new RangeError(`Onbekend brongeval: ${id}`);
  current = instance; descriptor = descriptors.instances.find(i => i.id === id); states = {};
  $('catalogue-family').value = current.family;
  const family = data.families.find(f => f.id === current.family);
  $('catalogue-instance').replaceChildren(...family.instances.map(i => option(i, `${i} · ${data.instances.find(x => x.id === i).style_slot || 'bronplaatsing'}`)));
  $('catalogue-instance').value = id; activeRules = rulesForInstance(); discoverStates(); buildStateControls(); return restart();
}
async function selectFamily(id) {
  const family = data.families.find(f => f.id === id); if (!family) throw new RangeError(`Onbekende familie: ${id}`);
  return selectInstance(family.instances[0]);
}
async function setState(name,value) {
  if (name === 'pressed' && current.id === 'INSTANCE-002') name = 'data-swap-active';
  if (!allowedStates.has(name)) throw new RangeError(`Onbekende bronvoorwaarde: ${name}`);
  const values = allowedStates.get(name);
  if (values.size && value !== '' && !values.has(String(value))) throw new RangeError('Onbekende bronwaarde');
  if (!values.size && typeof value !== 'boolean') throw new TypeError('Boolean bronvoorwaarde vereist');
  void target.getBoundingClientRect(); states[name] = value; applyStates(); buildStateControls();
  void frame.contentWindow.getComputedStyle(target).opacity; await nextFrame(); return renderInspection();
}
async function setMode(value) {
  if (!['normal','reduced'].includes(value)) throw new RangeError('Onbekende bewegingsmodus');
  mode = value; $('catalogue-reduced').checked = mode === 'reduced'; return restart();
}
function showError(error) { $('catalogue-runtime-status').textContent = error.message; }
const api = {ready:null,selectFamily,selectInstance,setState,setMode,restart,inspect};
window.uiMotionCatalogue = api;
api.ready = (async () => {
  const responses = await Promise.all([fetch('./assets/ui-motion-recipes.json'),fetch('./assets/ui-motion-fixtures.json')]);
  if (responses.some(r => !r.ok)) throw new Error('Brondata kon niet worden geladen');
  [data,descriptors] = await Promise.all(responses.map(r => r.json())); validateCatalogueData(data);
  validateCatalogueData({...data,rules:descriptors.support_rules,custom_variables:descriptors.variables});
  $('catalogue-family').append(...data.families.map(f => option(f.id)));
  const loaded = new Promise(resolve => frame.addEventListener('load',resolve,{once:true}));
  frame.srcdoc = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>html{color-scheme:dark;background:#181818;color:#eee;font:16px sans-serif}body{margin:0;min-height:340px;display:grid;place-items:center;overflow:hidden}#fixture-host{position:relative;isolation:isolate;max-width:100%;padding:24px}#fixture-host>[data-fixture-role=source-slot]{max-width:100%}</style></head><body></body></html>';
  await loaded; stage = frame.contentDocument; stylesheet = stage.createElement('style'); stage.head.append(stylesheet);
  stage.addEventListener('animationend',scheduleInspection); stage.addEventListener('transitionend',scheduleInspection);
  $('catalogue-family').addEventListener('change',e => selectFamily(e.target.value).catch(showError));
  $('catalogue-instance').addEventListener('change',e => selectInstance(e.target.value).catch(showError));
  for (const [id,direction] of [['catalogue-previous',-1],['catalogue-next',1]]) $(id).addEventListener('click',() => {
    const ids = data.families.find(f => f.id === current.family).instances;
    selectInstance(ids[(ids.indexOf(current.id)+direction+ids.length)%ids.length]).catch(showError);
  });
  $('catalogue-restart').addEventListener('click',() => restart().catch(showError));
  $('catalogue-reduced').addEventListener('change',e => setMode(e.target.checked?'reduced':'normal').catch(showError));
  return selectInstance('INSTANCE-083');
})();
api.ready.catch(showError);

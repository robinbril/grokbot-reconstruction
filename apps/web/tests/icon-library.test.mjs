import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadIconData, validateIconData, getIconNames, getIcon, iconSvg } from '../icon-library.js';

const data = JSON.parse(readFileSync(new URL('../assets/grok-icons.json', import.meta.url)));
test('all808 recovered icons expose both exact inert font outlines', () => {
  loadIconData(data);
  const names = getIconNames();
  assert.equal(names.length, 808);
  for (const name of names) for (const filled of [false, true]) {
    assert.equal(getIcon(name, { filled }).path, data.variants[filled ? 'filled' : 'outline'][name].path);
    const svg = iconSvg(name, { filled, size: 20 });
    assert.match(svg, /viewBox="0 0 300 300"/);
    assert.match(svg, /translate\(0 300\) scale\(1 -1\)/);
    assert.ok(!/NaN|Infinity|script|foreignObject|onload/i.test(svg));
  }
  assert.throws(() => getIcon('__missing_icon__'));
});
test('icon loader rejects path and name markup without corrupting loaded valid library', () => {
  for (const payload of ['M0 0\" onload=\"alert(1)', 'javascript:alert(1)', 'MNaN 0']) {
    const bad = structuredClone(data); bad.variants.outline.account.path = payload;
    assert.throws(() => validateIconData(bad));
  }
  const bad = structuredClone(data); bad.variants.outline['<script>'] = bad.variants.outline.account;
  assert.throws(() => validateIconData(bad));
  assert.equal(getIconNames().length, 808);
});

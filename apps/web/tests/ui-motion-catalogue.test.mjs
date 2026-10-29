import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCatalogueData } from '../ui-motion-catalogue-data.js';

const bytes = await readFile(new URL('../assets/ui-motion-recipes.json', import.meta.url));
const data = JSON.parse(bytes);
test('source asset is lossless and covers every exact family and instance', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c986d98af0742136de2e0119e64b1ede7aa21d0f5bf919ff8ec40be9be216ddb');
  assert.doesNotThrow(() => validateCatalogueData(data));
  assert.equal(data.families.length, 60); assert.equal(data.instances.length, 332);
  assert.equal(data.rules.length, 1705); assert.equal(data.keyframes.length, 91);
  assert.equal(data.custom_variables.length, 214);
  const ids = data.families.flatMap(f => f.instances);
  assert.equal(new Set(ids).size, 332);
  assert.deepEqual([...ids].sort(), data.instances.map(i => i.id).sort());
});
test('validator rejects active CSS payloads before isolated rendering', () => {
  for (const value of ['url(https://example.invalid/track)', 'expression(alert(1))', '</style><script>alert(1)</script>', '@import "https://example.invalid/x"', 'u\\72l(https://example.invalid/x)']) {
    const injected = structuredClone(data);
    injected.rules[0].declarations.push({ property: 'background', value });
    assert.throws(() => validateCatalogueData(injected));
  }
  const injected = structuredClone(data); injected.rules[0].selector = '</style><img src=x>';
  assert.throws(() => validateCatalogueData(injected));
});

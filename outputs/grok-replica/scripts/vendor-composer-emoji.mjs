#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(appDirectory, '../..');
const argument = process.argv.find(value => value.startsWith('--source='));
const sourceDirectory = argument?.slice('--source='.length)
  ?? resolve(repository, '../../work/versions/0.71.2/artifact/dist/renderer/assets');
const outputDirectory = resolve(appDirectory, 'assets/vendor/emoji');
const check = process.argv.includes('--check');
const sourceHashes = {
  'chunk-compact-C8-lyxgK.js': '9bf5419850ffdfd24efaaa4127da1dc71d0f5ad51c6d6d937e2beb30e4101227',
  'chunk-iamcal-CEyh6ide.js': '00ee56d54e4a2ac1a7fb253f5d0a066887e4581f98ea599bd8a3a180f7536d3d',
  'chunk-emojibase-Bc-csq5x.js': 'e1f8630e0e8733c12e5a923cb9fc003a659c09daed9a7d435a1a2824890c4ece',
  'chunk-messages-BZI145ap.js': '94408647e1136b7306a3bf1c04c9b320a9314f994a1f40a972323f7f615c4e7b',
};
const hash = content => createHash('sha256').update(content).digest('hex');
const array = value => typeof value === 'string' ? [value] : value ?? [];
const capitalize = (value, locale) => value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
const json = value => JSON.stringify(value) + '\n';

async function loadSource(name, expectedHash) {
  const content = await readFile(resolve(sourceDirectory, name));
  if (hash(content) !== expectedHash) throw new Error(`Source hash mismatch: ${name}`);
  // Only execute the exact, inspected, hash-pinned standalone data module.
  const module = await import(`data:text/javascript;base64,${content.toString('base64')}`);
  return { data: module.default, source: { file: name, sha256: expectedHash, bytes: content.length } };
}

function buildIndex(emojis, iamcal, emojibase, messages) {
  const groups = new Map();
  for (const emoji of emojis) {
    if (emoji.group == null) continue;
    if (!groups.has(emoji.group)) groups.set(emoji.group, []);
    for (const item of [emoji, ...emoji.skins ?? []]) {
      const shortcodes = [...new Set([...array(iamcal[item.hexcode]), ...array(emojibase[item.hexcode])])];
      const id = shortcodes[0] ?? item.hexcode;
      groups.get(emoji.group).push({
        id,
        name: capitalize(item.label, 'en'),
        native: item.unicode.replace(/(\p{Emoji_Presentation})\uFE0F/gu, '$1'),
        shortcodes,
        search: [item.label, id, ...shortcodes, ...item.tags ?? [], ...array(item.emoticon)]
          .join(' ').toLowerCase(),
      });
    }
  }
  return {
    categories: messages.groups.flatMap(group => {
      const entries = groups.get(group.order);
      return group.key === 'component' || !entries?.length ? [] : [{
        id: group.key, label: capitalize(group.message, 'nl'), emojis: entries,
      }];
    }),
  };
}

async function emit(name, content) {
  const destination = resolve(outputDirectory, name);
  if (check) {
    if (await readFile(destination, 'utf8') !== content) throw new Error(`Generated data drift: ${name}`);
  } else await writeFile(destination, content);
  return { sha256: hash(content), bytes: Buffer.byteLength(content) };
}

const loaded = await Promise.all(Object.entries(sourceHashes).map(([name, sha]) => loadSource(name, sha)));
const [compact, iamcal, emojibase, messages] = loaded.map(item => item.data);
const index = buildIndex(compact, iamcal, emojibase, messages);
const entries = index.categories.flatMap(category => category.emojis);
const licenses = {};
for (const name of ['LICENSE-emojibase-MIT.txt', 'NOTICE-Unicode.txt', 'NOTICE.md']) {
  const content = await readFile(resolve(outputDirectory, name));
  licenses[name] = { sha256: hash(content), bytes: content.length };
}
await mkdir(outputDirectory, { recursive: true });
const files = {
  'index.nl.json': await emit('index.nl.json', json(index)),
  'index.json': await emit('index.json', json(entries)),
};
await emit('manifest.json', JSON.stringify({
  formatVersion: 1,
  applicationVersion: '0.71.2',
  package: { name: 'emojibase-data', version: '17.0.0', license: 'MIT' },
  transformation: 'Native Pde index construction, source index.eager-app-DSuGVQNC.js; no search reordering',
  locale: 'nl',
  officialPackageCrossCheck: {
    tarball: 'https://registry.npmjs.org/emojibase-data/-/emojibase-data-17.0.0.tgz',
    integrity: 'sha512-Yvgb5AWoHViHV/gq1qr5ZAarcBip+B27/ZLRsUJkbgAEaLlZ/fof9g882LTpmEpyhBNEC0m2SEmItljHsTygjA==',
    structurallyEqualPackageFiles: [
      'en/compact.json', 'en/shortcodes/iamcal.json',
      'en/shortcodes/emojibase.json', 'nl/messages.json',
    ],
  },
  sources: loaded.map(item => item.source),
  counts: {
    compactBaseRecords: compact.length,
    iamcalKeys: Object.keys(iamcal).length,
    emojibaseKeys: Object.keys(emojibase).length,
    categories: index.categories.length,
    entries: entries.length,
    shortcodeAliases: new Set(entries.flatMap(entry => entry.shortcodes)).size,
  },
  files,
  licenses,
}, null, 2) + '\n');
console.log(`PASS emoji vendor ${check ? 'reproduction' : 'extraction'}: ${entries.length} entries, ${index.categories.length} categories, 4 source hashes verified`);

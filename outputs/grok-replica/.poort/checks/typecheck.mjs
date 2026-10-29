#!/usr/bin/env node
// Typecheck zoals de repo hem zelf bedoelt. `tsc --noEmit` in de root controleert
// bij een Vite-project niets: daar staat "files": [] met project references, en
// dan is de check altijd groen. Volgorde:
//   1. een script "typecheck" of "type-check" in package.json (de eigen definitie);
//   2. tsconfig.json met "references": `tsc -b` (of `vue-tsc --build`), incrementeel;
//   3. anders `tsc --noEmit` (of `vue-tsc --noEmit`).
// Draait in de map met package.json (cwd van de check).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

const scripts = (() => {
  try {
    return JSON.parse(read('package.json')).scripts || {};
  } catch {
    return {};
  }
})();
const own = ['typecheck', 'type-check'].find((s) => scripts[s]);

let cmd;
let args;
if (own) {
  [cmd, args] = ['npm', ['run', '-s', own]];
} else {
  const bin = fs.existsSync('node_modules/.bin/vue-tsc') ? 'vue-tsc' : 'tsc';
  // tsconfig is JSONC (commentaar, komma's): een tekstcontrole is genoeg.
  const refs = /"references"\s*:\s*\[\s*\{/.test(read('tsconfig.json'));
  [cmd, args] = ['npx', ['--no-install', bin, ...(refs ? ['--build'] : ['--noEmit'])]];
}
console.log(`typecheck: ${cmd} ${args.join(' ')}`);
const r = spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);

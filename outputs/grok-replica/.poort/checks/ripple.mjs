#!/usr/bin/env node
// Rimpeleffect van een gewijzigde definitie (adviserend).
//
// Twee dingen die een review anders zelf moet zoeken:
//   - dezelfde functienaam elders nog eens gedefinieerd: een kopie (ghost
//     version) die bij deze wijziging niet meeverandert;
//   - op een gedeelde surface het aantal consumers, zodat elke call site
//     gecontroleerd en in de PR genoemd kan worden.
// Een definitie telt als gewijzigd bij een gewijzigde def-regel én bij een
// gewijzigde regel in de body van een top-level definitie.
//
// Gebruik: node ripple.mjs [--shared <regex>] [bestanden...]
//   --shared  alleen voor bestanden die matchen consumers tellen (gedeelde surfaces)
// Altijd exit 0; meldingen als "poort:warn".
import { warn, addedLines, addedLineNumbers, readFile, definedNames, defGrep, langOf, isTest, grepFiles, GENERIC } from './_lib.mjs';

const argv = process.argv.slice(2);
const sharedIdx = argv.indexOf('--shared');
const shared = sharedIdx >= 0 ? new RegExp(argv[sharedIdx + 1]) : null;
const files = argv.filter((a, i) => !(sharedIdx >= 0 && (i === sharedIdx || i === sharedIdx + 1)) && langOf(a) && !isTest(a));
const SPECS = { py: ['*.py'], js: ['*.[jt]s', '*.[jt]sx', '*.[mc][jt]s', '*.vue'] };
// Topmap van een pad; '' voor een bestand in de root.
const app = (f) => (f.includes('/') ? f.split('/')[0] : '');
const MAX = 10;
let n = 0;

// Gewijzigde definities: een gewijzigde def-regel, of een gewijzigde regel in
// de body van een top-level definitie. Die body loopt tot het volgende
// top-level statement, of tot en met een sluitende } in kolom 0.
function touchedNames(file) {
  const names = new Set(definedNames(file, addedLines(file)));
  const changed = addedLineNumbers(file);
  if (!changed.size) return [...names];
  let cur = null;
  readFile(file)
    .split('\n')
    .forEach((l, i) => {
      const [def] = /^\S/.test(l) ? definedNames(file, [l]) : [];
      if (def) cur = def;
      else if (/^[^\s})\]#@/]/.test(l)) cur = null; // nieuw top-level statement
      if (cur && changed.has(i + 1)) names.add(cur);
      if (/^\}/.test(l)) cur = null;
    });
  return [...names];
}

for (const file of files) {
  const lang = langOf(file);
  for (const name of touchedNames(file)) {
    if (n >= MAX) break;
    if (name.length < 6 || GENERIC.has(name) || name.startsWith('_') || /^test/i.test(name)) continue;

    // 1. dezelfde definitie elders (andere bestanden, zelfde taalfamilie, geen tests)
    const twins = grepFiles(['-l', '-E', defGrep(lang, name)], SPECS[lang])
      .filter((f) => f !== file && langOf(f) === lang && !isTest(f) && !f.includes('node_modules/'))
      // alleen binnen dezelfde app (topmap, of de root): losse deployables mogen eigen kopieën hebben
      .filter((f) => app(f) === app(file));
    if (twins.length) {
      warn(`${name} (${file}) is ook gedefinieerd in ${twins.slice(0, 3).join(', ')}${twins.length > 3 ? ` en ${twins.length - 3} meer` : ''}: ghost version? Pas alle kopieën aan of maak er één bron van.`);
      n++;
    }

    // 2. consumers van een gedeelde surface
    if (shared && shared.test(file)) {
      const users = grepFiles(['-l', '-w', name], SPECS[lang])
        .filter((f) => f !== file && langOf(f) === lang && !isTest(f) && !f.includes('node_modules/') && !f.startsWith('.'));
      // > 40 treffers: de naam is te algemeen om op woordniveau iets te zeggen
      if (users.length >= 2 && users.length <= 40) {
        warn(`${name} (gedeelde surface) heeft ${users.length} consumers: ${users.slice(0, 4).join(', ')}${users.length > 4 ? ', …' : ''}. Controleer elke call site en noem ze in de PR.`);
        n++;
      }
    }
  }
}

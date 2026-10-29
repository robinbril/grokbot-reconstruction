#!/usr/bin/env node
// Gestapelde of verouderde branch. Blokkeert alleen bij een échte
// inhoudsconflict met de base (git merge-tree, exact, geen heuristiek).
// Achterstand zonder conflict, en overlap met bestanden die op de base
// veranderd zijn, worden advies: zo'n overlap kan een al gefixte bug
// terugbrengen zonder dat git een conflict ziet.
//
// Gebruik: node stale-branch.mjs [branch]
//   branch  de doelbranch (bijv. origin/main); zonder argument POORT_BASE_REF,
//           anders origin/main. Een kale SHA (zoals de merge-base) werkt niet:
//           die loopt nooit achter. Dan volgt een waarschuwing en de default.
// POORT_OFFLINE=1 slaat de fetch over. Resultaat hangt van de remote af: zet
// "cache": false en "required": false op deze check.
import { spawnSync } from 'node:child_process';
import { git, lines, warn } from './_lib.mjs';

let arg = process.argv[2];
// Hex en geen ref (een branch mag "cafe1234" heten): een SHA.
if (arg && /^[0-9a-f]{7,40}$/i.test(arg) && !git(['rev-parse', '--symbolic-full-name', arg]).trim()) {
  warn(`stale-branch verwacht een branchnaam (bijv. origin/main), geen SHA (${arg.slice(0, 12)}); ${process.env.POORT_BASE_REF || 'origin/main'} gebruikt`);
  arg = null;
}
const baseRef = arg || process.env.POORT_BASE_REF || 'origin/main';
if (!process.env.POORT_OFFLINE && baseRef.startsWith('origin/')) {
  spawnSync('git', ['fetch', '--quiet', 'origin', baseRef.slice(7)], { timeout: 10000 });
}
if (!git(['rev-parse', '--verify', '--quiet', baseRef]).trim()) {
  warn(`base ${baseRef} niet gevonden; stale-branch overgeslagen`);
  process.exit(0);
}

const behind = Number(git(['rev-list', '--count', `HEAD..${baseRef}`]).trim() || 0);
if (!behind) process.exit(0);

const mt = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', baseRef], { encoding: 'utf8' });
if (mt.status === 1) {
  const files = lines(mt.stdout).slice(1);
  console.log(`Conflict met ${baseRef} (${behind} commits achter) in:`);
  for (const f of files) console.log(`  ${f}`);
  console.log(`Rebase eerst: git fetch && git rebase ${baseRef}`);
  process.exit(1);
}

const mb = git(['merge-base', 'HEAD', baseRef]).trim();
const theirs = new Set(lines(git(['diff', '--name-only', `${mb}..${baseRef}`])));
const overlap = lines(git(['diff', '--name-only', `${mb}..HEAD`])).filter((f) => theirs.has(f));
if (overlap.length) {
  warn(`${behind} commits achter ${baseRef}; ${overlap.length} bestand(en) ook daar gewijzigd (${overlap.slice(0, 3).join(', ')}${overlap.length > 3 ? ', …' : ''}). Merge is schoon, maar rebase en hertest: een fix op de base kan stil terugdraaien.`);
} else {
  warn(`${behind} commits achter ${baseRef}; geen overlap. Rebase vóór review.`);
}

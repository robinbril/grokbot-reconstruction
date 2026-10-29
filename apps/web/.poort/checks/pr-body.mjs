#!/usr/bin/env node
// PR-beschrijving tegen de diff (draait in de PR-poort, vóór `gh pr create`).
//
// Twee terugkerende reviewbevindingen:
//   - gedragsverandering op een gedeelde surface zonder sectie die de delta
//     benoemt, zodat de reviewer elke wijziging in de diff moet wantrouwen;
//   - de beschrijving noemt een migratie of bestand dat niet bestaat.
//
// Regels uit poort.config.json:
//   "pr": {
//     "sections": [{ "when": "<regex op gewijzigde paden>", "heading": "<regex>", "why": "<uitleg>" }],
//     "migrationsDir": "db/migrations"
//   }
//
// Gebruik:
//   node pr-body.mjs --body-file <f> [--base <ref>]     (bestanden: <base>...HEAD + working tree)
//   node pr-body.mjs --pr <nummer> [--repo owner/name]  (backtest: body en bestanden via gh)
//   Zonder --base: de merge-base met POORT_BASE_REF, "base" uit de config,
//   origin/HEAD, origin/main of @{upstream} (de eerste die bestaat), anders HEAD~1,
//   en bij één commit de lege tree.
// Exit 1 met de redenen als de beschrijving niet klopt; exit 2 als er geen base is.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkBody({ body, files, rules, exists }) {
  const errors = [];
  for (const s of rules.sections || []) {
    const re = new RegExp(s.when);
    const hits = files.filter((f) => re.test(f));
    if (!hits.length) continue;
    // Een kop (#..), vetgedrukte regel of "X:" aan het begin van een regel.
    const heading = new RegExp(`^\\s*(#{1,6}\\s*|\\*\\*|__)?\\s*(${s.heading})`, 'im');
    if (!heading.test(body)) {
      errors.push(`Raakt ${hits.length} bestand(en) op een gedeelde surface (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''}) maar de beschrijving heeft geen sectie "${s.heading}". ${s.why || ''}`.trim());
    }
  }
  if (rules.migrationsDir) {
    const nums = new Set([...body.matchAll(/\bmigrat(?:ion|ie)\s*#?\s*(\d{2,4})\b/gi)].map((m) => m[1]));
    for (const n of nums) {
      if (!exists.migration(n)) errors.push(`De beschrijving noemt migratie ${n}, maar ${rules.migrationsDir} heeft geen ${n}_*.sql.`);
    }
  }
  // Alleen volledige repo-paden (eerste segment is een bestaande topmap), zodat
  // afkortingen als `core/auth.py` geen vals alarm geven.
  const paths = new Set([...body.matchAll(/`([\w.@-]+(?:\/[\w.@-]+)+\.[a-z]{1,5})`/g)].map((m) => m[1]));
  for (const p of paths) {
    if (!exists.topDir(p.split('/')[0]) || files.includes(p)) continue; // in de diff (ook verwijderd) = bekend
    if (!exists.file(p)) errors.push(`De beschrijving noemt \`${p}\`, maar dat bestand bestaat niet in deze branch.`);
  }
  return errors;
}

// ---------- CLI ----------
// realpath aan beide kanten: spaties (%20 in een URL) en symlinks mogen de
// CLI niet stil overslaan, want dan is de PR-poort groen zonder check.
const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const isMain = Boolean(process.argv[1]) && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const gitOut = (...a) => sh('git', a).stdout || '';
  const top = gitOut('rev-parse', '--show-toplevel').trim();
  const cfgFile = process.env.POORT_CONFIG || path.join(top, 'poort.config.json');
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  const rules = cfg.pr || {};

  let body;
  let files;
  let ref = null; // tree-ish om bestaan tegen te checken (null = working tree)
  if (opt('--pr')) {
    const repo = opt('--repo') ? ['--repo', opt('--repo')] : [];
    const meta = JSON.parse(sh('gh', ['pr', 'view', opt('--pr'), ...repo, '--json', 'body,files,headRefOid']).stdout || '{}');
    body = meta.body || '';
    files = (meta.files || []).map((f) => f.path);
    ref = meta.headRefOid;
    if (!sh('git', ['cat-file', '-t', ref]).stdout.trim()) sh('git', ['fetch', '-q', 'origin', `pull/${opt('--pr')}/head`]);
  } else {
    body = fs.readFileSync(opt('--body-file'), 'utf8');
    // Base: --base, anders de merge-base met de eerste ref die bestaat.
    const candidates = [process.env.POORT_BASE_REF, cfg.base, 'origin/HEAD', 'origin/main', '@{upstream}'].filter(Boolean);
    let base = opt('--base') || '';
    for (const c of candidates) {
      if (base) break;
      base = gitOut('merge-base', 'HEAD', c).trim();
    }
    if (!base) base = gitOut('rev-parse', '--verify', '--quiet', 'HEAD~1').trim();
    // Eén commit (verse repo): alles is nieuw, net als in poort zelf.
    if (!base && gitOut('rev-parse', '--verify', '--quiet', 'HEAD').trim()) base = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // pragma: allowlist secret
    if (!base) {
      console.log(`pr-body: geen base gevonden (geprobeerd: ${[...candidates, 'HEAD~1'].join(', ')}). Geef --base <ref> mee of zet POORT_BASE_REF.`);
      process.exit(2);
    }
    // -z: paden met niet-ASCII-tekens komen anders gequote terug.
    const names = (...a) => gitOut(...a, '-z').split('\0');
    files = [...new Set([...names('diff', '--name-only', base), ...names('ls-files', '-o', '--exclude-standard')].filter(Boolean))];
  }
  const exists = {
    file: (p) => (ref ? sh('git', ['cat-file', '-e', `${ref}:${p}`]).status === 0 : fs.existsSync(path.join(top, p))),
    topDir: (d) => (ref ? sh('git', ['cat-file', '-e', `${ref}:${d}`]).status === 0 : fs.existsSync(path.join(top, d))),
    migration: (n) => {
      const list = ref
        ? gitOut('ls-tree', '--name-only', `${ref}:${rules.migrationsDir}`).split('\n')
        : fs.existsSync(path.join(top, rules.migrationsDir))
          ? fs.readdirSync(path.join(top, rules.migrationsDir))
          : [];
      return list.some((f) => new RegExp(`^0*${Number(n)}_`).test(f));
    },
  };
  const errors = checkBody({ body, files, rules, exists });
  for (const e of errors) console.log(`✗ ${e}`);
  process.exit(errors.length ? 1 : 0);
}

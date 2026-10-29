#!/usr/bin/env node
// Formatteer elk bestand dat een agent bewerkt, met de formatter van de repo.
// Zo kost opmaak de agent geen eigen beurt, en wordt de commit-hook er niet
// rood op. Opt-in: alleen bestanden die een regel in "format" raken, zodat een
// repo die nog niet geformatteerd is geen hele bestanden herschreven krijgt.
//
// Werkt als hook voor:
//   Claude Code  PostToolUse, matcher "Write|Edit|MultiEdit"  (stdin: {tool_input:{file_path}, cwd})
//   Cursor       afterFileEdit                              (stdin: {file_path})
// Blokkeert nooit: altijd exit 0, een fout is één regel op stderr.
//
// poort.config.json:
//   "format": [
//     { "when": "\\.py$", "run": "ruff format --quiet {file}" },
//     { "when": "^web/.*\\.(ts|vue)$", "cwd": "web", "run": "npx --no-install prettier --write --log-level warn {file}" }
//   ]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const done = () => process.exit(0);
let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  done();
}
const raw = input.file_path || input.tool_input?.file_path || input.tool_input?.path;
if (!raw) done();
const abs = path.resolve(input.cwd || process.cwd(), raw);
if (!fs.existsSync(abs)) done();
// realpath: git geeft de echte map terug (macOS: /private/var i.p.v. /var).
const file = fs.realpathSync(abs);

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(file), encoding: 'utf8' }).stdout?.trim();
if (!top) done();
const cfgFile = process.env.POORT_CONFIG ? path.resolve(process.env.POORT_CONFIG) : path.join(top, 'poort.config.json');
let rules = [];
try {
  rules = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).format || [];
} catch {
  done();
}
const rel = path.relative(top, file).split(path.sep).join('/');
if (rel.startsWith('..')) done();

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
for (const r of Array.isArray(rules) ? rules : []) {
  // Een onvolledige of kapotte regel slaan we over: deze hook blokkeert nooit.
  try {
    if (typeof r?.run !== 'string') {
      process.stderr.write(`poort format: regel zonder "run" overgeslagen\n`);
      continue;
    }
    if (!new RegExp(r.when ?? '').test(rel)) continue;
    const cwd = path.join(top, r.cwd || '.');
    const arg = path.relative(cwd, file);
    const res = spawnSync('sh', ['-c', r.run.replaceAll('{file}', shq(arg))], { cwd, encoding: 'utf8', timeout: 20000 });
    if (res.status !== 0) {
      const why = (res.stderr || res.stdout || '').trim().split('\n').pop() || (res.error ? res.error.message : `exit ${res.status}`);
      process.stderr.write(`poort format: ${rel} niet geformatteerd (${why})\n`);
    }
  } catch (e) {
    process.stderr.write(`poort format: regel overgeslagen (${e.message})\n`);
  }
}
done();

#!/usr/bin/env node
// Geen nieuwe lint-schuld: ruff met flake8-regels, maar alleen blokkeren op
// regels die deze wijziging toevoegt of verandert.
//
// Waarom: in een bestaande codebase geeft volledige flake8 al snel duizenden
// overtredingen; die allemaal eerst oplossen is geen optie, ze allemaal negeren
// ook niet. Zo wordt elke commit schoon, en zakt de schuld vanzelf.
// ruff draait dezelfde regelcodes als flake8 (pyflakes F, pycodestyle E/W),
// alleen veel sneller.
//
// Gebruik: node ruff-new.mjs [--ruff-args "<args>"] [bestanden...]
//   --ruff-args  extra argumenten voor ruff, bijv. "--isolated --select F --target-version py311"
// Exit 1 bij overtredingen op gewijzigde regels; bestaande overtredingen in
// dezelfde bestanden worden geteld als advies.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { addedLineNumbers, isNewFile, warn } from './_lib.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--ruff-args');
const ruffArgs = i >= 0 ? argv[i + 1].split(/\s+/).filter(Boolean) : [];
const files = argv.filter((a, j) => !(i >= 0 && (j === i || j === i + 1)) && a.endsWith('.py'));
if (!files.length) process.exit(0);

const r = spawnSync('ruff', ['check', '--no-cache', '--output-format', 'json', '--exit-zero', ...ruffArgs, ...files], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (r.error || r.status !== 0) {
  console.log(`ruff kon niet draaien: ${r.error?.message || r.stderr.trim()}`);
  process.exit(2);
}
const findings = JSON.parse(r.stdout || '[]');

const touched = new Map(files.map((f) => [f, isNewFile(f) ? null : addedLineNumbers(f)])); // null = nieuw bestand, alles telt
// ruff meldt absolute paden; vergelijk volledig (a.py en pkg/a.py delen een suffix).
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const byPath = new Map(files.map((f) => [real(f), f]));
const rel = (abs) => byPath.get(real(abs)) ?? abs;
let nieuw = 0;
let bestaand = 0;
for (const f of findings) {
  const file = rel(f.filename);
  const lines = touched.get(file);
  const row = f.location?.row;
  if (lines === null || (lines && lines.has(row))) {
    console.log(`${file}:${row}:${f.location?.column ?? 1}: ${f.code} ${f.message}`);
    nieuw++;
  } else bestaand++;
}
if (bestaand) warn(`${bestaand} bestaande overtreding(en) in deze bestanden genegeerd; alleen gewijzigde regels tellen`);
if (nieuw) {
  console.log(`${nieuw} nieuwe overtreding(en). Veel zijn automatisch te fixen: ruff check --fix ${ruffArgs.join(' ')} <bestand>`);
  process.exit(1);
}

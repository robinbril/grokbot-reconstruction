#!/usr/bin/env node
// Migratie roept een functie aan die op dat moment nog niet bestaat.
//
// Typisch incident: een migratie gebruikt een functie die alleen een script
// aanmaakt dat ná de migraties draait (een "ensure"- of bootstrapstap). Een
// omgeving die functie en migratie in twee deploys kreeg ziet niets; een
// omgeving die ze in één keer krijgt blijft half gemigreerd achter. Deze check
// maakt die volgorde statisch zichtbaar.
//
// Gebruik: node migration-deps.mjs --dir <migratiemap> [--after <bestand> ...] [--all] [bestanden...]
//   --dir    map met genummerde migraties (NNN_naam.sql); rollback-bestanden tellen niet mee
//   --after  bestanden die ná de migraties draaien (bijv. een bootstrap- of ensure-script)
//   --all    controleer alle migraties i.p.v. de meegegeven bestanden
// Blokkeert (exit 1) bij: functie pas in een latere migratie, of alleen in een --after-bestand.
// Advies bij: functie in een app-schema die nergens wordt aangemaakt.
import fs from 'node:fs';
import path from 'node:path';
import { warn } from './_lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
const dir = opt('--dir')[0];
const after = opt('--after');
const all = argv.includes('--all');
const flagArgs = new Set(argv.flatMap((a, i) => (a === '--dir' || a === '--after' ? [i, i + 1] : a.startsWith('--') ? [i] : [])));
const given = argv.filter((_, i) => !flagArgs.has(i));
if (!dir || !fs.existsSync(dir)) {
  console.log(`migration-deps: --dir ${dir ?? '(leeg)'} bestaat niet`);
  process.exit(2);
}

// Commentaar weg, en "app"."f" wordt app.f (gequote identifiers tellen ook).
const strip = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, '$1');
const numOf = (f) => {
  const m = path.basename(f).match(/^(\d+)_/);
  return m ? Number(m[1]) : null;
};
const isRollback = (f) => /(^|_)rollback(_|\.)/i.test(path.basename(f));

const migrations = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql') && numOf(f) !== null && !isRollback(f))
  .map((f) => ({ file: path.join(dir, f), num: numOf(f), sql: strip(fs.readFileSync(path.join(dir, f), 'utf8')) }));

const ident = '[A-Za-z_][A-Za-z0-9_]*';
const defRe = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\s+(${ident})\\.(${ident})\\s*\\(`, 'gi');
const relRe = new RegExp(`create\\s+(?:or\\s+replace\\s+)?(?:unlogged\\s+)?(?:table|view|materialized\\s+view|type|sequence)\\s+(?:if\\s+not\\s+exists\\s+)?(${ident})\\.(${ident})`, 'gi');
const schemaRe = new RegExp(`create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?(${ident})`, 'gi');

const firstDef = new Map(); // "s.n" -> laagste migratienummer
const relations = new Set();
const schemas = new Set();
for (const m of migrations) {
  for (const [, s, n] of m.sql.matchAll(defRe)) {
    const k = `${s}.${n}`.toLowerCase();
    if (!firstDef.has(k) || firstDef.get(k) > m.num) firstDef.set(k, m.num);
    schemas.add(s.toLowerCase());
  }
  for (const [, s, n] of m.sql.matchAll(relRe)) relations.add(`${s}.${n}`.toLowerCase());
  for (const [, s] of m.sql.matchAll(schemaRe)) schemas.add(s.toLowerCase());
}
const lateDefs = new Map(); // functies uit bestanden die ná de migraties draaien
for (const f of after) {
  if (!fs.existsSync(f)) continue;
  for (const [, s, n] of strip(fs.readFileSync(f, 'utf8')).matchAll(defRe)) lateDefs.set(`${s}.${n}`.toLowerCase(), f);
}

const targets = all
  ? migrations
  : given
      .map((f) => path.resolve(f))
      .map((abs) => migrations.find((m) => path.resolve(m.file) === abs))
      .filter(Boolean);

const callRe = new RegExp(`(?<![\\w.])(${ident})\\.(${ident})\\s*\\(`, 'g');
// Geen aanroep: de definitie zelf, en een DROP ... IF EXISTS (heeft de functie
// niet nodig). Tabellen, views en types vallen al af via `relations`, dus
// `FROM app.fn()` en `EXECUTE FUNCTION app.trg_fn()` tellen wel.
const notCall = /\b(?:create\s+(?:or\s+replace\s+)?(?:function|procedure)|drop\s+(?:function|procedure)\s+if\s+exists)\s*$/i;
let errors = 0;
for (const m of targets) {
  const seen = new Set();
  for (const hit of m.sql.matchAll(callRe)) {
    const [, s, n] = hit;
    const k = `${s}.${n}`.toLowerCase();
    if (seen.has(k) || !schemas.has(s.toLowerCase()) || relations.has(k)) continue;
    if (notCall.test(m.sql.slice(Math.max(0, hit.index - 40), hit.index))) continue;
    seen.add(k);
    const def = firstDef.get(k);
    const rel = path.relative(process.cwd(), m.file);
    if (def !== undefined && def <= m.num) continue;
    if (def !== undefined) {
      console.log(`✗ ${rel}: ${k}() wordt pas in migratie ${def} aangemaakt (deze is ${m.num})`);
      errors++;
    } else if (lateDefs.has(k)) {
      console.log(`✗ ${rel}: ${k}() bestaat alleen in ${path.relative(process.cwd(), lateDefs.get(k))}, en dat draait ná de migraties.`);
      console.log(`  Maak de functie in deze migratie aan (CREATE OR REPLACE FUNCTION ...), zodat de migratie op zichzelf staat.`);
      errors++;
    } else {
      warn(`${rel}: ${k}() wordt in geen enkele migratie aangemaakt; bestaat hij echt?`);
    }
  }
}
process.exit(errors ? 1 : 0);

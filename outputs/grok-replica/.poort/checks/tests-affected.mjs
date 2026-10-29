#!/usr/bin/env node
// Draai alleen de Python-tests die de wijziging raken; de hele suite als een
// kernbestand verandert. Werkt met pytest en met elke andere runner (bijv.
// Django's `manage.py test`), optioneel tegen een verse Postgres-db per run.
//
// Selectie (statisch, geen plugin nodig):
//   - gewijzigde testbestanden draaien altijd mee;
//   - een gewijzigde (of verwijderde) module selecteert elke test die hem
//     importeert, ook via een relatieve import (`from .services import x`) of
//     een meerregelige import tussen haakjes, en ook via andere modules: de
//     importgraaf wordt gevolgd (test -> app.main -> router -> gewijzigde
//     module). Zo komen ook route-tests mee die alleen `app.main` importeren.
//     --direct beperkt het tot directe imports (sneller, minder zeker);
//   - met --routes '<module-regex>=<inhoud-regex>' ook de tests die via een URL
//     binnenkomen in plaats van via een import: bereikt de keten een
//     routermodule (Django: `urls$`), dan draaien alle tests waarvan de tekst
//     op de inhoud-regex past (`self\.client\.`);
//   - raakt de wijziging --full-on, dan de hele suite (gedeelde infrastructuur);
//   - raakt geen enkele test een gewijzigde module, ook niet via de graaf, dan
//     de hele suite: "geen test geselecteerd" is geen bewijs dat de wijziging
//     klopt (een import via een string of een plugin ziet de graaf niet).
//     --no-fallback maakt dat een waarschuwing, bewust en zichtbaar.
//
// Verse database (--pg-service): tests die direct in de database schrijven,
// laten state achter, en dan wijkt de hook af van CI. Elke run kloont een eigen
// database per worktree (<db>_<worktree-id>) uit <db>_template (Postgres
// TEMPLATE, ~1 s); het template migreert opnieuw zodra de bestanden onder
// --migrations veranderen. Parallelle worktrees zitten elkaar zo niet in de
// weg; een lock in de gedeelde git-map houdt het opbouwen en klonen van het
// template op volgorde. Guard: --pg-db moet "test" in de naam hebben, en een
// bestaand template zonder poort-markering wordt nooit gedropt.
//
// Gebruik (vanuit de repo-root, bestanden repo-relatief):
//   node tests-affected.mjs --root backend --src app [--tests tests]
//     [--test-pattern '^test_.*\.py$'] [--python .venv/bin/python]
//     [--cmd '<runner>' --label module|path]   (default: <python> -m pytest -q, label path)
//     [--full-on '<regex>'] [--direct] [--no-fallback] [--routes '<module-regex>=<inhoud-regex>']
//     [--deselect-file <pad>] [--requires tool=test.py,...]
//     [--env KEY=VAL ...]   ({tmp} in VAL wordt een verse tijdelijke map)
//     [--pg-service db --pg-db app_test --pg-user u --pg-password p
//      --migrations db/migrations --migrate '<commando, krijgt DATABASE_URL>']
//     [bestanden...]
//
// Uitsluiten: --deselect-file (pytest node-ids) en --requires gaan als
// --deselect naar pytest. Met --cmd kent de runner geen --deselect: dan haalt
// --requires alleen bestanden uit de selectie, en in de volledige suite
// (--full-on) gelden beide niet. Blijft er na --requires niets over, dan draait
// er niets (nooit stil de hele suite).
// Verwijderde bestanden mogen meekomen: een verwijderde module selecteert zijn
// importers, een verwijderd testbestand valt weg.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warn } from './_lib.mjs';

// ---------- argumenten ----------

const argv = process.argv.slice(2);
const opts = { env: [] };
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (k === 'env') opts.env.push(argv[++i]);
    // vlaggen zonder waarde; --transitive is sinds de graaf standaard en mag blijven staan
    else if (['transitive', 'direct', 'no-fallback'].includes(k)) opts[k] = true;
    else opts[k] = argv[++i];
  } else files.push(a);
}
const root = opts.root || '.';
const src = opts.src || 'app';
const testsDir = opts.tests || src;
const testPattern = new RegExp(opts['test-pattern'] || '^test_.*\\.py$');
const python = opts.python || 'python3';
const label = opts.label || 'path';
const fullOn = opts['full-on'] ? new RegExp(opts['full-on']) : null;
const transitive = !opts.direct;

// ---------- imports ----------

const moduleOf = (relToRoot) => relToRoot.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.');

// Welke modules een bestand importeert, absoluut gemaakt. `from a.b import c`
// telt als a.b én a.b.c (c kan een submodule zijn).
function importsOf(relToRoot, text) {
  const mod = moduleOf(relToRoot);
  const pkg = relToRoot.endsWith('__init__.py') ? mod : mod.split('.').slice(0, -1).join('.');
  // Eerst #-commentaar weg (een losse "(" daarin slokte anders de regels erna
  // op), dan alleen de haakjes direct na `import` platslaan.
  const flat = text
    .replace(/#[^\n]*/g, '')
    .replace(/\bimport\s*\(([^)]*)\)/g, (_, inner) => `import ${inner.replace(/\s*\n\s*/g, ' ')}`);
  const refs = new Set();
  for (const line of flat.split('\n')) {
    let m = line.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/);
    if (m) {
      const [, dots, rest, names] = m;
      let base = rest;
      if (dots) {
        const up = pkg.split('.').slice(0, pkg.split('.').length - (dots.length - 1));
        base = [...up, ...(rest ? [rest] : [])].filter(Boolean).join('.');
      }
      if (base) refs.add(base);
      for (const n of names.split(',')) {
        const name = n.trim().split(/\s+as\s+/)[0].replace(/[()\\]/g, '').trim();
        if (/^\w+$/.test(name)) refs.add(base ? `${base}.${name}` : name);
      }
      continue;
    }
    m = line.match(/^\s*import\s+(.+)$/);
    if (m) for (const n of m[1].split(',')) refs.add(n.trim().split(/\s+as\s+/)[0]);
  }
  return refs;
}

// ---------- selectie ----------

// Zelf recursief lopen: readdirSync({ recursive }) vraagt Node 18.17+.
// node_modules en verborgen mappen slaan we over.
function walk(dir, keep, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.normalize(path.join(dir, e.name));
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}
const testFiles = walk(path.join(root, testsDir), (b) => testPattern.test(b));
const testSet = new Set(testFiles);

const selected = new Set();
const changedModules = [];
let full = false;
let fullWhy = '';
for (const f of files) {
  if (fullOn?.test(f) && !full) {
    full = true;
    fullWhy = `kernbestand gewijzigd: ${f}`;
  }
  if (!f.endsWith('.py')) continue;
  if (testSet.has(path.normalize(f))) {
    selected.add(path.normalize(f));
    continue;
  }
  // Een verwijderd testbestand valt gewoon weg (geen "niet getest"-advies).
  if (testPattern.test(path.basename(f)) && !fs.existsSync(f)) continue;
  // Ook een verwijderde module telt: tests die hem nog importeren, breken.
  if (f.startsWith(path.join(root, src) + '/')) changedModules.push(moduleOf(path.relative(root, f)));
}

const untested = [];
if (!full && changedModules.length) {
  // importers: module-prefix -> modules die iets daaronder importeren, zodat
  // `from a.b import c` zowel een wijziging in a.b als in a.b.c raakt.
  const indexed = transitive
    ? new Set([...testFiles, ...walk(path.join(root, src), (b) => b.endsWith('.py')), ...walk(path.join(root, testsDir), (b) => b.endsWith('.py'))])
    : testFiles;
  const [routeMod, routeText] = opts.routes ? opts.routes.split(/=(.*)/s).map((s) => new RegExp(s)) : [];
  const viaRoute = [];
  const importers = new Map();
  const fileOf = new Map();
  for (const f of indexed) {
    const rel = path.relative(root, f);
    const mod = moduleOf(rel);
    const text = fs.readFileSync(f, 'utf8');
    fileOf.set(mod, f);
    if (routeText && testSet.has(f) && routeText.test(text)) viaRoute.push(f);
    for (const r of importsOf(rel, text)) {
      const parts = r.split('.');
      for (let i = 1; i <= parts.length; i++) {
        const key = parts.slice(0, i).join('.');
        if (!importers.has(key)) importers.set(key, new Set());
        importers.get(key).add(mod);
      }
    }
  }
  for (const m of changedModules) {
    let hit = false;
    const seen = new Set([m]);
    const queue = [m];
    while (queue.length) {
      for (const imp of importers.get(queue.shift()) || []) {
        if (seen.has(imp)) continue;
        seen.add(imp);
        if (testSet.has(fileOf.get(imp))) {
          selected.add(fileOf.get(imp));
          hit = true;
        }
        if (transitive) queue.push(imp);
      }
    }
    if (routeMod && [...seen].some((s) => routeMod.test(s))) {
      for (const t of viaRoute) selected.add(t);
      hit ||= viaRoute.length > 0;
    }
    if (!hit) untested.push(m);
  }
}
if (untested.length && !full) {
  const names = untested.slice(0, 3).join(', ') + (untested.length > 3 ? ` (+${untested.length - 3})` : '');
  if (opts['no-fallback']) {
    for (const m of untested.slice(0, 5)) warn(`geen test raakt ${m}; deze wijziging wordt lokaal niet getest (--no-fallback)`);
  } else {
    // Niets geselecteerd is geen groen: de graaf mist imports via strings of
    // plugins, en code zonder test kan nog steeds de suite breken.
    full = true;
    fullWhy = `geen test raakt ${names}`;
  }
}

if (!full && !selected.size) {
  console.log('tests-affected: geen tests geraakt');
  process.exit(0);
}

// ---------- uitsluiten ----------

const deselect = [];
if (opts['deselect-file'] && fs.existsSync(path.join(root, opts['deselect-file']))) {
  for (const line of fs.readFileSync(path.join(root, opts['deselect-file']), 'utf8').split('\n')) {
    const id = line.trim();
    if (id && !id.startsWith('#')) deselect.push('--deselect', id);
  }
}
for (const spec of String(opts.requires || '').split(',').filter(Boolean)) {
  const [tool, testPath] = spec.split('=');
  if (spawnSync('sh', ['-c', `command -v ${tool}`]).status !== 0) {
    deselect.push('--deselect', testPath);
    selected.delete(path.normalize(path.join(root, testPath)));
    warn(`${testPath} overgeslagen: ${tool} ontbreekt lokaal (CI draait hem wel)`);
  }
}
// Alles weggefilterd: niet doorvallen naar een lege selectie, want dan draait
// pytest de hele suite.
if (!full && !selected.size) {
  console.log('tests-affected: geen tests over na --requires');
  process.exit(0);
}

// ---------- omgeving en verse database ----------

const env = { ...process.env };
for (const kv of opts.env) {
  const i = kv.indexOf('=');
  const val = kv.slice(i + 1);
  env[kv.slice(0, i)] = val.includes('{tmp}') ? val.replaceAll('{tmp}', fs.mkdtempSync(path.join(os.tmpdir(), 'poort-tests-'))) : val;
}
const run = (cmd, args, extra = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...extra });

// Een lock in de gedeelde git-map (geldt voor alle worktrees). mkdir is atomair;
// een lock van een gestopt proces, of ouder dan 15 minuten, telt niet.
function withLock(name, fn) {
  const common = run('git', ['rev-parse', '--git-common-dir'], { cwd: root }).stdout.trim();
  const locks = common ? path.join(path.resolve(root, common), 'poort', 'locks') : path.join(os.tmpdir(), 'poort-locks');
  const dir = path.join(locks, name.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let told = false; ; ) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
      } catch {}
      const age = Date.now() - (fs.statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = pid > 0;
      } catch (err) {
        alive = err.code === 'EPERM';
      }
      if ((!alive && age > 2000) || age > 15 * 60 * 1000) {
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (!told) console.log(`tests-affected: wacht op ${name} (een andere worktree gebruikt hem)…`);
      told = true;
      spawnSync('sleep', ['0.5']);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (opts['pg-service']) {
  const svc = opts['pg-service'];
  const base = opts['pg-db'] || '';
  // Guard: deze database wordt bij elke run gedropt. Een naam zonder "test"
  // (bijv. de dev-database "ats") weigeren we, ook als iemand hem configureert.
  if (!/test/i.test(base) || !/^[a-z_][a-z0-9_]*$/.test(base)) {
    console.log(`tests-affected: --pg-db "${base}" geweigerd: gebruik een naam met "test" (kleine letters, cijfers, _); deze database wordt per run gedropt`);
    process.exit(1);
  }
  // Eigen database per worktree, zodat parallelle sessies elkaars database
  // niet droppen terwijl hun tests draaien.
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: root }).stdout.trim() || path.resolve(root);
  const db = `${base}_${createHash('sha256').update(fs.realpathSync(top)).digest('hex').slice(0, 8)}`;
  const tpl = `${base}_template`;
  const user = opts['pg-user'] || 'postgres';
  const pass = opts['pg-password'] || '';
  const psql = (sql) => run('docker', ['compose', 'exec', '-T', svc, 'psql', '-U', user, '-d', 'postgres', '-tAc', sql]);
  const port = run('docker', ['compose', 'port', svc, '5432']).stdout.trim();
  if (!port) {
    console.log(`tests-affected: database-service "${svc}" draait niet (docker compose port ${svc} 5432)`);
    process.exit(1);
  }
  const url = (name) => `postgresql+psycopg2://${user}:${pass}@${port}/${name}`;
  // Hash van de migraties op schijf (namen + inhoud, gesorteerd), relatief aan
  // --root: ook ongetrackte en nog niet gestagede migraties tellen.
  const migDir = path.join(root, opts.migrations || '.');
  const hash = createHash('sha256');
  for (const f of walk(migDir, () => true).sort()) hash.update(`${path.relative(migDir, f)}\0`).update(fs.readFileSync(f)).update('\0');
  const migHash = hash.digest('hex').slice(0, 16);
  // Opbouwen en klonen onder één lock: CREATE DATABASE ... TEMPLATE faalt als
  // een andere worktree het template op dat moment opbouwt of kloont.
  withLock(`pg-${tpl}`, () => {
    const exists = psql(`select 1 from pg_database where datname = '${tpl}'`).stdout.trim() === '1';
    const current = psql(`select shobj_description(oid, 'pg_database') from pg_database where datname = '${tpl}'`).stdout.trim();
    if (exists && !current.startsWith('poort:')) {
      console.log(`tests-affected: ${tpl} bestaat al en is niet door poort gemaakt; die droppen we niet. Kies een andere --pg-db.`);
      process.exit(1);
    }
    if (current !== `poort:${migHash}`) {
      console.log(`tests-affected: template ${tpl} (opnieuw) opbouwen…`);
      psql(`drop database if exists ${tpl}`);
      const c = psql(`create database ${tpl}`);
      if (c.status !== 0) {
        console.log(c.stderr);
        process.exit(1);
      }
      const m = run('sh', ['-c', opts.migrate], { cwd: root, env: { ...env, DATABASE_URL: url(tpl) } });
      if (m.status !== 0) {
        console.log(`migreren van ${tpl} faalde:\n${(m.stdout + m.stderr).split('\n').slice(-20).join('\n')}`);
        process.exit(1);
      }
      psql(`comment on database ${tpl} is 'poort:${migHash}'`);
    }
    psql(`drop database if exists ${db}`);
    const clone = psql(`create database ${db} template ${tpl}`);
    if (clone.status !== 0) {
      console.log(`kopie van ${tpl} faalde (open verbindingen?): ${clone.stderr.trim()}`);
      process.exit(1);
    }
  });
  console.log(`tests-affected: verse database ${db}`);
  env.DATABASE_URL = url(db);
}

// ---------- draaien ----------

const asLabel = (t) => (label === 'module' ? moduleOf(path.relative(root, t)) : path.relative(root, t));
const targets = full ? (label === 'module' ? [] : [testsDir]) : [...selected].map(asLabel).sort();
console.log(`tests-affected: ${full ? `volledige suite (${fullWhy})` : `${targets.length} testbestand(en)`}`);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const runner = opts.cmd ? ['sh', ['-c', `${opts.cmd} ${targets.map(shq).join(' ')}`]] : [python, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...targets, ...deselect]];
const r = spawnSync(runner[0], runner[1], { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);

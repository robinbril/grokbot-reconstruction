#!/usr/bin/env node
// Draai de run-stappen van een goedkope CI-job lokaal, uit de workflow zelf:
// dezelfde code als in CI, dus lokaal en CI lopen nooit uit elkaar. Bedoeld
// voor statische jobs zonder services (repo-invariants, lint-scripts), niet
// voor jobs die een stack of secrets nodig hebben.
//
//   node ci-job.mjs --workflow .github/workflows/ci.yml --job invariants
//     [--base-ref origin/acceptance]   (default: POORT_BASE_REF, base uit
//                                       poort.config.json, origin/HEAD)
//     [--path backend/.venv/bin]       (vóór PATH, komma-gescheiden: dan vinden
//                                       de stappen python3 met de packages die
//                                       de CI-runner al heeft, zoals PyYAML)
//
// Wat lokaal anders gaat:
//   - `uses:`-stappen (checkout, setup-*) slaan we over: de werkboom is er al;
//   - ${{ github.event_name }} is "pull_request", ${{ github.base_ref }} de base
//     zonder origin/, ${{ github.event.pull_request.base.sha }} de merge-base;
//     env.X uit de job- en stap-env; secrets.* leeg (met waarschuwing);
//   - `if:` met ==, !=, &&, ||, !, always() en success() wordt geëvalueerd; een
//     voorwaarde die we niet kunnen lezen, slaat de stap zichtbaar over;
//   - `git fetch --depth=N` zou een volledige clone shallow maken: een shim
//     haalt --depth en --shallow-* weg; met POORT_OFFLINE wordt fetch een no-op.
// Eén mislukte stap maakt de check rood, met de naam van de stap.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warn } from './_lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const workflow = opt('workflow', '.github/workflows/ci.yml');
const jobName = opt('job');
if (!jobName) {
  console.log('ci-job: geef --job <naam>');
  process.exit(2);
}
const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
const top = git(['rev-parse', '--show-toplevel']).stdout.trim() || process.cwd();

// ---------- workflow lezen (de subset die GitHub-workflows gebruiken) ----------

const indentOf = (l) => l.match(/^ */)[0].length;
const unquote = (v) => {
  const s = v.trim();
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) ? s.slice(1, -1) : s.replace(/\s+#.*$/, '');
};

// Lees `key: value` en blokscalars (| en >) vanaf regel i binnen een blok met
// een vaste inspringing. Geeft { map, end } terug.
function readMap(ls, start, ind) {
  const map = {};
  let i = start;
  while (i < ls.length) {
    const l = ls[i];
    if (!l.trim() || l.trim().startsWith('#')) {
      i++;
      continue;
    }
    if (indentOf(l) < ind) break;
    if (indentOf(l) > ind) {
      i++;
      continue;
    }
    const m = l.slice(ind).match(/^([\w.-]+):\s*(.*)$/);
    if (!m) break;
    const [, key, rest] = m;
    i++;
    if (/^[|>][-+]?\s*$/.test(rest)) {
      const body = [];
      while (i < ls.length && (!ls[i].trim() || indentOf(ls[i]) > ind)) body.push(ls[i++]);
      while (body.length && !body[body.length - 1].trim()) body.pop();
      const min = Math.min(...body.filter((b) => b.trim()).map(indentOf));
      const text = body.map((b) => b.slice(Math.min(min, indentOf(b)))).join('\n');
      map[key] = rest.startsWith('>') ? text.replace(/\n(?!\n)/g, ' ') : text + '\n';
    } else if (rest === '') {
      const sub = [];
      while (i < ls.length && (!ls[i].trim() || indentOf(ls[i]) > ind)) sub.push(ls[i++]);
      const subInd = Math.min(...sub.filter((s) => s.trim()).map(indentOf));
      map[key] = sub.some((s) => s.trim().startsWith('- ')) ? sub : readMap(sub, 0, subInd).map;
    } else map[key] = unquote(rest);
  }
  return { map, end: i };
}

function readJob(text, name) {
  const ls = text.split('\n');
  const jobsAt = ls.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt < 0) return null;
  const first = ls.slice(jobsAt + 1).find((l) => l.trim() && !l.trim().startsWith('#'));
  const jobInd = first ? indentOf(first) : 2;
  const at = ls.findIndex((l, i) => i > jobsAt && indentOf(l) === jobInd && l.trim() === `${name}:`);
  if (at < 0) return null;
  let end = at + 1;
  while (end < ls.length && (!ls[end].trim() || indentOf(ls[end]) > jobInd)) end++;
  const block = ls.slice(at + 1, end);
  const bodyInd = Math.min(...block.filter((l) => l.trim()).map(indentOf));
  const { map: job } = readMap(block, 0, bodyInd);
  const steps = [];
  const raw = Array.isArray(job.steps) ? job.steps : [];
  const itemInd = Math.min(...raw.filter((l) => l.trim().startsWith('- ')).map(indentOf));
  let cur = null;
  for (const l of raw) {
    if (indentOf(l) === itemInd && l.trim().startsWith('- ')) {
      if (cur) steps.push(cur);
      cur = [' '.repeat(itemInd + 2) + l.trim().slice(2)];
    } else if (cur) cur.push(l);
  }
  if (cur) steps.push(cur);
  return { env: job.env || {}, defaults: job.defaults || {}, steps: steps.map((s) => readMap(s, 0, itemInd + 2).map) };
}

// ---------- expressies en voorwaarden ----------

function baseRef() {
  const fromEnv = process.env.POORT_BASE_REF || opt('base-ref');
  if (fromEnv) return fromEnv;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(top, 'poort.config.json'), 'utf8'));
    if (cfg.base) return cfg.base;
  } catch {}
  return git(['rev-parse', '--abbrev-ref', 'origin/HEAD']).stdout.trim() || 'origin/main';
}
const BASE = baseRef();
const head = git(['rev-parse', 'HEAD']).stdout.trim();
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
const ctx = {
  'github.event_name': 'pull_request',
  'github.base_ref': BASE.replace(/^origin\//, ''),
  'github.head_ref': branch,
  'github.ref': `refs/heads/${branch}`,
  'github.ref_name': branch,
  'github.sha': head,
  'github.workspace': top,
  'github.event.pull_request.base.sha': git(['merge-base', 'HEAD', BASE]).stdout.trim(),
  'github.event.pull_request.base.ref': BASE.replace(/^origin\//, ''),
  'github.event.pull_request.head.sha': head,
  'runner.os': process.platform === 'darwin' ? 'macOS' : 'Linux',
};
const unknown = new Set();
function lookup(name, env) {
  if (name in ctx) return ctx[name];
  if (name.startsWith('env.')) return env[name.slice(4)] ?? '';
  if (name.startsWith('secrets.')) {
    warn(`ci-job: ${name} is lokaal leeg`);
    return '';
  }
  unknown.add(name);
  return undefined;
}
const expand = (s, env) => String(s).replace(/\$\{\{\s*([\w.-]+)\s*\}\}/g, (_, n) => lookup(n, env) ?? '');

// Een `if:` als JS-expressie, alleen uit tokens die we kennen: contexten,
// stringliterals, ==, !=, &&, ||, !, haakjes, true/false en status-functies.
function evalIf(expr, env) {
  if (expr === undefined || expr === '') return true;
  const src = String(expr).replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const tokens = src.match(/'(?:[^']|'')*'|[\w.-]+\(\)|[\w.-]+|==|!=|&&|\|\||!|\(|\)|\s+/g);
  if (!tokens || tokens.join('') !== src) return null;
  let js = '';
  for (const t of tokens) {
    if (/^\s+$/.test(t)) js += ' ';
    else if (t.startsWith("'")) js += JSON.stringify(t.slice(1, -1).replace(/''/g, "'"));
    else if (['==', '!=', '&&', '||', '!', '(', ')'].includes(t)) js += t === '==' ? '===' : t === '!=' ? '!==' : t;
    else if (t === 'always()' || t === 'success()' || t === 'true') js += 'true';
    else if (t === 'failure()' || t === 'cancelled()' || t === 'false') js += 'false';
    else {
      const v = lookup(t, env);
      if (v === undefined) return null;
      js += JSON.stringify(v);
    }
  }
  try {
    return Boolean(Function(`"use strict"; return (${js});`)());
  } catch {
    return null;
  }
}

// ---------- git-shim: geen --depth op een volledige clone ----------

function gitShim() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poort-ci-job-'));
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(
    path.join(dir, 'git'),
    `#!/bin/sh
# poort ci-job: --depth/--shallow-* maken een volledige lokale clone shallow.
if [ "$1" = "fetch" ]; then
  [ -n "$POORT_OFFLINE" ] && exit 0
  shift
  n=$#
  while [ "$n" -gt 0 ]; do
    a=$1
    shift
    n=$((n - 1))
    case "$a" in
      --depth|--shallow-since|--shallow-exclude)
        if [ "$n" -gt 0 ]; then shift; n=$((n - 1)); fi ;;
      --depth=*|--shallow-*|--unshallow|--deepen*) ;;
      *) set -- "$@" "$a" ;;
    esac
  done
  set -- fetch "$@"
fi
exec ${JSON.stringify(realGit)} "$@"
`,
    { mode: 0o755 },
  );
  return dir;
}

// ---------- draaien ----------

const file = path.join(top, workflow);
if (!fs.existsSync(file)) {
  console.log(`ci-job: ${workflow} bestaat niet`);
  process.exit(1);
}
const job = readJob(fs.readFileSync(file, 'utf8'), jobName);
if (!job) {
  console.log(`ci-job: job "${jobName}" niet gevonden in ${workflow}`);
  process.exit(1);
}
const shim = gitShim();
const jobEnv = Object.fromEntries(Object.entries(job.env).map(([k, v]) => [k, expand(v, process.env)]));
const defaultDir = job.defaults?.run?.['working-directory'];
let ran = 0;
let failed = 0;
for (const [i, step] of job.steps.entries()) {
  const label = step.name || (step.uses ? step.uses : `stap ${i + 1}`);
  if (step.uses) {
    if (!/^actions\/(checkout|setup-[\w-]+|cache)@/.test(step.uses)) warn(`ci-job: "${label}" (uses: ${step.uses}) kan lokaal niet en is overgeslagen`);
    continue;
  }
  if (!step.run) continue;
  const env = { ...process.env, ...jobEnv, GITHUB_EVENT_NAME: ctx['github.event_name'], GITHUB_BASE_REF: ctx['github.base_ref'], GITHUB_SHA: head, GITHUB_WORKSPACE: top };
  for (const [k, v] of Object.entries(step.env && typeof step.env === 'object' ? step.env : {})) env[k] = expand(v, env);
  unknown.clear();
  const cond = evalIf(step.if, env);
  if (cond === null || unknown.size) {
    warn(`ci-job: "${label}" overgeslagen: voorwaarde of expressie niet lokaal te bepalen (${[...unknown].join(', ') || step.if})`);
    continue;
  }
  if (!cond) continue;
  const script = expand(step.run, env);
  if (unknown.size) {
    warn(`ci-job: "${label}" overgeslagen: onbekende expressie ${[...unknown].join(', ')}`);
    continue;
  }
  const cwd = path.join(top, step['working-directory'] || defaultDir || '.');
  const extra = String(opt('path', '')).split(',').filter(Boolean).map((p) => path.resolve(top, p));
  env.PATH = [shim, ...extra, env.PATH].join(path.delimiter);
  console.log(`▶ ${label}`);
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd, env, stdio: 'inherit' });
  ran++;
  if (r.status !== 0) {
    failed++;
    console.log(`✗ ${label} (exit ${r.status})`);
    if (step['continue-on-error'] === 'true') failed--;
  }
}
fs.rmSync(shim, { recursive: true, force: true });
console.log(`ci-job ${jobName}: ${ran} stap(pen) gedraaid, ${failed} rood`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// poort — quality gate voor git-hooks en e2e, voor mensen en agents.
// Eén bestand, geen dependencies, Node >= 18. Bron: github.com/Reforge-Recruitment/poort
//
// Kern:
//   - checks per tier (commit, push) uit poort.config.json, alleen als gewijzigde
//     bestanden hun `when` raken, parallel;
//   - receipts gesleuteld op de inhoud die getest is: zelfde inhoud = cached groen;
//   - stack-checks draaien alleen tegen een stack uit déze worktree (provenance);
//   - output: één regel per check, bij falen de staart plus een logpad.
export const VERSION = '0.4.0';

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Gevendord naast poort.mjs (init kopieert integrations/ mee): doctor gebruikt
// precies dezelfde env en token-lookup als de e2e-opname zelf.
import { seatEnv, seatCwd, authStatusArgs, judgeSeatAuth, managedPolicyProblems, managedPolicyMessage, SERVER_POLICY_CAVEAT } from './integrations/e2e-claude-seat.mjs';

const TAIL_LINES = Number(process.env.POORT_TAIL || 30);
const TIERS = ['commit', 'push'];
const HOOK_TIER = { 'pre-commit': 'commit', 'pre-push': 'push' };
const isCI = () => Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

// ---------- git ----------

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  }
  return r.status === 0 ? r.stdout : '';
}
// De lege tree; git kent hem altijd. Het pragma: detect-secrets in de repo's waar
// poort in staat, ziet de hash anders als geheim en blokkeert de commit van .poort/.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // pragma: allowlist secret
const lines = (s) => s.split('\n').filter(Boolean);
const nul = (s) => s.split('\0').filter(Boolean);

export function repoInfo(cwd = process.cwd()) {
  const top = git(['rev-parse', '--show-toplevel'], { cwd }).trim();
  const common = path.resolve(top, git(['rev-parse', '--git-common-dir'], { cwd: top }).trim());
  const gitDir = path.resolve(top, git(['rev-parse', '--git-dir'], { cwd: top }).trim());
  const store = path.join(common, 'poort');
  return { top, common, gitDir, store };
}

function refExists(top, ref) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: top }).status === 0;
}

// Waar deze branch naartoe gaat (de PR-base) en de merge-base daarmee. De upstream
// komt als laatste: na de eerste push is dat de eigen remote-branch, en dan zou
// poort alleen nog de laatste commits zien in plaats van de hele branch.
// origin/HEAD wordt de echte naam (origin/main): een check kan die ophalen.
export function baseInfo(top, cfg) {
  for (let ref of [process.env.POORT_BASE_REF, cfg.base, 'origin/HEAD', 'origin/main', 'origin/master', '@{upstream}'].filter(Boolean)) {
    if (!refExists(top, ref)) continue;
    if (ref === 'origin/HEAD') ref = git(['rev-parse', '--abbrev-ref', 'origin/HEAD'], { cwd: top, allowFail: true }).trim() || ref;
    const sha = git(['merge-base', 'HEAD', ref], { cwd: top, allowFail: true }).trim();
    if (sha) return { ref, sha };
  }
  // Geen target: de vorige commit; bij één commit telt alles als nieuw (lege tree).
  const sha = refExists(top, 'HEAD~1') ? git(['rev-parse', 'HEAD~1'], { cwd: top }).trim() : refExists(top, 'HEAD') ? EMPTY_TREE : null;
  return { ref: null, sha };
}
export const baseFor = (top, cfg) => baseInfo(top, cfg).sha;

// Gewijzigde bestanden per situatie. `deleted` telt mee als trigger, niet als {files}.
export function changedFiles(top, { mode, base, pushRanges }) {
  const set = new Set();
  const add = (s) => nul(s).forEach((f) => set.add(f));
  // --no-renames: een hernoemd bestand telt met beide paden, zodat ook een check
  // op het oude pad (bijv. een import-selector) ziet dat het weg is.
  const diff = ['diff', '--name-only', '--no-renames', '-z'];
  if (mode === 'staged') {
    add(git([...diff, '--cached'], { cwd: top }));
  } else if (mode === 'push' && pushRanges?.length) {
    for (const [from, to] of pushRanges) add(git([...diff, from, to], { cwd: top }));
  } else {
    if (base) add(git([...diff, base, 'HEAD'], { cwd: top }));
    add(git([...diff, '--cached'], { cwd: top }));
    add(git(diff, { cwd: top }));
    add(git(['ls-files', '-o', '--exclude-standard', '-z'], { cwd: top }));
  }
  return [...set];
}

// ---------- config ----------

export function loadConfig(top) {
  // POORT_CONFIG: proefdraaien met een profiel zonder iets in de repo te schrijven.
  const file = process.env.POORT_CONFIG ? path.resolve(process.env.POORT_CONFIG) : path.join(top, 'poort.config.json');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  // Een meegeleverd profiel direct gebruiken (POORT_CONFIG): {web} hier invullen, zoals init dat doet.
  // Nooit in de eigen poort.config.json: daar heeft init het al ingevuld, en een
  // letterlijke {web} is dan van jou.
  let cfg = parseJson(file, text);
  if (process.env.POORT_CONFIG && text.includes('{web')) {
    const st = detectStack(top);
    const web = process.env.POORT_WEB || st.web;
    if (!web) {
      const e = new Error(
        st.webDirs.length > 1
          ? `${path.basename(file)} verwacht een webapp; er zijn er meerdere (${st.webDirs.join(', ')}): kies met POORT_WEB=<map>`
          : `${path.basename(file)} verwacht een webapp, maar er is geen package.json: kies met POORT_WEB=<map>`,
      );
      e.code = 'CONFIG';
      throw e;
    }
    cfg = fillWeb(cfg, web);
  }
  return expandWorktree(normalizeConfig(cfg), top);
}

// {worktree}: de mapnaam van de worktree als slug, zodat elke worktree een eigen
// stack-adres kan hebben (http://{worktree}.localhost). Alleen [a-z0-9-]: zo is
// het altijd een geldige hostnaam.
export function worktreeSlug(top) {
  const slug = path
    .basename(path.resolve(top))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'worktree';
}

// Staat {worktree} in de hostnaam (http://{worktree}.localhost), dan hoort het
// adres per constructie bij deze worktree: byName. Zo'n stack zit meestal achter
// één gedeelde proxypoort, waar poort de herkomst niet uit de poort kan halen.
// Alleen de echte hostnaam telt: {worktree} in de query, het fragment, het pad of
// de userinfo (http://{worktree}@localhost) maakt het adres niet van deze worktree.
// Daarom twee verschillende geldige markeringen invullen en de URL echt parsen:
// alleen als de hostnaam daardoor verandert, zit {worktree} erin. Eén vaste
// markering zou je kunnen namaken (http://<markering>.localhost/{worktree}).
const WORKTREE_MARKERS = ['poortwta', 'poortwtb'];
export function hostHasWorktree(url) {
  if (typeof url !== 'string' || !url.includes('{worktree}')) return false;
  try {
    const [a, b] = WORKTREE_MARKERS.map((m) => new URL(url.replaceAll('{worktree}', m)).hostname);
    return a !== b;
  } catch {
    return false;
  }
}

export function expandWorktree(cfg, top) {
  const slug = worktreeSlug(top);
  const fill = (v) => (typeof v === 'string' ? v.replaceAll('{worktree}', slug) : v);
  for (const c of cfg.checks) {
    c.stack = c.stack.map((st) => ({
      ...st,
      url: fill(st.url),
      start: fill(st.start),
      ...(hostHasWorktree(st.url) ? { byName: true } : {}),
    }));
  }
  return cfg;
}

function parseJson(file, text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(`${path.basename(file)} is geen geldige JSON: ${e.message}`);
    err.code = 'CONFIG';
    throw err;
  }
}

export function normalizeConfig(cfg) {
  const errors = [];
  const seen = new Set();
  cfg.checks = (cfg.checks || []).map((c, i) => {
    const where = `checks[${i}]${c.id ? ` (${c.id})` : ''}`;
    if (!c.id) errors.push(`${where}: id ontbreekt`);
    if (seen.has(c.id)) errors.push(`${where}: dubbele id`);
    seen.add(c.id);
    if (!TIERS.includes(c.tier)) errors.push(`${where}: tier moet ${TIERS.join(' of ')} zijn`);
    if (c.type === 'e2e') {
      c.cwd = c.cwd || c.dir || '.';
      c.run = c.run || 'npx --no-install e2e run --strict-cache --reporter list,markdown';
      c.hint = c.hint || `UI bewust veranderd? Neem opnieuw op: node .poort/poort.mjs e2e --record, en stage ${path.posix.join(c.cwd, '.e2e/cache')}/`;
    }
    if (!c.run) errors.push(`${where}: run ontbreekt`);
    const re = (key, list) => {
      try {
        return list.map((w) => new RegExp(w));
      } catch (e) {
        errors.push(`${where}: ${key} is geen geldige regex (${e.message})`);
        return [];
      }
    };
    c.whenRe = re('when', [].concat(c.when ?? '.'));
    // fullOn: bestanden die voor álle bestanden gelden (lint-config, lockfile). Ze
    // tellen mee in de receipt-sleutel en laten een {files}-check op alles draaien;
    // anders zou een groene run op alleen het configbestand alles "bewijzen".
    c.fullRe = re('fullOn', [].concat(c.fullOn ?? []));
    c.cwd = c.cwd || '.';
    c.timeout = Number(c.timeout || 300);
    c.stack = c.stack ? [].concat(c.stack) : [];
    c.required = c.required ?? c.cache !== false; // uitkomst hangt van buiten af: geen bewijs voor verify
    return c;
  });
  cfg.prepare = (cfg.prepare || []).map((p, i) => {
    const where = `prepare[${i}]${p.id ? ` (${p.id})` : ''}`;
    if (!p.id) errors.push(`${where}: id ontbreekt`);
    if (!p.run) errors.push(`${where}: run ontbreekt`);
    if (!p.when && !p.creates) errors.push(`${where}: geef when (lockfiles) of creates (pad dat moet bestaan)`);
    return { ...p, cwd: p.cwd || '.', when: [].concat(p.when || []), timeout: Number(p.timeout || 900) };
  });
  for (const [i, f] of (cfg.format || []).entries()) {
    if (!f.when || !f.run) errors.push(`format[${i}]: when en run zijn verplicht`);
    else if (!f.run.includes('{file}')) errors.push(`format[${i}]: run mist {file}`);
  }
  if (cfg.slots !== undefined && !(Number.isInteger(cfg.slots) && cfg.slots > 0)) errors.push('slots: een geheel getal groter dan 0');
  if (errors.length) {
    const err = new Error(`poort.config.json ongeldig:\n  ${errors.join('\n  ')}`);
    err.code = 'CONFIG';
    throw err;
  }
  return cfg;
}

// matches: raakt dit bestand de check (trigger en receipt-sleutel)? fileArg: hoort
// het in {files}? Een fullOn-bestand is wel een trigger, maar geen argument.
const fileArg = (check, file) => check.whenRe.some((re) => re.test(file));
const fullTrigger = (check, file) => check.fullRe.some((re) => re.test(file));
export const matches = (check, file) => fileArg(check, file) || fullTrigger(check, file);

// ---------- inhoud-hash (receipt-sleutel) ----------

// Hash over pad + blob-id van elk bestand dat de check raakt, zoals het nu op
// schijf staat. Ongewijzigde getrackte bestanden: blob-id uit de index (gratis);
// gewijzigde en untracked bestanden: git hash-object.
export function contentIndex(top) {
  const blobs = new Map();
  for (const rec of nul(git(['ls-files', '-s', '-z'], { cwd: top }))) {
    const tab = rec.indexOf('\t');
    const [, sha] = rec.slice(0, tab).split(' ');
    blobs.set(rec.slice(tab + 1), sha);
  }
  const dirty = new Set([
    ...nul(git(['diff', '--name-only', '-z'], { cwd: top })),
    ...nul(git(['ls-files', '-o', '--exclude-standard', '-z'], { cwd: top })),
  ]);
  const toHash = [...dirty].filter((f) => fs.existsSync(path.join(top, f)) && fs.statSync(path.join(top, f)).isFile());
  // Paden als argumenten, in brokken: een naam met een newline breekt --stdin-paths.
  // Verdwijnt een bestand intussen (een andere agent, build-output), dan per
  // bestand opnieuw; wat dan nog ontbreekt, telt als verwijderd.
  const hashed = new Set();
  for (let i = 0; i < toHash.length; i += 500) {
    const chunk = toHash.slice(i, i + 500);
    const out = lines(git(['hash-object', '--', ...chunk], { cwd: top, allowFail: true }));
    const shas = out.length === chunk.length ? out : chunk.map((f) => git(['hash-object', '--', f], { cwd: top, allowFail: true }).trim());
    chunk.forEach((f, j) => {
      if (!shas[j]) return;
      blobs.set(f, shas[j]);
      hashed.add(f);
    });
  }
  for (const f of dirty) if (!hashed.has(f)) blobs.delete(f); // verwijderd op schijf
  return blobs;
}

// Dezelfde kaart (pad -> blob-id), maar voor een commit in plaats van de schijf.
// verify gebruikt hem: het bewijs moet horen bij wat er gepusht wordt, niet bij
// niet-gecommitte wijzigingen die toevallig groen waren.
export function treeIndex(top, ref = 'HEAD') {
  const blobs = new Map();
  if (!refExists(top, ref)) return blobs;
  for (const rec of nul(git(['ls-tree', '-r', '-z', '--full-tree', ref], { cwd: top }))) {
    const tab = rec.indexOf('\t');
    blobs.set(rec.slice(tab + 1), rec.slice(0, tab).split(' ')[2]);
  }
  return blobs;
}

// Een check die {base} gebruikt (of "usesBase": true, voor een script dat
// POORT_BASE leest), hangt ook af van de base: die gaat dan mee in de sleutel.
export const usesBase = (check) => Boolean(check.usesBase) || String(check.run).includes('{base}');

// ctx: wat per worktree verschilt en mee bepaalt wat er getest is. Receipts zijn
// gedeeld tussen worktrees (zelfde inhoud = zelfde uitkomst), maar met
// {worktree} draait worktree B een ander commando tegen een andere stack dan A,
// ook bij identieke inhoud. Daarom telt het commando zoals het echt draait
// ({worktree} ingevuld), elk stack-adres en de E2E_BASE_URL die e2e krijgt.
// {poort} en {files} niet: het pad naar .poort verschilt per worktree zonder dat
// de check iets anders test, en de bestanden zitten al in de sleutel.
export function checkKey(check, blobs, base = null, ctx = {}) {
  const h = createHash('sha256');
  const run = ctx.worktree ? check.run.replaceAll('{worktree}', ctx.worktree) : check.run;
  h.update(`poort:${VERSION}\0${check.id}\0${check.cwd}\0${run}\0`);
  for (const s of check.stack || []) h.update(`stack:${s.url}\0`);
  if (ctx.e2eUrl) h.update(`e2e:${ctx.e2eUrl}\0`);
  if (usesBase(check)) h.update(`base:${base || 'HEAD'}\0`);
  const files = [...blobs.keys()].filter((f) => matches(check, f)).sort();
  for (const f of files) h.update(`${f}\0${blobs.get(f)}\0`);
  return h.digest('hex').slice(0, 32);
}

// ---------- receipts ----------

// Logs per worktree (.git/worktrees/<naam>/poort/logs): twee agents die dezelfde
// check draaien, overschrijven anders elkaars log en lezen elkaars waarschuwingen.
// Receipts zijn juist gedeeld: zelfde inhoud = zelfde uitkomst, in elke worktree.
const logDirOf = (gitDir) => path.join(gitDir, 'poort', 'logs');

const receiptPath = (store, id, key) => path.join(store, 'receipts', id.replace(/[^\w.-]/g, '_'), key + '.json');

export function readReceipt(store, id, key) {
  try {
    return JSON.parse(fs.readFileSync(receiptPath(store, id, key), 'utf8'));
  } catch {
    return null;
  }
}

function writeReceipt(store, id, key, data) {
  const p = receiptPath(store, id, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Eerst een tijdelijk bestand, dan rename (atomair): een agent die tegelijk leest,
  // ziet nooit een half geschreven receipt.
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, at: new Date().toISOString(), poort: VERSION }));
  fs.renameSync(tmp, p);
}

// Elke inhoud krijgt een eigen receipt; met tien agents loopt dat in de
// duizenden. Eén keer per dag: weg wat 30 dagen niet meer geschreven is.
const RECEIPT_MAX_AGE = 30 * 86400000;
export function pruneReceipts(store, now = Date.now()) {
  const dir = path.join(store, 'receipts');
  const stamp = path.join(dir, '.pruned');
  try {
    if (now - fs.statSync(stamp).mtimeMs < 86400000) return 0;
  } catch {}
  let n = 0;
  try {
    for (const id of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const f of fs.readdirSync(path.join(dir, id.name))) {
        const p = path.join(dir, id.name, f);
        if (now - fs.statSync(p).mtimeMs > RECEIPT_MAX_AGE) {
          fs.rmSync(p, { force: true });
          n++;
        }
      }
    }
    fs.writeFileSync(stamp, '');
  } catch {}
  return n;
}

// ---------- stack-provenance ----------

const sh = (cmd, cwd) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', timeout: 15000 });

export function portOf(url) {
  const u = new URL(url);
  return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
}

// Welke map serveert deze poort? Docker compose: het working_dir-label van de
// container. Anders: de cwd van het luisterende proces.
export function stackOwner(port) {
  const ids = lines(sh(`docker ps -q --filter publish=${port} 2>/dev/null`).stdout || '');
  if (ids.length) {
    const dir = (sh(`docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' ${ids[0]}`).stdout || '').trim();
    return dir && dir !== '<no value>' ? { dir, via: 'docker compose' } : { dir: null, via: 'docker zonder compose-label' };
  }
  const pids = lines(sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`).stdout || '');
  if (!pids.length) return null;
  for (const pid of pids) {
    const out = sh(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`).stdout || '';
    const n = lines(out).find((l) => l.startsWith('n'));
    if (n) return { dir: n.slice(1), via: `proces ${pid}` };
    try {
      return { dir: fs.readlinkSync(`/proc/${pid}/cwd`), via: `proces ${pid}` };
    } catch {}
  }
  return { dir: null, via: 'onbekend proces' };
}

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Hoort `dir` bij worktree `top`? Binnen top, en niet binnen een andere worktree
// die zelf in top genest is (bijv. .claude/worktrees/x).
export function ownsDir(top, dir, worktrees = []) {
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const t = real(top);
  const d = real(dir);
  if (!inside(d, t)) return false;
  return !worktrees.map(real).some((w) => w !== t && inside(w, t) && inside(d, w));
}

function worktreeList(top) {
  return lines(git(['worktree', 'list', '--porcelain'], { cwd: top, allowFail: true }))
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9));
}

// Een andere geregistreerde worktree van deze repo met dezelfde {worktree}-slug.
export function slugTwin(top, worktrees) {
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const t = real(top);
  const slug = worktreeSlug(top);
  return worktrees.find((w) => real(w) !== t && worktreeSlug(w) === slug) || null;
}

// docker ps en lsof kosten samen tot een seconde; checks delen vaak dezelfde
// poort. Eén meting per poort per run is genoeg.
const ownerCache = new Map();
let worktreeCache = null;

// Draait er iets op dit adres? Synchroon, want stackStatus is synchroon; een kind-
// proces met fetch werkt overal waar Node draait, zonder curl. 2xx/3xx telt als
// draaiend; een 404 van een gedeelde proxy betekent dat deze worktree er niet
// achter hangt.
// Redirects volgen we nooit: we willen weten wat dít adres antwoordt, inclusief
// waar een redirect heen wijst en of de stack zich met X-Poort-Worktree meldt.
// Het kind gebruikt http(s).request in plaats van fetch. Een *.localhost-naam gaat
// direct naar loopback (eerst 127.0.0.1, dan ::1) met de echte Host-header, zoals
// een browser doet (RFC 6761): de resolver van het platform is daar niet
// betrouwbaar (Node 18 kiest ::1 zonder terugval op IPv4, sommige systemen geven
// ENOTFOUND). Redirects worden nooit gevolgd.
const PROBE = `
const u = new URL(process.argv[1]);
const ms = Number(process.argv[2]);
const lib = require(u.protocol === 'https:' ? 'node:https' : 'node:http');
const host = u.hostname.replace(/^\\[|\\]$/g, '');
const loopback = host === 'localhost' || host.endsWith('.localhost');
const targets = loopback ? ['127.0.0.1', '::1'] : [host];
const port = u.port || (u.protocol === 'https:' ? 443 : 80);
const end = Date.now() + ms;
const once = (address) =>
  new Promise((resolve) => {
    const req = lib.request(
      { host: address, port, path: u.pathname + u.search, method: 'GET', headers: { host: u.host }, servername: loopback ? undefined : host, timeout: Math.max(1, end - Date.now()) },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location ?? null, worktree: res.headers['x-poort-worktree'] ?? null });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
(async () => {
  for (const t of targets) {
    if (Date.now() >= end) break;
    const r = await once(t);
    if (r) return process.stdout.write(JSON.stringify(r));
  }
  process.stdout.write('{}');
})();
`;

export function probeUrl(url, timeoutMs = 4000) {
  const r = spawnSync(process.execPath, ['-e', PROBE, url, String(timeoutMs)], { encoding: 'utf8', timeout: timeoutMs + 2000 });
  try {
    const p = JSON.parse(r.stdout);
    return { status: Number(p.status) || 0, location: p.location ?? null, worktree: p.worktree ?? null };
  } catch {
    return { status: 0, location: null, worktree: null };
  }
}

// Is het antwoord op een {worktree}-adres echt van deze worktree? Antwoorden is
// niet genoeg: een gedeelde proxy kan een onbekende host doorsturen naar main
// (302 naar main.localhost) of met een wildcard main serveren (200). Een redirect
// telt alleen binnen hetzelfde schema, dezelfde host en poort; meldt de stack
// zich met X-Poort-Worktree, dan moet dat de slug van deze worktree zijn. Een
// wildcard die 200 geeft zónder die header, is alleen met die header te vangen;
// laat je router hem daarom zetten.
export function byNameProbeStatus(url, probe, slug) {
  const { status, location, worktree } = probe;
  if (status < 200 || status >= 400) return { ok: false, reason: `geen stack op ${url}${status ? ` (HTTP ${status})` : ''}` };
  if (status >= 300) {
    let target = null;
    try {
      target = location ? new URL(location, url) : null;
    } catch {}
    const here = new URL(url);
    if (!target || target.protocol !== here.protocol || target.host !== here.host) {
      return { ok: false, reason: `${url} geeft een redirect naar een andere host (${location || 'geen Location'}); niet van deze worktree` };
    }
  }
  if (worktree != null && worktree !== slug) {
    return { ok: false, reason: `stack op ${url} meldt X-Poort-Worktree "${worktree}", niet "${slug}"; niet van deze worktree` };
  }
  return { ok: true };
}

export function stackStatus(top, stack) {
  if (isCI()) return { ok: true };
  for (const s of stack) {
    if (s.byName) {
      // Herkomst volgt uit de naam, maar alleen als die naam uniek is: /x/feat_a
      // en /y/feat-a worden allebei feat-a, en dan kan de ene worktree groen
      // krijgen op de stack van de andere.
      worktreeCache ??= worktreeList(top);
      const twin = slugTwin(top, worktreeCache);
      if (twin) return { ok: false, reason: `{worktree} is "${worktreeSlug(top)}", net als bij ${twin}; herkomst niet eenduidig, geef een van beide mappen een andere naam` };
      // Dan: antwoordt de stack, en wijst niets erop dat het een andere is?
      if (!ownerCache.has(s.url)) ownerCache.set(s.url, probeUrl(s.url));
      const st = byNameProbeStatus(s.url, ownerCache.get(s.url), worktreeSlug(top));
      if (!st.ok) return { ok: false, reason: `${st.reason}${s.start ? ` (start: ${s.start})` : ''}` };
      continue;
    }
    const port = portOf(s.url);
    if (!ownerCache.has(port)) ownerCache.set(port, stackOwner(port));
    const owner = ownerCache.get(port);
    if (!owner) return { ok: false, reason: `geen stack op :${port}${s.start ? ` (start: ${s.start})` : ''}` };
    if (!owner.dir) return { ok: false, reason: `:${port} wordt geserveerd door ${owner.via}; herkomst niet vast te stellen` };
    worktreeCache ??= worktreeList(top);
    if (!ownsDir(top, owner.dir, worktreeCache)) {
      return { ok: false, reason: `stack op :${port} is van ${owner.dir}, niet van deze worktree` };
    }
  }
  return { ok: true };
}

// e2e-checks krijgen het stack-adres (met {worktree} ingevuld) als E2E_BASE_URL,
// zodat e2e.config.ts precies de stack test waarvan poort net de herkomst
// controleerde. Een E2E_BASE_URL die je zelf zet, wint.
export function e2eEnv(check, env = process.env) {
  if (check.type !== 'e2e' || !check.stack.length || env.E2E_BASE_URL) return {};
  return { E2E_BASE_URL: check.stack[0].url };
}

// Volledig vergelijken, query en fragment inbegrepen: een proxy kan op
// ?backend=… routeren en een app op #/…, dus die bepalen mee welke stack je
// test. Alleen wat URL zelf normaliseert (hoofdletters in de host, standaardpoort)
// en een slash aan het eind van het pad tellen niet.
const normUrl = (u) => {
  const x = new URL(u);
  return `${x.protocol}//${x.username}:${x.password}@${x.host}${x.pathname.replace(/\/+$/, '')}${x.search}${x.hash}`;
};
export const sameUrl = (a, b) => {
  try {
    return normUrl(a) === normUrl(b);
  } catch {
    return a === b;
  }
};

// Een E2E_BASE_URL uit je shell (of van een andere worktree) wint van het
// stack-adres, maar dan test e2e iets anders dan de stack waarvan poort net de
// herkomst controleerde, en zou het bewijs groen worden voor andermans stack.
// Wijkt hij af, dan geen bewijs. In CI geldt de herkomstcontrole niet (zie
// stackStatus), dus daar ook dit niet.
export function e2eUrlStatus(check, env = process.env) {
  if (isCI() || check.type !== 'e2e' || !check.stack.length || !env.E2E_BASE_URL) return { ok: true };
  if (sameUrl(env.E2E_BASE_URL, check.stack[0].url)) return { ok: true };
  return { ok: false, reason: `E2E_BASE_URL wijst naar een andere stack dan de gecontroleerde (${env.E2E_BASE_URL} in plaats van ${check.stack[0].url}); haal hem weg of zet hem gelijk` };
}

// Het adres dat e2e echt krijgt: het stack-adres, tenzij een afwijkende
// E2E_BASE_URL in de env staat (die dan wint, zie e2eEnv). Gelijk aan het
// stack-adres telt als het stack-adres, zodat run en verify dezelfde sleutel maken.
export function effectiveE2EUrl(check, env = process.env) {
  if (check.type !== 'e2e') return '';
  const s = check.stack[0]?.url;
  if (env.E2E_BASE_URL && !(s && sameUrl(env.E2E_BASE_URL, s))) return env.E2E_BASE_URL;
  return s || '';
}

export const keyContext = (top, check, env = process.env) => ({ worktree: worktreeSlug(top), e2eUrl: effectiveE2EUrl(check, env) });

// Herkomst van de stack plus: test e2e ook echt die stack?
export function checkStackStatus(top, check, env = process.env) {
  const u = e2eUrlStatus(check, env);
  return u.ok ? stackStatus(top, check.stack) : u;
}

// ---------- afsluiten: niets laten draaien, niets kwijtraken ----------

// Checks draaien in een eigen process-groep (detached), zodat een timeout de hele
// boom kan stoppen. Keerzijde: Ctrl-C en een agent-timeout (SIGTERM) bereiken die
// groepen niet vanzelf. poort houdt ze daarom bij, stopt ze zelf (eerst SIGTERM,
// dan SIGKILL) en draait pas daarna de opruimstappen, zoals het terugzetten van
// niet-gestagede wijzigingen. Een tweede signaal wacht niet meer.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const groups = new Set();
const cleanups = new Set();
const signalGroup = (pid, sig) => {
  try {
    process.kill(-pid, sig);
  } catch {}
};
const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

export async function stopGroups(pids, graceMs = 2000) {
  pids.forEach((pid) => signalGroup(pid, 'SIGTERM'));
  const until = Date.now() + graceMs;
  while (Date.now() < until && pids.some(groupAlive)) await sleep(50);
  pids.forEach((pid) => signalGroup(pid, 'SIGKILL'));
}

function runCleanups() {
  for (const fn of [...cleanups]) {
    cleanups.delete(fn);
    try {
      fn();
    } catch {}
  }
}

let stopping = false;
async function shutdown(sig) {
  const code = 128 + (os.constants.signals[sig] || 0);
  if (stopping) {
    groups.forEach((pid) => signalGroup(pid, 'SIGKILL'));
    runCleanups();
    process.exit(code);
  }
  stopping = true;
  await stopGroups([...groups]);
  runCleanups();
  process.exit(code);
}
process.on('exit', () => groups.forEach((pid) => signalGroup(pid, 'SIGKILL')));

// ---------- uitvoeren ----------

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function runShell(cmd, { cwd, timeout, env, logFile }) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (!fs.existsSync(cwd)) {
      const msg = `map bestaat niet: ${cwd}`;
      fs.writeFileSync(logFile, msg + '\n');
      return resolve({ code: 127, ms: 0, tail: [msg], warns: [], timedOut: false });
    }
    const child = spawn(cmd, { cwd, shell: true, detached: true, env: { ...process.env, ...env } });
    if (child.pid) groups.add(child.pid);
    const log = fs.createWriteStream(logFile);
    const tail = [];
    const warns = [];
    const take = (l) => {
      tail.push(l);
      if (tail.length > TAIL_LINES) tail.shift();
      // Adviserende checks melden zich met regels "poort:warn <tekst>": zichtbaar, niet blokkerend.
      if (l.startsWith('poort:warn ')) warns.push(l.slice(11));
    };
    // Per stream een eigen restregel: een halve stdout-regel plakt anders aan stderr vast.
    const reader = () => {
      let buf = '';
      return {
        data: (d) => {
          log.write(d);
          buf += d.toString();
          const parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(take);
        },
        flush: () => buf && take(buf),
      };
    };
    const so = reader();
    const se = reader();
    child.stdout.on('data', so.data);
    child.stderr.on('data', se.data);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroups([child.pid]);
    }, timeout * 1000);
    // De check is klaar, maar iets wat hij op de achtergrond startte (een dev-server,
    // een watcher) houdt de groep levend en stdout open: dat ruimt poort ook op.
    child.on('exit', () => {
      if (groupAlive(child.pid)) stopGroups([child.pid], 1000);
    });
    let done = false;
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      groups.delete(child.pid);
      so.flush();
      se.flush();
      if (extra) take(extra);
      // Pas terugkomen als het log op schijf staat: de uitvoer verwijst ernaar.
      log.end(() => resolve({ code, ms: Date.now() - started, tail: tail.slice(-TAIL_LINES), warns, timedOut }));
    };
    child.on('error', (e) => finish(127, String(e.message)));
    child.on('close', (code) => finish(timedOut ? 124 : code ?? 1));
  });
}

// ---------- slots: zware checks begrenzen over alle worktrees heen ----------

// Tien agents in tien worktrees die tegelijk typechecken of een testsuite
// draaien, laten een laptop swappen of crashen. Een check met "heavy": true
// zet een wachtticket in de gedeelde git-map (.git/poort/slots). Onder een
// korte mutex (mkdir is atomair) mag het oudste wachtticket een slot nemen
// zolang er minder dan N houders zijn: eerlijk op volgorde, en nooit meer dan
// N tegelijk. Tickets van een gestopt proces (of ouder dan 3 uur) tellen niet mee.
const SLOT_MAX_AGE = 3 * 3600 * 1000;
const MUTEX_STALE = 5000;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const heldTickets = new Set();
process.on('exit', () => heldTickets.forEach((t) => fs.rmSync(t, { force: true })));

export function slotLimit(cfg) {
  const n = Number(process.env.POORT_SLOTS || cfg.slots || 3);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

function lockMutex(file) {
  try {
    fs.mkdirSync(file);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > MUTEX_STALE) fs.rmSync(file, { recursive: true, force: true });
    } catch {}
    return false;
  }
}

export async function acquireSlot(store, max, { pollMs = 250, onWait } = {}) {
  const dir = path.join(store, 'slots');
  const mutex = path.join(dir, '.mutex');
  fs.mkdirSync(dir, { recursive: true });
  const base = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const waitFile = path.join(dir, `w-${base}`);
  const holdFile = path.join(dir, `h-${base}`);
  fs.writeFileSync(waitFile, '');
  heldTickets.add(waitFile);
  const started = Date.now();
  let told = false;
  for (;;) {
    if (!lockMutex(mutex)) {
      await sleep(15); // een ander beslist net; meteen opnieuw, geen volle poll
      continue;
    }
    let holders;
    let ahead;
    try {
      const live = fs.readdirSync(dir).filter((t) => {
        const m = t.match(/^[wh]-(\d+)-(\d+)-/);
        if (!m) return false;
        if (Number(m[2]) === process.pid || (alive(Number(m[2])) && Date.now() - Number(m[1]) < SLOT_MAX_AGE)) return true;
        fs.rmSync(path.join(dir, t), { force: true });
        return false;
      });
      holders = live.filter((t) => t.startsWith('h-')).length;
      ahead = live.filter((t) => t.startsWith('w-')).sort().indexOf(`w-${base}`);
      if (holders < max && ahead === 0) {
        fs.renameSync(waitFile, holdFile);
        heldTickets.delete(waitFile);
        heldTickets.add(holdFile);
        const release = () => {
          heldTickets.delete(holdFile);
          fs.rmSync(holdFile, { force: true });
        };
        return { waitMs: Date.now() - started, release };
      }
    } finally {
      fs.rmSync(mutex, { recursive: true, force: true });
    }
    if (!told && onWait) {
      onWait({ holders, max, ahead });
      told = true;
    }
    await sleep(pollMs);
  }
}

// ---------- tijden: waar wachten agents op ----------

const TIMINGS_MAX = 2 * 1024 * 1024;
export function recordTiming(store, row) {
  const file = path.join(store, 'timings.jsonl');
  try {
    fs.mkdirSync(store, { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: Date.now(), ...row }) + '\n');
    if (fs.statSync(file).size > TIMINGS_MAX) {
      const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-5000);
      fs.writeFileSync(file, keep.join('\n') + '\n');
    }
  } catch {}
}

export function timingStats(store, { days = 7 } = {}) {
  const file = path.join(store, 'timings.jsonl');
  if (!fs.existsSync(file)) return [];
  const since = Date.now() - days * 86400000;
  const by = new Map();
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (!r || r.at < since) continue;
    const s = by.get(r.id) || { id: r.id, ran: 0, cached: 0, fail: 0, ms: [], waitMs: 0 };
    if (r.status === 'cached') s.cached++;
    else if (r.status === 'pass' || r.status === 'fail') {
      s.ran++;
      s.ms.push(r.ms || 0);
      if (r.status === 'fail') s.fail++;
    }
    s.waitMs += r.waitMs || 0;
    by.set(r.id, s);
  }
  const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
  return [...by.values()]
    .map((s) => ({ ...s, p50: pct(s.ms, 0.5), p95: pct(s.ms, 0.95), totalMs: s.ms.reduce((a, b) => a + b, 0) + s.waitMs }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

// ---------- prepare: eerst de omgeving, dan de checks ----------

// Een verse worktree heeft geen node_modules en geen .env; dan faalt elke check
// op iets wat niets met de wijziging te maken heeft. prepare draait alleen als
// het nodig is: het `creates`-pad ontbreekt, of een `when`-bestand (lockfile)
// is veranderd sinds de vorige keer in déze worktree. Bestaat `creates` al maar
// is er nog geen stempel, dan geldt de huidige stand als geïnstalleerd.
export function prepareNeed(top, gitDir, p) {
  const stampFile = path.join(gitDir, 'poort', 'prepare', p.id.replace(/[^\w.-]/g, '_'));
  const h = createHash('sha256').update(p.run + '\0');
  for (const f of p.when) {
    const abs = path.join(top, f);
    h.update(`${f}\0${fs.existsSync(abs) ? fs.readFileSync(abs) : ''}\0`);
  }
  const stamp = h.digest('hex').slice(0, 32);
  const prev = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : null;
  const missing = p.creates && !fs.existsSync(path.join(top, p.creates));
  if (missing) return { need: true, why: `${p.creates} ontbreekt`, stamp, stampFile };
  if (!p.when.length) return { need: false, stamp, stampFile };
  if (prev === null) {
    if (p.creates) {
      fs.mkdirSync(path.dirname(stampFile), { recursive: true });
      fs.writeFileSync(stampFile, stamp);
      return { need: false, stamp, stampFile };
    }
    return { need: true, why: 'nog nooit gedraaid in deze worktree', stamp, stampFile };
  }
  return prev === stamp ? { need: false, stamp, stampFile } : { need: true, why: `${p.when.join(', ')} gewijzigd`, stamp, stampFile };
}

export async function runPrepare(top, cfg) {
  if (!cfg.prepare.length || process.env.POORT_NO_PREPARE) return 0;
  const { gitDir, store } = repoInfo(top);
  const logDir = logDirOf(gitDir);
  let header = false;
  for (const p of cfg.prepare) {
    if (p.if && sh(p.if, path.join(top, p.cwd)).status !== 0) continue; // hoort niet bij deze repo (bijv. geen package-lock.json)
    let st = prepareNeed(top, gitDir, p);
    if (!st.need) continue;
    // Twee agents in dezelfde worktree: één installeert, de ander wacht.
    const lock = `${st.stampFile}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    for (;;) {
      try {
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
        break;
      } catch {
        const pid = Number(fs.readFileSync(lock, 'utf8') || 0);
        if (!alive(pid)) fs.rmSync(lock, { force: true });
        else await sleep(500);
      }
    }
    try {
      st = prepareNeed(top, gitDir, p); // de ander kan het net gedaan hebben
      if (!st.need) continue;
      if (!header) out('poort prepare');
      header = true;
      fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, `prepare-${p.id}.log`);
      const r = await runShell(p.run, { cwd: path.join(top, p.cwd), timeout: p.timeout, logFile, env: {} });
      recordTiming(store, { id: `prepare:${p.id}`, status: r.code === 0 ? 'pass' : 'fail', ms: r.ms, wt: path.basename(top) });
      if (r.code !== 0) {
        out(`  ✗ ${p.id}  exit ${r.code} · ${st.why}`);
        for (const l of r.tail) out(`    │ ${l}`);
        out(`    log:  ${path.relative(top, logFile)}`);
        return 1;
      }
      fs.writeFileSync(st.stampFile, prepareNeed(top, gitDir, p).stamp);
      out(`  ✓ ${p.id}  ${(r.ms / 1000).toFixed(1)}s · ${st.why}`);
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }
  return 0;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Plant welke checks draaien. Pure functie, los testbaar.
export function plan(cfg, { tier, changed, all, skip = [] }) {
  return cfg.checks
    .filter((c) => c.tier === tier)
    .map((c) => {
      const hits = changed.filter((f) => matches(c, f));
      if (skip.includes('all') || skip.includes(c.id)) return { check: c, action: 'skip', reason: 'POORT_SKIP' };
      // "all": false = niet in --all draaien, bijv. pre-commit-hooks die bestanden
      // zelf repareren: op de hele repo zou dat ongevraagd code herschrijven.
      if (all && c.all === false) return { check: c, action: 'skip', reason: 'niet in --all (wijzigt bestanden)' };
      if (!all && !hits.length) return { check: c, action: 'idle' };
      return { check: c, action: 'run', hits };
    });
}

export async function runTier(top, cfg, opts) {
  const { store, gitDir } = repoInfo(top);
  const { tier } = opts;
  const planned = plan(cfg, opts).filter((p) => p.action !== 'idle');
  if (!planned.length) {
    out(`poort ${tier}: niets te doen (geen check raakt de wijziging)`);
    return 0;
  }
  const blobs = contentIndex(top);
  const logDir = logDirOf(gitDir);
  fs.mkdirSync(logDir, { recursive: true });
  const width = Math.max(...planned.map((p) => p.check.id.length));
  const limit = Math.max(2, Math.floor(os.cpus().length / 2));

  const results = await pool(planned, limit, async (p) => {
    const c = p.check;
    if (p.action === 'skip') return { c, status: 'skip', reason: p.reason };
    // Eerst: test e2e wel de gecontroleerde stack? Anders telt ook een oud
    // groen bewijs niet.
    const url = e2eUrlStatus(c);
    if (!url.ok) return { c, status: 'skip', reason: url.reason };
    const key = checkKey(c, blobs, opts.base, keyContext(top, c));
    const prev = readReceipt(store, c.id, key);
    if (prev?.ok && !opts.noCache && c.cache !== false) return { c, status: 'cached', key };
    if (c.if) {
      const pre = sh(c.if, path.join(top, c.cwd));
      if (pre.status !== 0) return { c, status: 'skip', reason: c.ifHint ? `voorwaarde niet voldaan: ${c.ifHint}` : `voorwaarde niet voldaan: ${c.if}` };
    }
    // `if` zegt of de check hier hoort; `needs` zegt wat hij nodig heeft om te draaien.
    // Een ontbrekende tool is rood, nooit "overgeslagen": anders lijkt een check die
    // niet kon draaien groen.
    if (c.needs && sh(c.needs, path.join(top, c.cwd)).status !== 0) {
      const logFile = path.join(logDir, `${c.id}.log`);
      const msg = `tool ontbreekt (${c.needs})${c.needsHint ? `; installeer: ${c.needsHint}` : ''}`;
      fs.writeFileSync(logFile, msg + '\n');
      return { c, status: 'fail', code: 127, ms: 0, tail: [msg], logFile, cmd: c.needs, warns: [] };
    }
    if (c.stack.length && opts.noStack) return { c, status: 'skip', reason: '--no-stack' };
    if (c.stack.length) {
      const st = checkStackStatus(top, c);
      if (!st.ok) return { c, status: 'skip', reason: st.reason };
    }
    const cwd = path.join(top, c.cwd);
    const fullBy = opts.all ? null : (p.hits || []).find((f) => fullTrigger(c, f));
    const hits = (opts.all || fullBy ? [...blobs.keys()] : p.hits || []).filter((f) => fileArg(c, f));
    // Verwijderde bestanden alleen met "deleted": true: een linter struikelt over een
    // pad dat niet bestaat, een test-selector moet juist weten wat er weg is.
    const rel = hits
      .filter((f) => c.deleted || fs.existsSync(path.join(top, f)))
      .map((f) => path.relative(cwd, path.join(top, f)))
      .filter((f) => !f.startsWith('..'));
    if (c.run.includes('{files}') && !rel.length) return { c, status: 'skip', reason: 'geen bestaande bestanden binnen ' + c.cwd };
    const cmd = c.run
      .replaceAll('{files}', rel.map(shq).join(' '))
      .replaceAll('{base}', opts.base || 'HEAD')
      .replaceAll('{poort}', shq(path.dirname(fileURLToPath(import.meta.url))))
      .replaceAll('{worktree}', worktreeSlug(top));
    const logFile = path.join(logDir, `${c.id}.log`);
    const slot =
      c.heavy && !isCI()
        ? await acquireSlot(store, slotLimit(cfg), {
            onWait: ({ holders, max, ahead }) => out(`  … ${c.id} wacht op een slot (${holders}/${max} bezet${ahead ? `, ${ahead} vóór je` : ''})`),
          })
        : null;
    // POORT_STAGED alleen in de echte commit-hook: dan telt de gestagede diff,
    // anders (run, pre-push) de werkboom tegen de base.
    let r;
    try {
      const env = { POORT_TIER: tier, POORT_BASE: opts.base || '', POORT_BASE_REF: opts.baseRef || process.env.POORT_BASE_REF || '', POORT_STAGED: opts.staged ? '1' : '', ...e2eEnv(c) };
      r = await runShell(cmd, { cwd, timeout: c.timeout, logFile, env });
    } finally {
      slot?.release();
    }
    r.waitMs = slot?.waitMs || 0;
    if (r.code === 0) writeReceipt(store, c.id, key, { ok: true, ms: r.ms, tier, warns: r.warns });
    return { c, status: r.code === 0 ? 'pass' : 'fail', ...r, logFile, cmd, fullBy };
  });

  // Afgebroken (Ctrl-C, SIGTERM): de checks zijn gestopt, niet gefaald. Geen
  // rapport en geen metingen; shutdown() rondt af met de juiste exitcode.
  if (stopping) return 1;
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const waited = (r) => (r.waitMs > 250 ? ` (wachtte ${secs(r.waitMs)} op een slot)` : '') + (r.fullBy ? ` · alle bestanden (${r.fullBy} gewijzigd)` : '');
  const counts = { pass: 0, cached: 0, fail: 0, skip: 0 };
  for (const r of results) {
    if (r.status !== 'skip') recordTiming(store, { id: r.c.id, tier, status: r.status, ms: r.ms || 0, waitMs: r.waitMs || 0, wt: path.basename(top) });
  }
  out(`poort ${tier}`);
  for (const r of results) {
    counts[r.status]++;
    const id = r.c.id.padEnd(width);
    if (r.status === 'pass') out(`  ✓ ${id}  ${secs(r.ms)}${waited(r)}`);
    else if (r.status === 'cached') out(`  ✓ ${id}  cached`);
    if (r.status === 'pass' || r.status === 'cached') {
      const w = r.warns || readReceipt(store, r.c.id, r.key)?.warns || [];
      for (const m of w.slice(0, 8)) out(`    ! ${m}`);
      if (w.length > 8) out(`    ! … nog ${w.length - 8} (log: ${path.relative(top, path.join(logDir, r.c.id + '.log'))})`);
    }
    else if (r.status === 'skip') out(`  ↷ ${id}  overgeslagen: ${r.reason}`);
    else {
      out(`  ✗ ${id}  ${r.timedOut ? `timeout na ${r.c.timeout}s` : `exit ${r.code}`} · ${secs(r.ms)}${waited(r)}`);
      for (const l of r.tail) out(`    │ ${l}`);
      out(`    log:  ${path.relative(top, r.logFile).startsWith('..') ? r.logFile : path.relative(top, r.logFile)}`);
      if (r.c.hint) out(`    tip:  ${r.c.hint}`);
      if (process.env.GITHUB_ACTIONS) out(`::error title=poort ${r.c.id}::${r.c.id} faalde (exit ${r.code})`);
    }
  }
  const sum = [`${counts.pass + counts.cached} ✓`, counts.cached && `(${counts.cached} cached)`, counts.fail && `${counts.fail} ✗`, counts.skip && `${counts.skip} ↷`]
    .filter(Boolean)
    .join(' ');
  out(`poort ${tier}: ${sum}${counts.fail ? ' · geblokkeerd' : ''}`);
  pruneReceipts(store);
  return counts.fail ? 1 : 0;
}

// ---------- unstaged wijzigingen opzij tijdens de commit-hook ----------

// Zoals pre-commit: de hook moet testen wat er gecommit wordt, niet wat er nog
// los in de working tree staat. Patch opzij, na afloop terug.
// Vaste prefixen: met diff.noprefix in de gitconfig zou git apply de patch anders
// niet meer terugzetten. Submodules kan `checkout -- .` niet terugdraaien: buiten de patch.
const PATCH_ARGS = ['diff', '--binary', '--no-color', '--no-ext-diff', '--ignore-submodules', '--src-prefix=a/', '--dst-prefix=b/'];

// Patches van een eerdere hook die hard gestopt is (SIGKILL, stroom eraf): dat
// werk staat alleen nog daar, dus poort meldt het tot iemand het terugzet.
export function strandedPatches(gitDir) {
  const dir = path.join(gitDir, 'poort');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => {
      const m = f.match(/^unstaged-(\d+)(\.fixes)?\.patch$/);
      return m && !alive(Number(m[1]));
    })
    .map((f) => path.join(dir, f));
}

export async function withStagedOnly(top, gitDir, fn) {
  for (const f of strandedPatches(gitDir)) err(`poort: niet teruggezet werk van een afgebroken hook staat in ${f} (git apply ${shq(f)}, daarna verwijderen).`);
  if (process.env.POORT_NO_STASH) return fn();
  const patch = git(PATCH_ARGS, { cwd: top });
  if (!patch.trim()) return fn();
  const file = path.join(gitDir, 'poort', `unstaged-${process.pid}.patch`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, patch);
  // De gestagede stand bij de start: een fixer die zelf `git add` doet, verandert
  // ook de index, en dan is werkboom-tegen-index geen beeld meer van zijn wijziging.
  const staged = git(['write-tree'], { cwd: top, allowFail: true }).trim();
  git(['checkout', '--', '.'], { cwd: top });
  const apply = () => spawnSync('git', ['apply', '--whitespace=nowarn', file], { cwd: top, encoding: 'utf8' }).status === 0;
  const restore = () => {
    if (apply()) return fs.rmSync(file, { force: true });
    // Een fixer (of een andere agent in deze worktree) heeft intussen dezelfde
    // bestanden aangepast. Zoals pre-commit: die wijzigingen opzij, bewaard en
    // niet weggegooid, en dan het eigen werk terug op de gestagede stand van de start.
    const fixes = file.replace(/\.patch$/, '.fixes.patch');
    fs.writeFileSync(fixes, git([...PATCH_ARGS, ...(staged ? [staged] : [])], { cwd: top }));
    if (staged) git(['read-tree', staged], { cwd: top });
    git(['checkout', '--', '.'], { cwd: top });
    if (apply()) {
      fs.rmSync(file, { force: true });
      err(`poort: wijzigingen tijdens de hook botsten met je niet-gestagede werk. Je werk staat terug; de wijzigingen van de hook staan in ${fixes}.`);
    } else err(`poort: kon niet-gestagede wijzigingen niet terugzetten. Ze staan in ${file} (git apply ${shq(file)}).`);
  };
  // Ook bij Ctrl-C, SIGTERM (agent-timeout) en SIGHUP: shutdown() stopt eerst de checks, dan dit.
  cleanups.add(restore);
  try {
    return await fn();
  } finally {
    // Tijdens afsluiten doet shutdown() dit, pas als alle checks echt gestopt zijn.
    if (!stopping && cleanups.delete(restore)) restore();
  }
}

// ---------- verify ----------

// Bewijs is nodig voor de checks die de branch raakt (base..HEAD), net zoals
// `run` ze plant. Een check die de branch niet raakt, staat zoals op de base;
// bewijs daarvoor eisen zou een docs-PR voorgoed blokkeren, want `run push`
// heeft daar niets te doen.
export function verify(top, cfg, { tiers = TIERS, ref = 'HEAD', base = null } = {}) {
  const { store } = repoInfo(top);
  const blobs = treeIndex(top, ref);
  const changed = refExists(top, ref) ? nul(git(['diff', '--name-only', '--no-renames', '-z', base || EMPTY_TREE, ref], { cwd: top })) : [];
  const rows = [];
  for (const c of cfg.checks.filter((c) => tiers.includes(c.tier) && c.required)) {
    if (!changed.some((f) => matches(c, f))) continue;
    const url = e2eUrlStatus(c);
    if (!url.ok) {
      rows.push({ id: c.id, ok: false, reason: `geen bewijs: ${url.reason}` });
      continue;
    }
    const key = checkKey(c, blobs, base, keyContext(top, c));
    const r = readReceipt(store, c.id, key);
    if (r?.ok) {
      rows.push({ id: c.id, ok: true });
      continue;
    }
    if (c.if && sh(c.if, path.join(top, c.cwd)).status !== 0) {
      rows.push({ id: c.id, ok: null, reason: 'n.v.t. hier (voorwaarde)' });
      continue;
    }
    if (c.needs && sh(c.needs, path.join(top, c.cwd)).status !== 0) {
      rows.push({ id: c.id, ok: false, reason: `tool ontbreekt: ${c.needsHint || c.needs}` });
      continue;
    }
    // Een stack die niet draait, maakt een verplichte check niet overbodig: anders
    // opent de PR-poort door de app simpelweg niet te starten. Dekt CI hem, zet
    // dan "required": false.
    if (c.stack.length && !stackStatus(top, c.stack).ok) {
      rows.push({ id: c.id, ok: false, reason: `geen bewijs: ${stackStatus(top, c.stack).reason}; start je stack en draai run push, of zet "required": false als CI dit dekt` });
      continue;
    }
    rows.push({ id: c.id, ok: false, reason: 'geen groene receipt voor deze commit' });
  }
  return rows;
}

// ---------- init / doctor ----------

const HOOK_MARK = '# poort-hook';
// De hook die er vóór poort stond, draait eerst mee: bewaren zonder draaien zou
// stil een controle weghalen. Uitzondering: de hook van het pre-commit-framework
// als poort zelf al `pre-commit run` als check heeft (anders alles dubbel).
// pre-push krijgt de refs op stdin; beide hooks hebben ze nodig, dus eerst bufferen.
const hookScript = (name) => {
  const push = name === 'pre-push';
  const feed = push ? `printf '%s\\n' "$input" | ` : '';
  return `#!/bin/sh
${HOOK_MARK} v2 — gegenereerd door poort init; niet met de hand bewerken.
top="$(git rev-parse --show-toplevel)"
prev="$(dirname "$0")/${name}.pre-poort"
${push ? 'input="$(cat)"\n' : ''}if [ ! -f "$top/.poort/poort.mjs" ]; then
  # Branch of worktree zonder poort: alleen de vorige hook.
  if [ -x "$prev" ]; then ${feed}"$prev" "$@"; exit $?; fi
  echo "poort: .poort/poort.mjs ontbreekt op deze branch; ${name} overgeslagen."
  exit 0
fi
if [ -x "$prev" ] && ! { grep -q 'pre-commit.com' "$prev" && grep -qs 'pre-commit run' "$top/poort.config.json"; }; then
  ${feed}"$prev" "$@" || exit $?
fi
if ! command -v node >/dev/null 2>&1; then
  echo "poort: node niet gevonden in PATH (git-client zonder je shell-profiel?). Zie README, 'Problemen oplossen'." >&2
  exit 1
fi
${feed}exec node "$top/.poort/poort.mjs" hook ${name} "$@"
`;
};

// Husky (core.hooksPath = .husky/_) schrijft .husky/_ bij elke npm install opnieuw;
// daar kan poort niet in. De hooks die je zelf commit (.husky/pre-commit) wel.
const huskyLine = (name) => `${HOOK_MARK}\n[ ! -f .poort/poort.mjs ] || node .poort/poort.mjs hook ${name} "$@"`;
const usesHusky = (top) => /(^|[\\/])\.husky([\\/]|$)/.test(git(['config', 'core.hooksPath'], { cwd: top, allowFail: true }).trim());

// De instructie volgt de config: geen e2e-regels in een repo zonder e2e-check.
export function agentBlock(cfg) {
  const e2e = (cfg?.checks || []).some((c) => c.type === 'e2e');
  const prepare = (cfg?.prepare || []).length > 0;
  return [
    '<!-- poort:start -->',
    '## Quality gate (poort)',
    '',
    `- Klaar = \`node .poort/poort.mjs run push\` groen. Draai het vóór je "klaar" zegt; ongewijzigde checks zijn cached en kosten niets.${prepare ? ' Dependencies uit de lockfile installeert poort zelf (prepare).' : ''} "Wacht op een slot" betekent dat andere agents zware checks draaien: niet afbreken.`,
    '- Rood: lees alleen de getoonde staart en het logpad, fix alles in één ronde, draai opnieuw.',
    '- `↷ overgeslagen` is geen groen: noem het in je eindrapport.',
    ...(e2e
      ? [
          '- UI-wijziging: bekijk de app eerst via de e2e-MCP (`open_session`, `observe`) en schrijf of update een test in `tests/*.e2e.ts` van de e2e-map: één `agent.act` per doel, dan een exacte `expect`.',
          '- e2e-replay rood na een bewuste UI-wijziging: `node .poort/poort.mjs e2e --record`, stage `.e2e/cache/`.',
        ]
      : []),
    '- Nooit `--no-verify`. Overslaan alleen met reden en alleen de check die het betreft: `POORT_SKIP=<id> git commit ...` (commit-check) of `POORT_SKIP=<id> git push` (push-check).',
    '- Vóór een PR: commit alles, dan `node .poort/poort.mjs verify`. Het bewijs moet bij de commit horen; niet-gecommitte wijzigingen tellen niet.',
    '<!-- poort:end -->',
  ].join('\n');
}

function hooksDir(top) {
  if (usesHusky(top)) return path.join(top, '.husky');
  return path.resolve(top, git(['rev-parse', '--git-path', 'hooks'], { cwd: top }).trim());
}

function installHooks(top) {
  const dir = hooksDir(top);
  fs.mkdirSync(dir, { recursive: true });
  const done = [];
  if (usesHusky(top)) {
    for (const name of Object.keys(HOOK_TIER)) {
      const p = path.join(dir, name);
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (!cur.includes(HOOK_MARK)) fs.writeFileSync(p, `${cur.replace(/\s*$/, '')}${cur.trim() ? '\n\n' : ''}${huskyLine(name)}\n`, { mode: 0o755 });
      done.push(`${name} (husky: regel in .husky/${name}; commit dat bestand)`);
    }
    return { dir, done };
  }
  for (const name of Object.keys(HOOK_TIER)) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && !fs.readFileSync(p, 'utf8').includes(HOOK_MARK)) {
      fs.renameSync(p, `${p}.pre-poort`);
      done.push(`${name} (oude hook bewaard als ${name}.pre-poort)`);
    } else done.push(name);
    fs.writeFileSync(p, hookScript(name), { mode: 0o755 });
  }
  return { dir, done };
}

function upsertBlock(file, block) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = /<!-- poort:start -->[\s\S]*?<!-- poort:end -->/;
  const next = re.test(cur) ? cur.replace(re, block) : `${cur.replace(/\s*$/, '')}${cur ? '\n\n' : ''}${block}\n`;
  if (next !== cur) fs.writeFileSync(file, next);
}

// Welke e2e-versie de repo zelf gebruikt: de geïnstalleerde, anders die uit package.json.
function e2eVersion(top, dir) {
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const installed = read(path.join(top, dir, 'node_modules', 'e2e', 'package.json'))?.version;
  if (installed) return installed;
  const pkg = read(path.join(top, dir, 'package.json'));
  const spec = pkg?.devDependencies?.e2e || pkg?.dependencies?.e2e;
  return String(spec || '').match(/\d+\.\d+\.\d+/)?.[0] || null;
}

// e2e-MCP voor het team: de agent opent de app in een browser, kijkt (observe)
// en test locators voordat hij een test schrijft. Samenvoegen, nooit overschrijven.
// Alleen als de e2e-check hier echt geldt, en vastgepind op de versie die de
// repo zelf gebruikt: geen ongepind pakket dat npx bij elke start ophaalt.
function registerE2EMcp(top, check) {
  const dir = check.cwd || '.';
  const cwd = path.join(top, dir);
  const applies = check.if ? sh(check.if, cwd).status === 0 : ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js'].some((f) => fs.existsSync(path.join(cwd, f)));
  if (!applies) {
    out(`· e2e-MCP niet geregistreerd: de e2e-check geldt hier niet (${check.ifHint || check.if || `geen e2e.config in ${dir}`})`);
    return;
  }
  const version = e2eVersion(top, dir);
  if (!version) {
    out(`· e2e-MCP niet geregistreerd: e2e staat niet in ${path.posix.join(dir, 'package.json')} (npm i -D e2e @e2e-dev/web)`);
    return;
  }
  const args = ['-y', `e2e@${version}`, 'mcp', ...(dir !== '.' ? ['--config', path.posix.join(dir, 'e2e.config.ts')] : [])];
  for (const [rel, client] of [['.mcp.json', 'Claude Code'], [path.join('.cursor', 'mcp.json'), 'Cursor']]) {
    const file = path.join(top, rel);
    let json = {};
    if (fs.existsSync(file)) {
      try {
        json = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        out(`! ${rel} is geen geldige JSON; e2e-MCP niet toegevoegd`);
        continue;
      }
    }
    json.mcpServers = json.mcpServers || {};
    const cur = json.mcpServers.e2e;
    const want = { command: 'npx', args };
    if (cur && JSON.stringify(cur) === JSON.stringify(want)) {
      out(`· e2e-MCP staat al in ${rel}`);
      continue;
    }
    // Eerder door poort gezet, maar ongepind of op een andere versie: bijwerken.
    // Een eigen instelling (ander commando) laten we staan.
    const ours = cur?.command === 'npx' && Array.isArray(cur.args) && cur.args.some((a) => a === 'e2e' || /^e2e@/.test(a));
    if (cur && !ours) {
      out(`· e2e-MCP staat al in ${rel} (eigen instelling, niet aangepast)`);
      continue;
    }
    json.mcpServers.e2e = want;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    out(cur ? `✓ e2e-MCP in ${rel} vastgepind op e2e@${version} (${client})` : `✓ e2e-MCP in ${rel}, e2e@${version} (${client})`);
  }
  out(`· Codex: registreer de e2e-MCP in ~/.codex/config.toml:\n    [mcp_servers.e2e]\n    command = "npx"\n    args = ${JSON.stringify(args)}`);
  out('· e2e-skill voor je agent (hoe je tests schrijft): npx skills add tester-army/e2e');
}

// Agent-hooks voor Claude Code en Cursor, samengevoegd met wat er al staat:
//   - PR-poort: `gh pr create` en `gh pr ready` gaan pas door als verify groen
//     is en de PR-tekst klopt;
//   - format-on-edit (alleen met "format" in de config): elk bewerkt bestand
//     direct formatteren, zodat de agent er geen beurt aan kwijt is.
const AGENT_HOOKS = [
  {
    name: 'PR-poort',
    script: 'pr-gate.mjs',
    claude: { event: 'PreToolUse', matcher: 'Bash' },
    // Breed: pr-gate leest het commando zelf zoals de shell (ook `gh pr "create"`).
    cursor: { event: 'beforeShellExecution', matcher: '\\bgh\\b' },
  },
  {
    name: 'format-on-edit',
    script: 'format-on-edit.mjs',
    when: (cfg) => (cfg?.format || []).length > 0,
    claude: { event: 'PostToolUse', matcher: 'Write|Edit|MultiEdit' },
    cursor: { event: 'afterFileEdit' },
  },
];

function registerAgentHooks(top, cfg) {
  const readJson = (file) => {
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const writeJson = (file, json) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  };
  // Een item is van poort als het commando naar .poort/integrations/<script> wijst.
  // Zo'n item brengt init naar de huidige vorm (event, matcher, command), ook als
  // een oudere versie het anders zette: met een verouderde matcher zag Cursor
  // `gh pr "create"` niet. Items van anderen blijven onaangeroerd.
  const ours = (command, h) => typeof command === 'string' && command.includes(`.poort/integrations/${h.script}`);
  const targets = [
    {
      rel: path.join('.claude', 'settings.json'),
      client: 'Claude Code',
      event: (h) => h.claude.event,
      entry: (h) => ({ matcher: h.claude.matcher, hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.poort/integrations/${h.script}"` }] }),
      // Groepen bundelen hooks; staat ons commando naast een vreemd commando, dan
      // gaat alleen het onze eruit en blijft de groep van de ander staan.
      strip(list, h) {
        let at = -1;
        const kept = [];
        list.forEach((group) => {
          const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
          const rest = hooks.filter((x) => !ours(x?.command, h));
          if (rest.length === hooks.length) return kept.push(group);
          if (rest.length) kept.push({ ...group, hooks: rest });
          // Plek in de opgeschoonde lijst: waar de eigen groep stond, of direct
          // na de gedeelde groep die blijft.
          if (at < 0) at = kept.length;
        });
        return { kept, at };
      },
    },
    {
      rel: path.join('.cursor', 'hooks.json'),
      client: 'Cursor',
      event: (h) => h.cursor.event,
      entry: (h) => ({ command: `node .poort/integrations/${h.script}`, ...(h.cursor.matcher ? { matcher: h.cursor.matcher } : {}) }),
      strip(list, h) {
        const at = list.findIndex((x) => ours(x?.command, h));
        return { kept: list.filter((x) => !ours(x?.command, h)), at };
      },
    },
  ];
  for (const t of targets) {
    const file = path.join(top, t.rel);
    const json = readJson(file);
    if (json === null) {
      out(`! ${t.rel} is geen geldige JSON; agent-hooks niet toegevoegd`);
      continue;
    }
    const start = JSON.stringify(json);
    for (const h of AGENT_HOOKS) {
      const wanted = !h.when || h.when(cfg);
      const before = JSON.stringify(json);
      // Overal weghalen (een oudere versie kan een ander event gebruikt hebben),
      // en terugzetten op de plek waar het stond, zodat de volgorde blijft.
      let place = null;
      const emptied = [];
      for (const [event, list] of Object.entries(json.hooks || {})) {
        if (!Array.isArray(list)) continue;
        const { kept, at } = t.strip(list, h);
        if (at < 0) continue;
        if (place === null) place = { event, at };
        json.hooks[event] = kept;
        if (!kept.length) emptied.push(event);
      }
      if (wanted) {
        const event = t.event(h);
        if (t.rel.includes('.cursor')) json.version = json.version || 1;
        json.hooks = json.hooks || {};
        const list = (json.hooks[event] = json.hooks[event] || []);
        list.splice(place?.event === event ? Math.min(place.at, list.length) : list.length, 0, t.entry(h));
      }
      // Pas nu lege lijsten weg: eerder weghalen en opnieuw toevoegen zou de
      // sleutel naar achteren schuiven, en dan verschilt elke run het bestand.
      for (const event of emptied) if (!json.hooks[event]?.length) delete json.hooks[event];
      if (JSON.stringify(json) === before) {
        if (wanted) out(`· ${h.name} staat al in ${t.rel}`);
      } else if (!wanted) out(`✓ ${h.name} weg uit ${t.rel}: geen "format" in de config`);
      else out(place ? `✓ ${h.name} bijgewerkt in ${t.rel} (${t.client})` : `✓ ${h.name} in ${t.rel} (${t.client})`);
    }
    if (JSON.stringify(json) !== start) writeJson(file, json);
  }
}

// Welk meegeleverd profiel past bij deze repo, en waar staat de webapp (package.json)?
// Alleen bestanden op het hoogste niveau en één map diep: een monorepo met meerdere
// apps krijgt geen gok, maar een expliciet profiel.
export function detectStack(top) {
  const has = (f) => fs.existsSync(path.join(top, f));
  const entries = fs.readdirSync(top, { withFileTypes: true });
  const python =
    ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'manage.py'].some(has) ||
    entries.some((e) => e.isFile() && /^requirements.*\.txt$/.test(e.name));
  const webDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .filter((e) => fs.existsSync(path.join(top, e.name, 'package.json')))
    .map((e) => e.name)
    .sort();
  const web = has('package.json') ? '.' : webDirs.length === 1 ? webDirs[0] : null;
  const profile = python && web ? 'fullstack' : web ? 'node' : python ? 'python' : null;
  const reason = [python && 'Python', web && `package.json in ${web === '.' ? 'de root' : `${web}/`}`].filter(Boolean).join(' + ');
  return { profile, web, reason, python, webDirs };
}

// Waar gaan de PR's van deze repo naartoe? De meest gebruikte base van de
// laatste gemergde PR's (via gh). Een repo die naar acceptance of development
// merget, vergelijkt anders met origin/main en sleept de hele promotie-delta mee.
export function detectPrBase(top) {
  const r = spawnSync(process.env.POORT_GH || 'gh', ['pr', 'list', '--state', 'merged', '--limit', '30', '--json', 'baseRefName', '--jq', '.[].baseRefName'], {
    cwd: top,
    encoding: 'utf8',
    timeout: 20000,
  });
  if (r.status !== 0) return null;
  const counts = new Map();
  for (const b of lines(r.stdout)) counts.set(b, (counts.get(b) || 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && refExists(top, `origin/${best[0]}`) ? `origin/${best[0]}` : null;
}

export function fillWeb(cfg, web) {
  const prefix = web === '.' ? '' : `${web.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`;
  const fill = (v) =>
    typeof v === 'string' ? v.replaceAll('{web/}', prefix).replaceAll('{web}', web)
    : Array.isArray(v) ? v.map(fill)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
    : v;
  return fill(cfg);
}

function cmdInit(args) {
  const { top } = repoInfo();
  const self = fileURLToPath(import.meta.url);
  // --web <map> en --base <ref> nemen een waarde; die is geen profielnaam.
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const values = new Set(['--web', '--base'].filter((f) => args.includes(f)).map((f) => args.indexOf(f) + 1));
  const profile = args.find((a, i) => !a.startsWith('-') && !values.has(i));
  const webArg = valueOf('--web');
  const baseArg = valueOf('--base');
  const force = args.includes('--force');
  // Eerst alles controleren, dan pas schrijven: een mislukte init laat niets achter.
  if (fs.existsSync(path.join(top, 'profiles')) && path.resolve(top) === path.resolve(path.dirname(self))) {
    err('poort init: dit is de poort-repo zelf. Draai init in de repo die je wilt beschermen.');
    return 2;
  }
  const cfgFile = path.join(top, 'poort.config.json');
  const stackInfo = detectStack(top);
  if (webArg && !fs.existsSync(path.join(top, webArg, 'package.json'))) {
    err(`poort init: --web ${webArg}: daar staat geen package.json`);
    return 2;
  }
  const web = webArg || stackInfo.web;
  const chosen = profile || (webArg ? (stackInfo.python ? 'fullstack' : 'node') : stackInfo.profile);
  const writeCfg = !fs.existsSync(cfgFile) || force;
  let cfgText = null;
  let src = null;
  if (writeCfg) {
    if (!chosen) {
      err('poort init: geen stack herkend. Geef een profiel: node, python, fullstack, of een pad naar een eigen .json.');
      return 2;
    }
    // Een naam zonder / of .json is een meegeleverd profiel, ook als er toevallig een map zo heet.
    src = /[\\/]|\.json$/.test(chosen) ? path.resolve(chosen) : path.join(path.dirname(self), 'profiles', `${chosen}.json`);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      err(`poort init: profiel niet gevonden: ${chosen} (meegeleverd: node, python, fullstack)`);
      return 2;
    }
    // Generieke profielen: {web} is de map met package.json, {web/} het regex-voorvoegsel voor `when`.
    // Nooit stil de root als de webapp onduidelijk is: dan tellen typecheck en
    // vitest als "n.v.t." en staat de poort open.
    const raw = fs.readFileSync(src, 'utf8');
    if (raw.includes('{web') && !web) {
      err(
        stackInfo.webDirs.length > 1
          ? `poort init: meerdere mappen met een package.json (${stackInfo.webDirs.join(', ')}); kies de webapp met --web <map>`
          : `poort init: profiel ${chosen} verwacht een webapp, maar er is geen package.json in de root of één map diep; geef --web <map> of kies een ander profiel`,
      );
      return 2;
    }
    const parsed = raw.includes('{web') ? fillWeb(parseJson(src, raw), web) : parseJson(src, raw);
    // De PR-base: --base, anders de meest gebruikte base van recente PR's.
    const base = baseArg || (parsed.base ? null : detectPrBase(top));
    if (base) parsed.base = base;
    normalizeConfig(structuredClone(parsed));
    cfgText = raw.includes('{web') || base ? JSON.stringify(parsed, null, 2) + '\n' : raw;
    if (base) out(`✓ base: ${base}${baseArg ? '' : " (de meest gebruikte base van de laatste gemergde PR's)"}`);
  } else {
    // Bestaande config zonder base: alleen melden, niet ongevraagd herschrijven.
    let current = null;
    try {
      current = loadConfig(top);
    } catch {}
    const prBase = current && !current.base ? baseArg || detectPrBase(top) : null;
    if (prBase && baseInfo(top, current).ref !== prBase) {
      out(`! base: PR's gaan naar ${prBase}, maar poort vergelijkt met ${baseInfo(top, current).ref || 'de vorige commit'}; zet "base": "${prBase}" in poort.config.json`);
    }
  }
  const vendored = path.join(top, '.poort', 'poort.mjs');
  if (path.resolve(self) !== path.resolve(vendored)) {
    fs.mkdirSync(path.dirname(vendored), { recursive: true });
    fs.copyFileSync(self, vendored);
    // Lichtgewicht checks en agent-integraties reizen mee, zodat profielen en
    // hooks ze vanuit de repo kunnen aanroepen (ook in cloud-agents zonder netwerk).
    const extra = ['checks', 'integrations'].filter((d) => fs.existsSync(path.join(path.dirname(self), d)));
    for (const d of extra) {
      const dest = path.join(top, '.poort', d);
      fs.rmSync(dest, { recursive: true, force: true }); // verwijderde checks niet laten hangen
      fs.cpSync(path.join(path.dirname(self), d), dest, { recursive: true });
    }
    out(`✓ .poort/poort.mjs (v${VERSION})${extra.map((d) => ` + .poort/${d}/`).join('')}`);
  }
  if (writeCfg) {
    fs.writeFileSync(cfgFile, cfgText);
    const why = profile ? '' : ` — herkend: ${stackInfo.reason}`;
    out(`✓ poort.config.json (uit ${path.basename(src)}${why})`);
  } else out('· poort.config.json bestaat al (--force om te vervangen)');
  // --no-hooks: alles behalve de git-hooks. Nodig in een worktree, want die deelt
  // de hooks-map met de hoofdclone en alle andere worktrees.
  if (args.includes('--no-hooks')) out('· hooks niet geïnstalleerd (--no-hooks); later: node .poort/poort.mjs init');
  else {
    const h = installHooks(top);
    out(`✓ hooks in ${path.relative(top, h.dir) || h.dir}: ${h.done.join(', ')}`);
  }
  const cfgNow = loadConfig(top);
  const e2eCheck = (cfgNow?.checks || []).find((c) => c.type === 'e2e');
  if (e2eCheck) registerE2EMcp(top, e2eCheck);
  registerAgentHooks(top, cfgNow);
  // Codex en Cursor lezen AGENTS.md, Claude Code leest CLAUDE.md. Het blok staat
  // in AGENTS.md; CLAUDE.md importeert dat (@AGENTS.md) of krijgt het blok zelf.
  const block = agentBlock(cfgNow);
  upsertBlock(path.join(top, 'AGENTS.md'), block);
  out('✓ agent-instructie in AGENTS.md');
  const claudeMd = path.join(top, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    fs.writeFileSync(claudeMd, '@AGENTS.md\n');
    out('✓ CLAUDE.md met @AGENTS.md (Claude Code leest AGENTS.md niet vanzelf)');
  } else if (/^@AGENTS\.md\s*$/m.test(fs.readFileSync(claudeMd, 'utf8'))) {
    out('· CLAUDE.md importeert AGENTS.md al');
  } else {
    upsertBlock(claudeMd, block);
    out('✓ agent-instructie in CLAUDE.md');
  }
  out('Volgende stap: node .poort/poort.mjs doctor');
  return 0;
}

function cmdDoctor() {
  const { top } = repoInfo();
  let bad = 0;
  const row = (ok, msg) => {
    if (ok === false) bad++;
    out(`  ${ok === true ? '✓' : ok === false ? '✗' : '!'} ${msg}`);
  };
  out(`poort doctor · v${VERSION} · ${top}`);
  row(Number(process.versions.node.split('.')[0]) >= 18, `node ${process.versions.node} (>= 18)`);
  for (const f of strandedPatches(repoInfo(top).gitDir)) row(false, `niet teruggezet werk van een afgebroken hook: git apply ${shq(f)}, daarna verwijderen`);
  let cfg;
  try {
    cfg = loadConfig(top);
    row(Boolean(cfg), cfg ? `poort.config.json: ${cfg.checks.length} checks` : 'poort.config.json ontbreekt (poort init [profiel])');
    if (cfg) {
      // Waartegen vergelijkt poort? Een verkeerde base sleept de hele
      // promotie-delta mee (bijv. main terwijl PR's naar acceptance gaan).
      const b = baseInfo(top, cfg);
      const bron = process.env.POORT_BASE_REF ? 'POORT_BASE_REF' : cfg.base ? 'config' : 'standaard';
      row(bron === 'standaard' ? null : true, `base: ${b.ref || 'vorige commit'} (${bron})${bron === 'standaard' ? '; gaan je PR\'s naar een andere branch, zet dan "base" in poort.config.json' : ''}`);
    }
  } catch (e) {
    row(false, e.message);
  }
  const dir = hooksDir(top);
  for (const name of Object.keys(HOOK_TIER)) {
    const p = path.join(dir, name);
    const ok = fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(HOOK_MARK);
    row(ok, `hook ${name}${ok ? '' : ' niet geïnstalleerd (poort init)'}`);
  }
  if (cfg) {
    // Mappen waar prepare bij de volgende run nog installeert: een tool die daar
    // ontbreekt, komt vanzelf. Dat is geen fout, dus ! in plaats van ✗.
    const { gitDir } = repoInfo(top);
    const preparing = new Set(
      cfg.prepare
        .filter((p) => !(p.if && sh(p.if, path.join(top, p.cwd)).status !== 0) && prepareNeed(top, gitDir, p).need)
        .map((p) => path.join(top, p.cwd)),
    );
    for (const c of cfg.checks) {
      if (c.if) {
        const ok = sh(c.if, path.join(top, c.cwd)).status === 0;
        row(ok ? true : null, `${c.id}: ${ok ? 'voorwaarde ok' : `n.v.t. hier (${c.ifHint || c.if})`}`);
        // Hoort de check hier niet, dan zegt een ontbrekende tool niets: niet rood melden.
        if (!ok) continue;
      }
      if (c.needs) {
        const ok = sh(c.needs, path.join(top, c.cwd)).status === 0;
        if (!ok && preparing.has(path.join(top, c.cwd))) row(null, `${c.id}: tool nog niet geïnstalleerd; prepare doet dat bij de volgende run`);
        else row(ok, `${c.id}: ${ok ? 'tool aanwezig' : `tool ontbreekt: ${c.needsHint || c.needs}`}`);
      }
      if (c.stack.length) {
        const st = checkStackStatus(top, c);
        row(st.ok ? true : null, `${c.id}: ${st.ok ? 'eigen stack draait' : st.reason}`);
      }
    }
    const heavy = cfg.checks.filter((c) => c.heavy).map((c) => c.id);
    if (heavy.length) row(true, `slots: max ${slotLimit(cfg)} zware checks tegelijk over alle worktrees (${heavy.join(', ')})`);
    for (const p of cfg.prepare) {
      if (p.if && sh(p.if, path.join(top, p.cwd)).status !== 0) {
        row(null, `prepare ${p.id}: n.v.t. (${p.if})`);
        continue;
      }
      const st = prepareNeed(top, gitDir, p);
      row(st.need ? null : true, `prepare ${p.id}: ${st.need ? `draait bij de volgende run (${st.why})` : 'up-to-date'}`);
    }
    if (cfg.format?.length) {
      const claude = path.join(top, '.claude', 'settings.json');
      const ok = fs.existsSync(claude) && fs.readFileSync(claude, 'utf8').includes('format-on-edit.mjs');
      row(ok ? true : null, `format-on-edit: ${cfg.format.length} regel(s)${ok ? '' : '; hook niet gekoppeld (poort init)'}`);
    }
    // Het model is alleen nodig voor --record (replay draait zonder). Daarom is een
    // ontbrekende login een waarschuwing, nooit rood.
    const e2eDirs = [...new Set(cfg.checks.filter((c) => c.type === 'e2e').map((c) => c.cwd))];
    for (const d of e2eDirs) {
      for (const p of e2eProviders(path.join(top, d))) {
        const st = e2eProviderStatus(p);
        row(st.ok, `e2e${e2eDirs.length > 1 ? ` (${d})` : ''}: ${st.msg}`);
      }
    }
  }
  return bad ? 1 : 0;
}

// ---------- e2e-provider (doctor) ----------

// Providers met een API-sleutel en de variabele die hun AI SDK-pakket leest.
const E2E_KEY_PROVIDERS = [
  ['@ai-sdk/openai', 'OpenAI', 'OPENAI_API_KEY'],
  ['@ai-sdk/anthropic', 'Anthropic', 'ANTHROPIC_API_KEY'],
  ['@ai-sdk/google', 'Google', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  ['@ai-sdk/xai', 'xAI', 'XAI_API_KEY'],
  ['@ai-sdk/gateway', 'AI Gateway', 'AI_GATEWAY_API_KEY'],
  ['@openrouter/ai-sdk-provider', 'OpenRouter', 'OPENROUTER_API_KEY'],
];

// Welke modelproviders gebruikt de e2e-config? Gelezen uit de imports: de config
// uitvoeren zou TypeScript en de dependencies van de repo vragen.
export function e2eProviders(dir) {
  const file = ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!file) return [{ kind: 'unknown', why: `geen e2e.config in ${path.basename(dir) || dir}` }];
  const src = fs.readFileSync(file, 'utf8');
  const from = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const found = [];
  if (from.includes('e2e/oauth/chatgpt')) found.push({ kind: 'chatgpt' });
  if (from.some((f) => /e2e-claude-seat(\.mjs)?$/.test(f))) found.push({ kind: 'claude-seat' });
  for (const [pkg, name, env] of E2E_KEY_PROVIDERS) if (from.includes(pkg)) found.push({ kind: 'key', name, env });
  for (const f of from.filter((f) => /^e2e\/oauth\//.test(f) && f !== 'e2e/oauth/chatgpt')) found.push({ kind: 'unknown', why: f });
  return found.length ? found : [{ kind: 'unknown', why: `geen bekende provider in ${path.basename(file)}` }];
}

export function e2eProviderStatus(p, env = process.env) {
  if (p.kind === 'chatgpt') {
    const login = path.join(os.homedir(), '.config', 'e2e', 'oauth.json');
    return fs.existsSync(login)
      ? { ok: true, msg: 'ChatGPT-login aanwezig' }
      : { ok: null, msg: 'ChatGPT niet ingelogd; alleen nodig voor --record: npx e2e login openai' };
  }
  if (p.kind === 'key') {
    return env[p.env]
      ? { ok: true, msg: `${p.name}: ${p.env} gezet` }
      : { ok: null, msg: `${p.name}: ${p.env} ontbreekt; alleen nodig voor --record` };
  }
  if (p.kind === 'claude-seat') return claudeSeatStatus(env);
  return { ok: null, msg: `modelprovider niet gecontroleerd (${p.why})` };
}

// Goedkoop: `claude auth status` kost geen model-call. Met dezelfde env als de
// seat-integratie (seatEnv), anders telt een ANTHROPIC_API_KEY als "ingelogd" en
// ziet doctor de token in ~/.config/poort/claude-seat-token niet.
function claudeSeatStatus(env) {
  const bin = env.CLAUDE_BIN || 'claude';
  let childEnv;
  try {
    childEnv = seatEnv(env);
  } catch (e) {
    return { ok: false, msg: `Claude-seat: ${e.message}` };
  }
  // Beheerde instellingen eerst, vóór er een claude-kind start: een beheerde env
  // of hook zou anders al bij dit kind binnenkomen, met je seat-token erbij.
  const problems = managedPolicyProblems();
  if (problems.length) return { ok: false, msg: managedPolicyMessage(problems) };
  // Met dezelfde isolatie als de opname (instellingen en MCP uit, lege werkmap),
  // zodat doctor beoordeelt wat de opname echt gebruikt.
  const spawnAuth = (args) => spawnSync(bin, args, { encoding: 'utf8', env: childEnv, cwd: seatCwd(), timeout: 15000 });
  let r = spawnAuth(authStatusArgs(true));
  if (/unknown option '--safe-mode'/.test(r.stderr || '')) r = spawnAuth(authStatusArgs(false));
  if (r.error?.code === 'ENOENT') return { ok: null, msg: `Claude-seat: ${bin} niet gevonden; installeer Claude Code (alleen nodig voor --record)` };
  let st;
  try {
    st = JSON.parse(r.stdout);
  } catch {
    return { ok: null, msg: `Claude-seat: login niet gecontroleerd (${bin} auth status gaf geen JSON)` };
  }
  // Zelfde regel als de opname zelf: alleen een abonnement telt. Een opgeslagen
  // Console-sleutel, een apiKeyHelper of Bedrock is ook "ingelogd", maar geen seat.
  const v = judgeSeatAuth(st, childEnv);
  if (!v.ok && v.kind === 'login') {
    return { ok: null, msg: 'Claude-seat: niet ingelogd; alleen nodig voor --record: draai claude en log in, of zet een token van `claude setup-token` in ~/.config/poort/claude-seat-token (chmod 600)' };
  }
  if (!v.ok) return { ok: false, msg: `Claude-seat: ${v.reason}; de opname weigert dit. Log in met je Claude-abonnement of gebruik een token van \`claude setup-token\`` };
  const via = v.via === 'CLAUDE_CODE_OAUTH_TOKEN' ? 'CLAUDE_CODE_OAUTH_TOKEN (token zelf niet gevalideerd)' : v.via;
  return { ok: true, msg: `Claude-seat: ingelogd via ${via}; let op: ${SERVER_POLICY_CAVEAT}` };
}

// ---------- e2e opnemen ----------

async function cmdE2E(args) {
  const { top } = repoInfo();
  const cfg = mustConfig(top);
  if (!args.includes('--record')) {
    err('gebruik: poort e2e --record   (neemt verouderde stappen opnieuw op, met AI)');
    return 2;
  }
  let code = 0;
  for (const c of cfg.checks.filter((c) => c.type === 'e2e')) {
    const st = c.stack.length ? checkStackStatus(top, c) : { ok: true };
    if (!st.ok) {
      out(`↷ ${c.id}: ${st.reason}`);
      continue;
    }
    out(`● ${c.id}: opnemen in ${c.cwd}`);
    const r = spawnSync('npx', ['--no-install', 'e2e', 'run', '--reporter', 'list,markdown'], { cwd: path.join(top, c.cwd), stdio: 'inherit', env: { ...process.env, ...e2eEnv(c) } });
    if (r.status !== 0) code = 1;
    const st2 = git(['status', '--short', '--', path.join(c.cwd, '.e2e/cache')], { cwd: top }).trim();
    if (st2) out(`  stage deze opnames mee:\n${st2.replace(/^/gm, '    ')}`);
  }
  return code;
}

// ---------- CLI ----------

function out(s) {
  process.stdout.write(s + '\n');
}
function err(s) {
  process.stderr.write(s + '\n');
}
function mustConfig(top) {
  const cfg = loadConfig(top);
  if (!cfg) {
    const e = new Error('poort.config.json ontbreekt. Begin met: npx -y github:Reforge-Recruitment/poort init');
    e.code = 'CONFIG';
    throw e;
  }
  return cfg;
}

const skipList = () => (process.env.POORT_SKIP || '').split(',').map((s) => s.trim()).filter(Boolean);

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function cmdHook([name]) {
  const tier = HOOK_TIER[name];
  if (!tier) {
    err(`poort hook: onbekende hook ${name}`);
    return 2;
  }
  const { top, gitDir } = repoInfo();
  const cfg = loadConfig(top);
  if (!cfg) return 0; // repo zonder config: niets afdwingen
  const prep = await runPrepare(top, cfg);
  if (prep) return prep;
  if (tier === 'commit') {
    const { ref: baseRef } = baseInfo(top, cfg);
    return withStagedOnly(top, gitDir, () => runTier(top, cfg, { tier, staged: true, baseRef, changed: changedFiles(top, { mode: 'staged' }), skip: skipList() }));
  }
  // pre-push: stdin = "<local ref> <local sha> <remote ref> <remote sha>" per ref
  const zero = /^0+$/;
  const ranges = [];
  const { sha: base, ref: baseRef } = baseInfo(top, cfg);
  for (const l of lines(readStdin())) {
    const [, localSha, , remoteSha] = l.split(' ');
    if (!localSha || zero.test(localSha)) continue; // branch verwijderen
    // Nieuwe branch zonder base (eerste push van een verse repo): alles telt als nieuw.
    const from = zero.test(remoteSha) ? base || EMPTY_TREE : remoteSha;
    if (from && refExists(top, from)) ranges.push([from, localSha]);
  }
  const changed = ranges.length ? changedFiles(top, { mode: 'push', pushRanges: ranges }) : changedFiles(top, { mode: 'all', base });
  return runTier(top, cfg, { tier, changed, base, baseRef, skip: skipList() });
}

async function cmdRun(args) {
  const tier = args.find((a) => TIERS.includes(a)) || 'push';
  const all = args.includes('--all');
  const noCache = args.includes('--no-cache');
  const noStack = args.includes('--no-stack');
  const { top } = repoInfo();
  const cfg = mustConfig(top);
  const { sha: base, ref: baseRef } = baseInfo(top, cfg);
  const changed = changedFiles(top, { mode: 'all', base });
  // `run push` = de volledige lokale poort: commit-checks plus push-checks.
  const tiers = tier === 'push' && !args.includes('--only') ? TIERS : [tier];
  let code = await runPrepare(top, cfg);
  if (code) return code;
  for (const t of tiers) code = Math.max(code, await runTier(top, cfg, { tier: t, changed, all, noCache, noStack, base, baseRef, skip: skipList() }));
  return code;
}

function cmdVerify(args) {
  const { top } = repoInfo();
  const cfg = mustConfig(top);
  const rows = verify(top, cfg, { base: baseInfo(top, cfg).sha });
  const dirty = Boolean(git(['status', '--porcelain'], { cwd: top }).trim());
  const head = git(['rev-parse', '--short', 'HEAD'], { cwd: top, allowFail: true }).trim();
  const failed = rows.filter((r) => r.ok === false);
  // --json: alleen JSON op stdout, zodat een script of CI hem direct kan parsen.
  if (args.includes('--json')) {
    out(JSON.stringify({ ok: !failed.length, head, dirty, rows }));
    return failed.length ? 1 : 0;
  }
  out(`poort verify · ${head || '(nog geen commit)'} (de commit, zoals hij gepusht wordt)`);
  if (dirty) out('  ! niet-gecommitte wijzigingen tellen niet mee: commit ze en draai run push, of zet ze weg');
  for (const r of rows) out(`  ${r.ok ? '✓' : r.ok === null ? '↷' : '✗'} ${r.id}${r.reason ? `  ${r.reason}` : ''}`);
  out(failed.length ? `poort verify: ${failed.length} zonder bewijs · draai: node .poort/poort.mjs run push` : `poort verify: ok${rows.some((r) => r.ok === null) ? ' (met n.v.t.-checks, zie ↷)' : ''}`);
  return failed.length ? 1 : 0;
}

function cmdStats(args) {
  const { store } = repoInfo();
  const i = args.indexOf('--days');
  const days = i >= 0 ? Number(args[i + 1]) || 7 : 7;
  const rows = timingStats(store, { days });
  if (!rows.length) {
    out(`poort stats: nog geen metingen (laatste ${days} dagen)`);
    return 0;
  }
  const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const w = Math.max(...rows.map((r) => r.id.length));
  out(`poort stats · laatste ${days} dagen, alle worktrees · zwaarste eerst`);
  out(`  ${'check'.padEnd(w)}  gedraaid  cached  rood     p50     p95   totaal  slot-wacht`);
  for (const r of rows) {
    out(`  ${r.id.padEnd(w)}  ${String(r.ran).padStart(8)}  ${String(r.cached).padStart(6)}  ${String(r.fail).padStart(4)}  ${s(r.p50).padStart(6)}  ${s(r.p95).padStart(6)}  ${`${(r.totalMs / 60000).toFixed(1)}m`.padStart(7)}  ${s(r.waitMs).padStart(10)}`);
  }
  return 0;
}

const HELP = `poort ${VERSION} — quality gate voor git-hooks en e2e

  poort init [profiel]        vendor naar .poort/, config, hooks, agent-instructie;
                              zonder profiel kiest init node, python of fullstack
        --no-hooks            alles behalve de git-hooks (bijv. in een worktree)
        --force               vervang een bestaande poort.config.json
  poort run [commit|push]     draai een tier; 'push' = commit + push (default)
        --all                 alle checks, ook zonder wijziging
        --no-cache            negeer receipts
        --only                bij 'push': alleen de push-tier
        --no-stack            sla checks over die een draaiende stack nodig hebben (CI-preflight)
  poort verify [--json]       heeft elke verplichte check bewijs voor de commit (HEAD)?
  poort e2e --record          neem verouderde e2e-stappen opnieuw op (AI)
  poort doctor                controleer installatie, tools en stacks
  poort stats [--days 7]      waar wachten agents op: duur, cache-hits, slot-wachttijd per check
  poort hook <pre-commit|pre-push>   (aangeroepen door git)
  poort --version

Omgeving:
  POORT_SKIP=id,id|all   checks overslaan (alleen met reden)
  POORT_BASE_REF=ref     target-branch (anders: base uit de config, origin/HEAD, origin/main)
  POORT_CONFIG=pad       ander configbestand, bijv. een profiel om te proberen
  POORT_SLOTS=3          max zware checks tegelijk over alle worktrees
  POORT_TAIL=30          regels uitvoer bij een rode check
  POORT_NO_STASH=1       commit-hook test de werkboom in plaats van alleen de gestagede versie
  POORT_NO_PREPARE=1     geen dependencies installeren
  POORT_OFFLINE=1        stale-branch haalt de target-branch niet op

Checks krijgen: POORT_TIER, POORT_BASE (merge-base), POORT_BASE_REF (target), POORT_STAGED=1 (commit-hook).`;

export async function main(argv) {
  const [cmd, ...args] = argv;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(sig));
  try {
    switch (cmd) {
      case 'init':
        return cmdInit(args);
      case 'run':
        return await cmdRun(args);
      case 'hook':
        return await cmdHook(args);
      case 'verify':
        return cmdVerify(args);
      case 'e2e':
        return await cmdE2E(args);
      case 'doctor':
        return cmdDoctor();
      case 'stats':
        return cmdStats(args);
      case '--version':
      case '-v':
        out(VERSION);
        return 0;
      default:
        out(HELP);
        return cmd && cmd !== '--help' && cmd !== '-h' ? 2 : 0;
    }
  } catch (e) {
    err(e.code === 'CONFIG' ? e.message : `poort: ${e.stack || e.message}`);
    return 2;
  }
}

// realpath: via npx/npm-bin is argv[1] een symlink naar dit bestand.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv.slice(2)).then((code) => stopping || process.exit(code));
}

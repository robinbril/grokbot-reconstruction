// Gedeelde helpers voor de lichtgewicht poort-checks. Geen dependencies.
// Een check meldt advies met regels "poort:warn <tekst>" (niet blokkerend) en
// blokkeert met exit 1. Context komt van poort: POORT_TIER, POORT_BASE (merge-base),
// POORT_BASE_REF (doelbranch) en POORT_STAGED (alleen in de echte commit-hook).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return r.status === 0 ? r.stdout : '';
}

export const lines = (s) => s.split('\n').filter(Boolean);
export const warn = (msg) => console.log(`poort:warn ${msg}`);
export const top = () => git(['rev-parse', '--show-toplevel']).trim();

// Wat deze wijziging toevoegt: in de echte commit-hook (POORT_STAGED) de
// gestagede diff, anders de working tree tegen de merge-base.
// POORT_HEAD (backtest): lees een commit in plaats van de working tree.
export const HEAD = process.env.POORT_HEAD || null;

// De lege tree: base voor een repo zonder commits (of een base die niet bestaat).
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // pragma: allowlist secret (detect-secrets)
const hasCommit = (ref) => Boolean(git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim());

export function diffArgs() {
  const base = process.env.POORT_BASE;
  if (HEAD && base) return ['diff', base, HEAD];
  if (process.env.POORT_STAGED) return ['diff', '--cached', ...(hasCommit('HEAD') ? [] : [EMPTY_TREE])];
  const b = base || 'HEAD';
  return ['diff', hasCommit(b) ? b : EMPTY_TREE];
}

// Eén diff voor het hele proces, zonder pathspec: een pathspec beperkt de
// rename-detectie (een hernoemd bestand leek dan helemaal nieuw) en kost een
// git-aanroep per bestand. Paden zijn repo-relatief; toegevoegde regels per
// bestand, plus de bestanden die nieuw zijn.
let parsed = null;
function changes() {
  if (parsed) return parsed;
  const root = top() || process.cwd();
  const fmt = ['-c', 'core.quotePath=false'];
  const opts = ['-M', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
  const [cmd, ...rest] = diffArgs();
  const added = new Map(); // pad -> [{ n, text }]
  let cur = null;
  let header = false; // tussen "diff --git" en de eerste hunk: "+++ " is daar een kop, geen regel
  let n = 0;
  for (const l of git([...fmt, cmd, ...opts, '-U0', ...rest], { cwd: root }).split('\n')) {
    if (l.startsWith('diff --git ')) {
      cur = null;
      header = true;
    } else if (header && l.startsWith('+++ ')) {
      const p = unquote(l.slice(4));
      cur = p.startsWith('b/') ? p.slice(2) : null;
      if (cur && !added.has(cur)) added.set(cur, []);
    } else if (cur && l.startsWith('@@ ')) {
      header = false;
      n = Number(l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)?.[1] ?? 0);
    } else if (cur && !header && l.startsWith('+')) added.get(cur).push({ n: n++, text: l.slice(1) });
  }
  // --name-status -z: status en pad zonder quoting; R/C hebben twee paden.
  const fresh = new Set();
  const st = git([cmd, ...opts, '--name-status', '-z', ...rest], { cwd: root }).split('\0');
  for (let i = 0; i < st.length - 1; ) {
    const s = st[i];
    if (/^[RC]/.test(s)) i += 3;
    else {
      if (s === 'A') fresh.add(st[i + 1]);
      i += 2;
    }
  }
  // Buiten de commit-hook en de backtest: een ongetrackt bestand is helemaal nieuw.
  const tracked = HEAD || process.env.POORT_STAGED ? null : new Set(git(['ls-files', '-z'], { cwd: root }).split('\0'));
  parsed = { root, added, fresh, tracked };
  return parsed;
}

// C-quoting van git ("b/\303\274.py") terugzetten naar het echte pad.
function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  const body = s.slice(1, -1);
  const esc = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') bytes.push(...Buffer.from(body[i]));
    else if (/[0-7]/.test(body[i + 1])) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else bytes.push(esc[body[++i]] ?? body.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
}

// Pad zoals de check het kreeg (relatief aan cwd, of absoluut) -> repo-relatief.
// realpath: git geeft de echte map terug (macOS: /private/var i.p.v. /var).
function repoPath(file, root) {
  let abs = path.resolve(file);
  try {
    abs = fs.realpathSync(abs);
  } catch {
    // verwijderd bestand: het pad zoals het is
  }
  return path.relative(root, abs).split(path.sep).join('/');
}

const untracked = (c, p) => Boolean(c.tracked) && !c.tracked.has(p) && fs.existsSync(path.join(c.root, p));

function added(file) {
  const c = changes();
  const p = repoPath(file, c.root);
  if (!untracked(c, p)) return c.added.get(p) || [];
  const src = readFile(file).split('\n');
  if (src.at(-1) === '') src.pop();
  return src.map((text, i) => ({ n: i + 1, text }));
}

// git grep over de working tree, of over POORT_HEAD in een backtest.
export function grepFiles(args, pathspecs) {
  const out = git(['grep', ...args, ...(HEAD ? [HEAD] : []), '--', ...pathspecs]);
  return lines(out).map((l) => (HEAD && l.startsWith(HEAD + ':') ? l.slice(HEAD.length + 1) : l));
}

export function readFile(file) {
  if (HEAD) return git(['show', `${HEAD}:${file}`]);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function addedLines(file) {
  return added(file).map((l) => l.text);
}

// Regelnummers (in de nieuwe versie) die deze wijziging toevoegt of verandert.
export function addedLineNumbers(file) {
  return new Set(added(file).map((l) => l.n));
}

// Nieuw = toegevoegd in de diff, of (buiten commit-hook en backtest) ongetrackt.
// Een hernoemd bestand is niet nieuw: alleen de gewijzigde regels tellen.
export function isNewFile(file) {
  const c = changes();
  const p = repoPath(file, c.root);
  return c.fresh.has(p) || untracked(c, p);
}

const DEF_PATTERNS = {
  // Alleen top-level: methodes (ingesprongen) zijn meestal overrides/polymorfie, geen kopie.
  py: [/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^class\s+([A-Za-z_]\w*)/],
  js: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/,
  ],
};

export const langOf = (file) => (/\.py$/.test(file) ? 'py' : /\.([mc]?[jt]sx?|vue)$/.test(file) ? 'js' : null);
export const isTest = (file) => /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.|(^|\/)test_[^/]*\.py$|_test\.py$/.test(file);

export function definedNames(file, src) {
  const lang = langOf(file);
  if (!lang) return [];
  const names = new Set();
  for (const l of src) for (const re of DEF_PATTERNS[lang]) {
    const m = l.match(re);
    if (m) names.add(m[1]);
  }
  return [...names];
}

// Definitie-regex voor git grep (POSIX ERE), per taal.
// Let op: git grep -E is POSIX ERE, dus [[:space:]] in plaats van \\s.
export function defGrep(lang, name) {
  const S = '[[:space:]]';
  return lang === 'py'
    ? `^(async${S}+)?def${S}+${name}${S}*\\(`
    : `(function${S}*\\*?${S}*${name}${S}*\\()|(const${S}+${name}${S}*=${S}*(async${S}*)?(\\(|function|[A-Za-z_$][A-Za-z0-9_$]*${S}*=>))`;
}

export const GENERIC = new Set([
  'setup', 'render', 'main', 'handler', 'handle', 'init', 'load', 'save', 'update', 'create', 'delete', 'remove',
  'index', 'default', 'constructor', 'toString', 'format', 'parse', 'validate', 'get', 'set', 'run', 'build',
  'onMounted', 'computed', 'reset', 'close', 'open', 'submit', 'fetchData', 'normalize', 'serialize', 'apply',
]);

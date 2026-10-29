#!/usr/bin/env node
// PR-poort voor agents: blokkeert `gh pr create` / `gh pr ready` tot
// `poort verify` groen is voor precies de commit die gepusht wordt.
//
// Werkt als hook voor:
//   Claude Code  PreToolUse, matcher "Bash"  (stdin: {tool_input:{command}}; blokkeren = exit 2 + stderr)
//   Cursor       beforeShellExecution        (stdin: {command}; blokkeren = {"permission":"deny"})
// Andere commando's laat hij ongemoeid door.
//
// Het commando wordt gelezen zoals de shell het ziet (quotes weg, delen aan
// elkaar), niet als ruwe tekst: `gh pr "create"` is ook een PR. Een subcommando
// uit een variabele (`gh pr $SUB`) kan een hook niet invullen; dat telt als PR.
// Niet afgedekt: een PR via `gh api` of de website.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shell-woorden per commando. Scheidingstekens (; && || | & en een newline)
// beginnen een nieuw commando. Geen volledige shell: genoeg voor wat agents typen.
export function commands(command) {
  const out = [[]];
  let word = null;
  const end = () => {
    if (word !== null) out.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'") {
      const j = command.indexOf("'", i + 1);
      word = (word ?? '') + command.slice(i + 1, j < 0 ? undefined : j);
      i = j < 0 ? command.length : j;
    } else if (ch === '"') {
      let s = '';
      for (i++; i < command.length && command[i] !== '"'; i++) s += command[i] === '\\' && /["\\$`]/.test(command[i + 1] ?? '') ? command[++i] : command[i];
      word = (word ?? '') + s;
    } else if (ch === '\\' && i + 1 < command.length) {
      word = (word ?? '') + command[++i];
    } else if (/[;&|\n]/.test(ch)) {
      end();
      if (out.at(-1).length) out.push([]);
    } else if (/\s/.test(ch)) end();
    else word = (word ?? '') + ch;
  }
  end();
  return out.filter((c) => c.length);
}

// Het gh-commando dat een PR opent of op 'ready' zet, als woordenlijst; anders null.
const dynamic = (w) => /[$`]/.test(w ?? '');
export function prCommand(command) {
  for (const words of commands(command)) {
    // gh moet het commando zelf zijn, eventueel na VAR=x of env/command/exec/time/nohup/sudo.
    let gh = 0;
    while (gh < words.length && (/^\w+=/.test(words[gh]) || /^(env|command|exec|time|nohup|sudo)$/.test(words[gh]))) gh++;
    if (path.basename(words[gh] ?? '') !== 'gh') continue;
    const rest = words.slice(gh + 1);
    // Het commando staat vooraan (eventueel na -R <repo>); `pr` of een variabele.
    const plain = rest.filter((w) => !w.startsWith('-'));
    const i = plain.slice(0, 2).findIndex((w) => w === 'pr' || dynamic(w));
    if (i < 0) continue;
    const sub = plain[i + 1];
    if (/^(create|new|ready)$/.test(sub ?? '') || dynamic(sub)) return rest;
  }
  return null;
}

// --body/-b "<tekst>" of --body-file/-F <pad>; null als het commando geen body meegeeft.
export function bodyFrom(command, words, cwd) {
  // --body "$(cat <<'EOF' ... EOF)": de body staat in de heredoc.
  const here = command.match(/--body(?:=|\s+)"?\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\s*\n?\s*\)/);
  if (here) return here[2];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--body' || w === '-b') return words[i + 1] ?? '';
    if (w.startsWith('--body=')) return w.slice(7);
    if (w === '--body-file' || w === '-F' || w.startsWith('--body-file=')) {
      const f = w.startsWith('--body-file=') ? w.slice(12) : words[i + 1];
      if (!f || f === '-') return null;
      try {
        return fs.readFileSync(path.resolve(cwd, f), 'utf8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {}
  const cursor = typeof input.command === 'string';
  const cmd = cursor ? input.command : input.tool_input?.command || '';

  const allow = () => {
    if (cursor) process.stdout.write(JSON.stringify({ permission: 'allow' }));
    process.exit(0);
  };
  const words = /\bgh\b/.test(cmd) ? prCommand(cmd) : null;
  if (!words) allow();

  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', cwd: input.cwd || process.cwd() }).stdout.trim();
  const poort = path.join(top, '.poort', 'poort.mjs');
  if (!top || !fs.existsSync(poort)) allow();

  const problems = [];
  const r = spawnSync('node', [poort, 'verify'], { cwd: top, encoding: 'utf8' });
  if (r.status !== 0) problems.push(`Niet elke verplichte check heeft bewijs voor deze commit.\n${r.stdout.trim()}`);

  // PR-beschrijving tegen de diff (checks/pr-body.mjs), als de body in het commando staat.
  const body = bodyFrom(cmd, words, input.cwd || top);
  const prBody = path.join(top, '.poort', 'checks', 'pr-body.mjs');
  if (body !== null && fs.existsSync(prBody)) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poort-pr-')), 'body.md');
    fs.writeFileSync(tmp, body);
    const b = spawnSync('node', [prBody, '--body-file', tmp], { cwd: top, encoding: 'utf8' });
    if (b.status !== 0) problems.push(`De PR-beschrijving klopt niet met de diff:\n${b.stdout.trim()}`);
  }
  if (!problems.length) allow();

  const msg = `PR geblokkeerd door poort.\n${problems.join('\n\n')}`;
  if (cursor) {
    process.stdout.write(JSON.stringify({ permission: 'deny', userMessage: msg, agentMessage: msg }));
    process.exit(0);
  }
  process.stderr.write(msg + '\n');
  process.exit(2);
}

// Alleen als script; de tests importeren commands/prCommand/bodyFrom.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) main();

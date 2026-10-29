// e2e-claude-seat: een Claude-abonnement (seat) als AI SDK-taalmodel voor e2e.
//
//   import { claudeSeat } from './.poort/integrations/e2e-claude-seat.mjs';
//   agents: { default: { model: claudeSeat('claude-sonnet-5-5'), judge: claudeSeat('claude-opus-5-5') } }
//
// Waarom via `claude -p` en niet via de API: een seat-token werkt niet op de
// Messages-API (blijvend 429) en een abonnement via een proxy routeren mag niet
// volgens de voorwaarden. Claude Code zelf is de toegestane weg. Daarom zetten we
// hier nooit ANTHROPIC_BASE_URL of ANTHROPIC_AUTH_TOKEN en praten we nooit zelf met
// api.anthropic.com; we halen ze juist weg (en elke HTTP-proxy), zodat het kind de
// seat-login gebruikt. Vóór elk kind controleert `claude auth status` dat
// het kind echt op een abonnement zit en niet op een opgeslagen API-sleutel.
//
// `claude -p` is een agent, geen completion-model: met een grote vreemde
// tool-prompt zegt hij "die tool heb ik niet" in plaats van hem aan te roepen.
// Daarom staan zijn eigen tools, MCP, hooks en instellingen uit (beheerde
// instellingen van een organisatie kunnen we niet uitzetten; die weigeren we, zie
// managedPolicyProblems), en vragen we een
// tool-aanroep als gestructureerde uitvoer (--json-schema): het antwoord ís dan de
// keuze van tool en input, die we terugvertalen naar een gewone tool-call.
//
// Geen dependencies: het object volgt de LanguageModelV4-specificatie van
// @ai-sdk/provider (ai 7, die e2e 0.18 gebruikt) zonder die te importeren.

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [2_000, 6_000];
const KEEP_IMAGES = 2;
export const IMAGE_OMITTED = '[schermafbeelding weggelaten]';

// De env van het kind is een allowlist, geen zwarte lijst: alleen wat een proces
// nodig heeft om te starten en zijn home, taal en tijdelijke map te vinden. Een
// zwarte lijst mist altijd iets: NODE_OPTIONS (--require draait code vóór de
// CLI zijn vlaggen leest, mét de seat-token), LD_PRELOAD en DYLD_* (een
// bibliotheek in het proces), HTTP_PROXY en familie (seat-verkeer gaat rechtstreeks
// naar Anthropic), ANTHROPIC_* (API-sleutel, andere endpoint, model-override) en
// CLAUDE_CODE_* van een agent-sessie (sessie-ID, berichtensocket, Bedrock-vlag).
// Van Claude blijven alleen CLAUDE_CODE_OAUTH_TOKEN (je seat-token van `claude
// setup-token`) en CLAUDE_CONFIG_DIR (welke login, dus welke seat).
// NODE_EXTRA_CA_CERTS gaat bewust niet mee: een eigen CA is precies wat een
// onderscheppende bedrijfsproxy nodig heeft, en een proxy mag hier niet.
// PATHEXT (Windows) is nodig om claude.cmd te vinden.
const ALLOW_ENV = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN',
]);
const ALLOW_ENV_WIN = new Set(['SYSTEMROOT', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'PATH', 'TEMP', 'TMP']);
const ALLOW_PREFIX = /^(LC_|XDG_)/;

export function allowedEnvName(k, platform = process.platform) {
  if (ALLOW_ENV.has(k) || ALLOW_PREFIX.test(k)) return true;
  // Windows-variabelen zijn hoofdletterongevoelig (Path, SystemRoot, ComSpec).
  return platform === 'win32' && ALLOW_ENV_WIN.has(k.toUpperCase());
}

// Vlaggen die niet elke CLI-versie kent. Kent de CLI er een niet, dan proberen we
// het één keer zonder; de rest van de run onthoudt dat (per binary).
const OPTIONAL_FLAGS = ['--safe-mode', '--disable-slash-commands'];
const unsupportedFlags = new Map();

// Waar je seat-token op je eigen machine staat als CLAUDE_CODE_OAUTH_TOKEN niet
// in de env zit: buiten elke repo, alleen voor jou leesbaar (chmod 600). Zo hoeft
// de token niet in je shellprofiel of in een projectbestand.
export function tokenFile(base = process.env) {
  return base.POORT_CLAUDE_SEAT_TOKEN_FILE || path.join(base.HOME || os.homedir(), '.config', 'poort', 'claude-seat-token');
}

export function seatToken(base = process.env) {
  if (base.CLAUDE_CODE_OAUTH_TOKEN) return { token: base.CLAUDE_CODE_OAUTH_TOKEN, via: 'CLAUDE_CODE_OAUTH_TOKEN' };
  const file = tokenFile(base);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  // Een token die anderen kunnen lezen is een gelekte token; liever hard falen.
  if (process.platform !== 'win32' && st.mode & 0o077) {
    throw new ClaudeSeatError(`${file} is leesbaar voor anderen; maak hem privé met: chmod 600 ${file}`, { kind: 'auth' });
  }
  const token = fs.readFileSync(file, 'utf8').trim();
  return token ? { token, via: file } : null;
}

// De env voor het kind: opgeschoond (childEnv) plus je seat-token uit het bestand
// als de env er zelf geen heeft.
export function seatEnv(base = process.env) {
  const env = childEnv(base);
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
    const found = seatToken(base);
    if (found) env.CLAUDE_CODE_OAUTH_TOKEN = found.token;
  }
  return env;
}

export function childEnv(base = process.env, platform = process.platform) {
  const env = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && allowedEnvName(k, platform)) env[k] = v;
  return env;
}

// ---------- geheimen uit foutmeldingen ----------

// Alles wat het kind op stderr of in een JSON-fout zet, kan in een rapport, een
// CI-log of een agent-transcript belanden. De actieve token en alles wat eruitziet
// als een Anthropic-sleutel of seat-token gaat er daarom af voordat een fout de
// provider verlaat.
const SECRET_RE = /sk-ant-[A-Za-z0-9_-]{6,}/g;
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const t of secrets) if (typeof t === 'string' && t.length >= 8) s = s.split(t).join('[token]');
  return s.replace(SECRET_RE, 'sk-ant-[token]');
}

// ---------- beheerde instellingen (policy van de organisatie) ----------

// --setting-sources "" en --safe-mode zetten gebruikers-, project- en lokale
// instellingen uit, maar beheerde instellingen (managed policy) blijven gelden.
// Een beheerde hook draait met de seat-token in zijn env; een beheerde env of
// apiKeyHelper kan het verkeer omleiden of een API-sleutel inzetten; een
// managed-mcp.json negeert onze lege --mcp-config en start eigen processen met
// diezelfde env. Dat zijn harde regels ("nooit via een proxy, de token nooit naar
// derden"), dus daar is geen opt-out voor: alleen sleutels waarvan we weten dat
// ze alleen beperken of alleen weergave zijn, mogen. Een onbekende sleutel telt
// als risico: een nieuwe versie van Claude Code kan er een uitvoerpad mee openen.
// Paden en sleutels zoals Claude Code 2.1.x ze zelf leest.
const HARMLESS_MANAGED_KEYS = new Set([
  '$schema',
  'permissions',
  'disableAllHooks',
  'disableBypassPermissionsMode',
  'allowManagedHooksOnly',
  'allowManagedPermissionRulesOnly',
  'allowManagedMcpServersOnly',
  'allowedMcpServers',
  'deniedMcpServers',
  'strictKnownMarketplaces',
  'forceLoginMethod',
  'forceLoginOrgUUID',
  'model',
  'availableModels',
  'cleanupPeriodDays',
  'companyAnnouncements',
  'includeCoAuthoredBy',
  'includeGitInstructions',
  'outputStyle',
  'spinnerTipsEnabled',
  'autoUpdatesChannel',
  'feedbackSurveyRate',
]);
const MDM_PLIST = 'com.anthropic.claudecode.plist';

function riskyKeys(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return ['(geen object)'];
  return Object.keys(policy).filter((k) => !HARMLESS_MANAGED_KEYS.has(k));
}

// Waar Claude Code beheerd beleid leest. Altijd de echte systeemplekken: geen
// env-variabele of configsleutel kan ze vervangen, anders is de weigering met
// één export uit te zetten terwijl Claude het echte beleid gewoon laadt.
export function policySources(platform = process.platform) {
  if (platform === 'darwin') {
    const mp = '/Library/Managed Preferences';
    return { dir: '/Library/Application Support/ClaudeCode', plists: [path.join(mp, MDM_PLIST), path.join(mp, os.userInfo().username, MDM_PLIST)], registry: false };
  }
  if (platform === 'win32') return { dir: 'C:\\Program Files\\ClaudeCode', plists: [], registry: true };
  return { dir: '/etc/claude-code', plists: [], registry: false };
}

// Testnaad: alleen vanuit code (de tests) te zetten, niet via env of config.
let testPolicySources = null;
export function setPolicySourcesForTests(sources) {
  testPolicySources = sources;
}

export function managedPolicyProblems() {
  const src = testPolicySources ?? policySources();
  const dir = src.dir;
  const problems = [];
  const files = [path.join(dir, 'managed-settings.json')];
  try {
    const dropIn = path.join(dir, 'managed-settings.d');
    for (const f of fs.readdirSync(dropIn).sort()) if (f.endsWith('.json')) files.push(path.join(dropIn, f));
  } catch {}
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    let policy;
    try {
      policy = JSON.parse(text);
    } catch {
      problems.push(`${f} is geen geldige JSON`);
      continue;
    }
    const keys = riskyKeys(policy);
    if (keys.length) problems.push(`${f} zet ${keys.join(', ')}`);
  }
  const mcp = path.join(dir, 'managed-mcp.json');
  if (fs.existsSync(mcp)) problems.push(`${mcp} neemt de MCP-servers over`);
  // MDM-profielen (macOS): plutil (staat op elke Mac) zet de plist om in JSON,
  // dan geldt dezelfde sleutelregel. Lukt dat niet, dan weten we niet wat erin
  // staat, en dat telt als risico.
  for (const p of src.plists) {
    if (!fs.existsSync(p)) continue;
    let policy;
    if (process.platform === 'darwin') {
      const r = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', p], { encoding: 'utf8' });
      try {
        policy = r.status === 0 ? JSON.parse(r.stdout) : undefined;
      } catch {}
    }
    if (policy === undefined) problems.push(`MDM-profiel ${p} (niet te lezen)`);
    else if (riskyKeys(policy).length) problems.push(`MDM-profiel ${p} zet ${riskyKeys(policy).join(', ')}`);
  }
  // Windows-registerbeleid lezen we niet uit; aanwezig is dus onbekend, en weigeren.
  if (src.registry) {
    for (const key of ['HKLM\\SOFTWARE\\Policies\\ClaudeCode', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode']) {
      if (spawnSync('reg', ['query', key], { stdio: 'ignore' }).status === 0) problems.push(`registerbeleid ${key}`);
    }
  }
  return problems;
}

// Beleid dat een organisatie via de server van Anthropic uitrolt, laadt Claude
// Code bij het starten; het staat niet op schijf en is lokaal niet uit te lezen.
// Daar geldt de "nooit"-belofte dus niet; dat zeggen we hardop.
export const SERVER_POLICY_CAVEAT = 'beleid dat je organisatie via de server uitrolt, is lokaal niet te controleren; op zo\'n machine geldt de garantie niet';

export function managedPolicyMessage(problems) {
  return `Claude-seat: beheerde Claude Code-instellingen gevonden (${problems.join('; ')}). Die gelden ook met --setting-sources "" en --safe-mode: een hook of MCP-server draait met je seat-token, en env of een credential-helper kan het verkeer omleiden. Daarom weigeren we; alleen beleid dat alleen beperkt (zoals permissions) mag. Vraag wie het beleid beheert om het aan te passen, of neem op op een machine zonder dit beleid.`;
}

// Werkmap van elk claude-kind: leeg en buiten elke repo, zodat er geen CLAUDE.md
// of projectinstellingen meekomen. doctor gebruikt dezelfde.
export function seatCwd() {
  const d = path.join(os.tmpdir(), 'poort-claude-seat');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// `claude auth status` kent zelf geen isolatievlaggen, maar de globale vlaggen
// vóór het subcommando gelden wel (gemeten met Claude Code 2.1.291: een
// apiKeyHelper in projectinstellingen telt zonder --setting-sources "" mee, met
// niet). Zo beoordeelt de controle dezelfde instellingen als de opname.
export function authStatusArgs(safeMode = true) {
  return ['--setting-sources', '', '--strict-mcp-config', ...(safeMode ? ['--safe-mode'] : []), 'auth', 'status', '--json'];
}

// ---------- welke login gebruikt het kind? ----------

// `claude auth status --json` (Claude Code 2.1.x) geeft authMethod uit
// none | claude.ai | oauth_token | api_key | api_key_helper | third_party en
// apiProvider uit firstParty | bedrock | vertex | foundry | anthropicAws |
// anthropicGoogleCloud | mantle | gateway. Een seat is alleen firstParty met
// claude.ai (interactieve abonnementslogin) of oauth_token uit
// CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`). oauth_token zonder die
// variabele komt van iets anders (een ant-profiel, ANTHROPIC_AUTH_TOKEN), en een
// opgeslagen Console-sleutel heet api_key: allebei geen seat.
export const SEAT_AUTH_METHODS = ['claude.ai', 'oauth_token'];

export function judgeSeatAuth(st, env = {}) {
  if (!st || typeof st !== 'object') return { ok: false, kind: 'unknown', reason: 'claude auth status gaf geen JSON' };
  if (!st.loggedIn) return { ok: false, kind: 'login', reason: 'niet ingelogd' };
  // Alles wat uit het kind komt, kan een geheim bevatten (een wrapper of een
  // kapotte status die een sleutel in apiKeySource zet). Elk veld dat in een
  // reden belandt, gaat daarom eerst door redact().
  const say = (v) => redact(String(v), [env.CLAUDE_CODE_OAUTH_TOKEN]).slice(0, 80);
  if (st.apiProvider !== 'firstParty') {
    return { ok: false, kind: 'method', reason: `apiProvider is ${st.apiProvider == null ? 'onbekend' : say(st.apiProvider)}, geen Claude-seat (alleen firstParty is een abonnement)` };
  }
  if (st.apiKeySource) return { ok: false, kind: 'method', reason: `er is een API-sleutel actief (${say(st.apiKeySource)}); die gaat voor de seat-login` };
  const m = st.authMethod;
  if (!SEAT_AUTH_METHODS.includes(m)) {
    const why = { api_key: 'een API-sleutel (Console), geen abonnement', api_key_helper: 'een apiKeyHelper, geen abonnement', third_party: 'een externe provider' }[m] || 'geen bekende abonnementslogin';
    return { ok: false, kind: 'method', reason: `authMethod is ${m == null ? 'onbekend' : say(m)}: ${why}` };
  }
  if (m === 'oauth_token' && !env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { ok: false, kind: 'method', reason: 'authMethod is oauth_token, maar niet uit CLAUDE_CODE_OAUTH_TOKEN (een ant-profiel of ANTHROPIC_AUTH_TOKEN is geen seat)' };
  }
  return { ok: true, via: m === 'oauth_token' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'claude.ai-login' };
}

// ---------- prompt plat slaan ----------

const bytesToBase64 = (d) => (typeof d === 'string' ? d.replace(/^data:[^;]+;base64,/, '') : Buffer.from(d).toString('base64'));

// Een file-part in de vormen die de AI SDK aanlevert: V4 ({type:'data'|'url'|'text'})
// en de oudere kale Uint8Array/base64-string.
function fileInfo(part) {
  const mediaType = part.mediaType || part.mimeType || 'application/octet-stream';
  const d = part.data;
  if (d instanceof Uint8Array || typeof d === 'string') return { mediaType, base64: bytesToBase64(d) };
  if (d?.type === 'data') return { mediaType, base64: bytesToBase64(d.data) };
  if (d?.type === 'text') return { mediaType, text: d.text };
  if (d?.type === 'url') {
    const url = String(d.originalUrl || d.url);
    const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(url);
    if (m) return { mediaType: m[1] || mediaType, base64: m[2] };
    return { mediaType, text: `[bestand: ${url}]` };
  }
  return { mediaType, text: '[bestand]' };
}

const CONCRETE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

// V4 staat ook een topniveau-type toe ("image" of "image/*"). De Messages-API
// wil een concreet type, dus lezen we het uit de eerste bytes; anders zou de
// schermafbeelding stil een tekstregel worden.
export function sniffImageType(base64) {
  let b;
  try {
    b = Buffer.from(String(base64).slice(0, 24), 'base64');
  } catch {
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function concreteImage(f) {
  if (!f.base64) return f;
  if (f.mediaType === 'image' || /^image\/\*$/.test(f.mediaType)) {
    const t = sniffImageType(f.base64);
    if (t) return { ...f, mediaType: t };
  }
  return f;
}

const isImage = (f) => f.base64 && CONCRETE_IMAGE.test(f.mediaType);

const compact = (v) => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

// Bouwt de blokken van één user-bericht: tekst en afbeeldingen in de volgorde
// van het gesprek. Systeemberichten gaan apart naar --system-prompt.
export function flattenPrompt(prompt, { keepImages = KEEP_IMAGES } = {}) {
  const system = [];
  const items = []; // {text} | {image: {mediaType, base64}}
  const pushText = (t) => items.push({ text: t });
  const pushFile = (part) => {
    const f = concreteImage(fileInfo(part));
    if (isImage(f)) items.push({ image: f });
    else pushText(f.text ?? `[bestand ${f.mediaType}]`);
  };
  for (const msg of prompt || []) {
    if (msg.role === 'system') {
      system.push(String(msg.content));
      continue;
    }
    const content = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content || [];
    if (msg.role === 'user') {
      pushText('[gebruiker]');
      for (const p of content) {
        if (p.type === 'text') pushText(p.text);
        else if (p.type === 'file' || p.type === 'image') pushFile(p.type === 'image' ? { ...p, data: p.image, mediaType: p.mediaType || 'image/png' } : p);
      }
    } else if (msg.role === 'assistant') {
      pushText('[assistent]');
      for (const p of content) {
        if (p.type === 'text' && p.text) pushText(p.text);
        else if (p.type === 'tool-call') pushText(`[tool-aanroep ${p.toolName} id=${p.toolCallId}] ${compact(p.input)}`);
        else if (p.type === 'tool-result') pushToolResult(p);
        else if (p.type === 'file') pushFile(p);
        // reasoning en custom: niet nodig om de volgende stap te kiezen.
      }
    } else if (msg.role === 'tool') {
      for (const p of content) if (p.type === 'tool-result') pushToolResult(p);
    }
  }
  function pushToolResult(p) {
    const o = p.output || {};
    const head = `[tool-resultaat ${p.toolName} id=${p.toolCallId}]`;
    if (o.type === 'text' || o.type === 'error-text') pushText(`${head}${o.type === 'error-text' ? ' fout:' : ''} ${o.value}`);
    else if (o.type === 'json' || o.type === 'error-json') pushText(`${head}${o.type === 'error-json' ? ' fout:' : ''} ${compact(o.value)}`);
    else if (o.type === 'execution-denied') pushText(`${head} niet uitgevoerd${o.reason ? `: ${o.reason}` : ''}`);
    else if (o.type === 'content') {
      pushText(head);
      for (const it of o.value || []) {
        if (it.type === 'text') pushText(it.text);
        else if (it.type === 'file' || it.type === 'image-data' || it.type === 'media') pushFile(it.type === 'file' ? it : { data: it.data, mediaType: it.mediaType });
        else pushText(compact(it));
      }
    } else pushText(`${head} ${compact(o.value ?? o)}`);
  }
  // Alleen de laatste schermafbeeldingen tellen voor de volgende stap; oudere
  // kosten tokens en tijd zonder iets toe te voegen.
  const imgIdx = items.map((it, i) => (it.image ? i : -1)).filter((i) => i >= 0);
  const drop = new Set(imgIdx.slice(0, Math.max(0, imgIdx.length - keepImages)));
  const blocks = [];
  for (const [i, it] of items.entries()) {
    const text = drop.has(i) ? IMAGE_OMITTED : it.text;
    if (text !== undefined) {
      const last = blocks.at(-1);
      if (last?.type === 'text') last.text += '\n' + text;
      else blocks.push({ type: 'text', text });
    } else blocks.push({ type: 'image', source: { type: 'base64', media_type: it.image.mediaType, data: it.image.base64 } });
  }
  return { system: system.join('\n\n'), blocks, images: imgIdx.length - drop.size };
}

// ---------- tools als gestructureerde uitvoer ----------

function functionTools(tools) {
  return (tools || []).filter((t) => t.type === 'function' || t.type === undefined);
}

// Welke tools mag het antwoord kiezen, en mag het ook gewoon tekst zijn?
export function toolPlan(tools, toolChoice) {
  const all = functionTools(tools);
  const choice = toolChoice?.type || 'auto';
  if (!all.length || choice === 'none') return null;
  if (choice === 'tool') {
    const t = all.filter((x) => x.name === toolChoice.toolName);
    return t.length ? { tools: t, text: false } : null;
  }
  return { tools: all, text: choice === 'auto' };
}

const objectSchema = (s) => (s && typeof s === 'object' && Object.keys(s).length ? s : { type: 'object' });

// json: de responseFormat van de aanroep. Vraagt die om JSON en mag het model
// ook zonder tool antwoorden, dan is dat antwoord {"json": <volgens het schema>}
// en geen vrije tekst: anders krijgt een aanroeper die een gestructureerd oordeel
// wil, proza terug waar de SDK op struikelt.
export function toolSchema(plan, json = null) {
  const options = plan.tools.map((t) => ({
    type: 'object',
    properties: { tool: { type: 'string', const: t.name }, input: objectSchema(t.inputSchema) },
    required: ['tool', 'input'],
    additionalProperties: false,
  }));
  if (plan.text && json) {
    options.push({
      type: 'object',
      properties: { json: json.schema && typeof json.schema === 'object' ? json.schema : {} },
      required: ['json'],
      additionalProperties: false,
    });
  } else if (plan.text) {
    options.push({
      type: 'object',
      properties: { text: { type: 'string', description: 'Alleen als er geen tool past: je antwoord in tekst.' } },
      required: ['text'],
      additionalProperties: false,
    });
  }
  return { type: 'object', properties: { action: { anyOf: options } }, required: ['action'], additionalProperties: false };
}

function toolInstructions(plan, json = null) {
  const list = plan.tools
    .map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ''}\n  input-schema: ${compact(objectSchema(t.inputSchema))}`)
    .join('\n');
  const noTool = !plan.text
    ? 'Je moet precies één tool kiezen; tekst alleen is geen geldig antwoord.'
    : json
      ? `Past echt geen tool, antwoord dan met {"action":{"json":<waarde>}}, met de waarde${json.schema ? ` volgens dit schema: ${compact(json.schema)}` : ' als JSON'}.`
      : 'Past echt geen tool, antwoord dan met {"action":{"text":"..."}}.';
  return [
    'Je bent het beslismodel van een testagent. Je voert zelf niets uit: je kiest de volgende actie en de harness voert die uit.',
    'De tools hieronder bestaan in de harness, niet bij jou. Zeg nooit dat je een tool niet hebt; kies er een door hem in je gestructureerde antwoord te noemen.',
    noTool,
    'Antwoordvorm: {"action":{"tool":"<naam>","input":{...}}}, met input volgens het schema van die tool.',
    'Beschikbare tools:',
    list,
  ].join('\n');
}

// Vindt het JSON-object in een tekstantwoord: een ```json-blok, of het eerste
// gebalanceerde {...}. Voor als de CLI geen structured_output teruggeeft.
export function extractJson(text) {
  if (typeof text !== 'string') return undefined;
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const c of [...fenced, text]) {
    try {
      return JSON.parse(c.trim());
    } catch {}
    for (let start = c.indexOf('{'); start >= 0; start = c.indexOf('{', start + 1)) {
      let depth = 0;
      let inStr = false;
      for (let i = start; i < c.length; i++) {
        const ch = c[i];
        if (inStr) {
          if (ch === '\\') i++;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

// ---------- de CLI aanroepen ----------

export class ClaudeSeatError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'ClaudeSeatError';
    Object.assign(this, extra);
  }
}

const LOGIN_HINT =
  'Claude-seat niet ingelogd: draai `claude` en log in met je Claude-account, of maak een token met `claude setup-token` en zet die in ~/.config/poort/claude-seat-token (chmod 600) of in CLAUDE_CODE_OAUTH_TOKEN. Een API-sleutel werkt hier bewust niet.';

// Overbelast of een tijdelijke serverfout: een paar seconden later lukt het
// meestal wel. Een gebruikslimiet of een login-probleem niet; die herhalen kost
// alleen tijd (en bij een limiet nog meer van je seat).
const TRANSIENT_RE = /overloaded|\b529\b|api_error|internal server error|\b50[0234]\b|bad gateway|service unavailable|gateway timeout|ECONNRESET|ETIMEDOUT|socket hang up/i;

// secrets: de actieve token(s); alles gaat door redact() voor het een fout wordt.
function friendlyError(text, { code = null, signal = null, secrets = [] } = {}) {
  const t = redact(String(text || '').trim(), secrets);
  const exit = signal ? ` (gestopt door ${signal})` : code != null && code !== 0 ? ` (exit ${code})` : '';
  if (/not logged in|please run \/login|invalid api key|oauth token (has )?expired|authentication_error|\b401\b/i.test(t)) return new ClaudeSeatError(LOGIN_HINT, { kind: 'auth', detail: t });
  if (/usage limit|rate limit|\b429\b/i.test(t)) return new ClaudeSeatError(`Claude-seat: limiet bereikt (${t.slice(0, 200)})`, { kind: 'limit', detail: t, isRetryable: false });
  if (TRANSIENT_RE.test(t)) return new ClaudeSeatError(`Claude-seat: tijdelijk niet beschikbaar${exit} (${t.slice(0, 200)})`, { kind: 'overloaded', detail: t, isRetryable: true });
  return new ClaudeSeatError(`claude -p faalde${exit}: ${t.slice(0, 500) || 'geen uitvoer'}`, { kind: 'cli', detail: t });
}

const sleepFor = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('afgebroken', 'AbortError'));
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason ?? new DOMException('afgebroken', 'AbortError'));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function parseResult(stdout) {
  const s = stdout.trim();
  try {
    const one = JSON.parse(s);
    if (Array.isArray(one)) return one.findLast?.((m) => m?.type === 'result') ?? one.at(-1);
    return one;
  } catch {}
  // stream-json: één JSON-object per regel; het laatste result telt.
  let result;
  for (const line of s.split('\n')) {
    try {
      const m = JSON.parse(line);
      if (m?.type === 'result') result = m;
    } catch {}
  }
  return result;
}

const DEFAULT_SYSTEM = 'Beantwoord het bericht van de gebruiker.';
const GROUP_KILL = process.platform !== 'win32';
const KILL_GRACE_MS = 1500;

// Procesgroepen die SIGTERM kregen maar hun SIGKILL nog niet. Eindigt het proces
// hard (process.exit) voordat de gratie om is, dan krijgen ze die hier alsnog;
// process.kill werkt synchroon in een exit-handler.
const openGroups = new Set();
let exitHandlerSet = false;
function ensureExitHandler() {
  if (exitHandlerSet) return;
  exitHandlerSet = true;
  process.on('exit', () => {
    for (const pgid of openGroups) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {}
    }
  });
}

const deadlineError = (totalMs) => new ClaudeSeatError(`claude -p gaf binnen ${Math.round(totalMs / 1000)} s geen antwoord`, { kind: 'timeout', isRetryable: true });

// totalMs: de hele termijn van de modelaanroep, voor de melding; timeoutMs: wat
// er voor dit ene kind nog over is.
function runOnce(bin, args, stdin, { env, cwd, timeoutMs, totalMs = timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('afgebroken', 'AbortError'));
    if (!(timeoutMs > 0)) return reject(deadlineError(totalMs));
    let child;
    try {
      // Op Unix in een eigen procesgroep: een CLAUDE_BIN-wrapper die claude als
      // kleinkind start, zou bij afbreken anders blijven draaien, met je
      // seat-token en je seat-gebruik. Zo stopt afbreken de hele groep.
      child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: GROUP_KILL });
    } catch (e) {
      return reject(new ClaudeSeatError(`claude niet te starten (${bin}): ${e.message}`, { kind: 'spawn' }));
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const signalAll = (sig) => {
      try {
        if (GROUP_KILL && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {}
    };
    // Eerst netjes (SIGTERM), na een korte gratie hard (SIGKILL), voor de hele groep;
    // ook als het directe kind al weg is, kunnen kleinkinderen nog leven. De timer
    // blijft bewust gerefereerd: een unref'de timer laat de aanroeper eerder
    // eindigen dan de SIGKILL, en een kleinkind dat SIGTERM negeert draait dan door
    // met de seat-token. Eindigt het proces toch hard (process.exit), dan stopt de
    // exit-handler de nog openstaande groepen.
    const kill = () => {
      signalAll('SIGTERM');
      if (!GROUP_KILL || !child.pid) return;
      ensureExitHandler();
      openGroups.add(child.pid);
      const pgid = child.pid;
      setTimeout(() => {
        signalAll('SIGKILL');
        openGroups.delete(pgid);
      }, KILL_GRACE_MS);
    };
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(v);
    };
    const timer = setTimeout(() => {
      kill();
      finish(reject, deadlineError(totalMs));
    }, timeoutMs);
    const onAbort = () => {
      kill();
      finish(reject, signal.reason ?? new DOMException('afgebroken', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) =>
      finish(reject, new ClaudeSeatError(e.code === 'ENOENT' ? `claude niet gevonden (${bin}); installeer Claude Code of zet CLAUDE_BIN` : `claude: ${e.message}`, { kind: 'spawn' })),
    );
    child.on('close', (code, sig) => finish(resolve, { code, signal: sig, stdout, stderr }));
    child.stdin.on('error', () => {}); // kind kan stoppen voor stdin leeg is (bijv. onbekende vlag)
    child.stdin.end(stdin);
  });
}

async function runClaude({ bin, baseArgs, optional, stdin, env, cwd, timeLeft, totalMs, signal }) {
  if (!unsupportedFlags.has(bin)) unsupportedFlags.set(bin, new Set());
  const unsupported = unsupportedFlags.get(bin);
  for (;;) {
    const flags = optional.filter((f) => !unsupported.has(f));
    const r = await runOnce(bin, [...baseArgs, ...flags], stdin, { env, cwd, timeoutMs: timeLeft(), totalMs, signal });
    const unknown = /unknown option '([^']+)'/.exec(r.stderr);
    if (r.code !== 0 && unknown && flags.includes(unknown[1])) {
      unsupported.add(unknown[1]);
      continue;
    }
    return r;
  }
}

// ---------- vooraf: is dit echt een seat? ----------

// Vóór élk claude-kind, ook bij een nieuwe poging: beleid en login kunnen tussen
// twee stappen veranderen (een nieuw beheerd beleid met een hook, een login die
// naar een Console-account is gewisseld), en het kind leest ze bij elke start
// opnieuw. Een cache zou die wijziging missen. Kost één `claude auth status`
// (gemeten ongeveer 0,2 s), geen model-call.
async function preflight({ bin, env, cwd, signal, timeLeft, totalMs }) {
  const secrets = [env.CLAUDE_CODE_OAUTH_TOKEN];
  {
    const problems = managedPolicyProblems();
    if (problems.length) throw new ClaudeSeatError(managedPolicyMessage(problems), { kind: 'managed', problems });
    // Valt binnen de termijn van de modelaanroep, en nooit langer dan 15 s.
    const t = () => ({ env, cwd, timeoutMs: Math.min(15_000, timeLeft()), totalMs, signal });
    let r = await runOnce(bin, authStatusArgs(true), '', t());
    if (/unknown option '--safe-mode'/.test(r.stderr)) r = await runOnce(bin, authStatusArgs(false), '', t());
    let st;
    try {
      st = JSON.parse(r.stdout);
    } catch {}
    const v = judgeSeatAuth(st, env);
    if (v.ok) return v;
    // Ook de velden die we aan de fout hangen, komen uit het kind: geredigeerd.
    const field = (x) => (x == null ? undefined : redact(String(x), secrets));
    if (v.kind === 'login') throw new ClaudeSeatError(LOGIN_HINT, { kind: 'auth', authMethod: field(st?.authMethod) });
    const detail = v.kind === 'unknown' ? ` (${redact(r.stderr || r.stdout, secrets).trim().slice(0, 200) || 'geen uitvoer'})` : '';
    throw new ClaudeSeatError(redact(`Claude-seat geweigerd: ${v.reason}${detail}. Gebruik een seat: log in met \`claude\` op je Claude-abonnement, of zet een token van \`claude setup-token\` in ~/.config/poort/claude-seat-token (chmod 600) of in CLAUDE_CODE_OAUTH_TOKEN.`, secrets), {
      kind: 'auth',
      authMethod: field(st?.authMethod),
      apiProvider: field(st?.apiProvider),
    });
  }
}

// De stop_reason van de CLI (die van de Messages-API) naar de finish reasons van
// de AI SDK, zodat een afgekapt antwoord (max_tokens) niet als gewone stop
// telt. Met --json-schema eindigt ook een tool-keuze op end_turn; een tool-call
// die we uit de gestructureerde uitvoer haalden, is dus tool-calls. Een kale
// tool_use zonder zo'n tool-call (een eigen tool van de CLI) is geen tool-call
// voor de SDK: other, anders wacht de SDK op calls die er niet zijn.
export function unifiedFinish(stopReason, hasToolCall = false) {
  if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') return 'length';
  if (stopReason === 'refusal' || stopReason === 'content_filter') return 'content-filter';
  if (hasToolCall) return 'tool-calls';
  if (stopReason == null || stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'stop';
  return 'other';
}

function mapUsage(u) {
  const input = u?.input_tokens;
  const cacheRead = u?.cache_read_input_tokens;
  const cacheWrite = u?.cache_creation_input_tokens;
  const total = [input, cacheRead, cacheWrite].some((n) => typeof n === 'number') ? (input || 0) + (cacheRead || 0) + (cacheWrite || 0) : undefined;
  // output_tokens telt denken mee. Tekst is dus totaal min denken, maar alleen
  // als de CLI dat denken apart meldt; anders weten we de verdeling niet.
  const out = u?.output_tokens;
  const reasoning = u?.output_tokens_details?.thinking_tokens;
  const text = typeof out === 'number' && typeof reasoning === 'number' ? Math.max(0, out - reasoning) : undefined;
  return {
    inputTokens: { total, noCache: input, cacheRead, cacheWrite },
    outputTokens: { total: out, text, reasoning },
    ...(u ? { raw: u } : {}),
  };
}

// ---------- het model ----------

export function claudeSeat(modelId, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS);
  const keepImages = options.keepImages ?? KEEP_IMAGES;
  const bin = () => options.bin || process.env.CLAUDE_BIN || 'claude';
  // Een lege map als werkmap: geen CLAUDE.md of projectinstellingen van de repo
  // waarin e2e draait.
  const cwd = () => options.cwd || seatCwd();

  async function doGenerate(call) {
    const warnings = [];
    for (const k of ['temperature', 'topP', 'topK', 'seed', 'presencePenalty', 'frequencyPenalty', 'stopSequences']) {
      if (call[k] !== undefined) warnings.push({ type: 'unsupported', feature: k, details: 'claude -p kent deze instelling niet' });
    }
    const flat = flattenPrompt(call.prompt, { keepImages });
    const plan = toolPlan(call.tools, call.toolChoice);
    const json = call.responseFormat?.type === 'json' ? call.responseFormat : null;
    let schema = null;
    const sys = [flat.system];
    if (plan) {
      schema = toolSchema(plan, json);
      sys.push(toolInstructions(plan, json));
    } else if (json) {
      if (json.schema) schema = json.schema;
      sys.push(`Antwoord uitsluitend met één JSON-waarde${json.schema ? ' volgens het opgegeven schema' : ''}, zonder uitleg${json.name ? ` (${json.name}${json.description ? `: ${json.description}` : ''})` : ''}.`);
    }
    const system = sys.filter(Boolean).join('\n\n');
    const images = flat.blocks.some((b) => b.type === 'image');
    // Nooit een lege of witruimte-systeemprompt: de API weigert die (400
    // "text content blocks must contain non-whitespace text"), en weglaten zou de
    // agent-prompt van Claude Code zelf laden.
    const args = ['-p', '--model', modelId, '--system-prompt', system.trim() ? system : DEFAULT_SYSTEM];
    // Afbeeldingen kunnen alleen via stream-json; die invoer vraagt ook stream-json uit.
    if (images) args.push('--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose');
    else args.push('--output-format', 'json');
    args.push(
      '--tools', '',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '',
      '--no-session-persistence',
    );
    if (options.effort) args.push('--effort', options.effort);
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    const stdin = images
      ? JSON.stringify({ type: 'user', message: { role: 'user', content: flat.blocks } }) + '\n'
      : flat.blocks.map((b) => b.text).join('\n');
    const started = Date.now();
    const base = options.env || process.env;
    const env = seatEnv(base);
    const secrets = [env.CLAUDE_CODE_OAUTH_TOKEN];
    // maxOutputTokens: Claude Code kent er geen vlag voor, wel de variabele
    // CLAUDE_CODE_MAX_OUTPUT_TOKENS (gemeten in 2.1.291). Alleen voor de
    // modelcall, niet voor de controle vooraf. Een ongeldige waarde: waarschuwen.
    const genEnv = { ...env };
    if (call.maxOutputTokens !== undefined) {
      if (Number.isInteger(call.maxOutputTokens) && call.maxOutputTokens > 0) genEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(call.maxOutputTokens);
      else warnings.push({ type: 'unsupported', feature: 'maxOutputTokens', details: `geen positief geheel getal: ${call.maxOutputTokens}` });
    }
    // timeoutMs is één termijn voor de hele aanroep: controle vooraf, terugval
    // zonder onbekende vlag, nieuwe pogingen en het wachten ertussen samen. Zo
    // klopt de belofte "maximaal timeoutMs per modelaanroep".
    const deadline = started + timeoutMs;
    const timeLeft = () => deadline - Date.now();
    const runArgs = { bin: bin(), baseArgs: args, optional: OPTIONAL_FLAGS, stdin, env: genEnv, cwd: cwd(), timeLeft, totalMs: timeoutMs, signal: call.abortSignal };
    const attempt = async () => {
      await preflight({ bin: runArgs.bin, env, cwd: runArgs.cwd, signal: call.abortSignal, timeLeft, totalMs: timeoutMs });
      let r;
      try {
        r = await runClaude(runArgs);
      } catch (e) {
        if (e instanceof ClaudeSeatError) e.message = redact(e.message, secrets);
        throw e;
      }
      const res = parseResult(r.stdout);
      // Een kind dat niet met 0 eindigt (of door een signaal stopt) is mislukt,
      // ook als er al een succes-achtig resultaat op stdout stond: misschien is
      // het halverwege afgebroken.
      const failed = r.code !== 0 || Boolean(r.signal);
      const resError = res && (res.is_error || (res.subtype && res.subtype !== 'success'));
      // maxOutputTokens bereikt: de CLI meldt dat als fout en gooit de tekst weg
      // (gemeten in 2.1.291). Voor de SDK is dat een afgekapt antwoord, geen
      // kapotte call: lege inhoud met finish reason length.
      if (resError && !r.signal && /exceeded the \d+ output token maximum/i.test(String(res.result || ''))) return { ...res, truncatedByLimit: true };
      if (!res || resError || failed) {
        // Een mislukt resultaat zet de echte oorzaak soms alleen in `errors`
        // (bijv. subtype error_during_execution met een lege result); zonder die
        // regels herkennen we een overbelasting of login-fout niet.
        const errs = resError && Array.isArray(res.errors) ? res.errors.map(compact) : [];
        const text = [resError ? res.result || res.subtype : '', ...errs, r.stderr].filter(Boolean).join('\n') || r.stdout;
        throw friendlyError(text, { code: r.code, signal: r.signal, secrets });
      }
      return res;
    };
    // Begrensd opnieuw proberen, alleen bij tijdelijke fouten; de AI SDK doet dat
    // zelf alleen bij zijn eigen APICallError, dus het moet hier.
    const delays = (options.retryDelaysMs ?? RETRY_DELAYS_MS).slice(0, MAX_RETRIES);
    let res;
    for (let i = 0; ; i++) {
      try {
        res = await attempt();
        break;
      } catch (e) {
        // Past het wachten plus een nieuwe poging niet meer binnen de termijn, dan
        // nu de fout in plaats van wachten op een poging die meteen afloopt.
        if (!(e instanceof ClaudeSeatError) || !e.isRetryable || i >= delays.length || delays[i] >= timeLeft()) throw e;
        await sleepFor(delays[i], call.abortSignal);
      }
    }
    const structured = res.truncatedByLimit ? undefined : res.structured_output ?? res.structuredOutput ?? (schema ? extractJson(res.result) : undefined);
    const content = [];
    let finish = 'stop';
    if (res.truncatedByLimit) {
      warnings.push({ type: 'other', message: `maxOutputTokens (${call.maxOutputTokens}) bereikt; claude -p geeft dan geen gedeeltelijke tekst terug` });
      res.stop_reason = 'max_tokens';
    } else if (plan) {
      const action = structured?.action ?? structured;
      const known = action && plan.tools.find((t) => t.name === (action.tool ?? action.toolName ?? action.name));
      if (known) {
        content.push({ type: 'tool-call', toolCallId: `seat-${randomUUID()}`, toolName: known.name, input: JSON.stringify(action.input ?? action.arguments ?? {}) });
        finish = 'tool-calls';
      } else if (json && plan.text && action && 'json' in action) {
        content.push({ type: 'text', text: JSON.stringify(action.json) });
      } else {
        const text = typeof action?.text === 'string' ? action.text : res.result || '';
        if (!plan.text) warnings.push({ type: 'other', message: 'claude -p koos geen tool' });
        else if (json) warnings.push({ type: 'other', message: 'claude -p gaf geen JSON volgens responseFormat' });
        if (text) content.push({ type: 'text', text });
      }
    } else if (json) {
      const value = structured !== undefined ? structured : extractJson(res.result);
      content.push({ type: 'text', text: value !== undefined ? JSON.stringify(value) : String(res.result ?? '') });
    } else {
      content.push({ type: 'text', text: String(res.result ?? '') });
    }
    return {
      content,
      finishReason: { unified: unifiedFinish(res.stop_reason, finish === 'tool-calls'), raw: res.stop_reason ?? undefined },
      usage: mapUsage(res.usage),
      warnings,
      request: { body: { args: args.filter((a) => a !== system), images: flat.images } },
      response: { id: res.session_id, modelId, timestamp: new Date(started) },
      providerMetadata: { claudeSeat: { durationMs: res.duration_ms ?? Date.now() - started, costUsd: res.total_cost_usd ?? null } },
    };
  }

  async function doStream(call) {
    const result = await doGenerate(call);
    const parts = [{ type: 'stream-start', warnings: result.warnings }, { type: 'response-metadata', ...result.response }];
    for (const [i, c] of result.content.entries()) {
      if (c.type === 'text') {
        const id = `text-${i}`;
        parts.push({ type: 'text-start', id }, { type: 'text-delta', id, delta: c.text }, { type: 'text-end', id });
      } else if (c.type === 'tool-call') {
        parts.push(
          { type: 'tool-input-start', id: c.toolCallId, toolName: c.toolName },
          { type: 'tool-input-delta', id: c.toolCallId, delta: c.input },
          { type: 'tool-input-end', id: c.toolCallId },
          c,
        );
      }
    }
    parts.push({ type: 'finish', usage: result.usage, finishReason: result.finishReason, providerMetadata: result.providerMetadata });
    const stream = new ReadableStream({
      start(ctrl) {
        for (const p of parts) ctrl.enqueue(p);
        ctrl.close();
      },
    });
    return { stream, request: result.request, response: {} };
  }

  return {
    specificationVersion: 'v4',
    provider: 'claude-seat',
    modelId,
    // Leeg: de AI SDK haalt URL-bestanden zelf op en levert bytes aan.
    supportedUrls: {},
    doGenerate,
    doStream,
  };
}

export default claudeSeat;

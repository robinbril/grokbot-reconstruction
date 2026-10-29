import { harnessError } from "./store.mjs";
const fail = (message) => {
  throw harnessError("INVALID_SCHEDULE", message, 422);
};
const formatters = /* @__PURE__ */ new Map();
function formatter(zone) {
  if (!formatters.has(zone)) try {
    formatters.set(zone, new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
  } catch {
    fail("Use a valid IANA timeZone");
  }
  return formatters.get(zone);
}
function parts(ms, zone) {
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).filter((p2) => p2.type !== "literal").map((p2) => [p2.type, Number(p2.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}
const naive = (p) => Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0);
const civilDate = (p) => `${p.year.toString().padStart(4, "0")}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
function resolveCivil(p, zone) {
  const utc = naive(p), offsets = /* @__PURE__ */ new Set();
  for (const delta of [-1728e5, -864e5, -216e5, 0, 216e5, 864e5, 1728e5]) {
    const probe = utc + delta;
    offsets.add(naive(parts(probe, zone)) - probe);
  }
  const candidates = [...offsets].map((offset) => utc - offset), exact = candidates.filter((ms) => naive(parts(ms, zone)) === utc);
  if (exact.length) return Math.min(...exact);
  const after = candidates.filter((ms) => naive(parts(ms, zone)) > utc).sort((a, b) => naive(parts(a, zone)) - naive(parts(b, zone)));
  if (after.length) return after[0];
  fail("Cannot resolve local schedule time");
}
function normalizeRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) fail("A typed schedule rule is required");
  if (typeof rule.timeZone !== "string" || rule.timeZone.length > 100) fail("Use a valid IANA timeZone");
  formatter(rule.timeZone);
  if (rule.kind === "once") {
    if (typeof rule.at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(rule.at)) fail("One-time schedules require an ISO instant with offset");
    const ms = Date.parse(rule.at);
    if (!Number.isFinite(ms)) fail("Invalid schedule instant");
    const date = rule.at.slice(0, 10), [y, m, d] = date.split("-").map(Number);
    if (civilDate(parts(Date.UTC(y, m - 1, d), "UTC")) !== date) fail("Invalid civil date");
    return { kind: "once", at: new Date(ms).toISOString(), timeZone: rule.timeZone };
  }
  if (!["daily", "weekly"].includes(rule.kind) || typeof rule.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) fail("Use daily/weekly and HH:mm");
  let weekdays;
  if (rule.kind === "weekly") {
    if (!Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.length > 7 || rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) fail("Weekdays use ISO1 through7");
    weekdays = [...new Set(rule.weekdays)].sort();
  }
  return { kind: rule.kind, time: rule.time, timeZone: rule.timeZone, ...weekdays ? { weekdays } : {} };
}
function nextOccurrence(rule, after, { inclusive = false } = {}) {
  const ms = Number(new Date(after));
  if (!Number.isFinite(ms)) fail("Invalid recurrence cursor");
  if (rule.kind === "once") {
    const at = Date.parse(rule.at);
    return at > ms || inclusive && at === ms ? { at: rule.at, key: rule.at } : null;
  }
  const start = parts(ms, rule.timeZone), day0 = Date.UTC(start.year, start.month - 1, start.day), [hour, minute] = rule.time.split(":").map(Number);
  for (let day = 0; day < 370; day++) {
    const date = new Date(day0 + day * 864e5), weekday = date.getUTCDay() || 7;
    if (rule.kind === "weekly" && !rule.weekdays.includes(weekday)) continue;
    const p = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute }, at = resolveCivil(p, rule.timeZone);
    if (at > ms || inclusive && at === ms) return { at: new Date(at).toISOString(), key: civilDate(p) + "T" + rule.time };
  }
  fail("No recurrence within370 civil days");
}
function dueOccurrences(rule, firstDue, now) {
  const cutoff = Number(new Date(now)), first = Number(new Date(firstDue));
  if (first > cutoff) return null;
  let cursor = { at: firstDue, key: rule.kind === "once" ? rule.at : nextOccurrence(rule, first - 1).key }, latest = null, total = 0;
  for (let i = 0; i < 37e3 && cursor && Date.parse(cursor.at) <= cutoff; i++) {
    latest = cursor;
    total++;
    cursor = nextOccurrence(rule, cursor.at);
  }
  if (cursor && Date.parse(cursor.at) <= cutoff) fail("Schedule catchup exceeds100years; edit to a future time");
  return { latest, next: cursor, total, eligible: latest && cutoff - Date.parse(latest.at) <= 864e5 };
}
export {
  dueOccurrences,
  nextOccurrence,
  normalizeRule
};

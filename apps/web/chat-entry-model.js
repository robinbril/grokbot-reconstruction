// Pure projections over the existing transcript. No persisted text lives here.
export const CHAT_SCHEMA = 1;
export const ENTRY_KINDS = Object.freeze(['message', 'send-message', 'user-attachment', 'tool-call', 'notice', 'mcp-app', 'event', 'feedback', 'voice-call']);
const statuses = ['pending', 'streaming', 'stable', 'failed', 'cancelled', 'interrupted'];
const phases = ['accepted', 'running', 'awaiting-question', 'awaiting-approval', 'final-pending-delivery', 'delivered', 'cancelled', 'failed', 'interrupted'];
const operations = ['count', 'upper', 'markdown'];
export const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
export const data = (value, key) => { const d = value != null ? Object.getOwnPropertyDescriptor(value, key) : undefined; return d && own(d, 'value') ? d.value : undefined; };
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).every(key => typeof key === 'string' && own(Object.getOwnPropertyDescriptor(value, key), 'value'));
export const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
// Array references are a data boundary too: neither holes nor supplied methods
// may resolve inherited data or execute an indexed accessor.
export const ownDataArray = value => {
  if (!Array.isArray(value)) return false;
  const length = data(value, 'length');
  if (!Number.isSafeInteger(length) || length < 0) return false;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !own(descriptor, 'value')) return false;
  }
  return true;
};
export const findOwnArray = (value, predicate) => {
  if (!ownDataArray(value)) return undefined;
  for (let index = 0; index < data(value, 'length'); index++) {
    const item = data(value, String(index));
    if (predicate(item, index)) return item;
  }
  return undefined;
};
export const mapOwnArray = (value, mapper) => {
  if (!ownDataArray(value)) return undefined;
  const result = [];
  for (let index = 0; index < data(value, 'length'); index++) result.push(mapper(data(value, String(index)), index));
  return result;
};
const integer = value => Number.isSafeInteger(value) && value >= 0;
const boundedLabel = value => (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) ? String(value).slice(0, 64) : 'unknown';
const closed = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));

export function normalizeEntry(message, {conversationId} = {}) {
  const t = data(message, 'transcript');
  const result = {messageId:data(message, 'id'), conversationId, kind:'message', revision:0, status:'stable', text:data(message, 'text')};
  if (t === undefined && !own(message, 'transcript')) return result;
  const revision = data(t, 'revision');
  if (integer(revision)) result.revision = revision;
  const runId = data(t, 'runId'), generation = data(t, 'generation');
  const payload = data(t, 'payload'), replica = data(t, 'replica');
  const bad = !record(t) || data(t, 'schema') !== CHAT_SCHEMA || !ENTRY_KINDS.includes(data(t, 'kind')) || !integer(revision) || !statuses.includes(data(t, 'status')) ||
    (own(t, 'payload') && !record(payload)) || (own(t, 'replica') && (!closed(replica, ['producer', 'operation']) || data(replica, 'producer') !== 'local-text-v1' || !operations.includes(data(replica, 'operation')))) ||
    ((runId !== undefined || generation !== undefined) && (!identifier(runId) || !Number.isSafeInteger(generation) || generation < 1));
  if (bad) return {...result, unsupported:{schema:boundedLabel(data(t, 'schema')), kind:boundedLabel(data(t, 'kind'))}};
  result.kind = t.kind; result.status = t.status;
  if (runId !== undefined) { result.runId = runId; result.generation = generation; }
  if (replica) result.replica = {producer:replica.producer, operation:replica.operation};
  const layoutMode = data(payload, 'layoutMode');
  if (payload && ['elevated', 'bubble'].includes(layoutMode)) result.payload = {layoutMode};
  return result;
}

export function reduceEntry(message, event) {
  const reject = rejectedReason => ({message, changed:false, rejectedReason});
  if (!closed(event, ['schema', 'type', 'conversationId', 'entryId', 'revision', 'text', 'status', 'runId', 'generation']) || event.schema !== 1 || event.type !== 'replace' || !identifier(event.conversationId) || !identifier(event.entryId) || typeof event.text !== 'string' || event.text.length > 300000 || !Number.isSafeInteger(event.revision) || event.revision < 1 || !['streaming', 'stable', 'failed', 'cancelled', 'interrupted'].includes(event.status)) return reject('invalid');
  const entry = normalizeEntry(message, {conversationId:event.conversationId});
  if (entry.unsupported || !record(data(message, 'transcript'))) return reject('invalid');
  if (entry.messageId !== event.entryId || entry.runId !== event.runId || entry.generation !== event.generation) return reject('identity');
  if (!['pending', 'streaming'].includes(entry.status)) return reject('invalid');
  if (event.revision <= entry.revision) return reject('revision');
  return {message:{...message, text:event.text, transcript:{...message.transcript, revision:event.revision, status:event.status}}, changed:true, rejectedReason:null};
}

export function normalizeChatRuns(state) {
  const map = data(state, 'chatRuns'), messages = data(state, 'messages'), chatRuns = Object.create(null), issues = [];
  const allowed = ['schema', 'id', 'conversationId', 'submissionId', 'inputEntryId', 'outputEntryId', 'noticeEntryIds', 'adapterId', 'operation', 'style', 'styleProfileVersion', 'generation', 'lastSeq', 'phase', 'progress', 'createdAt', 'updatedAt', 'retryOf', 'delivery'];
  if (!map || typeof map !== 'object') return {chatRuns, issues};
  for (const key of Object.keys(map)) {
    const r = data(map, key), issue = code => issues.push({runId:boundedLabel(identifier(key) ? key : 'unknown'), code});
    if (!closed(r, allowed) || !allowed.filter(k => !['retryOf', 'progress'].includes(k)).every(k => own(r, k)) || r.schema !== 1 || r.id !== key || !['id', 'conversationId', 'submissionId', 'inputEntryId', 'outputEntryId', 'adapterId', 'styleProfileVersion'].every(k => identifier(r[k])) || !operations.includes(r.operation) || !['short', 'full'].includes(r.style) || !Number.isSafeInteger(r.generation) || r.generation < 1 || !integer(r.lastSeq) || !phases.includes(r.phase) || !Number.isFinite(r.createdAt) || !Number.isFinite(r.updatedAt) || !ownDataArray(r.noticeEntryIds) || Array.prototype.some.call(r.noticeEntryIds, value => !identifier(value)) || (own(r, 'retryOf') && !identifier(r.retryOf))) { issue('invalid'); continue; }
    const list = data(messages, r.conversationId);
    const input = findOwnArray(list, e => data(e, 'id') === r.inputEntryId);
    const output = findOwnArray(list, e => data(e, 'id') === r.outputEntryId);
    const n = normalizeEntry(output, {conversationId:r.conversationId});
    if (!input || data(input, 'role') !== 'user' || typeof data(input, 'text') !== 'string' || !output || data(output, 'role') !== 'bot' || typeof data(output, 'text') !== 'string' || n.unsupported || n.runId !== r.id || n.generation !== r.generation) { issue('reference'); continue; }
    if (own(r, 'progress')) {
      const p = r.progress;
      if (!closed(p, ['processed', 'total']) || Object.keys(p).length !== 2 || !integer(p.processed) || !integer(p.total) || p.processed > p.total || p.total !== input.text.length || p.total > 100000) { issue('invalid'); continue; }
    }
    let valid = r;
    if (r.phase === 'delivered') {
      const d = r.delivery;
      if (!closed(d, ['id', 'entryId', 'generation', 'revision', 'committedAt', 'scope']) || Object.keys(d).length !== 6 || d.id !== r.id + ':final' || d.entryId !== output.id || d.generation !== r.generation || d.revision !== n.revision || n.status !== 'stable' || d.scope !== 'browser-local' || !Number.isFinite(d.committedAt)) { valid = {...r, phase:'interrupted', delivery:null}; issue('receipt'); }
    } else if (r.delivery !== null) { issue('invalid'); continue; }
    Object.defineProperty(chatRuns, key, {value:valid, enumerable:true, writable:true, configurable:true});
  }
  return {chatRuns, issues};
}

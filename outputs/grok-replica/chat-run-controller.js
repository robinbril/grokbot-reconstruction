import {normalizeComposerDocument} from './composer-document.js';
import {normalizeEntry, normalizeChatRuns, own, data, record, identifier, ownDataArray, findOwnArray, mapOwnArray} from './chat-entry-model.js';

const active = ['accepted', 'running', 'awaiting-question', 'awaiting-approval', 'final-pending-delivery'];
const restartable = ['accepted', 'running', 'final-pending-delivery'];
const validText = text => typeof text === 'string' && text.length <= 100000 && text.trim().length > 0;
const sameQuote = (a, b) => a === undefined && b === undefined || record(a) && record(b) && ['messageId', 'text', 'title'].every(k => data(a, k) === data(b, k));
const safeCounter = n => Number.isSafeInteger(n) && n >= 0;
const resultError = (code, runId) => ({ok:false, ...(runId ? {runId} : {}), code});

// A newer editor document owns its matching text and quote until explicitly sent.
function consumedDraft(state, {conversationId, text, richText, quote}) {
  let drafts = state.drafts, replyDrafts = state.replyDrafts, draftRichTexts = data(state, 'draftRichTexts');
  const sameDocument = data(draftRichTexts, conversationId) === richText;
  const consume = sameDocument && data(drafts, conversationId) === text;
  if (consume) {
    drafts = {...drafts, [conversationId]:''};
    if (richText !== undefined) { draftRichTexts = {...draftRichTexts}; delete draftRichTexts[conversationId]; }
  }
  // Preserve the historical plain-text quote contract when richText is absent.
  if (sameDocument && (richText === undefined || consume) && quote && sameQuote(data(replyDrafts, conversationId), quote)) { replyDrafts = {...replyDrafts}; delete replyDrafts[conversationId]; }
  return {...(drafts !== state.drafts ? {drafts} : {}), ...(draftRichTexts !== data(state, 'draftRichTexts') ? {draftRichTexts} : {}), ...(replyDrafts !== state.replyDrafts ? {replyDrafts} : {})};
}

export function createChatRunController({getState, commit, publishChatProgress, getChatSaveState, adapter, onEntryChange, now = Date.now, newId = () => crypto.randomUUID()}) {
  const owners = new Map(), allocations = new Map();
  let destroyed = false, reconciled = false, reloadError = false, boot;
  const notify = (r, reason) => { try { onEntryChange?.({conversationId:r.conversationId, entryIds:[r.outputEntryId], runId:r.id, reason}); } catch { /* View failures cannot revoke a saved transaction. */ } };
  const resolve = (state, conversationId, runId) => {
    const run = data(data(state, 'chatRuns'), runId), list = data(data(state, 'messages'), conversationId);
    if (!record(run) || !['id', 'conversationId', 'inputEntryId', 'outputEntryId', 'generation', 'phase', 'lastSeq'].every(key => own(run, key)) || run.conversationId !== conversationId || !ownDataArray(list)) return null;
    const input = findOwnArray(list, e => data(e, 'id') === run.inputEntryId), output = findOwnArray(list, e => data(e, 'id') === run.outputEntryId);
    if (!input || !output || data(input, 'role') !== 'user' || typeof data(input, 'text') !== 'string' || data(output, 'role') !== 'bot') return null;
    const entry = normalizeEntry(output, {conversationId});
    if (entry.unsupported || entry.runId !== runId || entry.generation !== run.generation) return null;
    return {run, list, input, output, entry};
  };
  const validLookup = (conversationId, runId) => {
    if (!identifier(conversationId) || !identifier(runId)) return null;
    const state = getState(), normalized = normalizeChatRuns(state);
    if (!own(normalized.chatRuns, runId)) return null;
    const found = resolve(state, conversationId, runId);
    return found ? {...found, normalizedRun:normalized.chatRuns[runId]} : null;
  };
  const save = (build, reason) => {
    if (destroyed) return resultError('destroyed');
    try { const result = commit(build, {reason}); return result?.ok ? {ok:true} : resultError(result?.error?.code || 'storage'); }
    catch { return resultError('storage'); }
  };
  const patch = (state, f, runPatch, outputPatch) => ({...state,
    chatRuns:{...state.chatRuns, [f.run.id]:{...f.run, ...runPatch}},
    ...(outputPatch ? {messages:{...state.messages, [f.run.conversationId]:mapOwnArray(f.list, e => e === f.output ? outputPatch : e)}} : {})});
  const owns = (owner, requireActive = true) => {
    if (destroyed || owners.get(owner.runId) !== owner || owner.abort.signal.aborted || owner.cancelGeneration) return null;
    const f = resolve(getState(), owner.conversationId, owner.runId);
    if (!f || f.run.generation !== owner.generation || (requireActive && !active.includes(f.run.phase))) { owner.abort.abort(); return null; }
    return f;
  };
  const local = f => adapter?.id === 'local-text-v1' && f.run.adapterId === adapter.id && f.run.styleProfileVersion === 'local-answer-v1' && ['count', 'upper', 'markdown'].includes(f.run.operation) && ['short', 'full'].includes(f.run.style) && f.entry.kind === 'send-message' && f.entry.replica?.producer === 'local-text-v1' && f.entry.replica.operation === f.run.operation && validText(f.input.text);
  const ownerFor = run => { const owner = {runId:run.id, conversationId:run.conversationId, generation:run.generation, abort:new AbortController(), finalizing:false, pending:null}; owners.set(run.id, owner); return owner; };

  function getRuntime(request) {
    const unavailable = {effectivePhase:'interrupted', textSaved:false, statusSaved:false, delivered:false, canRetryDelivery:false, canResume:false, errorCode:'unavailable'};
    if (!record(request)) return Object.freeze(unavailable);
    const conversationId = data(request, 'conversationId'), runId = data(request, 'runId');
    const f = validLookup(conversationId, runId);
    if (!f) return Object.freeze(unavailable);
    const r = f.normalizedRun, owner = owners.get(runId);
    let effectivePhase = r.phase, errorCode;
    if (owner?.cancelGeneration) { effectivePhase = 'cancelled'; errorCode = owner.error; }
    else if (owner?.error) { effectivePhase = 'interrupted'; errorCode = owner.error; }
    else if ((!reconciled || !owner) && restartable.includes(r.phase)) effectivePhase = 'interrupted';
    if (!reconciled && reloadError) errorCode = 'reload-save-failed';
    const marker = getChatSaveState?.({conversationId, runId});
    const textSaved = !!marker && marker.entryId === f.output.id && marker.generation === r.generation && marker.revision === f.entry.revision;
    const statusSaved = textSaved && marker.phase === effectivePhase && (!owner?.cancelGeneration || r.generation === owner.cancelGeneration) && !errorCode;
    const delivered = r.phase === 'delivered' && effectivePhase === 'delivered' && !!r.delivery;
    return Object.freeze({effectivePhase, textSaved, statusSaved, delivered,
      canRetryDelivery:!!owner?.pending && !owner.deliveryTask && !owner.cancelGeneration && !owner.abort.signal.aborted && effectivePhase === 'final-pending-delivery',
      canResume:!destroyed && reconciled && effectivePhase === 'interrupted' && !owner?.cancelGeneration && local(f),
      ...(own(r, 'progress') ? {progress:Object.freeze({processed:r.progress.processed, total:r.progress.total})} : {}),
      ...(errorCode ? {errorCode} : {})});
  }

  async function reconcileReload() {
    if (destroyed) return resultError('destroyed');
    if (reconciled) return {ok:true};
    const state = getState();
    if (!boot) boot = new Map(Object.keys(data(state, 'chatRuns') || {}).map(id => [id, data(data(data(state, 'chatRuns'), id), 'generation')]));
    const normalized = normalizeChatRuns(state);
    let messages = state.messages, changed = normalized.issues.length > 0;
    const runs = {...normalized.chatRuns};
    for (const [id, r] of Object.entries(runs)) {
      if (!boot.has(id) || boot.get(id) !== r.generation) continue;
      const original = data(state.chatRuns, id);
      if (restartable.includes(r.phase) || (r.phase === 'interrupted' && original !== r)) {
        runs[id] = {...r, phase:'interrupted', delivery:null}; changed = true;
        const f = resolve(state, r.conversationId, id);
        if (f && f.entry.status !== 'interrupted') {
          if (messages === state.messages) messages = {...messages};
          const list = messages[r.conversationId];
          messages[r.conversationId] = mapOwnArray(list, e => data(e, 'id') === f.output.id ? {...e, transcript:{...e.transcript, status:'interrupted'}} : e);
        }
      }
    }
    if (!changed) { reconciled = true; reloadError = false; return {ok:true}; }
    const answer = save(latest => {
      if (latest !== state) throw new Error('Reload state changed');
      return {...latest, messages, chatRuns:runs};
    }, 'chat-reload');
    if (!answer.ok) { reloadError = true; return resultError(destroyed ? 'destroyed' : 'storage'); }
    reconciled = true; reloadError = false;
    for (const r of Object.values(runs)) notify(r, 'status');
    return {ok:true};
  }

  function publish(owner, value, phase) {
    const f = owns(owner);
    if (!f || (owner.finalizing && phase === 'running')) return false;
    const text = data(value, 'text'), processed = data(value, 'processed'), total = data(value, 'total');
    if (!record(value) || typeof text !== 'string' || text.length > 300000 || !safeCounter(processed) || !safeCounter(total) || total !== f.input.text.length || processed > total || (f.run.progress && processed < f.run.progress.processed) || (phase === 'final-pending-delivery' && processed !== total)) { owner.abort.abort(); owner.error = 'invalid-progress'; return false; }
    let answer;
    try { answer = publishChatProgress({conversationId:owner.conversationId, runId:owner.runId, entryId:f.output.id, generation:owner.generation, seq:f.run.lastSeq + 1, text, phase, progress:{processed, total}}); } catch { answer = {ok:false}; }
    if (!answer?.ok) { owner.abort.abort(); owner.error = 'progress-rejected'; return false; }
    notify(f.run, 'progress'); return true;
  }

  async function retryDelivery(request) {
    if (!record(request)) return resultError('invalid');
    const conversationId = data(request, 'conversationId'), runId = data(request, 'runId');
    if (destroyed) return resultError('destroyed', runId);
    const f = validLookup(conversationId, runId);
    if (!f) return resultError('unavailable', runId);
    const owner = owners.get(runId);
    if (owner?.cancelGeneration) return resultError('cancelled', runId);
    if (f.normalizedRun.phase === 'delivered') return {ok:true, runId};
    const pending = owner?.pending;
    if (!pending || !owns(owner)) return resultError('unavailable', runId);
    if (owner.deliveryTask) return owner.deliveryTask;
    const attempt = () => {
      const answer = save(state => {
        if (!owns(owner) || owner.pending !== pending) throw new Error('Revoked delivery');
        const latest = resolve(state, conversationId, runId);
        if (!latest || latest.run.generation !== pending.generation || latest.run.phase !== 'final-pending-delivery' || latest.run.lastSeq !== pending.seq || latest.entry.revision !== pending.expectedLiveRevision || latest.output.text !== pending.finalEntry.text) throw new Error('Stale delivery');
        const delivery = {id:pending.receiptId, entryId:pending.entryId, generation:pending.generation, revision:pending.revision, committedAt:now(), scope:'browser-local'};
        const finalEntry = {...latest.output, text:pending.finalEntry.text, transcript:{...latest.output.transcript, revision:pending.revision, generation:pending.generation, status:'stable'}};
        return patch(state, latest, {phase:'delivered', delivery, updatedAt:now()}, finalEntry);
      }, 'chat-delivery');
      if (answer.ok) { owner.pending = null; return {ok:true, runId}; }
      return resultError(answer.code, runId);
    };
    owner.deliveryTask = Promise.resolve().then(attempt);
    try { return await owner.deliveryTask; } finally {
      owner.deliveryTask = null;
      // Notify after releasing the save lock so the UI sees retry eligibility.
      if (!destroyed && !owner.cancelGeneration) notify(f.run, owner.pending ? 'storage-error' : 'delivery');
    }
  }

  async function execute(owner, checkpoint) {
    let f = owns(owner);
    if (!f) return;
    if (checkpoint) {
      const answer = save(state => {
        const latest = resolve(state, owner.conversationId, owner.runId);
        if (!owns(owner) || !latest) throw new Error('Revoked start');
        return patch(state, latest, {phase:'running', updatedAt:now()});
      }, 'chat-running');
      if (!answer.ok) { owner.error = 'run-start-save-failed'; notify(f.run, 'storage-error'); return; }
    }
    f = owns(owner);
    if (!f) return;
    try {
      const result = await adapter.execute({text:f.input.text, operation:f.run.operation, style:f.run.style, signal:owner.abort.signal, onProgress:value => { if (!owner.finalizing) publish(owner, value, 'running'); }});
      if (!owns(owner)) return;
      owner.finalizing = true;
      if (!publish(owner, result, 'final-pending-delivery')) return;
      f = owns(owner);
      if (!f) return;
      const revision = f.entry.revision + 1;
      if (!Number.isSafeInteger(revision)) { owner.abort.abort(); return; }
      owner.pending = Object.freeze({runId:owner.runId, generation:owner.generation, entryId:f.output.id, seq:f.run.lastSeq, expectedLiveRevision:f.entry.revision, revision,
        finalEntry:Object.freeze({...f.output, transcript:Object.freeze({...f.output.transcript, revision, status:'stable'})}), receiptId:owner.runId + ':final'});
      await retryDelivery({conversationId:owner.conversationId, runId:owner.runId});
    } catch (error) {
      if (!owns(owner) || error?.name === 'AbortError') return;
      owner.error = 'adapter-failed';
      const latest = owns(owner);
      if (latest) {
        const saved = save(state => {
          const current = resolve(state, owner.conversationId, owner.runId);
          if (!current || !owns(owner)) throw new Error('Revoked failure');
          const revision = current.entry.revision + 1;
          if (!Number.isSafeInteger(revision)) throw new Error('Invalid failure revision');
          return patch(state, current, {phase:'failed', updatedAt:now()}, {...current.output, transcript:{...current.output.transcript, status:'failed', revision}});
        }, 'chat-failed');
        if (saved.ok) owner.error = undefined;
        else owner.abort.abort();
        notify(latest.run, saved.ok ? 'status' : 'storage-error');
      }
    }
  }

  async function start(args) {
    if (destroyed) return resultError('destroyed');
    if (!reconciled) return resultError('reload-not-reconciled');
    if (!record(args)) return resultError('invalid');
    const [conversationId, submissionId, text, operation, style, inputEntryId, quote, suppliedLayout, richText] = ['conversationId', 'submissionId', 'text', 'operation', 'style', 'inputEntryId', 'quote', 'layoutMode', 'richText'].map(key => data(args, key));
    const layoutMode = suppliedLayout === undefined ? operation === 'markdown' ? 'elevated' : 'bubble' : suppliedLayout;
    const state = getState(), list = data(state.messages, conversationId);
    if (!identifier(conversationId) || !identifier(submissionId) || !ownDataArray(list) || !validText(text) || !['count', 'upper', 'markdown'].includes(operation) || !['short', 'full'].includes(style) || !['elevated', 'bubble'].includes(layoutMode) || adapter?.id !== 'local-text-v1') return resultError('invalid');
    try { normalizeComposerDocument(richText, {text, references:[]}); } catch { return resultError('invalid-rich-text'); }
    if (quote !== undefined && (!record(quote) || Object.keys(quote).length !== 3 || !['messageId', 'text', 'title'].every(k => own(quote, k)) || !identifier(quote.messageId) || typeof quote.text !== 'string' || typeof quote.title !== 'string' || quote.text.length > 100000 || quote.title.length > 100000 || !findOwnArray(list, e => data(e, 'id') === quote.messageId))) return resultError('invalid-quote');
    if (inputEntryId !== undefined && (!identifier(inputEntryId) || !findOwnArray(list, e => data(e, 'id') === inputEntryId && data(e, 'role') === 'user' && data(e, 'text') === text && data(e, 'richText') === richText))) return resultError('invalid-input');
    const runs = normalizeChatRuns(state).chatRuns;
    for (const r of Object.values(runs)) {
      if (r.conversationId !== conversationId) continue;
      if (r.submissionId === submissionId) {
        const f = resolve(state, conversationId, r.id);
        if (!f || r.operation !== operation || r.style !== style || f.input.text !== text || data(f.input, 'richText') !== richText || (inputEntryId !== undefined && inputEntryId !== r.inputEntryId) || !sameQuote(data(f.input, 'quote'), quote) || data(data(f.entry, 'payload'), 'layoutMode') !== layoutMode) return resultError('submission-mismatch');
        return {ok:true, runId:r.id, outputEntryId:r.outputEntryId};
      }
    }
    for (const r of Object.values(runs)) if (r.conversationId === conversationId && active.includes(getRuntime({conversationId, runId:r.id}).effectivePhase)) return resultError('busy');
    const key = JSON.stringify([conversationId, submissionId]);
    let ids = allocations.get(key);
    if (!ids) { ids = {runId:newId(), inputEntryId:inputEntryId ?? newId(), outputEntryId:newId()}; allocations.set(key, ids); }
    if (inputEntryId !== undefined && ids.inputEntryId !== inputEntryId) return resultError('submission-mismatch');
    if (![ids.runId, ids.inputEntryId, ids.outputEntryId].every(identifier) || new Set(Object.values(ids)).size !== 3) return resultError('invalid-id');
    const timestamp = now();
    const run = {schema:1, id:ids.runId, conversationId, submissionId, inputEntryId:ids.inputEntryId, outputEntryId:ids.outputEntryId, noticeEntryIds:[], adapterId:adapter.id, operation, style, styleProfileVersion:'local-answer-v1', generation:1, lastSeq:0, phase:'accepted', progress:{processed:0, total:text.length}, createdAt:timestamp, updatedAt:timestamp, delivery:null};
    const answer = save(latest => {
      const current = data(latest.messages, conversationId);
      if (!ownDataArray(current) || own(latest.chatRuns || {}, ids.runId) || findOwnArray(current, e => data(e, 'id') === ids.outputEntryId || (!inputEntryId && data(e, 'id') === ids.inputEntryId))) throw new Error('Changed submission');
      let input = inputEntryId ? findOwnArray(current, e => data(e, 'id') === inputEntryId && data(e, 'role') === 'user' && data(e, 'text') === text && data(e, 'richText') === richText) : {id:ids.inputEntryId, role:'user', text, ...(richText !== undefined ? {richText} : {}), createdAt:timestamp, transcript:{schema:1, kind:'message', revision:0, status:'stable'}, ...(quote ? {quote:{...quote}} : {})};
      if (!input) throw new Error('Input disappeared');
      if (inputEntryId && !sameQuote(data(input, 'quote'), quote)) {
        if (!quote || data(input, 'quote')) throw new Error('Existing input quote differs');
        input = {...input, quote:{...quote}};
      }
      const output = {id:ids.outputEntryId, role:'bot', text:'', createdAt:timestamp, transcript:{schema:1, kind:'send-message', revision:0, status:'pending', runId:ids.runId, generation:1, replica:{producer:'local-text-v1', operation}, payload:{layoutMode}}};
      const acceptedList = mapOwnArray(current, e => inputEntryId && data(e, 'id') === inputEntryId ? input : e);
      if (!inputEntryId) acceptedList.push(input);
      return {...latest, messages:{...latest.messages, [conversationId]:[...acceptedList, output]}, chatRuns:{...latest.chatRuns, [ids.runId]:run}, ...consumedDraft(latest, {conversationId, text, richText, quote})};
    }, 'chat-acceptance');
    if (!answer.ok) return resultError(answer.code);
    allocations.delete(key);
    const owner = ownerFor(run); notify(run, 'accepted');
    queueMicrotask(() => { if (!destroyed) void execute(owner, true); });
    return {ok:true, runId:run.id, outputEntryId:run.outputEntryId};
  }

  async function cancel(request) {
    if (!record(request)) return resultError('invalid');
    const conversationId = data(request, 'conversationId'), runId = data(request, 'runId');
    if (destroyed) return resultError('destroyed', runId);
    const f = validLookup(conversationId, runId);
    if (!f) return resultError('unavailable', runId);
    if (f.run.phase === 'cancelled') return {ok:true, runId};
    if (!active.includes(f.run.phase) && f.run.phase !== 'interrupted') return resultError('terminal', runId);
    let owner = owners.get(runId);
    if (!owner) owner = ownerFor(f.run);
    owner.cancelGeneration ||= f.run.generation + 1;
    owner.abort.abort(); owner.pending = null;
    if (!Number.isSafeInteger(owner.cancelGeneration) || !Number.isSafeInteger(f.entry.revision + 1)) { owner.error = 'cancel-save-failed'; notify(f.run, 'storage-error'); return resultError('invalid', runId); }
    const answer = save(state => {
      const current = resolve(state, conversationId, runId);
      if (!current || current.run.generation !== owner.generation) throw new Error('Revoked cancellation');
      return patch(state, current, {generation:owner.cancelGeneration, phase:'cancelled', delivery:null, updatedAt:now()}, {...current.output, transcript:{...current.output.transcript, generation:owner.cancelGeneration, status:'cancelled', revision:current.entry.revision + 1}});
    }, 'chat-cancel');
    owner.error = answer.ok ? undefined : 'cancel-save-failed';
    notify(f.run, answer.ok ? 'status' : 'storage-error');
    return answer.ok ? {ok:true, runId} : resultError(answer.code, runId);
  }

  async function resume(request) {
    if (!record(request)) return resultError('invalid');
    const conversationId = data(request, 'conversationId'), runId = data(request, 'runId');
    if (destroyed) return resultError('destroyed', runId);
    if (!reconciled) return resultError('reload-not-reconciled', runId);
    const f = validLookup(conversationId, runId);
    if (!f || !getRuntime({conversationId, runId}).canResume || !local(f)) return resultError('unavailable', runId);
    for (const r of Object.values(normalizeChatRuns(getState()).chatRuns)) if (r.id !== runId && r.conversationId === conversationId && active.includes(getRuntime({conversationId, runId:r.id}).effectivePhase)) return resultError('busy', runId);
    const generation = f.run.generation + 1;
    if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(f.entry.revision + 1)) return resultError('invalid', runId);
    const answer = save(state => {
      const current = resolve(state, conversationId, runId);
      if (!current || current.run.generation !== f.run.generation) throw new Error('Stale resume');
      return patch(state, current, {generation, lastSeq:0, phase:'running', delivery:null, progress:{processed:0, total:current.input.text.length}, updatedAt:now()}, {...current.output, transcript:{...current.output.transcript, generation, revision:current.entry.revision + 1, status:'streaming'}});
    }, 'chat-resume');
    if (!answer.ok) return resultError(answer.code, runId);
    owners.get(runId)?.abort.abort();
    const owner = ownerFor({...f.run, generation}); notify(f.run, 'status');
    queueMicrotask(() => { if (!destroyed) void execute(owner, false); });
    return {ok:true, runId};
  }

  // Call only after the conversation's durable removal has succeeded.
  // Revocation stops local work without creating a second persistence transaction.
  function revokeConversation(conversationId) {
    for (const [runId, owner] of owners) if (owner.conversationId === conversationId) {
      owner.abort.abort(); owner.pending = null; owners.delete(runId);
    }
    for (const key of allocations.keys()) {
      let scope; try { scope = JSON.parse(key); } catch { continue; }
      if (Array.isArray(scope) && scope[0] === conversationId) allocations.delete(key);
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const owner of owners.values()) { owner.abort.abort(); owner.pending = null; }
    owners.clear(); allocations.clear(); boot?.clear();
    onEntryChange = undefined;
  }
  return {reconcileReload, start, cancel, resume, retryDelivery, getRuntime, revokeConversation, destroy};
}

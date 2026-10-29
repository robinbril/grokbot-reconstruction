import {validateCanvasInput,resolveCanvasInput,pinnedCanvasInput,saveCanvasInput,canvasInputKey} from './canvas-context.mjs';
import {normalizeRichText} from './rich-text.mjs';
import {validateMcpReferences} from './mcp-references.mjs';
import {normalizeSkillRefs} from './skills.mjs';
import {incomingReplyId,resolveIncomingReply} from './incoming-replies.mjs';
import {prepareModelAttachmentsBeforeAcceptance} from './model-attachment-input.mjs';
import { createHash, randomUUID } from "node:crypto";
import { harnessError, identifier, bounded } from "./store.mjs";
import { normalizeRule, nextOccurrence, dueOccurrences } from "./workflow-rules.mjs";
const terminal = /* @__PURE__ */ new Set(["completed", "failed", "cancelled", "interrupted"]);
const own = (obj, key) => Object.hasOwn(obj ?? {}, key) ? obj[key] : void 0;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const errorValue = (e) => ({ code: e.code ?? "WORKFLOW_FAILED", message: bounded(e.message ?? "Workflow failed", 2e3), retryable: e.retryable !== false });
function queuedNativeRun(state, queue) {
  return state.runs.find((run) => run.workflowQueueId === queue.id && run.workflowPayloadHash === queue.payloadHash && run.requestId === queue.nativeRequestId && (!queue.runId || run.id === queue.runId));
}
function reconcileScheduleResult(state, queue, run) {
  if (!terminal.has(run.status)) return;
  const schedule = state.schedules.find((item) => item.id === queue.source.scheduleId);
  if (!schedule) return;
  schedule.lastRunId = run.id;
  schedule.lastResult = run.status;
  if (schedule.rule.kind === "once" && schedule.status === "enabled" && !schedule.nextDueAt) {
    schedule.status = "completed";
    schedule.enabled = false;
  }
}
function ensure(s) {
  s.queue ??= [];
  s.schedules ??= [];
  s.workflow ??= { nextSequence: 0, hold: null };
  s.workflow.nextSequence ??= 0;
  return s;
}
function receipt(s, key, value) {
  const prior = own(s?.requests, key);
  if (prior && prior.hash !== hash(value)) throw harnessError("IDEMPOTENCY_CONFLICT", "Request identifier was already used for different input", 409);
  return prior?.response;
}
const saveReceipt = (s, key, value, response) => {
  s.requests[key] = { hash: hash(value), response: structuredClone(response) };
};
function normalizeWorkflowPayload(body) {
  if (body.attachments && (!Array.isArray(body.attachments) || body.attachments.length) || body.files) throw harnessError("ATTACHMENTS_UNSUPPORTED", "Use uploaded attachmentRefs, not browser paths or files", 422);
  const refs = body.attachmentRefs;
  const skillRefs=normalizeSkillRefs(body.skillRefs);
  if (refs !== void 0 && (!Array.isArray(refs) || refs.length > 10 || refs.some((ref) => !ref || typeof ref !== "object" || !identifier(ref.attachmentId) || !Number.isSafeInteger(ref.size) || ref.size < 0 || typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256) || Object.keys(ref).some((k) => !["attachmentId", "sha256", "size"].includes(k))))) throw harnessError("INVALID_ATTACHMENTS", "Use bounded immutable uploaded attachment references", 422);
  if (typeof body.text !== "string" || body.text.length > 32768 || !body.text.trim() && !refs?.length && !skillRefs?.length) throw harnessError("INVALID_TEXT", "Prompt text or ready uploaded attachments required", 422);
  if (body.quote !== void 0 && typeof body.quote !== "string") throw harnessError("INVALID_CONTEXT", "Quote must be text", 422);
  if (body.skillReferences !== void 0 && (!Array.isArray(body.skillReferences) || body.skillReferences.length > 20 || body.skillReferences.some((v) => typeof v !== "string" || v.length > 2e3))) throw harnessError("INVALID_CONTEXT", "Skill references must be bounded text", 422);
  const richText=normalizeRichText(body);
  const replyToId=incomingReplyId(body.replyToId);
  return { text: body.text, ...(richText!==undefined?{richText}:{}), ...(skillRefs!==undefined?{skillRefs}:{}), ...(replyToId!==undefined?{replyToId}:{}), ...body.quote !== void 0 ? { quote: body.quote } : {}, ...body.skillReferences !== void 0 ? { skillReferences: structuredClone(body.skillReferences) } : {}, ...refs?.length ? { attachmentRefs: structuredClone(refs) } : {} };
}
class WorkflowEngine {
  constructor({ store, runtime, attachments, clock = () => /* @__PURE__ */ new Date(), autoStart = true, intervalMs = 1e3, maxPending = 50 }) {
    Object.assign(this, { store, runtime, attachments, clock, maxPending });
    this.autoStart = autoStart;
    this.intervalMs = intervalMs;
    this.pumps = /* @__PURE__ */ new Map();
    this.subscriptions = /* @__PURE__ */ new Map();
    this.syncs = /* @__PURE__ */ new Map();
    this.tickTail = Promise.resolve();
    this.closed = false;
    this.store.workflowErrors ??= /* @__PURE__ */ new Map();
  }
  now() {
    return new Date(this.clock()).toISOString();
  }
  async init() {
    for (const [id, state] of this.store.states) {
      this.observe(id);
      if (!state.queue?.length) continue;
      await this.store.transaction(state.owner, id, (s, emit) => {
        ensure(s);
        for (const q of s.queue) {
          if (["queued", "preparing"].includes(q.status)) {
            q.status = "queued";
            delete q.error;
            continue;
          }
          if (["sending", "running"].includes(q.status)) {
            const run = queuedNativeRun(s, q);
            if (run) {
              q.runId = run.id;
              q.status = terminal.has(run.status) ? run.status : "interrupted";
              if (run.error) q.error = run.error;
              reconcileScheduleResult(s, q, run);
            } else q.status = "interrupted";
            if (q.status === "interrupted") {
              q.error = { code: "EXECUTION_UNCERTAIN", message: "Server restarted after dispatch reservation. Prior work was not resent.", retryable: false };
              s.workflow.hold = { code: "EXECUTION_UNCERTAIN", queueId: q.id, runId: q.runId, message: q.error.message };
            }
          }
        }
        const prior = s.runs.findLast((r) => r.status === "interrupted" && r.error?.code === "SERVER_RESTART" && !s.workflow.reviewedRunIds?.includes(r.id));
        if (prior && s.queue.some((q) => !terminal.has(q.status)) && !s.workflow.hold) s.workflow.hold = { code: "EXECUTION_UNCERTAIN", queueId: null, runId: prior.id, message: "Server restarted during previous model work. Review effects before continuing." };
        emit("queue.changed", { queue: s.queue, workflow: s.workflow });
      });
    }
    if (this.autoStart) {
      this.timer = setInterval(() => this.tick().catch(() => {
      }), this.intervalMs);
      this.timer.unref();
      await this.tick();
    }
    return this;
  }
  observe(id) {
    if (this.subscriptions.has(id)) return;
    this.subscriptions.set(id, this.store.subscribe(id, (event) => {
      if (event.type.startsWith("run.")) this.sync(id, event).catch(() => {
      });
    }));
  }
  async prepare(owner, id, body, {canvasKey}={}) {
    const payload = normalizeWorkflowPayload(body);
    await validateMcpReferences(this.runtime,owner,id,payload.richText);
    if(canvasKey)pinnedCanvasInput(this.store.get(owner,id),canvasKey,payload.richText);
    else await validateCanvasInput(this.store,owner,id,payload.richText);
    if(payload.skillRefs?.length){if(!this.runtime.skills)throw harnessError("SKILLS_UNAVAILABLE","Skill registry unavailable",503);this.runtime.skills.resolve(owner,payload.skillRefs);}
    resolveIncomingReply(this.store.get(owner,id),payload.replyToId);
    let metadata = [];
    if (payload.attachmentRefs?.length) try {
      metadata = (await prepareModelAttachmentsBeforeAcceptance(this.attachments, owner, id, payload.attachmentRefs)).attachments;
    } catch (e) {
      if (e.status === 404) throw Object.assign(harnessError("INVALID_ATTACHMENTS", "One or more uploaded attachments are unavailable", 422),{accepted:false});
      throw e;
    }
    return { payload, metadata };
  }
  async admit(s, emit, { requestId, payload, metadata = [], source = { kind: "manual" }, key = "workflow-queue:" + requestId, at = this.now() }) {
    ensure(s);
    const previous = receipt(s, key, payload);
    if (previous) return previous;
    await validateMcpReferences(this.runtime,s.owner,s.conversationId,payload.richText,s);
    resolveIncomingReply(s,payload.replyToId);
    const canvasInput=source.kind==='schedule'?pinnedCanvasInput(s,canvasInputKey('schedule',source.scheduleId,source.scheduleRevision),payload.richText):resolveCanvasInput(s,payload.richText);
    if (s.queue.filter((q2) => !terminal.has(q2.status)).length >= this.maxPending) throw harnessError("QUEUE_CAPACITY", "At most50 pending messages per conversation", 429, true);
    const id = randomUUID(), q = { id, requestId, nativeRequestId: "queue:" + id, status: "queued", enqueueSequence: ++s.workflow.nextSequence, createdAt: at, payload: structuredClone(payload), payloadHash: hash(payload), attachments: metadata, source: structuredClone(source) };
    saveCanvasInput(s,canvasInputKey('queue',id),canvasInput);
    s.queue.push(q);
    const response = { schema: 1, accepted: true, requestId, conversationId: s.conversationId, queueId: id, status: "queued" };
    saveReceipt(s, key, payload, response);
    emit("queue.changed", { queue: s.queue, workflow: s.workflow });
    return response;
  }
  async enqueue(owner, id, body) {
    const key = "workflow-queue:" + body.requestId, payload = normalizeWorkflowPayload(body), prior = receipt(this.store.get(owner, id), key, payload);
    if (prior) return structuredClone(prior);
    const prepared = await this.prepare(owner, id, body);
    let accepted;
    await this.store.transaction(owner, id, async(s, emit) => {
      accepted = await this.admit(s, emit, { requestId: body.requestId, ...prepared });
    });
    this.observe(id);
    this.wake(id);
    return accepted;
  }
  wake(id) {
    if (this.closed || this.pumps.has(id)) return;
    const job = Promise.resolve().then(() => this.pump(id)).catch(() => {
    }).finally(() => {
      if (this.pumps.get(id) === job) this.pumps.delete(id);
      const state = this.store.states.get(id);
      if (!this.closed && state && !state.workflow?.hold && !this.runtime.active(id) && state.queue?.find((q) => !terminal.has(q.status))?.status === "queued") setImmediate(() => this.wake(id));
    });
    this.pumps.set(id, job);
  }
  async pump(id) {
    const current = this.store.states.get(id);
    if (!current || this.closed) return;
    if (current.workflow?.hold || this.runtime.active(id)) return;
    const head = (current.queue ?? []).find((q) => !terminal.has(q.status));
    if (!head || head.status !== "queued") return;
    const owner = current.owner;
    let claimed = false;
    await this.store.transaction(owner, id, (s, emit) => {
      ensure(s);
      const q = s.queue.find((q2) => q2.id === head.id);
      if (s.workflow.hold || this.runtime.active(id) || s.queue.find((q2) => !terminal.has(q2.status))?.id !== q?.id || q.status !== "queued") return;
      q.status = "preparing";
      q.attemptId = randomUUID();
      delete q.error;
      claimed = true;
      emit("queue.changed", { queue: s.queue, workflow: s.workflow });
    });
    if (!claimed) return;
    try {
      await this.runtime.withLifecycle(id, async () => {
        if (this.runtime.active(id)) {
          await this.store.transaction(owner, id, (s, emit) => {
            const q2 = s.queue.find((q3) => q3.id === head.id);
            if (q2.status === "preparing") q2.status = "queued";
            emit("queue.changed", { queue: s.queue, workflow: s.workflow });
          });
          return;
        }
        const q = this.store.get(owner, id).queue.find((q2) => q2.id === head.id);
        if (q.status !== "preparing") return;
        const prepared = await this.prepare(owner, id, q.payload,{canvasKey:canvasInputKey('queue',q.id)});
        await this.runtime.connect(owner, id);
        let send = false;
        await this.store.transaction(owner, id, (s, emit) => {
          const saved = s.queue.find((q2) => q2.id === head.id);
          if (saved.status !== "preparing" || s.workflow.hold) return;
          saved.status = "sending";
          saved.sendMarkedAt = this.now();
          send = true;
          emit("queue.changed", { queue: s.queue, workflow: s.workflow });
        });
        if (!send) return;
        const accepted = await this.runtime.startUnlocked(owner, id, { requestId: q.nativeRequestId, ...q.payload, attachmentMetadata: prepared.metadata }, { queueId: q.id, queuePayloadHash: q.payloadHash });
        await this.store.transaction(owner, id, (s, emit) => {
          const saved = s.queue.find((saved2) => saved2.id === q.id);
          const run = queuedNativeRun(s, saved);
          if (!run || run.id !== accepted.runId) throw harnessError("QUEUE_BINDING_CONFLICT", "Native receipt does not bind this exact accepted queue payload", 409);
          saved.runId = accepted.runId;
          emit("queue.changed", { queue: s.queue, workflow: s.workflow });
        });
      });
      await this.sync(id);
    } catch (e) {
      await this.store.transaction(owner, id, (s, emit) => {
        const q = s.queue.find((q2) => q2.id === head.id);
        if (terminal.has(q.status)) return;
        const native = queuedNativeRun(s, q);
        if (native) {
          q.runId = native.id;
          return;
        }
        q.status = "blocked";
        q.error = errorValue(e);
        delete q.sendMarkedAt;
        emit("queue.changed", { queue: s.queue, workflow: s.workflow });
      });
    }
  }
  sync(id, event) {
    if (this.closed) return Promise.resolve();
    const prior = this.syncs.get(id) ?? Promise.resolve();
    const state = this.store.states.get(id);
    if (!state) return Promise.resolve();
    const job = prior.catch(() => {
    }).then(() => this.store.transaction(state.owner, id, (s, emit) => {
      ensure(s);
      let changed = false;
      if (event?.type === "run.interrupted" && s.queue.some((q) => !terminal.has(q.status))) {
        const interrupted = event.data.run;
        s.workflow.hold = { code: "EXECUTION_UNCERTAIN", queueId: s.queue.find((q) => q.runId === interrupted.id)?.id ?? null, runId: interrupted.id, message: "Previous model work was interrupted; review its effects before continuing queued work." };
        changed = true;
      }
      for (const q of s.queue) {
        if (terminal.has(q.status)) continue;
        const run = queuedNativeRun(s, q);
        if (!run) continue;
        const status = terminal.has(run.status) ? run.status : ["running", "waiting_approval", "cancelling"].includes(run.status) ? "running" : "sending";
        if (q.status !== status || q.runId !== run.id) {
          q.status = status;
          q.runId = run.id;
          changed = true;
          if (run.error) q.error = run.error;
          if (status === "interrupted") s.workflow.hold = { code: "EXECUTION_UNCERTAIN", queueId: q.id, runId: run.id, message: "Previous model work was interrupted; review its effects before continuing queued work." };
          reconcileScheduleResult(s, q, run);
        }
      }
      if (changed) emit("queue.changed", { queue: s.queue, workflow: s.workflow });
    })).finally(() => {
      if (this.syncs.get(id) === job) this.syncs.delete(id);
      this.wake(id);
    });
    this.syncs.set(id, job);
    return job;
  }
  async cancel(owner, id, queueId, requestId) {
    let response;
    await this.store.transaction(owner, id, (s, emit) => {
      ensure(s);
      const key = "workflow-cancel:" + queueId + ":" + requestId, old = receipt(s, key, {});
      if (old) {
        response = old;
        return;
      }
      const q = s.queue.find((q2) => q2.id === queueId);
      if (!q) throw harnessError("NOT_FOUND", "Queue row not found", 404);
      if (["sending", "running"].includes(q.status)) throw harnessError("QUEUE_IN_FLIGHT", "Use Stop on the actual run", 409);
      if (!terminal.has(q.status)) q.status = "cancelled";
      response = { schema: 1, acknowledged: true, queueId, status: q.status };
      saveReceipt(s, key, {}, response);
      emit("queue.changed", { queue: s.queue, workflow: s.workflow });
    });
    this.wake(id);
    return response;
  }
  async resume(owner, id, requestId) {
    await this.store.transaction(owner, id, (s, emit) => {
      ensure(s);
      const key = "workflow-resume:" + requestId;
      if (receipt(s, key, {})) return;
      if (s.workflow.hold?.runId) {
        s.workflow.reviewedRunIds ??= [];
        if (!s.workflow.reviewedRunIds.includes(s.workflow.hold.runId)) s.workflow.reviewedRunIds.push(s.workflow.hold.runId);
      }
      s.workflow.hold = null;
      saveReceipt(s, key, {}, { schema: 1, acknowledged: true });
      emit("queue.changed", { queue: s.queue, workflow: s.workflow });
    });
    this.wake(id);
    return { schema: 1, acknowledged: true };
  }
  async retry(owner, id, queueId, requestId) {
    await this.store.transaction(owner, id, (s, emit) => {
      ensure(s);
      const key = "workflow-retry:" + queueId + ":" + requestId;
      if (receipt(s, key, {})) return;
      const q = s.queue.find((q2) => q2.id === queueId);
      if (!q) throw harnessError("NOT_FOUND", "Queue row not found", 404);
      if (q.status === "blocked") {
        q.status = "queued";
        delete q.error;
        emit("queue.changed", { queue: s.queue, workflow: s.workflow });
      }
      saveReceipt(s, key, {}, { schema: 1, acknowledged: true });
    });
    this.wake(id);
    return { schema: 1, acknowledged: true };
  }
  list(owner, id) {
    const s = this.store.get(owner, id);
    return { schema: 1, schedules: structuredClone(s?.schedules ?? []) };
  }
  async createSchedule(owner, id, body) {
    const normalized = normalizeWorkflowPayload(body.payload ?? {}), rule = normalizeRule(body.rule);
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200 || typeof body.enabled !== "boolean") throw harnessError("INVALID_SCHEDULE", "Title and explicit enabled boolean required", 422);
    const canonical = { title: body.title, payload: normalized, rule, enabled: body.enabled }, replay = receipt(this.store.get(owner, id), "workflow-schedule-create:" + body.requestId, canonical);
    if (replay) return structuredClone(replay);
    await this.prepare(owner, id, normalized);
    let response;
    await this.store.transaction(owner, id, async(s, emit) => {
      ensure(s);
      const key = "workflow-schedule-create:" + body.requestId, old = receipt(s, key, canonical);
      if (old) {
        response = old;
        return;
      }
      await validateMcpReferences(this.runtime,owner,id,normalized.richText,s);
      resolveIncomingReply(s,normalized.replyToId);
      const canvasInput=resolveCanvasInput(s,normalized.richText);
      if (s.schedules.filter((s2) => s2.status !== "deleted").length >= 100) throw harnessError("SCHEDULE_CAPACITY", "At most100 schedules per conversation", 429);
      const at = this.now(), next = nextOccurrence(rule, at), schedule = { id: randomUUID(), revision: 1, ...canonical, status: body.enabled ? "enabled" : "paused", nextDueAt: body.enabled ? next?.at ?? null : null, createdAt: at, updatedAt: at, skippedCount: 0 };
      if (body.enabled && !next) throw harnessError("INVALID_SCHEDULE", "Choose a future one-time instant", 422);
      saveCanvasInput(s,canvasInputKey('schedule',schedule.id,schedule.revision),canvasInput);
      s.schedules.push(schedule);
      response = { schema: 1, schedule, inFlightRunIds: [] };
      saveReceipt(s, key, canonical, response);
      emit("schedule.changed", { schedule });
    });
    this.observe(id);
    return response;
  }
  async scheduleAction(owner, id, scheduleId, kind, body) {
    let prepared, rule, enabled;
    if (kind === "edit") {
      prepared = { payload: normalizeWorkflowPayload(body.payload ?? {}) };
      rule = normalizeRule(body.rule);
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200) throw harnessError("INVALID_SCHEDULE", "Title required", 422);
      if (Object.hasOwn(body, "enabled")) {
        if (typeof body.enabled !== "boolean") throw harnessError("INVALID_SCHEDULE", "Enabled must be a boolean", 422);
        enabled = body.enabled;
      }
    }
    const normalizedCommand = { kind, expectedRevision: body.expectedRevision, ...prepared ? { title: body.title, payload: prepared.payload, rule, ...enabled !== void 0 ? { enabled } : {} } : {} };
    const existing = receipt(this.store.get(owner, id), "workflow-schedule-action:" + scheduleId + ":" + body.requestId, normalizedCommand);
    if (existing) return structuredClone(existing);
    if (prepared) await this.prepare(owner, id, prepared.payload);
    let response;
    await this.store.transaction(owner, id, async(s, emit) => {
      ensure(s);
      const key = "workflow-schedule-action:" + scheduleId + ":" + body.requestId, canonical = { kind, expectedRevision: body.expectedRevision, ...prepared ? { title: body.title, payload: prepared.payload, rule, ...enabled !== void 0 ? { enabled } : {} } : {} }, old = receipt(s, key, canonical);
      if (old) {
        response = old;
        return;
      }
      const schedule = s.schedules.find((item) => item.id === scheduleId);
      if (!schedule) throw harnessError("NOT_FOUND", "Schedule not found", 404);
      if (schedule.revision !== body.expectedRevision) throw harnessError("REVISION_CONFLICT", "Schedule changed; refresh before editing", 409);
      if (schedule.status === "deleted") throw harnessError("SCHEDULE_DELETED", "Deleted schedules cannot be changed", 409);
      if(kind==='edit'||kind==='enable'){
       await validateMcpReferences(this.runtime,owner,id,(prepared?.payload??schedule.payload).richText,s);
       resolveCanvasInput(s,(prepared?.payload??schedule.payload).richText);
      }
      const previousCanvasInput=pinnedCanvasInput(s,canvasInputKey('schedule',schedule.id,schedule.revision),schedule.payload.richText);
      const at = this.now();
      let queueId;
      if (kind === "run-now") {
        const accepted = await this.admit(s, emit, { requestId: body.requestId, payload: schedule.payload, source: { kind: "schedule", scheduleId, scheduleRevision: schedule.revision, occurrenceKey: "manual:" + body.requestId, dueAt: at }, key: "workflow-schedule-manual:" + scheduleId + ":" + body.requestId });
        queueId = accepted.queueId;
        schedule.lastQueueId = queueId;
      } else if (kind === "edit") {
        resolveIncomingReply(s,prepared.payload.replyToId);
        const nextDueAt = (enabled ?? schedule.enabled) ? nextOccurrence(rule, at)?.at ?? null : null;
        if (enabled === true && !nextDueAt) throw harnessError("INVALID_SCHEDULE", "Choose a future time or Run now", 422);
        schedule.title = body.title;
        schedule.payload = prepared.payload;
        schedule.rule = rule;
        schedule.nextDueAt = nextDueAt;
        if (enabled !== void 0) {
          schedule.enabled = enabled;
          schedule.status = enabled ? "enabled" : "paused";
          if (!enabled) for (const q of s.queue) if (q.source.scheduleId === scheduleId && ["queued", "preparing", "blocked"].includes(q.status)) q.status = "cancelled";
        }
        schedule.revision++;
        saveCanvasInput(s,canvasInputKey('schedule',schedule.id,schedule.revision),resolveCanvasInput(s,schedule.payload.richText));
      } else if (kind === "enable") {
        schedule.enabled = true;
        schedule.status = "enabled";
        schedule.nextDueAt = nextOccurrence(schedule.rule, at)?.at ?? null;
        if (!schedule.nextDueAt) throw harnessError("INVALID_SCHEDULE", "Choose a future time or Run now", 422);
        schedule.revision++;
      } else if (kind === "pause" || kind === "delete") {
        schedule.enabled = false;
        schedule.status = kind === "delete" ? "deleted" : "paused";
        schedule.nextDueAt = null;
        schedule.revision++;
        for (const q of s.queue) if (q.source.scheduleId === scheduleId && ["queued", "preparing", "blocked"].includes(q.status)) q.status = "cancelled";
      } else throw harnessError("INVALID_ACTION", "Unsupported schedule action", 422);
      if(kind!=='edit')saveCanvasInput(s,canvasInputKey('schedule',schedule.id,schedule.revision),previousCanvasInput);
      schedule.updatedAt = at;
      const inFlightRunIds = s.queue.filter((q) => q.source.scheduleId === scheduleId && ["sending", "running"].includes(q.status) && q.runId).map((q) => q.runId);
      response = { schema: 1, schedule, ...queueId ? { queueId } : {}, inFlightRunIds };
      saveReceipt(s, key, canonical, response);
      emit("schedule.changed", { schedule });
      emit("queue.changed", { queue: s.queue, workflow: s.workflow });
    });
    this.observe(id);
    this.wake(id);
    return response;
  }
  tick() {
    const work = this.tickTail.catch(() => {
    }).then(async () => {
      if (this.closed) return;
      for (const [id, current] of this.store.states) {
        this.observe(id);
        try {
          if (current.schedules?.some((schedule) => schedule.status === "enabled" && schedule.nextDueAt && schedule.nextDueAt <= this.now() && !(schedule.lastError?.code === "QUEUE_CAPACITY" && (current.queue ?? []).filter((q) => !terminal.has(q.status)).length >= this.maxPending) && !(current.queue ?? []).some((q) => q.source.scheduleId === schedule.id && !terminal.has(q.status)))) {
            await this.store.transaction(current.owner, id, async(s, emit) => {
              ensure(s);
              for (const schedule of [...s.schedules].sort((a, b) => (a.nextDueAt ?? "").localeCompare(b.nextDueAt ?? "") || a.id.localeCompare(b.id))) {
                if (schedule.status !== "enabled" || !schedule.nextDueAt || schedule.nextDueAt > this.now()) continue;
                if (s.queue.some((q) => q.source.scheduleId === schedule.id && !terminal.has(q.status))) continue;
                try {
                  const due = dueOccurrences(schedule.rule, schedule.nextDueAt, this.now());
                  if (!due) continue;
                  if (due.eligible) {
                    if (s.queue.filter((q) => !terminal.has(q.status)).length >= this.maxPending) {
                      if (schedule.lastError?.code !== "QUEUE_CAPACITY") {
                        schedule.lastError = { code: "QUEUE_CAPACITY", message: "Scheduled work is deferred until this conversation has queue capacity", retryable: true };
                        emit("schedule.changed", { schedule });
                      }
                      continue;
                    }
                    const key = schedule.id + ":" + schedule.revision + ":" + due.latest.key;
                    const accepted = await this.admit(s, emit, { requestId: "schedule_" + hash(key).slice(0, 48), payload: schedule.payload, source: { kind: "schedule", scheduleId: schedule.id, scheduleRevision: schedule.revision, occurrenceKey: key, dueAt: due.latest.at }, key: "workflow-occurrence:" + key });
                    schedule.lastQueueId = accepted.queueId;
                    schedule.skippedCount += Math.max(0, due.total - 1);
                  } else {
                    schedule.skippedCount += due.total;
                    schedule.lastResult = "missed";
                  }
                  delete schedule.lastError;
                  schedule.nextDueAt = due.next?.at ?? null;
                  if (!due.eligible && !schedule.nextDueAt) {
                    schedule.enabled = false;
                    schedule.status = "completed";
                  }
                } catch (error) {
                  const diagnostic = { code: error.code ?? "SCHEDULE_RULE_FAILED", message: "Schedule could not be evaluated; its due cursor has not advanced", retryable: false };
                  if (JSON.stringify(schedule.lastError) === JSON.stringify(diagnostic)) continue;
                  schedule.lastError = diagnostic;
                }
                emit("schedule.changed", { schedule });
              }
            });
            this.store.workflowErrors.delete(id);
          }
        } catch (error) {
          this.store.workflowErrors.set(id, { code: "SCHEDULER_STORE_FAILED", causeCode: error.code ?? "STORE_ERROR", message: "Scheduled work could not be saved. It remains due and will be retried.", retryable: true, at: this.now() });
        }
        this.wake(id);
      }
      await Promise.allSettled([...this.pumps.values()]);
    });
    this.tickTail = work;
    return work;
  }
  async close() {
    this.closed = true;
    for (const stream of this.streams ?? []) stream.end();
    clearInterval(this.timer);
    await this.tickTail.catch(() => {
    });
    await Promise.allSettled([...this.pumps.values(), ...this.syncs.values()]);
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }
}
export {
  WorkflowEngine,
  normalizeWorkflowPayload
};

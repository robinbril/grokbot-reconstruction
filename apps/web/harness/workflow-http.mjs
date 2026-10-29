import { harnessError, identifier } from "./store.mjs";
import {openEventStream} from './event-stream.mjs';
function createWorkflowHandler({ workflows, store, json, body }) {
  return async (req, res, { owner, conversationId: id, route }) => {
    if (req.method === "GET" && route === "schedules") {
      json(res, 200, workflows.list(owner, id));
      return true;
    }
    if (req.method === "GET" && route === "events") {
      const state = store.get(owner, id);
      if (!state) throw harnessError("NOT_FOUND", "Conversation not found", 404);
      const url = new URL(req.url, "http://localhost"), offset = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > state.lastSeq) throw harnessError("INVALID_OFFSET", "Invalid event offset");
      workflows.streams ??= /* @__PURE__ */ new Set();
      openEventStream({store,owner,conversationId:id,res,after:offset,streams:workflows.streams});
      return true;
    }
    if (req.method !== "POST" || !/^queue(?:\/|$)|^schedules(?:\/|$)/.test(route)) return false;
    const b = await body(req);
    if (!identifier(b.requestId)) throw harnessError("INVALID_REQUEST_ID", "A bounded requestId is required");
    if (route === "queue") {
      json(res, 202, await workflows.enqueue(owner, id, b));
      return true;
    }
    if (route === "queue/resume") {
      json(res, 200, await workflows.resume(owner, id, b.requestId));
      return true;
    }
    const queue = route.match(/^queue\/([^/]+)\/(cancel|retry)$/);
    if (queue) {
      if (!identifier(queue[1])) throw harnessError("INVALID_ID", "Invalid queue identifier");
      json(res, 200, await workflows[queue[2]](owner, id, queue[1], b.requestId));
      return true;
    }
    if (route === "schedules") {
      json(res, 201, await workflows.createSchedule(owner, id, b));
      return true;
    }
    const schedule = route.match(/^schedules\/([^/]+)\/(edit|enable|pause|delete|run-now)$/);
    if (schedule) {
      if (!identifier(schedule[1]) || !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1) throw harnessError("INVALID_REVISION", "Schedule id and expectedRevision required", 422);
      json(res, 200, await workflows.scheduleAction(owner, id, schedule[1], schedule[2], b));
      return true;
    }
    throw harnessError("NOT_FOUND", "Workflow endpoint not found", 404);
  };
}
export {
  createWorkflowHandler
};

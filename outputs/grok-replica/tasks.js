// Independent browser-local model of the 0.71.2 agent/task routing contract.
// A task's conversation key is deliberately distinct from its owning Bot ID.
const reservedConversationKeys = new Set(['new', ...Object.getOwnPropertyNames(Object.prototype)]);

export function normalizeTasks(state) {
  const botIds = new Set(state.agents.map(agent => agent.id));
  const keys = new Set(botIds), tuples = new Set();
  state.tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(task => {
    if (!task || typeof task.id !== 'string' || typeof task.name !== 'string' ||
        !botIds.has(task.parentBotId) || typeof task.conversationId !== 'string' ||
        !task.id || !task.conversationId || reservedConversationKeys.has(task.conversationId) ||
        keys.has(task.conversationId)) return false;
    const tuple = JSON.stringify([task.parentBotId, task.id]);
    if (tuples.has(tuple)) return false;
    tuples.add(tuple); keys.add(task.conversationId);
    return true;
  }).map(task => {
    const next = { ...task, status: task.status === 'done' ? 'done' : 'open' };
    if (!Number.isFinite(task.pinnedAtMs) || task.pinnedAtMs < 0) delete next.pinnedAtMs;
    return next;
  });
  // A discarded saved task must not leave render reading its invalid dictionary key.
  // Existing real Bot selections and retained task selections keep their identity.
  if (!botIds.has(state.selected) && !state.tasks.some(task => task.conversationId === state.selected)) {
    state.selected = null;
  }
}

export const taskForConversation = (state, key) => state.tasks.find(task => task.conversationId === key);
export const tasksForBot = (state, parentBotId) => state.tasks.filter(task => task.parentBotId === parentBotId);
export const pinnedTasksForBot = (state, parentBotId) => tasksForBot(state, parentBotId)
  .filter(task => task.pinnedAtMs !== undefined)
  .sort((left, right) => left.pinnedAtMs - right.pinnedAtMs);

export function taskConversationAgent(state, key) {
  const task = taskForConversation(state, key);
  const parent = task && state.agents.find(agent => agent.id === task.parentBotId);
  return parent ? { ...parent, id: task.conversationId, parentBotId: parent.id, taskId: task.id } : undefined;
}

export function setTaskPinned(state, conversationId, isPinned, persist) {
  const task = taskForConversation(state, conversationId);
  if (!task) return false;
  const previous = task.pinnedAtMs;
  if (isPinned) task.pinnedAtMs = previous ?? Math.max(Date.now(), ...state.tasks.map(item => (item.pinnedAtMs ?? 0) + 1));
  else delete task.pinnedAtMs;
  if (persist()) return true;
  if (previous === undefined) delete task.pinnedAtMs;
  else task.pinnedAtMs = previous;
  return false;
}

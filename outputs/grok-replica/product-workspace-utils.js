export const source = number => `data-source-instance="INSTANCE-${String(number).padStart(3, '0')}"`;
export function bindWorkspace(host, root = host.overlay) {
  host.sourceMotion.ready.then(() => { if (root.isConnected) host.sourceMotion.bindTree(root); });
}
export function ownScope(host) {
  let controller = new AbortController(), generation = 0;
  const animations = new Set(), timers = new Set();
  return {
    get signal() { return controller.signal; }, get generation() { return generation; },
    animate(node, frames, timing, meta) { const a = host.sourceMotion.animate(node, frames, timing, meta); if (a) { animations.add(a); const done = () => animations.delete(a); a.finished.then(done,done); } return a; },
    timer(fn, ms) { const key = setTimeout(() => { timers.delete(key); fn(); }, ms); timers.add(key); return key; },
    clear() { generation++; controller.abort(); controller = new AbortController(); for (const a of animations) a.cancel(); animations.clear(); for (const id of timers) clearTimeout(id); timers.clear(); },
  };
}

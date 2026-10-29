import { setTimeout as delay } from 'node:timers/promises';

function childLifetime(child) {
  let finished = false, failure;
  const exit = new Promise(resolve => {
    const finish = () => {
      finished = true;
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      resolve();
    };
    const onExit = () => finish();
    const onError = () => { failure = Error('Local backend could not start'); finish(); };
    child.once('exit', onExit);
    child.once('error', onError);
  });
  let stopping;
  return {
    get finished() { return finished; },
    get failure() { return failure; },
    exited: exit,
    stop() {
      stopping ??= (async () => {
        if (finished) return;
        child.kill('SIGTERM');
        let timer;
        try {
          await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
          if (!finished) { child.kill('SIGKILL'); await exit; }
        } finally { clearTimeout(timer); }
      })();
      return stopping;
    },
  };
}

export async function acquireBackend({ probe, spawnBackend, signal, startupMs = 15000, pollMs = 100 }) {
  signal?.throwIfAborted();
  const initial = await probe();
  signal?.throwIfAborted();
  if (initial === 'verified') return { owned: false, stop: async () => {} };
  if (initial !== 'absent') throw Error('The configured local port is occupied by an unrelated service');
  const lifetime = childLifetime(spawnBackend()), deadline = Date.now() + startupMs;
  try {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (lifetime.finished) throw lifetime.failure ?? Error('Local backend exited before becoming ready');
      const state = await probe();
      if (state === 'foreign') throw Error('Local backend identity could not be verified');
      if (state === 'verified') {
        // Yield so an EADDRINUSE child cannot claim ownership of a concurrent server.
        await delay(pollMs, undefined, { signal });
        if (lifetime.finished) throw lifetime.failure ?? Error('Local backend exited before becoming ready');
        return { owned: true, exited: lifetime.exited, stop: () => lifetime.stop() };
      }
      await delay(pollMs, undefined, { signal });
    }
    throw Error('Local backend startup timed out');
  } catch (error) { await lifetime.stop(); throw error; }
}

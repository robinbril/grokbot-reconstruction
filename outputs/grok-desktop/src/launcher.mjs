import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { acquireBackend } from './lifecycle.mjs';
import { probeBackend } from './probe.mjs';
import { desktopOrigin, electronEnvironment } from './security.mjs';

function waitForDesktop(child, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const stop = () => {
      child.kill('SIGTERM');
      timer ??= setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const onError = () => { cleanup(); reject(Error('The desktop process could not start; run npm run setup:desktop')); };
    const onExit = code => {
      cleanup();
      if (code === 0 || signal?.aborted) resolve();
      else reject(Error('The desktop process exited unexpectedly'));
    };
    child.once('error', onError);
    child.once('exit', onExit);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });
}

export async function runDesktop({ env, backendRoot, desktopRoot, electronBinary, signal, spawnProcess = spawn }) {
  const origin = desktopOrigin(env), index = await readFile(path.join(backendRoot, 'index.html'));
  const backend = await acquireBackend({ signal,
    probe: () => probeBackend({ origin, index }),
    spawnBackend: () => spawnProcess(process.execPath, [path.join(backendRoot, 'server.mjs')], {
      cwd: path.resolve(backendRoot, '../..'), stdio: 'ignore',
      env: { ...env, GROK_BIND_HOST: '127.0.0.1', GROK_PUBLIC_ORIGIN: origin },
    }),
  });
  try {
    signal?.throwIfAborted();
    const child = spawnProcess(electronBinary, [desktopRoot], {
      cwd: desktopRoot, stdio: 'ignore', env: electronEnvironment(env, origin),
    });
    const backendFailure = new AbortController();
    const desktopSignal = signal ? AbortSignal.any([signal, backendFailure.signal]) : backendFailure.signal;
    const desktopExit = waitForDesktop(child, desktopSignal);
    if (!backend.owned) { await desktopExit; return; }
    const firstExit = await Promise.race([
      desktopExit.then(() => 'desktop'), backend.exited.then(() => 'backend'),
    ]);
    if (firstExit === 'backend') {
      backendFailure.abort();
      await desktopExit;
      throw Error('The local backend exited unexpectedly; restart Grok Local');
    }
  } finally { await backend.stop(); }
}

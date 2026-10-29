import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runDesktop } from '../src/launcher.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
async function unusedPort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('launcher isolates Electron environment and cleans up its backend when the native process exits', async () => {
  const port = await unusedPort(), processes = [], originalEnv = { PORT: String(port), PATH: process.env.PATH,
    CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-not-real', GROK_MODEL_PROVIDER: 'synthetic-provider' };
  let electronStarted = false, desktop;
  await runDesktop({ env: originalEnv, backendRoot: fixtures, desktopRoot: fixtures, electronBinary: '/synthetic/electron',
    spawnProcess(binary, args, options) {
      if (binary === '/synthetic/electron') {
        electronStarted = true;
        assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
        assert.equal(options.env.GROK_MODEL_PROVIDER, undefined);
        assert.equal(options.env.GROK_DESKTOP_ORIGIN, `http://127.0.0.1:${port}`);
        assert.deepEqual(args, [fixtures]);
        desktop = spawn(process.execPath, ['-e', 'process.exit(0)'], options); return desktop;
      }
      assert.equal(binary, process.execPath);
      assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, 'synthetic-not-real');
      assert.equal(args[0], path.join(fixtures, 'server.mjs'));
      const child = spawn(binary, args, options); processes.push(child); return child;
    } });
  assert.equal(electronStarted, true);
  assert.equal(processes.length, 1);
  assert.equal(processes[0].signalCode, 'SIGTERM');
  for (const child of [processes[0], desktop]) {
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('exit'), 0);
  }
});

test('Electron startup failure also cleans up the backend it created', async () => {
  const port = await unusedPort(); let backend, desktop;
  await assert.rejects(runDesktop({ env: { PORT: String(port) }, backendRoot: fixtures,
    desktopRoot: fixtures, electronBinary: '/does-not-exist',
    spawnProcess(binary, args, options) {
      const child = spawn(binary, args, options);
      if (binary === process.execPath) backend = child;
      else desktop = child;
      return child;
    } }), /desktop process could not start/);
  assert.equal(backend.signalCode, 'SIGTERM');
  for (const child of [backend, desktop]) {
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('exit'), 0);
  }
});

test('quit with a reused web backend leaves that server available', async t => {
  const index = await readFile(path.join(fixtures, 'index.html'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json');
    res.end(req.url === '/' ? index : JSON.stringify({ schema: 1, application: 'grokbot-reconstruction' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, controller = new AbortController(); let child;
  await runDesktop({ env: { PORT: String(port) }, backendRoot: fixtures, desktopRoot: fixtures,
    electronBinary: '/synthetic/electron', signal: controller.signal,
    spawnProcess(binary, _args, options) {
      assert.equal(binary, '/synthetic/electron', 'must not start a second backend');
      child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
      setTimeout(() => controller.abort(), 50);
      return child;
    } });
  assert.equal(child.signalCode, 'SIGTERM');
  assert.equal(server.listening, true);
  const response = await fetch(`http://127.0.0.1:${port}/api/harness/health`);
  assert.equal(response.status, 200);
  await response.arrayBuffer();
});

test('an occupied unrelated server never launches Electron and remains available', async t => {
  const server = http.createServer((_req, res) => res.end('other app'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let spawned = false;
  await assert.rejects(runDesktop({ env: { PORT: String(server.address().port) }, backendRoot: fixtures,
    desktopRoot: fixtures, electronBinary: '/synthetic/electron',
    spawnProcess() { spawned = true; } }), /occupied/);
  assert.equal(spawned, false);
  assert.equal(server.listening, true);
});

test('owned backend crash closes its desktop and removes process listeners and shutdown timers', async t => {
  const port = await unusedPort(), controller = new AbortController();
  let backend, desktop;
  const timers = new Set(), schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => {
    const timer = schedule(() => { timers.delete(timer); callback(...args); }, milliseconds);
    timers.add(timer); return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', timer => { timers.delete(timer); cancel(timer); });
  const fallback = schedule(() => controller.abort(), 1500);
  try {
    await assert.rejects(runDesktop({ env: { PORT: String(port) }, backendRoot: fixtures,
      desktopRoot: fixtures, electronBinary: '/synthetic/electron', signal: controller.signal,
      spawnProcess(binary, args, options) {
        if (binary === '/synthetic/electron') {
          desktop = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
          schedule(() => backend.kill('SIGKILL'), 60);
          return desktop;
        }
        backend = spawn(binary, args, options); return backend;
      } }), /local backend exited unexpectedly/i);
    assert.equal(controller.signal.aborted, false, 'must fail on backend exit before the safety timeout');
    assert.equal(backend.signalCode, 'SIGKILL');
    assert.equal(desktop.signalCode, 'SIGTERM');
    for (const child of [backend, desktop]) {
      assert.equal(child.listenerCount('error'), 0);
      assert.equal(child.listenerCount('exit'), 0);
    }
    assert.equal(timers.size, 0, 'all launcher shutdown timers must be cancelled');
  } finally {
    cancel(fallback);
    controller.abort();
    if (backend?.exitCode === null && !backend.signalCode) backend.kill('SIGTERM');
    if (desktop?.exitCode === null && !desktop.signalCode) desktop.kill('SIGTERM');
  }
});

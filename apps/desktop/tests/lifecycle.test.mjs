import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { acquireBackend } from '../src/lifecycle.mjs';

test('reused verified server is never spawned or stopped', async () => {
  let spawned = false;
  const backend = await acquireBackend({ probe: async () => 'verified', spawnBackend: () => { spawned = true; } });
  assert.equal(backend.owned, false);
  await backend.stop();
  assert.equal(spawned, false);
});

test('unrelated occupied port fails closed without spawning', async () => {
  let spawned = false;
  await assert.rejects(acquireBackend({ probe: async () => 'foreign', spawnBackend: () => { spawned = true; } }), /occupied/);
  assert.equal(spawned, false);
});

test('only a child created by the launcher is terminated, and stop is idempotent', async () => {
  let child, probes = 0;
  const backend = await acquireBackend({ probe: async () => ++probes === 1 ? 'absent' : 'verified',
    spawnBackend: () => (child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })) });
  assert.equal(backend.owned, true);
  assert.equal(child.exitCode, null);
  await Promise.all([backend.stop(), backend.stop()]);
  assert.equal(child.signalCode, 'SIGTERM');
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('failed startup stops the owned child and preserves the foreign process', async () => {
  let child, probes = 0;
  await assert.rejects(acquireBackend({ probe: async () => ++probes === 1 ? 'absent' : 'foreign',
    spawnBackend: () => (child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })) }), /identity/);
  assert.equal(child.signalCode, 'SIGTERM');
});

test('child exit before readiness is reported without waiting the whole timeout', async () => {
  const started = Date.now();
  await assert.rejects(acquireBackend({ probe: async () => 'absent', pollMs: 10, startupMs: 2000,
    spawnBackend: () => spawn(process.execPath, ['-e', 'process.exit(4)'], { stdio: 'ignore' }) }), /exited/);
  assert.ok(Date.now() - started < 1500);
});

test('startup abort terminates its child without launching Electron', async () => {
  const controller = new AbortController(); let child;
  const timer = setTimeout(() => controller.abort(), 60);
  try {
    await assert.rejects(acquireBackend({ probe: async () => 'absent', pollMs: 10, signal: controller.signal,
      spawnBackend: () => (child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })) }), /abort/i);
    assert.equal(child.signalCode, 'SIGTERM');
  } finally { clearTimeout(timer); }
});

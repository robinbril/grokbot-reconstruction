import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startDesktop } from '../src/desktop.mjs';

function nativeDouble(lock = true) {
  const app = new EventEmitter();
  Object.assign(app, { getPath: () => '/profile', setPath: (key, value) => { app[key] = value; },
    setName: value => { app.name = value; }, enableSandbox: () => { app.sandboxed = true; },
    requestSingleInstanceLock: () => lock, quit: () => { app.quitCalled = true; }, whenReady: async () => {} });
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; windows.push(this);
      this.webContents = { setWindowOpenHandler() {}, on() {}, session: {
        setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} },
      } };
    }
    async loadURL(value) { this.url = value; }
    show() { this.shown = true; }
    isMinimized() { return false; }
    focus() { this.focused = true; }
    isDestroyed() { return false; }
  }
  return { app, BrowserWindow, windows };
}

test('desktop uses its own OS profile and opens only the verified local origin', async () => {
  const native = nativeDouble();
  await startDesktop(native, 'http://127.0.0.1:8765', 'darwin');
  assert.equal(native.app.userData, '/profile/GrokLocalDesktop');
  assert.equal(native.app.sandboxed, true);
  assert.equal(native.windows[0].url, 'http://127.0.0.1:8765/?desktop=1');
  native.windows[0].emit('ready-to-show');
  assert.equal(native.windows[0].shown, true);
  native.app.emit('second-instance');
  assert.equal(native.windows[0].focused, true);
  native.app.emit('window-all-closed');
  assert.equal(native.app.quitCalled, undefined);
  native.windows[0].emit('closed');
  native.app.emit('activate');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(native.windows.length, 2);
  assert.equal(native.windows[0].options.titleBarStyle, 'hiddenInset');
});

test('non-Mac platforms exit when the last window closes', async () => {
  const native = nativeDouble();
  await startDesktop(native, 'http://127.0.0.1:8765', 'linux');
  native.app.emit('window-all-closed');
  assert.equal(native.app.quitCalled, true);
  assert.equal(native.windows[0].options.titleBarStyle, undefined);
});

test('second-instance recreates a Mac window after the last window closes', async () => {
  const native = nativeDouble();
  await startDesktop(native, 'http://127.0.0.1:8765', 'darwin');
  native.windows[0].emit('closed');
  native.app.emit('window-all-closed');
  native.app.emit('second-instance');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(native.windows.length, 2);
  assert.equal(native.windows[1].url, 'http://127.0.0.1:8765/?desktop=1');
  assert.equal(native.app.quitCalled, undefined);
});

test('a second instance never creates another window', async () => {
  const native = nativeDouble(false);
  await startDesktop(native, 'http://127.0.0.1:8765');
  assert.equal(native.app.quitCalled, true);
  assert.equal(native.windows.length, 0);
});

test('canonical default HTTP port works as a local origin', async () => {
  const native = nativeDouble();
  await startDesktop(native, 'http://127.0.0.1');
  assert.equal(native.windows[0].url, 'http://127.0.0.1/?desktop=1');
});

test('direct Electron entry rejects untrusted launch origins', async () => {
  for (const origin of [undefined, 'https://example.com', 'http://127.0.0.1:8765/evil',
    'http://user:pass@127.0.0.1:8765', 'http://localhost:8765']) {
    const native = nativeDouble();
    await assert.rejects(startDesktop(native, origin), /local backend origin/);
    assert.equal(native.windows.length, 0);
  }
});

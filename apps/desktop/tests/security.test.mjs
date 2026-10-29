import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopOrigin, electronEnvironment, allowedRequest, windowOptions, installWindowPolicy } from '../src/security.mjs';

test('desktop accepts only an explicit loopback backend configuration', () => {
  assert.equal(desktopOrigin({ PORT: '9876' }), 'http://127.0.0.1:9876');
  assert.equal(desktopOrigin({ PORT: '80' }), 'http://127.0.0.1');
  for (const env of [{ PORT: '0' }, { PORT: 'NaN' }, { GROK_BIND_HOST: '0.0.0.0' },
    { GROK_PUBLIC_ORIGIN: 'https://example.com' }]) assert.throws(() => desktopOrigin(env));
});

test('Electron never inherits inference credentials, node injection, or arbitrary host env', () => {
  assert.deepEqual(electronEnvironment({ HOME: '/home/test', PATH: '/bin', LANG: 'en_US.UTF-8',
    CLAUDE_CODE_OAUTH_TOKEN: 'secret', XAI_API_KEY: 'secret', NODE_OPTIONS: '--require evil',
    ELECTRON_RUN_AS_NODE: '1', GROK_SEAT_COMMAND: 'secret' }, 'http://127.0.0.1:8765'),
  { HOME: '/home/test', PATH: '/bin', LANG: 'en_US.UTF-8', GROK_DESKTOP_ORIGIN: 'http://127.0.0.1:8765' });
});

test('requests remain on the verified local backend, with local blobs and data images', () => {
  const origin = 'http://127.0.0.1:8765';
  for (const url of [origin + '/api/harness/status', 'blob:' + origin + '/id', 'data:image/png;base64,aA==']) {
    assert.equal(allowedRequest(url, origin), true, url);
  }
  for (const url of ['https://example.com', 'http://localhost:8765', 'http://127.0.0.1:8766',
    'file:///etc/passwd', 'javascript:alert(1)', 'blob:https://example.com/id', 'data:text/html,hello',
    'http://user:pass@127.0.0.1:8765']) assert.equal(allowedRequest(url, origin), false, url);
});

test('window has no privileged renderer bridge and explicitly enables isolation', () => {
  const options = windowOptions();
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(options.webPreferences.preload, undefined);
});

test('window policy denies popups, external navigation, foreign downloads, permissions and foreign requests', () => {
  const handlers = {}, origin = 'http://127.0.0.1:8765';
  const session = {
    setPermissionRequestHandler: fn => { handlers.permission = fn; },
    setPermissionCheckHandler: fn => { handlers.check = fn; },
    webRequest: { onBeforeRequest: fn => { handlers.request = fn; } },
    on: (name, fn) => { handlers[name] = fn; },
  };
  const contents = { session, on: (name, fn) => { handlers[name] = fn; },
    setWindowOpenHandler: fn => { handlers.popup = fn; } };
  installWindowPolicy({ webContents: contents }, origin);
  assert.deepEqual(handlers.popup({ url: origin }), { action: 'deny' });
  let prevented = 0;
  handlers['will-navigate']({ preventDefault() { prevented++; } }, 'https://example.com');
  handlers['will-redirect']({ preventDefault() { prevented++; } }, 'file:///etc/passwd');
  handlers['will-navigate']({ preventDefault() { prevented++; } }, origin + '/?chat=abc');
  assert.equal(prevented, 2);
  handlers.permission(contents, 'media', allowed => assert.equal(allowed, false));
  assert.equal(handlers.check(contents, 'geolocation'), false);
  handlers.request({ url: 'https://example.com' }, result => assert.equal(result.cancel, true));
  handlers.request({ url: origin + '/app.js' }, result => assert.equal(result.cancel, false));
  handlers['will-download']({ preventDefault() { prevented++; } }, { getURLChain: () => ['https://example.com/file'] });
  assert.equal(prevented, 3);
  for (const url of [`blob:${origin}/attachment`, `${origin}/api/harness/conversations/c1/attachments/a1/download`]) {
    handlers['will-download']({ preventDefault() { prevented++; } }, { getURLChain: () => [url] });
  }
  assert.equal(prevented, 3);
});

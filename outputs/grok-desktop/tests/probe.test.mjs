import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeBackend } from '../src/probe.mjs';

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('probe verifies exact local application bytes without requesting owner/session endpoints', async t => {
  const requested = [], index = Buffer.from('<html>synthetic Grok local</html>');
  const origin = await listen(t, (req, res) => {
    requested.push(req.url);
    if (req.url === '/api/harness/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ schema: 1, application: 'grokbot-reconstruction' })); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(index);
  });
  assert.equal(await probeBackend({ origin, index }), 'verified');
  assert.deepEqual(requested, ['/api/harness/health', '/']);
});

test('an exact health DTO is required even when static bytes match', async t => {
  const index = Buffer.from('test');
  for (const health of [{ schema: 1, application: 'another-app' },
    { schema: 1, application: 'grokbot-reconstruction', extra: true }]) {
    const origin = await listen(t, (req, res) => {
      res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json');
      res.end(req.url === '/' ? index : JSON.stringify(health));
    });
    assert.equal(await probeBackend({ origin, index }), 'foreign');
  }
});

test('unrelated service, redirect, cookie-issuing service, and oversized content fail closed', async t => {
  const index = Buffer.from('<html>synthetic Grok local</html>');
  for (const handler of [
    (_req, res) => res.end('unrelated service'),
    (_req, res) => { res.writeHead(302, { Location: 'https://example.com' }); res.end(); },
    (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'owner=unexpected' }); res.end(index); },
    (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(Buffer.alloc(1024 * 1024)); },
  ]) {
    const origin = await listen(t, handler);
    assert.equal(await probeBackend({ origin, index }), 'foreign');
  }
});

test('only connection refused is treated as absent; an unresponsive occupied port is foreign', async t => {
  const index = Buffer.from('test');
  const origin = await listen(t, () => {});
  assert.equal(await probeBackend({ origin, index, timeoutMs: 30 }), 'foreign');
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const absent = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  assert.equal(await probeBackend({ origin: absent, index }), 'absent');
});

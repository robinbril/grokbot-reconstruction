import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns/promises';
import { createWorkspaceTools, validateToolArguments } from '../harness/workspace-tools.mjs';
import { createBrowserTools } from '../harness/browser-tools.mjs';

const html = `<!doctype html><title>Browser actions fixture</title><style>body{height:4000px}#pane{width:300px;height:150px;overflow:auto}#inside{height:1800px}</style>
<input id="entry" onkeydown="if(event.key==='Enter')document.querySelector('#pressed').textContent='Enter received'">
<textarea id="multiline"></textarea><p id="pressed">No key</p>
<select id="choice" onchange="document.querySelector('#selected').textContent='selected '+this.value"><option value="a">Alpha</option><option value="b">Beta</option></select><p id="selected">selected a</p>
<div id="pane" onscroll="document.querySelector('#scrolled').textContent='pane '+Math.round(this.scrollTop)"><div id="inside">Scrollable content</div></div><p id="scrolled">pane 0</p>
<p id="page-scroll" style="position:fixed;bottom:0">page 0</p><script>addEventListener('scroll',()=>document.querySelector('#page-scroll').textContent='page '+Math.round(scrollY))</script>`;

async function fixture(t) {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['x-harness-bridge'], 'fixture');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/preview/`;
  const frames = [];
  const tools = createWorkspaceTools({ baseUrl, authorizeLocalUrl: () => ({ headers: { 'x-harness-bridge': 'fixture' } }), emit: async (type, frame) => frames.push({ type, frame }) });
  t.after(async () => { await tools.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await tools.callTool('browser_open', { url: baseUrl });
  return { tools, frames };
}

async function snapshotUntil(tools, expected) {
  let lastText = '';
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const snapshot = await tools.callTool('browser_snapshot', {});
    lastText = snapshot.text;
    if (expected.test(snapshot.text)) return snapshot;
  }
  assert.fail(`Browser never showed ${expected}: ${lastText}`);
}

test('browser action catalog validates bounded keys, direction, integer pixels and own argument fields', () => {
  for (const [name, args] of [
    ['browser_press', { selector: '#entry', key: 'Shift+Enter' }],
    ['browser_scroll', { direction: 'down', pixels: 400 }],
    ['browser_select', { selector: '#choice', value: 'b' }],
  ]) assert.doesNotThrow(() => validateToolArguments(name, args));
  for (const [name, args] of [
    ['browser_press', { selector: '#entry', key: 'Meta+Q' }],
    ['browser_press', { selector: '', key: 'Enter' }],
    ['browser_scroll', { direction: 'diagonal', pixels: 1 }],
    ['browser_scroll', { direction: 'down', pixels: '10' }],
    ['browser_scroll', { direction: 'down', pixels: 0 }],
    ['browser_scroll', { direction: 'down', pixels: 4001 }],
    ['browser_scroll', { direction: 'down', pixels: 1.5 }],
    ['browser_scroll', { direction: 'down', pixels: 1, selector: '' }],
    ['browser_select', { selector: '#choice', value: 'b'.repeat(65537) }],
    ['browser_select', Object.assign(Object.create({ selector: '#choice' }), { value: 'b' })],
    ['browser_select', JSON.parse('{"selector":"#choice","value":"b","__proto__":"bad"}')],
    ['browser_select', { selector: '#choice', value: 'b', constructor: 'bad' }],
  ]) assert.throws(() => validateToolArguments(name, args));
});

test('actual Chromium receives Enter, multiline Shift+Enter, native selection and wheel scrolling with frames', async t => {
  const { tools, frames } = await fixture(t);
  const result = await tools.callTool('browser_scroll', { direction: 'down', pixels: 500 });
  await snapshotUntil(tools, /page 500/);
  assert.equal(tools.frame(result.captureId).contentType, 'image/png');
  assert.deepEqual([...tools.frame(result.captureId).bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  await tools.callTool('browser_scroll', { direction: 'up', pixels: 500 });
  await snapshotUntil(tools, /page 0(?:\n|$)/);
  await tools.callTool('browser_press', { selector: '#entry', key: 'Enter' });
  assert.match((await tools.callTool('browser_snapshot', {})).text, /Enter received/);
  await tools.callTool('browser_fill', { selector: '#multiline', value: 'first' });
  await tools.callTool('browser_press', { selector: '#multiline', key: 'End' });
  await tools.callTool('browser_press', { selector: '#multiline', key: 'Shift+Enter' });
  assert.equal((await tools.callTool('browser_snapshot', {})).elements.find(row => row.selector === '#multiline').value, 'first\n');
  await tools.callTool('browser_select', { selector: '#choice', value: 'b' });
  assert.match((await tools.callTool('browser_snapshot', {})).text, /selected b/);
  await tools.callTool('browser_scroll', { selector: '#pane', direction: 'down', pixels: 350 });
  await snapshotUntil(tools, /pane 350/);
  await tools.callTool('browser_scroll', { selector: '#pane', direction: 'up', pixels: 200 });
  await snapshotUntil(tools, /pane 150/);
  assert.ok(frames.every(row => row.type === 'browser.frame'));
  assert.ok(frames.length >= 10);
});

test('invalid direct arguments and ambiguous selectors produce no interactive effects', async t => {
  const { tools } = await fixture(t);
  for (const args of [{ selector: '#entry', key: 'Meta+Q' }, { selector: 'input,textarea', key: 'Enter' }]) await assert.rejects(tools.callTool('browser_press', args));
  await assert.rejects(tools.callTool('browser_select', { selector: 'select,input', value: 'b' }), /exactly one/);
  const snapshot = await tools.callTool('browser_snapshot', {});
  assert.match(snapshot.text, /No key/);
  assert.doesNotMatch(snapshot.text, /Enter received|pane [1-9]|page [1-9]/);
  const direct = createBrowserTools();
  t.after(() => direct.close());
  await assert.rejects(direct.callTool('browser_scroll', { direction: 'down', pixels: '20' }));
});

test('external interactions require approval before locator, hover, keyboard or wheel effects', async t => {
  const seen = [];
  const tools = createBrowserTools({ authorizeInteraction: async request => { seen.push(request); return false; } });
  t.after(() => tools.close());
  for (const [name, args] of [
    ['browser_press', { selector: '#entry', key: 'Enter' }],
    ['browser_scroll', { direction: 'down', pixels: 100 }],
    ['browser_select', { selector: '#choice', value: 'b' }],
  ]) await assert.rejects(tools.callTool(name, args), /not approved/);
  assert.deepEqual(seen.map(row => row.action), ['browser_press', 'browser_scroll', 'browser_select']);
  assert.ok(seen.every(row => row.pageUrl === 'about:blank'));
  assert.equal(tools.browserState(), undefined);
});

// Two real Chromium launches share this budget; it is not an effect deadline.
test('page closure while consent is pending and cancellation reject without a post-consent effect', { timeout: 30000 }, async t => {
  let requested, resolveConsent;
  const ready = new Promise(resolve => { requested = resolve; });
  const tools = createBrowserTools({ authorizeInteraction: () => { requested(); return new Promise(resolve => { resolveConsent = resolve; }); } });
  t.after(() => tools.close());
  const action = tools.callTool('browser_scroll', { direction: 'down', pixels: 100 });
  await ready;
  await tools.close();
  resolveConsent(true);
  await assert.rejects(action, /page changed/);
  let cancelRequested, release;
  const cancelReady = new Promise(resolve => { cancelRequested = resolve; });
  const cancelled = createBrowserTools({ authorizeInteraction: () => { cancelRequested(); return new Promise(resolve => { release = resolve; }); } });
  t.after(() => cancelled.close());
  const controller = new AbortController();
  const pending = cancelled.callTool('browser_press', { selector: '#entry', key: 'Enter' }, { signal: controller.signal });
  await cancelReady;
  controller.abort(); release(true);
  await assert.rejects(pending, /abort/i);
  assert.equal(cancelled.browserState(), undefined);
  await cancelled.close();
});


// Only the external transport is redirected to an exclusive local fixture. Chromium,
// the production public-address checks and the production approval path remain real.
async function externalFixture(t, authorizeInteraction) {
  let changed, navigate = 'stay', documentLoads = 0;
  const changedPage = new Promise(resolve => { changed = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/poll') return res.end(navigate);
    if (req.url === '/committed') { changed(); return res.end('ready'); }
    const replacement = req.url === '/changed' || (req.url === '/' && ++documentLoads > 1);
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(html + `<script>if(${replacement})fetch('/committed');else setInterval(async()=>{const action=await(await fetch('/poll')).text();if(action==='navigate')location.href='/changed';if(action==='reload')location.reload()},50)</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const lookup = dns.lookup.bind(dns), request = http.request.bind(http);
  t.mock.method(dns, 'lookup', (host, options) => host === 'browser-fixture.invalid' ? Promise.resolve([{ address: '93.184.216.34', family: 4 }]) : lookup(host, options));
  t.mock.method(http, 'request', (url, options, callback) => {
    if (url.hostname !== 'browser-fixture.invalid') return request(url, options, callback);
    return request(new URL(url.pathname + url.search, local), { ...options, lookup: undefined }, callback);
  });
  const tools = createBrowserTools({ authorizeInteraction });
  t.after(async () => { await tools.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await tools.callTool('browser_open', { url: 'http://browser-fixture.invalid/' });
  return { tools, changePage: async () => { navigate = 'navigate'; await changedPage; }, reloadPage: async () => { navigate = 'reload'; await changedPage; } };
}

test('real external-page keyboard and select remain unchanged on denied approval; approved requests perform actual actions', async t => {
  let approved = false;
  const requests = [];
  const { tools } = await externalFixture(t, async request => { requests.push(request); return approved; });
  for (const [name, args] of [
    ['browser_press', { selector: '#entry', key: 'Enter' }],
    ['browser_select', { selector: '#choice', value: 'b' }],
    ['browser_scroll', { selector: '#pane', direction: 'down', pixels: 300 }],
  ]) await assert.rejects(tools.callTool(name, args), /not approved/);
  const before = await tools.callTool('browser_snapshot', {});
  assert.match(before.text, /No key/); assert.match(before.text, /selected a/); assert.match(before.text, /pane 0/);
  approved = true;
  await tools.callTool('browser_press', { selector: '#entry', key: 'Enter' });
  await tools.callTool('browser_select', { selector: '#choice', value: 'b' });
  const after = await tools.callTool('browser_snapshot', {});
  assert.match(after.text, /Enter received/); assert.match(after.text, /selected b/);
  assert.equal(requests.length, 5);
  assert.ok(requests.every(row => row.pageUrl === 'http://browser-fixture.invalid/'));
});

test('external navigation while approval waits cannot apply consent to a replacement document', async t => {
  let requested, release;
  const ready = new Promise(resolve => { requested = resolve; });
  const { tools, changePage } = await externalFixture(t, () => { requested(); return new Promise(resolve => { release = resolve; }); });
  const pending = tools.callTool('browser_press', { selector: '#entry', key: 'Enter' });
  await ready; await changePage(); release(true);
  await assert.rejects(pending, /page changed/);
  assert.match((await tools.callTool('browser_snapshot', {})).text, /No key/);
});


test('same-URL external reload while approval waits invalidates consent for the old document', async t => {
  let requested, release;
  const ready = new Promise(resolve => { requested = resolve; });
  const { tools, reloadPage } = await externalFixture(t, () => { requested(); return new Promise(resolve => { release = resolve; }); });
  const pending = tools.callTool('browser_press', { selector: '#entry', key: 'Enter' });
  await ready; await reloadPage(); release(true);
  await assert.rejects(pending, /page changed/);
  const after = await tools.callTool('browser_snapshot', {});
  assert.equal(after.pageUrl, 'http://browser-fixture.invalid/');
  assert.match(after.text, /No key/);
});

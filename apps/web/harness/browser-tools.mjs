import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserDestination, fetchBrowserResource, isOwnedPreview } from './browser-network.mjs';
import { browserInteractionDefinitions, validatePrimitiveArguments, performBrowserInteraction } from './browser-interactions.mjs';

const interactionRequests = new WeakSet();
const interactionDenials = new WeakSet();
export const isBrowserInteractionApproval = request => interactionRequests.has(request);
export const isBrowserInteractionDenied = error => interactionDenials.has(error);

const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
export const browserToolDefinitions = [
  { name: 'browser_open', description: 'Open a public HTTP(S) page or this workspace preview in an isolated Chromium browser. Captures an actual screenshot.', inputSchema: schema({ url: string }, ['url']) },
  { name: 'browser_snapshot', description: 'Read the current real browser DOM, visible text and interactive element selectors.', inputSchema: schema() },
  { name: 'browser_screenshot', description: 'Capture the current real Chromium page as a PNG frame.', inputSchema: schema() },
  ...browserInteractionDefinitions,
];

async function executablePath() {
  const candidates = [
    process.env.HARNESS_CHROMIUM_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    chromium.executablePath(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try the next installed executable. */ }
  }
  throw new Error('Chromium is unavailable; install Chrome or set HARNESS_CHROMIUM_EXECUTABLE');
}

export function createBrowserTools({ baseUrl, emit = async () => {}, authorizeLocalUrl, authorizeInteraction } = {}) {
  let browser;
  let context;
  let page;
  let opening;
  let closingPage;
  let closed = false;
  let state;
  let pageGeneration = 0;
  let activeSignal;
  let interactionApproved = false;
  let blockedMainRequest;
  const frames = new Map();
  let retainedBytes = 0;
  let queue = Promise.resolve();
  const id = randomUUID();

  async function intercept(route) {
    const request = route.request();
    try {
      const destination = await browserDestination(request.url(), { baseUrl, authorizeLocalUrl });
      if (!destination.owned && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !interactionApproved) throw new Error('External write request requires approved browser interaction');
      const body = request.postDataBuffer();
      if (body?.length > 256 * 1024) throw new Error('Browser request body exceeds 256 KiB');
      const result = await fetchBrowserResource(destination, { method: request.method(), headers: await request.allHeaders(), body, signal: activeSignal });
      if (result.status >= 300 && result.status < 400 && result.headers.location) {
        await browserDestination(new URL(result.headers.location, request.url()).href, { baseUrl, authorizeLocalUrl });
      }
      await route.fulfill(result);
    } catch (error) {
      if (request.isNavigationRequest() && request.frame() === page?.mainFrame()) blockedMainRequest = error.message;
      await route.abort('blockedbyclient').catch(() => {});
    }
  }

  async function ensurePage() {
    if (closed) throw new Error('Browser tools are closed');
    await closingPage;
    if (page && !page.isClosed()) return page;
    if (opening) return opening;
    opening = (async () => {
      await browser?.close();
      browser = await chromium.launch({ executablePath: await executablePath(), headless: true, args: ['--disable-background-networking', '--dns-prefetch-disable', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false, permissions: [] });
      await context.route('**/*', intercept);
      await context.routeWebSocket('**/*', socket => socket.close());
      page = await context.newPage();
      context.on('page', popup => { if (popup !== page) popup.close().catch(() => {}); });
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) pageGeneration += 1;
        if (!/^https?:/.test(frame.url()) && frame.url() !== 'about:blank') {
          blockedMainRequest = 'Browser navigation protocol is forbidden';
          closingPage = page.close().catch(() => {});
        }
      });
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(25_000);
      return page;
    })();
    try { return await opening; } finally { opening = undefined; }
  }

  async function capture() {
    const bytes = await page.screenshot({ type: 'png', timeout: 15_000 });
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Browser frame exceeds 4 MiB');
    const captureId = randomUUID();
    frames.set(captureId, { bytes, contentType: 'image/png' });
    retainedBytes += bytes.length;
    while (frames.size > 12 || retainedBytes > 24 * 1024 * 1024) {
      const oldest = frames.keys().next().value;
      retainedBytes -= frames.get(oldest).bytes.length;
      frames.delete(oldest);
    }
    const pageUrl = page.url();
    state = { id, title: (await page.title()).slice(0, 2048), pageUrl: pageUrl.slice(0, 4096), ...(pageUrl.length > 4096 ? { pageUrlTruncated: true } : {}), captureId, capturedAt: new Date().toISOString() };
    await emit('browser.frame', { ...state });
    return { ...state };
  }

  async function approve(action, args, signal) {
    if (isOwnedPreview(page.url(), baseUrl)) return;
    if (!authorizeInteraction) throw new Error('External browser interaction requires explicit approval');
    const pageUrl = page.url();
    const generation = pageGeneration;
    const request = { action, arguments: args, pageUrl, signal };
    interactionRequests.add(request);
    let decision;
    try { decision = await authorizeInteraction(request); } finally { interactionRequests.delete(request); }
    signal?.throwIfAborted();
    if (decision !== true && decision?.approved !== true) {
      const error = Object.assign(new Error('External browser interaction was not approved'), { code: 'TOOL_DENIED' });
      interactionDenials.add(error);
      throw error;
    }
    if (page.isClosed() || page.url() !== pageUrl || pageGeneration !== generation) throw new Error('Browser page changed while awaiting approval; request a new interaction');
    interactionApproved = true;
  }

  async function snapshot() {
    const dom = await page.evaluate(() => {
      const escape = value => CSS.escape(value);
      const selectorFor = element => {
        if (element.id) return `#${escape(element.id)}`;
        const parts = [];
        let current = element;
        while (current && current !== document.documentElement && parts.length < 6) {
          const siblings = [...current.parentElement.children].filter(sibling => sibling.localName === current.localName);
          parts.unshift(`${current.localName}:nth-of-type(${siblings.indexOf(current) + 1})`);
          current = current.parentElement;
        }
        return parts.join(' > ');
      };
      const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"]')].filter(element => element.getClientRects().length).slice(0, 100).map(element => {
        const selector = selectorFor(element);
        return {
          selector: selector.length <= 1024 ? selector : null, ...(selector.length > 1024 ? { selectorTruncated: true } : {}), tag: element.localName,
          text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').slice(0, 300),
          ...(element instanceof HTMLAnchorElement ? { href: element.href.slice(0, 4096), ...(element.href.length > 4096 ? { hrefTruncated: true } : {}) } : {}),
          ...(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? { value: element.type === 'password' ? '[redacted]' : element.value.slice(0, 300) } : {}),
        };
      });
      const text = document.body?.innerText || '';
      return { text: text.slice(0, 24_000), truncated: text.length > 24_000, elements };
    });
    return { ...(await capture()), ...dom };
  }

  async function execute(name, args, { signal } = {}) {
    signal?.throwIfAborted();
    const definition = browserToolDefinitions.find(tool => tool.name === name);
    if (!definition) throw new Error('Unknown browser tool');
    validatePrimitiveArguments(definition, args);
    activeSignal = signal;
    blockedMainRequest = undefined;
    const onAbort = () => { closingPage = page?.close().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (name === 'browser_open') await browserDestination(args.url, { baseUrl, authorizeLocalUrl });
      await ensurePage();
      signal?.throwIfAborted();
      if (name === 'browser_open') {
        const response = await page.goto(args.url, { waitUntil: 'domcontentloaded' });
        if (response && !response.ok()) throw new Error(`Browser navigation failed with HTTP ${response.status()}`);
      }
      else if (browserInteractionDefinitions.some(tool => tool.name === name)) {
        await approve(name, args, signal);
        signal?.throwIfAborted();
        await performBrowserInteraction(page, name, args);
      } else if (!['browser_snapshot', 'browser_screenshot'].includes(name)) throw new Error('Unknown browser tool');
      signal?.throwIfAborted();
      if (blockedMainRequest) throw new Error(blockedMainRequest);
      if (name === 'browser_snapshot') return await snapshot();
      return await capture();
    } catch (error) {
      if (blockedMainRequest) throw new Error(blockedMainRequest);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      interactionApproved = false;
      activeSignal = undefined;
    }
  }

  return {
    callTool(name, args, options) {
      const result = queue.then(() => execute(name, args, options));
      queue = result.catch(() => {});
      return result;
    },
    browserState: () => state ? { ...state } : undefined,
    frame: captureId => frames.get(captureId),
    async close() {
      closed = true;
      await opening?.catch(() => {});
      await browser?.close();
      frames.clear();
      retainedBytes = 0;
    },
  };
}

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const [prefix, assignment] = normalized.split(':');
    // Accept only global unicast, excluding documentation, Teredo and transition ranges.
    return /^[23][0-9a-f]{3}:/.test(normalized)
      && !(prefix === '2001' && (!assignment || Number.parseInt(assignment, 16) <= 0x1ff))
      && !/^(2001:db8:|2002:|3fff:)/.test(normalized);
  }
  return false;
}

export function parseBrowserUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid browser URL');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without credentials are allowed');
  return url;
}

function ownedPreview(url, baseUrl) {
  if (!baseUrl) return false;
  const base = parseBrowserUrl(baseUrl);
  return base.pathname.endsWith('/') && url.origin === base.origin && url.pathname.startsWith(base.pathname);
}

export async function browserDestination(value, { baseUrl, authorizeLocalUrl } = {}) {
  const url = parseBrowserUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Browser hostname has no addresses');
  if (ownedPreview(url, baseUrl)) {
    const authorization = await authorizeLocalUrl?.(url.href);
    if (!authorization || !authorization.headers?.['x-harness-bridge']) throw new Error('Owned preview authorization is unavailable');
    // The preview server is specifically local; a public or changing destination is not the owned service.
    if (!addresses.every(item => item.address === '127.0.0.1' || item.address === '::1')) throw new Error('Owned preview must use loopback');
    return { url, address: addresses[0], owned: true, headers: { 'x-harness-bridge': authorization.headers['x-harness-bridge'] } };
  }
  if (addresses.some(item => !isPublicAddress(item.address))) throw new Error('Private, local and reserved browser destinations are forbidden');
  return { url, address: addresses[0], owned: false, headers: {} };
}

function requestHeaders(headers, destination) {
  const clean = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('x-harness-')) continue;
    clean[name] = value;
  }
  delete clean['accept-encoding'];
  clean['accept-encoding'] = 'identity';
  return { ...clean, ...destination.headers };
}

export function fetchBrowserResource(destination, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const transport = destination.url.protocol === 'https:' ? https : http;
    const request = transport.request(destination.url, {
      method, headers: requestHeaders(headers, destination), signal, agent: false,
      // Pin the connection to the validated address. Chromium never performs DNS for this request.
      lookup(_hostname, _options, callback) {
        if (_options?.all) callback(null, [destination.address]);
        else callback(null, destination.address.address, destination.address.family);
      },
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESOURCE_BYTES) response.destroy(new Error('Browser resource exceeds 8 MiB'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const outputHeaders = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined && !HOP_HEADERS.has(name) && name !== 'content-length') outputHeaders[name] = Array.isArray(value) ? value.join('\n') : value;
        }
        resolve({ status: response.statusCode, headers: outputHeaders, body: Buffer.concat(chunks) });
      });
    });
    request.on('error', reject);
    request.setTimeout(15_000, () => request.destroy(new Error('Browser resource timed out')));
    if (body?.length) request.write(body);
    request.end();
  });
}

export function isOwnedPreview(value, baseUrl) {
  try { return ownedPreview(parseBrowserUrl(value), baseUrl); } catch { return false; }
}

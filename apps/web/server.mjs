import {serverAddress} from './harness/server-address.mjs';
import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHarnessHandler } from './harness/http.mjs';
import {staticAssetType,staticAssetPolicy} from './harness/static-assets.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const {port,bindHost,publicOrigin}=serverAddress(process.env);


const harness = await createHarnessHandler({ root, baseUrl: publicOrigin });
const server = http.createServer(async (req, res) => {
  if (await harness.handle(req, res)) return;
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(root, relative);
    const parts = relative.split('/');
    if (parts[0] === 'harness' || !target.startsWith(root + path.sep) || parts.some(part => part.startsWith('.')) || !staticAssetType(relative)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const canonical = await realpath(target);
    const canonicalRelative = path.relative(root, canonical);
    if (canonicalRelative.startsWith('..') || path.isAbsolute(canonicalRelative) || canonicalRelative.split(path.sep).some(part => part.startsWith('.')) || canonicalRelative.split(path.sep)[0] === 'harness' || !staticAssetType(canonicalRelative.split(path.sep).join('/'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    const info = await stat(canonical);
    if (!info.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const bytes = await readFile(canonical);
    res.writeHead(200, { 'Content-Type': staticAssetType(canonicalRelative.split(path.sep).join('/')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': staticAssetPolicy(canonicalRelative.split(path.sep).join('/')) });
    res.end(bytes);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, bindHost, () => process.stdout.write(`Grok reconstruction: http://127.0.0.1:${port}\n`));

let closing = false;
async function close() { if (closing) return; closing = true; await harness.close(); server.close(); server.closeIdleConnections(); }
process.once('SIGINT', () => close().then(() => process.exit(0)));
process.once('SIGTERM', () => close().then(() => process.exit(0)));

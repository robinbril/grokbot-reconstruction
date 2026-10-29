import http from 'node:http';

function readProbe({ origin, route, limit, type, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false;
    const finish = (state, bytes) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve({ state, bytes });
    };
    const request = http.get(`${origin}${route}`, { agent: false }, response => {
      if (response.statusCode !== 200 || (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== type
        || response.headers['set-cookie']) {
        response.destroy(); finish('foreign'); return;
      }
      const parts = []; let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > limit) { response.destroy(); finish('foreign'); return; }
        parts.push(chunk);
      });
      response.once('end', () => finish('ok', Buffer.concat(parts)));
      response.once('error', () => finish('foreign'));
      response.once('aborted', () => finish('foreign'));
    });
    const timer = setTimeout(() => { request.destroy(); finish('foreign'); }, timeoutMs);
    request.once('error', error => finish(error.code === 'ECONNREFUSED' ? 'absent' : 'foreign'));
  });
}

// Both probes are read-only and deliberately avoid owner/session endpoints.
export async function probeBackend({ origin, index, timeoutMs = 1500 }) {
  const health = await readProbe({ origin, route: '/api/harness/health', limit: 128,
    type: 'application/json', timeoutMs });
  if (health.state !== 'ok') return health.state;
  try {
    const dto = JSON.parse(health.bytes);
    if (dto.schema !== 1 || dto.application !== 'grokbot-reconstruction'
      || Object.keys(dto).sort().join(',') !== 'application,schema') return 'foreign';
  } catch { return 'foreign'; }
  const page = await readProbe({ origin, route: '/', limit: index.length, type: 'text/html', timeoutMs });
  return page.state === 'ok' && page.bytes.equals(index) ? 'verified' : 'foreign';
}

import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';

const MAX_BRIDGE_BYTES = 2 * 1024 * 1024;

export function createWorkspaceMcpBridge({ baseUrl, token, fetchImpl = fetch }) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash
    || !/^\/api\/harness\/internal\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname)) throw new Error('Invalid internal workspace MCP endpoint');
  if (typeof token !== 'string' || token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) throw new Error('Invalid workspace MCP bridge token');
  const server = new Server({ name: 'grok_workspace', version: '1.0.0' }, { capabilities: { tools: {} } });

  async function request(suffix, params, signal) {
    const response = await fetchImpl(`${url.href.replace(/\/$/, '')}/tools/${suffix}`, {
      method: params ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(params ? { 'content-type': 'application/json' } : {}) },
      ...(params ? { body: JSON.stringify(params) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000), redirect: 'error',
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (!reader) throw new Error('Workspace bridge returned an empty response');
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BRIDGE_BYTES) { await reader.cancel(); throw new Error('Workspace bridge response exceeds limit'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Workspace bridge returned invalid JSON'); }
    if (!response.ok) throw new Error(payload.error?.message || `Workspace bridge request failed (${response.status})`);
    return payload;
  }

  server.setRequestHandler('tools/list', async (_request, context) => {
    const payload = await request('list', undefined, context.signal);
    const tools = Array.isArray(payload) ? payload : payload.tools;
    if (!Array.isArray(tools) || tools.length > 100) throw new Error('Invalid workspace tool inventory');
    return { tools };
  });
  server.setRequestHandler('tools/call', async (incoming, context) => {
    try {
      const output = await request('call', { name: incoming.params.name, arguments: incoming.params.arguments ?? {} }, context.signal);
      if (Array.isArray(output.content)) return output;
      const result = output.result ?? output;
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  return server;
}

export async function startWorkspaceMcp() {
  const server = createWorkspaceMcpBridge({ baseUrl: process.env.HARNESS_MCP_BASE_URL, token: process.env.HARNESS_MCP_TOKEN });
  await server.connect(new StdioServerTransport());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorkspaceMcp().catch(() => {
    process.stderr.write('Workspace MCP bridge initialization failed\n');
    process.exitCode = 1;
  });
}

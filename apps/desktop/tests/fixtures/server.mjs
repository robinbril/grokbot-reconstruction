import http from 'node:http';
import { readFile } from 'node:fs/promises';
const bytes = await readFile(new URL('./index.html', import.meta.url));
const server = http.createServer((req, res) => {
  if (req.url === '/api/harness/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ schema: 1, application: 'grokbot-reconstruction' })); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(bytes);
});
server.listen(Number(process.env.PORT), '127.0.0.1');

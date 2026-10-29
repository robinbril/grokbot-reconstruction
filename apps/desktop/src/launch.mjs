import electronBinary from 'electron';
import { fileURLToPath } from 'node:url';
import { runDesktop } from './launcher.mjs';

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  await runDesktop({ env: process.env, signal: controller.signal, electronBinary,
    backendRoot: fileURLToPath(new URL('../../web/', import.meta.url)),
    desktopRoot: fileURLToPath(new URL('../', import.meta.url)),
  });
} catch (error) {
  if (!controller.signal.aborted) {
    process.stderr.write(`Grok Local: ${error.message}\n`);
    process.exitCode = 1;
  }
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}

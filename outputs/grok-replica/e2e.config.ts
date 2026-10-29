import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
// From poort ≥ 0.4.0 (`npx -y github:Reforge-Recruitment/poort init`). Adjust the
// relative path if this config sits in a subfolder, e.g. '../.poort/...'.
import { claudeSeat } from './.poort/integrations/e2e-claude-seat.mjs';

// Claude on your own seat via `claude -p`: no API keys, no proxy. Sign in once
// by running `claude`, or set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
// Only recording calls a model; replaying .e2e/cache/ does not.
//
// Pick per run: `E2E_MODEL=claude-opus-5-5 npx e2e run --record`.
export default {
  tests: ['tests/**/*.e2e.ts', '!tests/streaming-attachments.e2e.ts', '!tests/live-harness.e2e.ts'],
  // Test files match tests/**/*.e2e.ts by default.
  targets: [
    {
      engine: web({ viewport: { width: 1033, height: 748 } }),
      app: {
        url: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:0',
        // Keep the canonical recording identity when the same app uses an isolated test port.
        identity: 'http://127.0.0.1:8765',
        command: {
          executable: 'node', args: ['server.mjs'],
          // Managed app processes do not inherit arbitrary shell variables.
          env: { PORT: '{port}', HARNESS_DATA_DIR: '.harness-runtime/e2e-main-{port}' },
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
  workers: 1,
  timeout: 300_000,
  trace: 'on',
  agents: {
    default: {
      // A fast model acts; a stronger model judges, as a second opinion.
      model: claudeSeat(process.env.E2E_MODEL ?? 'claude-sonnet-5-5'),
      judge: claudeSeat(process.env.E2E_JUDGE ?? 'claude-opus-5-5'),
    },
  },
} satisfies E2EConfig;

# Architecture

## Repository map

| Area | Responsibility | Entrypoint |
| --- | --- | --- |
| `apps/web/` | Web client, independent local execution host, assets, source-reference fixtures and tests | `server.mjs`, `index.html` |
| `apps/desktop/` | Isolated Electron client and normal-Node process launcher | `src/launch.mjs` |
| `docs/` | This architecture note and original README artwork | No runtime imports |
| `.harness/projectstructuur/` | Portable structure checker used by CI | `tools/project-structure-check.js` |
| `.github/workflows/` | Repository-structure CI | `project-structure.yml` |

The root contains the README, manifests, test gate and configuration required by those entrypoints. The ignored root `.env` is private local runtime configuration. `npm run setup`, `npm start`, `npm run setup:desktop` and `npm run desktop` remain the supported startup commands. Each application keeps its own dependency lockfile.

## Execution boundaries

The production composition creates the independent runtime. Model inference proposes actions; the host validates, approves, executes and records effects. The optional Claude-seat adapter supplies inference only, with native tools and project configuration disabled. Historical adapter tests select their dependency explicitly; no automatic production fallback exists.

The host owns conversations, queues, scheduled tasks, workspace files, owned browser sessions, sandboxed terminal execution and MCP connections. Provider OAuth grants are separate from application device identity. Host/Origin checks and CSRF protect browser requests. Device pairing uses an expiring single-use code; existing owned resources block pairing rather than being abandoned. Read receipts and cursor pagination belong to the shared backend.

The desktop launcher verifies a public health DTO and exact entrypoint bytes before reusing a backend. Health does not create account/device sessions. A newly started backend remains launcher-owned; quitting never stops a pre-existing server. An owned-backend crash stops its Electron client. The renderer receives an OS environment allowlist and local origin, without provider credentials, Node access, preload or privileged IPC. Desktop OAuth popups and microphone capture are not implemented.

## Test and source layout

Product tests remain under `apps/web/tests/`; desktop tests live under `apps/desktop/tests/`. Byte-preserved source-comparison fixtures live in `tests/fixtures/source-reference/`. Generated navigation, history and motion evidence goes under ignored `.e2e/artifacts/`, never into source directories. Vendor licenses and provenance stay with their assets.

The obsolete research website, its report-only test/server, historical acceptance reports, agent scratch state and proof logs are archived outside the product repository. Product assertions remain in place. The removed report-site case tested the retired website, not the application. Optional emoji re-vendoring still requires an explicitly supplied original native asset source; installed vendored assets do not need that archive to run.

## Verification and remaining limits

Run `npm run check:structure` for the structural contract. It checks declared root areas and supported static import forms; it does not prove semantic architecture quality. `npm run check:push` runs the canonical root Poort gate and does not publish to GitHub. The local application profile remains available under its own directory. Test recording uses the developer's authorized Claude seat, not an API proxy or substitute provider.

Before this cleanup the latest full UI run was409/412. The three failures subsequently passed targeted checks; that is not a new full green run. Focused committed verification passed26 desktop and70 changed-boundary Node tests. The cleanup preserved all four fixture files byte-for-byte. Its relocated-fixture checks passed27/27, asset checks2/2, and fresh focused browser checks8/8. Three fresh lifecycle recordings were attempted and failed at agent.act because the configured Claude seat is signed out; no product assertion ran or was weakened in those attempts. The retired report website contributes one fewer product-suite case. Full model-driven acceptance remains unverified while the configured test seat is signed out.

The original private cloud, physical-phone synchronization, signed desktop installers, real external-account consent and live xAI inference remain unverified. Notion is outside current acceptance. A public source repository does not certify a production-ready service or complete product parity.

## Naming

`apps/web` and `apps/desktop` describe application responsibilities. Package names are `@grokbot/web` and `@grokbot/desktop`; root commands are unchanged. Persistent browser-storage keys, session cookies and Electron profile identifiers retain their original names for compatibility. Existing installations must keep `HARNESS_DATA_DIR` pointed at the same private data directory during this path migration.

The application-directory migration passed883 maintained Node checks,26 desktop checks and3 fresh browser checks. Root npm setup installed the renamed lockfile; root npm start served the verified health DTO and exact apps/web entrypoint. This is separate from complete model-driven acceptance.

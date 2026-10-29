import base from './e2e.config';

export default {
  ...base,
  tests: ['tests/queue-draft-recovery.e2e.ts'],
  output: '.e2e/queue-draft-recovery',
  targets: base.targets.map(target => ({
    ...target,
    app: {...target.app, url: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8878'},
  })),
};

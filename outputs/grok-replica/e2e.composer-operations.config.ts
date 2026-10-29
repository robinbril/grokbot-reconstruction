import base from './e2e.composer-editor.config';
export default {
 ...base,
 tests:['tests/chat-delivery.e2e.ts','tests/chat-formats.e2e.ts'],
 output:'.e2e/composer-operations',
};

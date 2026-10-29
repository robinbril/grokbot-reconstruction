import base from './e2e.composer-editor.config';
export default {
 ...base,
 tests:['tests/chat-delivery.e2e.ts','tests/chat-streaming.e2e.ts','tests/chat-formats.e2e.ts','tests/ui-motion-main.e2e.ts'],
 output:'.e2e/composer-migration',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18894',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-composer-migration-{port}'}}}})),
};

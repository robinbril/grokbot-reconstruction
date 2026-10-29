import base from './e2e.config';
export default {
 ...base,tests:['tests/draft-retention.e2e.ts','tests/composer-reliability.e2e.ts','tests/attachments.e2e.ts','tests/composer-canvas-selection.e2e.ts','tests/composer-emoji.e2e.ts'],output:'.e2e/draft-retention',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:19043',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-draft-retention-{port}'}}}})),
};

import base from './e2e.config';
export default {
 ...base,
 tests:['tests/workflow-commands.e2e.ts','tests/live-workflows.e2e.ts'],
 output:'.e2e/composer-final-migration',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18901',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-composer-final-migration-{port}'}}}})),
};

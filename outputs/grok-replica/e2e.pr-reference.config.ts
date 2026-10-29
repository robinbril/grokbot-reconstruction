import base from './e2e.config';
export default {
 ...base,tests:['tests/pr-reference.e2e.ts'],output:'.e2e/pr-reference',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18913',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-pr-reference-{port}'}}}})),
};

import base from './e2e.config';
export default {
 ...base,
 tests:['tests/provider-catalog.e2e.ts'],
 output:'.e2e/provider-catalog',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:8893',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-provider-catalog-{port}'}}}})),
};

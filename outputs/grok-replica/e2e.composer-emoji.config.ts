import base from './e2e.config';
export default {
 ...base,tests:['tests/composer-emoji.e2e.ts'],output:'.e2e/composer-emoji',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18903',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-composer-emoji-{port}'}}}})),
};

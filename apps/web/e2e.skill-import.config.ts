import base from './e2e.config';
export default {
 ...base,tests:['tests/skill-import.e2e.ts'],output:'.e2e/skill-import',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:'http://127.0.0.1:19041',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-skill-import-{port}'}}}})),
};

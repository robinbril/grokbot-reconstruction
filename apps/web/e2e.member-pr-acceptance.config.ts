import base from './e2e.config';
export default {
 ...base,
 tests:['tests/composer-mentions.e2e.ts','tests/pr-reference.e2e.ts','tests/composer-emoji.e2e.ts','tests/composer-quote-editor.e2e.ts','tests/workflow-commands.e2e.ts','tests/runtime-description.e2e.ts'],
 output:'.e2e/member-pr-acceptance',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18920',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-member-pr-acceptance-{port}'}}}})),
};

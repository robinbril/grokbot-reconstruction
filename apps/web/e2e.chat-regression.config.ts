import base from './e2e.config';
export default {
 ...base,tests:['tests/chat-formats.e2e.ts','tests/chat-delivery.e2e.ts','tests/chat-streaming.e2e.ts'],output:'.e2e',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18936',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-chat-regression-{port}'}}}})),
};

import base from './e2e.config';
export default {...base,tests:['tests/live-queue-draft-recovery.e2e.ts','tests/queue-draft-recovery.e2e.ts'],output:'.e2e/queue-recovery-accept',targets:base.targets.map(target=>({...target,app:{...target.app,url:'http://127.0.0.1:18879',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-recovery-accept-{port}'}}}}))};

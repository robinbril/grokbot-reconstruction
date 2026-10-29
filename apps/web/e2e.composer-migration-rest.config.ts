import base from './e2e.composer-editor.config';
export default {
 ...base,
 tests:["tests/attachments.e2e.ts", "tests/avatar-morphs.e2e.ts", "tests/command-palette.e2e.ts", "tests/legacy-task-durability.e2e.ts", "tests/live-harness.e2e.ts", "tests/live-queue-draft-recovery.e2e.ts", "tests/outgoing-delivery.e2e.ts", "tests/product-operations.e2e.ts", "tests/product-primary-motion-proof.e2e.ts", "tests/queue-draft-recovery.e2e.ts", "tests/replica.e2e.ts", "tests/rich-transcript.e2e.ts", "tests/settings-controls.e2e.ts", "tests/streaming-attachments.e2e.ts", "tests/version0712-tasks.e2e.ts", "tests/workflow-delivery.e2e.ts", "tests/incoming-replies.e2e.ts"],
 output:'.e2e/composer-migration-rest',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:18897',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-composer-migration-rest-{port}'}}}})),
};

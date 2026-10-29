import base from './e2e.config';
export default {
 ...base,tests:['tests/canvas-frame-review.e2e.ts'],output:'.e2e/canvas-frame-review',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:'http://127.0.0.1:19002',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-canvas-frame-review-{port}'}}}})),
};

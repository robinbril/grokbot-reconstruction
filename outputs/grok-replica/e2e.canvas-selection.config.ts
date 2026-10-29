import base from './e2e.config';
export default {
 ...base,tests:['tests/live-canvas-selection.e2e.ts'],output:'.e2e/canvas-selection',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:'http://127.0.0.1:19032',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-canvas-selection-{port}'}}}})),
};

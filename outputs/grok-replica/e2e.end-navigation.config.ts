import base from './e2e.config';
export default {...base,tests:['tests/end-navigation.e2e.ts','tests/product-jump-latest.e2e.ts'],output:'.e2e/end-navigation',targets:base.targets.map(target=>({...target,app:{...target.app,url:'http://127.0.0.1:19049',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-end-navigation-{port}'}}}}))};

import base from './e2e.config';
import {web} from '@e2e-dev/web';
export default {
 ...base,output:'.e2e/source-chat',tests:['tests/source-chat-reference.e2e.ts'],workers:1,
 targets:base.targets.map(target=>({...target,engine:web({viewport:{width:1733,height:1267}}),app:{...target.app,url:'http://127.0.0.1:0',command:{...target.app.command,env:{PORT:'{port}',HARNESS_DATA_DIR:'.harness-runtime/e2e-source-chat-{port}'}}}})),
};

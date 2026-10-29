import base from './e2e.config';
export default {...base,output:'.e2e/streaming',tests:['tests/streaming-attachments.e2e.ts'],targets:[{...base.targets[0],app:{url:'http://127.0.0.1:8890',command:{executable:'node',args:['tests/fixtures/streaming-ui-server.mjs'],log:'.e2e/logs/streaming-ui.log'}}}]};

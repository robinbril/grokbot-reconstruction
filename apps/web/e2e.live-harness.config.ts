import base from './e2e.config';

// Required real-provider acceptance; kept separate from ordinary UI replay.
export default {
 ...base, tests:['tests/live-harness.e2e.ts'], output:'.e2e/live-harness',
 targets:base.targets.map(target=>({...target,app:{
  ...target.app, url:'http://127.0.0.1:0',
  command:{...target.app.command,env:{
   ...target.app.command.env,
   HARNESS_DATA_DIR:'.harness-runtime/e2e-live-harness-{port}',
   GROK_MODEL_PROVIDER:'claude-seat',
   CLAUDE_MODEL:process.env.CLAUDE_MODEL??'claude-sonnet-5-5',
  }},
 }})),
};

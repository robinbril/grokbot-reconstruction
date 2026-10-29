import base from './e2e.config';
export default {
 ...base,
 tests:['tests/tool-denial.e2e.ts'],
 output:'.e2e/tool-denial',
 targets:base.targets.map(target=>({...target,app:{...target.app,url:process.env.E2E_BASE_URL??'http://127.0.0.1:8893'}})),
};

// Explicit historical protocol coverage only. Production never imports this adapter.
import {fileURLToPath} from 'node:url';
import {HarnessRuntime} from '../../harness/runtime.mjs';
import {createHarnessHandler} from '../../harness/http.mjs';
import {startHarness} from './harness-http.mjs';
export {collectUntil,collectQueueUntil} from './harness-http.mjs';

const fixture=fileURLToPath(new URL('./harness-codex-fixture.mjs',import.meta.url));
const legacyFactory=codexBinary=>options=>new HarnessRuntime({...options,codexBinary});
export function startLegacyHarness({codexBinary=fixture,...options}={}){
 return startHarness({...options,runtimeFactory:legacyFactory(codexBinary)});
}
export function createLegacyHarnessHandler({codexBinary=fixture,...options}={}){
 return createHarnessHandler({...options,runtimeFactory:legacyFactory(codexBinary)});
}

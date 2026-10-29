import base from './e2e.config';
import type {E2EConfig} from 'e2e';
// Dedicated synthetic shared-server demo; start tests/fixtures/cloud-history-fixture.mjs first.
export default {...base,targets:[{...base.targets[0],app:{url:'http://127.0.0.1:8895/'}}]} satisfies E2EConfig;

import test from 'node:test';
import assert from 'node:assert/strict';
import {staticAssetType,staticAssetPolicy} from '../harness/static-assets.mjs';
test('PDF decoder resources are served only within their vendored public directory',()=>{
 for(const [name,type] of [['cmaps/78-EUC-H.bcmap','application/octet-stream'],['standard_fonts/FoxitSerif.pfb','application/octet-stream'],['standard_fonts/LiberationSans-Regular.ttf','font/ttf'],['wasm/openjpeg.wasm','application/wasm']])assert.equal(staticAssetType('assets/vendor/file-preview/'+name),type);
 for(const name of ['runtime/private.wasm','assets/vendor/elsewhere/file.bcmap','assets/vendor/file-preview/../private.wasm','assets/vendor/file-preview2/a.wasm','assets/vendor/file-preview/.private/a.wasm'])assert.equal(staticAssetType(name),null);
 assert.equal(staticAssetType('app.js'),'text/javascript; charset=utf-8');
 assert.equal(staticAssetType('index.html'),'text/html; charset=utf-8');
});
test('only the pinned PDF worker can compile local WASM; main scripts retain the existing policy',()=>{
 const normal=staticAssetPolicy('app.js');assert.match(normal,/script-src 'self';/);assert.doesNotMatch(normal,/wasm-unsafe-eval|unsafe-eval/);
 const worker=staticAssetPolicy('assets/vendor/file-preview/pdf.worker.js');assert.match(worker,/script-src 'self' 'wasm-unsafe-eval';/);assert.doesNotMatch(worker,/'unsafe-eval'/);
 assert.equal(staticAssetPolicy('assets/vendor/elsewhere/pdf.worker.js'),normal);
 assert.match(worker,/connect-src 'self';/);assert.match(worker,/object-src 'none';/);
});

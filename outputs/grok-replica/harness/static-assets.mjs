import path from 'node:path';
const baseTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const decoderTypes={'.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.otf':'font/otf','.wasm':'application/wasm'};
const policy="default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
export function staticAssetType(relative){
 const type=baseTypes[path.posix.extname(relative)];if(type)return type;
 if(!relative.startsWith('assets/vendor/file-preview/')||relative.includes('\\')||relative.split('/').some(part=>part.startsWith('.')))return null;
 return decoderTypes[path.posix.extname(relative)]??null;
}
export function staticAssetPolicy(relative){
 // The decoder is pinned local application code. Main-page JavaScript keeps
 // its existing no-eval policy; only this worker may compile local codec WASM.
 return relative==='assets/vendor/file-preview/pdf.worker.js'?policy.replace("script-src 'self';","script-src 'self' 'wasm-unsafe-eval';"):policy;
}

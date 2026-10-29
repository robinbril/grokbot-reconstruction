// Reproducible licensed popup positioning, separate from the editor bundle.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory='assets/vendor/composer-popup',pins={'@floating-ui/dom':'1.8.0'};
for(const [name,version] of Object.entries(pins))if(JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8')).version!==version)throw Error(`Version mismatch: ${name}`);
await mkdir(directory,{recursive:true});
const result=await build({stdin:{contents:"export {computePosition,offset,flip,shift,size,autoUpdate} from '@floating-ui/dom';",resolveDir:process.cwd(),sourcefile:'composer-popup-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:`${directory}/floating-ui.js`,minify:true,legalComments:'linked',metafile:true});
const packages=new Set();for(const file of Object.keys(result.metafile.inputs)){const match=file.match(/(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/);if(match)packages.add(match[1]);}
const bundled=[];
for(const base of [...packages].sort()){
 const metadata=JSON.parse(await readFile(`${base}/package.json`,'utf8')),destination=`${directory}/licenses/${metadata.name.replaceAll('/','__')}@${metadata.version}`;await mkdir(destination,{recursive:true});
 const licenses=(await readdir(base)).filter(name=>/^(?:licen[sc]e|copying|notice)(?:[.\-_]|$)/i.test(name));if(!licenses.length)throw Error(`Missing license: ${metadata.name}`);
 for(const name of licenses)await copyFile(`${base}/${name}`,`${destination}/${name}`);bundled.push({name:metadata.name,version:metadata.version,license:metadata.license,licenseFiles:licenses});
}
const bytes=await readFile(`${directory}/floating-ui.js`);await writeFile(`${directory}/manifest.json`,JSON.stringify({pins,bundled,recipe:'npm ci && node scripts/vendor-composer-popup.mjs',nativeBoundary:'Native middleware and options are recovered; its resolved package version is unavailable. This maintained local package pin is not native version parity.',artifact:{file:`${directory}/floating-ui.js`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},null,2)+'\n');
console.log(`Vendored popup: ${bytes.length} bytes, ${bundled.length} licensed packages.`);

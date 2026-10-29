// Offline, exact-version PDF.js browser runtime and resources.
import {readFile,writeFile,mkdir,copyFile,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const version='6.4.299',source='node_modules/pdfjs-dist',target='assets/vendor/file-preview';
if(JSON.parse(await readFile(source+'/package.json','utf8')).version!==version)throw new Error('Unexpected PDF.js version');
await mkdir(target,{recursive:true});
// Retain exact distribution originals beside the .js aliases served by this app.
for(const name of ['pdf.min.mjs','pdf.worker.min.mjs']){await copyFile(source+'/build/'+name,target+'/'+name);await copyFile(source+'/build/'+name,target+'/'+name.replace('.min.mjs','.js'));}
await copyFile(source+'/LICENSE',target+'/LICENSE');
const css=await readFile(source+'/web/pdf_viewer.css','utf8');
await writeFile(target+'/text-layer.css',css.slice(css.indexOf('.textLayer {'),css.indexOf('.textLayerImages {')));
for(const name of ['standard_fonts','cmaps','wasm'])await cp(source+'/'+name,target+'/'+name,{recursive:true});
const artifacts=[];
async function walk(directory){for(const item of await readdir(directory,{withFileTypes:true})){const file=directory+'/'+item.name;if(item.isDirectory())await walk(file);else if(item.name!=='manifest.json'){const data=await readFile(file);artifacts.push({file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}}
await walk(target);artifacts.sort((a,b)=>a.file.localeCompare(b.file));
await writeFile(target+'/manifest.json',JSON.stringify({package:'pdfjs-dist',version,license:'Apache-2.0',recipe:'node scripts/vendor-file-preview.mjs',artifacts},null,2)+'\n');
console.log('Vendored PDF.js '+version+' with '+artifacts.length+' local artifacts');

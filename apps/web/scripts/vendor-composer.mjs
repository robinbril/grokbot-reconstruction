// Reproducible self-hosted editor runtime; never touches other renderer bundles.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory='assets/vendor/composer';
const pins={'@tiptap/core':'3.32.0','@tiptap/pm':'3.32.0','@tiptap/extension-link':'3.32.0',esbuild:'0.28.2'};
for(const [name,version] of Object.entries(pins)){
 const metadata=JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8'));
 if(metadata.version!==version)throw Error(`Version mismatch: ${name}`);
}
await mkdir(directory,{recursive:true});
const result=await build({stdin:{contents:`export {Editor,Node,Extension,wrappingInputRule,PasteRule} from '@tiptap/core';
export {Link} from '@tiptap/extension-link';
export {EditorState,TextSelection} from '@tiptap/pm/state';
export {splitListItem,sinkListItem,liftListItem} from '@tiptap/pm/schema-list';
export {Fragment,Slice,DOMParser as ProseMirrorDOMParser} from '@tiptap/pm/model';
export {history,undo,redo,closeHistory} from '@tiptap/pm/history';`,resolveDir:process.cwd(),sourcefile:'composer-vendor-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:`${directory}/tiptap.js`,minify:true,legalComments:'linked',metafile:true});
const packages=new Set();
for(const file of Object.keys(result.metafile.inputs)){
 const match=file.match(/(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/);
 if(match)packages.add(match[1]);
}
const bundled=[];
for(const base of [...packages].sort()){
 const metadata=JSON.parse(await readFile(`${base}/package.json`,'utf8'));
 const destination=`${directory}/licenses/${metadata.name.replaceAll('/','__')}@${metadata.version}`;
 await mkdir(destination,{recursive:true});
 const licenses=(await readdir(base)).filter(name=>/^(?:licen[sc]e|copying|notice)(?:[.\-_]|$)/i.test(name));
 if(!licenses.length)throw Error(`Missing license: ${metadata.name}`);
 for(const name of licenses)await copyFile(`${base}/${name}`,`${destination}/${name}`);
 bundled.push({name:metadata.name,version:metadata.version,license:metadata.license,licenseFiles:licenses});
}
const bytes=await readFile(`${directory}/tiptap.js`);
await writeFile(`${directory}/manifest.json`,JSON.stringify({pins,bundled,recipe:'npm ci && npm run vendor:composer',nativeBoundary:'Native uses Tiptap; its resolved lockfile version is unavailable. This is a maintained exact local pin, not a native package-version parity claim.',artifact:{file:`${directory}/tiptap.js`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},null,2)+'\n');
console.log(`Vendored composer: ${bytes.length} bytes, ${bundled.length} licensed packages.`);

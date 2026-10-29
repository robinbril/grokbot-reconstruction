// Reproducible, offline browser assets from exact installed package versions.
import { build } from 'esbuild';
import { readFile,writeFile,mkdir,readdir,copyFile,cp,rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const pins = {mermaid:'11.17.2',shiki:'4.5.0',katex:'0.19.0',esbuild:'0.28.2','marked-footnote':'1.4.0'};
for (const [name,version] of Object.entries(pins)) { const metadata = JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8')); if (metadata.version !== version) throw new Error(`Version mismatch: ${name}`); }
await rm('assets/vendor/mermaid',{recursive:true,force:true});
await rm('assets/vendor/shiki',{recursive:true,force:true});
const bundledPackages = new Set();
const collect = result => { for (const file of Object.keys(result.metafile.inputs)) { const match = file.match(/(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/); if (match) bundledPackages.add(match[1]); } };
await mkdir('assets/vendor/mermaid',{recursive:true});
collect(await build({stdin:{contents:"export { default } from 'mermaid';",resolveDir:process.cwd(),sourcefile:'chat-mermaid-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',splitting:true,outdir:'assets/vendor/mermaid',entryNames:'mermaid',chunkNames:'chunks/[name]-[hash]',minify:true,legalComments:'linked',metafile:true,write:true}));
await mkdir('assets/vendor/shiki',{recursive:true});
collect(await build({stdin:{contents:`import {createHighlighterCore} from 'shiki/core';
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript';
import js from 'shiki/langs/javascript.mjs';import ts from 'shiki/langs/typescript.mjs';
import json from 'shiki/langs/json.mjs';import css from 'shiki/langs/css.mjs';import html from 'shiki/langs/html.mjs';
import diff from 'shiki/langs/diff.mjs';import python from 'shiki/langs/python.mjs';import bash from 'shiki/langs/bash.mjs';import markdown from 'shiki/langs/markdown.mjs';import sql from 'shiki/langs/sql.mjs';
import light from 'shiki/themes/github-light.mjs';import dark from 'shiki/themes/github-dark.mjs';
let engine;export function createChatHighlighter(){return engine??=createHighlighterCore({themes:[light,dark],langs:[js,ts,json,css,html,diff,python,bash,markdown,sql],engine:createJavaScriptRegexEngine()});}`,
resolveDir:process.cwd(),sourcefile:'chat-shiki-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'assets/vendor/shiki/shiki.js',minify:true,legalComments:'linked',metafile:true,write:true}));
await mkdir('assets/vendor/marked-footnote',{recursive:true});
await copyFile('node_modules/marked-footnote/dist/index.js','assets/vendor/marked-footnote/marked-footnote.js');
// npm omits its root license. Preserve the checked-in exact published-commit license.
const footnoteLicense = await readFile('assets/vendor/marked-footnote/LICENSE');
if (createHash('sha256').update(footnoteLicense).digest('hex') !== '9359f7399b808813111a91c5d28656d5843d8f6d337168541938286dbf273a32') throw new Error('Unexpected footnote license');
await copyFile('node_modules/katex/dist/katex.css','assets/vendor/katex/katex.css');
await cp('node_modules/katex/dist/fonts','assets/vendor/katex/fonts',{recursive:true});
for (const name of ['mermaid','shiki']) await copyFile(`node_modules/${name}/LICENSE`,`assets/vendor/${name}/LICENSE`);
await rm('assets/vendor/chat-licenses',{recursive:true,force:true});
await mkdir('assets/vendor/chat-licenses',{recursive:true});
const bundled = [];
for (const base of [...bundledPackages].sort()) {
  const metadata = JSON.parse(await readFile(`${base}/package.json`,'utf8'));
  const directory = `assets/vendor/chat-licenses/${metadata.name.replaceAll('/','__')}@${metadata.version}`;
  await mkdir(directory,{recursive:true});
  const licenses = (await readdir(base)).filter(name => /^(?:licen[sc]e|copying|notice)(?:[.\-_]|$)/i.test(name));
  for (const name of licenses) { try { await copyFile(`${base}/${name}`,`${directory}/${name}`); } catch (error) { if (error.code !== 'EISDIR') throw error; } }
  if (!licenses.length) { const readme = await readFile(`${base}/README.md`,'utf8'); const at = readme.search(/^## License/m); if (at < 0) throw new Error(`Missing license for ${metadata.name}`); await writeFile(`${directory}/LICENSE-from-README.md`,readme.slice(at)); licenses.push('LICENSE-from-README.md'); }
  bundled.push({name:metadata.name,version:metadata.version,license:metadata.license,licenseFiles:licenses});
}
const artifacts = [];
async function walk(directory) { for (const item of await readdir(directory,{withFileTypes:true})) { const name = `${directory}/${item.name}`; if (item.isDirectory()) await walk(name); else { const data = await readFile(name); artifacts.push({file:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}); } } }
for (const name of ['mermaid','shiki','katex','marked-footnote','chat-licenses']) await walk(`assets/vendor/${name}`);
artifacts.sort((a,b) => a.file.localeCompare(b.file));
await writeFile('assets/vendor/chat-renderer-manifest.json',JSON.stringify({pins,bundled,footnoteLicenseSource:'https://raw.githubusercontent.com/bent10/marked-extensions/faab750f00af4788397948286fb8f7fe0c929a7e/license',recipe:'npm ci && npm run vendor:chat-renderer',nativeVersionBoundary:'Native declares Mermaid ^11.16.0 and KaTeX ^0.16.45; exact native lock resolution is unavailable. Mermaid 11.17.2 satisfies that range and includes maintained security fixes; exact layout parity with an unknown native lock resolution is not asserted. Mermaid nested KaTeX is overridden to that same safe 0.19.0, avoiding a vulnerable older nested copy. Replica KaTeX 0.19.0 remains the pre-existing frozen maintained pin, not a native version-parity claim.',security:'Self-hosted ESM, Shiki JavaScript regex engine, no eval or WASM. Mermaid strict, htmlLabels:false; generated SVG receives a separate strict allowlist. KaTeX upstream CSS includes its global equation counter reset.',artifacts},null,2)+'\n');
console.log(`Vendored ${artifacts.length} files; Mermaid ${pins.mermaid}; Shiki ${pins.shiki}; KaTeX ${pins.katex}.`);

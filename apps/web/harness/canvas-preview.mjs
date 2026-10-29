import {build,transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harnessError} from './store.mjs';
const require=createRequire(import.meta.url),root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowed=new Set(['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client']);
export const canvasPreviewPolicy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const failed=message=>harnessError('CANVAS_COMPILE_FAILED',message.slice(0,2000),422);
function sourcePlugin(source){
 return {name:'owned-canvas-source',setup(build){
  build.onResolve({filter:/^canvas-entry$/},args=>args.kind==='entry-point'?{path:'entry',namespace:'canvas-entry'}:null);
  build.onLoad({filter:/.*/,namespace:'canvas-entry'},()=>({contents:'import React from "react";import {createRoot} from "react-dom/client";import Canvas from "canvas-user";import {activateCanvasDesign} from "canvas-design";activateCanvasDesign();createRoot(document.getElementById("canvas-root"),{onUncaughtError:showCanvasError}).render(React.createElement(Canvas));',loader:'js',resolveDir:root}));
  build.onResolve({filter:/^canvas-user$/,namespace:'canvas-entry'},()=>({path:'source.canvas.tsx',namespace:'canvas-user'}));
  build.onLoad({filter:/.*/,namespace:'canvas-user'},async()=>({contents:(await transform(source,{loader:'tsx',jsx:'automatic',jsxDev:true,sourcefile:'source.canvas.tsx'})).code,loader:'js',resolveDir:root}));
  build.onResolve({filter:/^canvas-design$/,namespace:'canvas-entry'},()=>({path:'design',namespace:'canvas-design'}));
  build.onResolve({filter:/^canvas-design$/,namespace:'canvas-jsx'},()=>({path:'design',namespace:'canvas-design'}));
  build.onLoad({filter:/.*/,namespace:'canvas-design'},async()=>({contents:await readFile(new URL('./canvas-design-runtime.js',import.meta.url),'utf8'),loader:'js'}));
  build.onLoad({filter:/.*/,namespace:'canvas-jsx'},async()=>({contents:await readFile(new URL('./canvas-jsx-runtime.js',import.meta.url),'utf8'),loader:'js',resolveDir:root}));
  build.onResolve({filter:/^react\/jsx-runtime$/,namespace:'canvas-jsx'},()=>({path:require.resolve('react/jsx-runtime')}));
  build.onResolve({filter:/.*/,namespace:'canvas-user'},args=>{
   if(args.path==='react/jsx-dev-runtime')return {path:'jsx',namespace:'canvas-jsx'};
   if(!allowed.has(args.path))return {errors:[{text:'Canvas imports support only the installed React runtime.'}]};
   try{return {path:require.resolve(args.path)};}catch{return {errors:[{text:'The installed React preview runtime is unavailable.'}]};}
  });
 }};
}
// Compiles source as data. Only the opaque browser frame executes the result.
export async function compileCanvas({source,title='Canvas',theme='light',signal}={}){
 if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>65536||source.includes('\0')||typeof title!=='string'||title.length>200||!['light','dark'].includes(theme))throw failed('Canvas source or title exceeds its preview limits.');
 signal?.throwIfAborted();let result;
 try{result=await build({entryPoints:['canvas-entry'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'es2022',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[sourcePlugin(source)]});}
 catch(error){throw failed('Canvas TSX could not compile: '+(error.errors?.map(value=>value.text).join('; ')??'Invalid source or unavailable runtime.'));}
 signal?.throwIfAborted();const code=result.outputFiles[0].text.replace(/<\/script/giu,'<\\/script');
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;color-scheme:'+theme+';background:'+(theme==='dark'?'#111':'#fff')+';color:'+(theme==='dark'?'#eee':'#111')+'}#canvas-error{white-space:pre-wrap;padding:16px;color:#b00020}</style></head><body><div id="canvas-root"></div><pre id="canvas-error" hidden></pre><script>function showCanvasError(error){const node=document.getElementById("canvas-error");node.hidden=false;node.textContent="Canvas runtime error: "+String(error?.message??error).slice(0,1000)}addEventListener("error",event=>showCanvasError(event.message));'+code+'</script></body></html>';
}

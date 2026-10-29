import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../harness/canvas-preview.mjs').catch(()=>null);
function compile(options){assert.equal(typeof module?.compileCanvas,'function','real TSX preview compiler must exist');return module.compileCanvas(options);}
test('React TSX compiles without executing source on the server',async()=>{
 const html=await compile({title:'<synthetic>',source:'import {useState} from "react"; globalThis.__canvasServerEffect=true; export default function App(){const [count,setCount]=useState(0);return <button onClick={()=>setCount(count+1)}>Count {count}</button>}'});
 assert.equal(globalThis.__canvasServerEffect,undefined);assert.match(html,/&lt;synthetic&gt;/);assert.match(html,/Count/);assert.match(html,/createRoot/);assert.doesNotMatch(html,/<script[^>]+src=/);
 assert.match(module.canvasPreviewPolicy,/connect-src 'none'/);assert.match(module.canvasPreviewPolicy,/sandbox allow-scripts/);assert.doesNotMatch(module.canvasPreviewPolicy,/allow-same-origin/);
});
test('foreign file, network and builtin imports reject before any output is served',async()=>{
 for(const target of ['node:fs','/etc/passwd','./secret','https://example.test/x.js','react-dom/server'])await assert.rejects(compile({title:'Bad',source:`import x from ${JSON.stringify(target)}; export default function App(){return <p>{String(x)}</p>}`}),{code:'CANVAS_COMPILE_FAILED'});
});
test('malformed TSX and missing default export fail with bounded readable diagnostics',async()=>{
 for(const source of ['export default function App(){return <main>}','export const x=1'])await assert.rejects(compile({title:'Broken',source}),error=>error.code==='CANVAS_COMPILE_FAILED'&&error.message.length<=2000);
});
test('script-shaped text cannot escape the owned preview script and create extra markup',async()=>{
 const html=await compile({title:'Safe',source:'export default function App(){return <p>{"</script><script>globalThis.__leak=1</script>"}</p>}'});
 assert.equal((html.match(/<\/script>/g)??[]).length,1);assert.doesNotMatch(html,/<\/script><script>/);assert.equal(globalThis.__leak,undefined);
});

test('user source cannot resolve the compiler internal entry namespace',async()=>{
 await assert.rejects(compile({title:'Internal bypass',source:'import "canvas-entry"; export default function App(){return <main>blocked</main>}'}),{code:'CANVAS_COMPILE_FAILED'});
});

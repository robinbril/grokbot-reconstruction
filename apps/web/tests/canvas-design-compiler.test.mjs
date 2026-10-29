import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCanvas} from '../harness/canvas-preview.mjs';
test('actual TSX opening positions are embedded through a source-aware production JSX bridge without server execution',async()=>{
 const html=await compileCanvas({source:'globalThis.__designServerEffect=true;\nexport default function Canvas(){return <main><h1 title="Heading">Exact</h1><button>Act</button></main>}'});
 assert.equal(globalThis.__designServerEffect,undefined);
 assert.match(html,/cursor-canvas-design-capable/);assert.match(html,/cursor-canvas-design-picked/);assert.match(html,/source\.canvas\.tsx/);
 assert.match(html,/lineNumber: 2/);assert.match(html,/columnNumber: 41/);
 assert.doesNotMatch(html,/<script[^>]+src=/);
});
test('source-aware JSX bridge does not expose internal compiler namespaces to authored imports',async()=>{
 for(const path of ['canvas-design','canvas-jsx-runtime','canvas-entry','canvas-user'])await assert.rejects(compileCanvas({source:`import x from '${path}';export default function Canvas(){return <h1>{String(x)}</h1>}`}),{code:'CANVAS_COMPILE_FAILED'});
});
test('metadata keeps refs and handlers untouched while bounding only primitive selection data',async()=>{
 const {annotateCanvasElement}=await import('../harness/canvas-design-runtime.js'),ref={current:null},onClick=()=>{},props={ref,onClick,title:'x'.repeat(200),style:{color:'red'},'data-rea-canvas-source':'forged'};
 const next=annotateCanvasElement('button',props,{fileName:'source.canvas.tsx',lineNumber:7,columnNumber:9});
 assert.equal(next.ref,ref);assert.equal(next.onClick,onClick);assert.equal(next.style,props.style);assert.equal(props['data-rea-canvas-source'],'forged');
 const metadata=JSON.parse(next['data-rea-canvas-source']);assert.deepEqual(metadata.anchor,{line:7,column:9});assert.equal(metadata.props.title.length,120);assert.equal(metadata.props.onClick,undefined);assert.equal(metadata.props.style,undefined);
 assert.equal(annotateCanvasElement('invalid:tag',props,{fileName:'source.canvas.tsx',lineNumber:7,columnNumber:9}),props);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCanvasInput,saveCanvasInput,pinnedCanvasInput,validateCanvasInput} from '../harness/canvas-context.mjs';
import {canvasSelectionAttrs,canvasSelectionProjection} from '../composer-canvas-selection.js';
import {appendHeldCanvasReference} from '../composer-canvas-reference.js';
const id='13ef3a12-60b7-4216-b4df-7b8fd3dd34ae',scope='b801193a-6b2b-4d5c-a766-19c8a192ce72';
const pick={stack:[{kind:'element',name:'h1',anchor:{line:1,column:41},props:{}}],tag:'h1',text:'Actual selected instance',rect:{x:10,y:20,width:100,height:30}};
const state=()=>({conversationId:scope,canvases:[{id,storeId:scope,title:'Owned source',revision:2,source:'export default function Canvas(){return <h1>Private source</h1>}'}]});
function document(selection=pick,sourceFile='source.canvas.tsx',canvasId=id){const attrs=canvasSelectionAttrs({canvasId,sourceFile,selection}),text=canvasSelectionProjection(attrs.label);return JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'canvasSelection',attrs},{type:'text',text:' Explain'}]}]});}
test('selected atom alone resolves actual owned source and pins exact selection context after pane closes',async()=>{
 const s=state(),richText=document(),resolved=resolveCanvasInput(s,richText);assert.equal(resolved.length,1);assert.equal(resolved[0].source,s.canvases[0].source);assert.deepEqual(resolved[0].selections,[{sourceFile:'source.canvas.tsx',label:'h1',selection:pick}]);
 let reads=0;await validateCanvasInput({resourceRead:async(owner,id,project)=>{reads++;return project(s);}},'owner',scope,richText);assert.equal(reads,1);
 saveCanvasInput(s,'queue:q',resolved);s.canvases[0].source='NEWER';assert.equal(pinnedCanvasInput(s,'queue:q',richText)[0].source,resolved[0].source);assert.throws(()=>pinnedCanvasInput(s,'queue:q',document({...pick,text:'Substituted'})),{code:'INVALID_CANVAS_REFERENCE'});
});
test('hidden held reference and multiple selections share one source while retaining every selection',()=>{
 const rich=appendHeldCanvasReference(document(),{canvasId:id,title:'Untrusted title'}),doc=JSON.parse(rich);doc.content[0].content.push({type:'canvasSelection',attrs:canvasSelectionAttrs({canvasId:id,sourceFile:'source.canvas.tsx',selection:{...pick,text:'Second instance'}})});
 const input=resolveCanvasInput(state(),JSON.stringify(doc));assert.equal(input.length,1);assert.equal(input[0].selections.length,2);assert.equal(input[0].title,'Owned source');assert.equal(input[0].selections[1].selection.text,'Second instance');
});
test('selection cannot read foreign resource or use sourceFile as filesystem authority',()=>{
 assert.throws(()=>resolveCanvasInput(state(),document(pick,'../secret.tsx')),{code:'INVALID_CANVAS_SELECTION'});
 assert.throws(()=>resolveCanvasInput(state(),document(pick,'source.canvas.tsx','d37d7317-754c-4e80-92b2-b39ae997ae85')),{code:'INVALID_CANVAS_REFERENCE'});
 const foreign=state();foreign.canvases[0].storeId='foreign';assert.throws(()=>resolveCanvasInput(foreign,document()),{code:'INVALID_CANVAS_REFERENCE'});
});
test('claimed anchors must identify actual JSX openings in the owned saved source in UTF16 columns',()=>{
 for(const anchor of [{line:999,column:1},{line:1,column:2},{line:1,column:42}])assert.throws(()=>resolveCanvasInput(state(),document({...pick,stack:[{...pick.stack[0],anchor}]})),{code:'INVALID_CANVAS_SELECTION'});
 const s=state();s.canvases[0].source='const label="é🙂"; export default function Canvas(){return <h1>{label}</h1>}';const actual={...pick,stack:[{...pick.stack[0],anchor:{line:1,column:60}}]};assert.equal(resolveCanvasInput(s,document(actual))[0].selections[0].selection.stack[0].anchor.column,60);
});
function revisionDocument(revision){const doc=JSON.parse(document()),attrs=doc.content[0].content[0].attrs,selection=JSON.parse(attrs.selection);selection.__localSourceRevision=revision;attrs.selection=JSON.stringify(selection);return JSON.stringify(doc);}
test('explicit local selected revision keeps the actual old source when current content changed at the same anchor',()=>{
 const s=state(),old={...s.canvases[0],revision:1,source:'export default function Canvas(){return <h1>Before</h1>}'};s.canvasHistory=[old];s.canvases[0].source='export default function Canvas(){return <h1>After</h1>}';
 const rich=appendHeldCanvasReference(revisionDocument(1),{canvasId:id,title:'Current held title'}),resolved=resolveCanvasInput(s,rich);assert.equal(resolved.length,1);assert.equal(resolved[0].revision,1);assert.equal(resolved[0].source,old.source);saveCanvasInput(s,'queue:old',resolved);
 assert.equal(pinnedCanvasInput(s,'queue:old',rich)[0].revision,1);assert.throws(()=>pinnedCanvasInput(s,'queue:old',revisionDocument(2)),{code:'INVALID_CANVAS_REFERENCE'});
 assert.throws(()=>resolveCanvasInput(s,revisionDocument(99)),{code:'INVALID_CANVAS_SELECTION'});
 const mixed=JSON.parse(revisionDocument(1));mixed.content[0].content.push(JSON.parse(revisionDocument(2)).content[0].content[0]);assert.throws(()=>resolveCanvasInput(s,JSON.stringify(mixed)),{code:'INVALID_CANVAS_SELECTION'});
});
test('actual intrinsic element produced by a JSX alias keeps its true source opening anchor',()=>{
 const s=state();s.canvases[0].source='const Tag="h1";export default function Canvas(){return <Tag>Alias</Tag>}';const alias={...pick,stack:[{...pick.stack[0],anchor:{line:1,column:s.canvases[0].source.indexOf('<Tag>')+1}}]};assert.equal(resolveCanvasInput(s,document(alias))[0].selections[0].selection.stack[0].name,'h1');
});

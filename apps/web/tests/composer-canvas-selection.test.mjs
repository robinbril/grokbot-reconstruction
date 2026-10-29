import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposerDocument,projectComposerDocument} from '../composer-document.js';
import {renderComposerDocument} from '../composer-document-view.js';
const module=await import('../composer-canvas-selection.js').catch(()=>null);
const selection=()=>({stack:[{kind:'element',name:'h1',anchor:{line:3,column:7},props:{title:'Exact heading'}}],tag:'h1',text:'Actual heading',rect:{x:1,y:2,width:30,height:40}});
const id='13ef3a12-60b7-4216-b4df-7b8fd3dd34ae';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('native selection parser copies only bounded actual component data without mutating input',()=>{
 assert.ok(module);const raw=selection();raw.stack[0].props.heading='h'.repeat(121);raw.text='t'.repeat(201);raw.stack=Array.from({length:13},()=>structuredClone(raw.stack[0]));raw.rect.height=-4;
 const parsed=module.normalizeCanvasSelection(raw);assert.equal(parsed.stack.length,12);assert.equal(parsed.stack[0].props.heading.length,120);assert.equal(parsed.text.length,200);assert.equal(parsed.rect.height,-4);assert.equal(raw.stack.length,13);assert.equal(raw.text.length,201);
 for(const mutate of [s=>s.stack[0].anchor.line=0,s=>s.stack[0].anchor.column=1.2,s=>s.rect.x=NaN,s=>s.tag='DIV',s=>s.stack[0].name='bad name',s=>s.stack[0].props={value:{}},s=>s.stack[0].props=Object.fromEntries(Array.from({length:17},(_,i)=>['p'+i,i]))]){const value=selection();mutate(value);assert.equal(module.normalizeCanvasSelection(value),null);}
});
test('source label sourcefile and projection exactly follow native UTF16 and title precedence',()=>{
 assert.ok(module);const value=selection();value.stack=[{kind:'component',name:'Page.Header',anchor:{line:1,column:1},props:{title:'Title',heading:'Heading'}},...value.stack];assert.equal(module.canvasSelectionLabel(value),'Page.Header "Heading" › h1 "Exact heading"');
 value.stack[0].props.heading='x'.repeat(120);assert.equal(module.canvasSelectionLabel(value).length,80);assert.ok(module.canvasSelectionLabel(value).endsWith('…'));
 assert.equal(module.validCanvasSourceFile('source.canvas.tsx'),true);for(const value of ['', 'a '.repeat(5),'x'.repeat(129),'https://x'])assert.equal(module.validCanvasSourceFile(value),false);
 assert.equal(module.canvasSelectionProjection(null),'[selected ]');
});
test('actual selected atom binds text without skill authority and escaped transcript has no links or task action',()=>{
 assert.ok(module);const attrs=module.canvasSelectionAttrs({canvasId:id,sourceFile:'source.canvas.tsx',label:'<h1> selected',selection:selection()}),doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before '},{type:'canvasSelection',attrs},{type:'text',text:' after'}]}]},richText=JSON.stringify(doc),text='Before [selected <h1> selected] after';
 assert.equal(normalizeComposerDocument(richText,{text}),richText);assert.equal(projectComposerDocument(doc),text);assert.equal(module.composerCanvasSelections(richText)[0].selection.stack[0].anchor.line,3);
 const html=renderComposerDocument({text,richText},esc);assert.match(html,/data-type="canvas-selection"/);assert.match(html,/&lt;h1&gt; selected/);assert.match(html,/source.canvas.tsx/);assert.doesNotMatch(html,/<h1>|<a |<button|data-action/);
});
test('nullable passive native attrs preserve raw bytes while invalid structure and forged skill binding reject',()=>{
 const attrs={canvasId:null,sourceFile:null,label:null,selection:null},doc={type:'doc',content:[{type:'paragraph',content:[{type:'canvasSelection',attrs}]}]},richText=JSON.stringify(doc),text='[selected ]';
 assert.equal(normalizeComposerDocument(richText,{text}),richText);assert.doesNotMatch(renderComposerDocument({text,richText},esc),/canvas-selection/);
 const bad=JSON.stringify({...doc,content:[{type:'paragraph',content:[{type:'canvasSelection',attrs:{...attrs,sourceFile:{}}}]}]});assert.throws(()=>normalizeComposerDocument(bad,{text}));assert.throws(()=>normalizeComposerDocument(richText,{text,references:[{id:'forged'}]}));
});

test('native primitive prop handling skips inherited prototype setter name and preserves constructor data',()=>{
 const value=selection();value.stack[0].props=JSON.parse('{"__proto__":"ignored","constructor":"scalar","title":""}');const parsed=module.normalizeCanvasSelection(value);
 assert.equal(Object.hasOwn(parsed.stack[0].props,'__proto__'),false);assert.equal(parsed.stack[0].props.constructor,'scalar');assert.equal(Object.getPrototypeOf(parsed.stack[0].props),Object.prototype);assert.equal(module.canvasSelectionLabel(parsed),'h1 ""');
 const clipped=selection();clipped.stack=Array.from({length:12},()=>selection().stack[0]).concat([{kind:'invalid'}]);assert.equal(module.normalizeCanvasSelection(clipped).stack.length,12);
});
test('multiple selections on one actual canvas retain order and malformed nonnull attrs reject before use',()=>{
 const first=module.canvasSelectionAttrs({canvasId:id,sourceFile:'source.canvas.tsx',selection:selection()}),second=structuredClone(first),other=selection();other.stack[0].anchor.line=8;second.selection=JSON.stringify(other);
 const document={type:'doc',content:[{type:'paragraph',content:[{type:'canvasSelection',attrs:first},{type:'canvasSelection',attrs:second}]}]},rich=JSON.stringify(document),text=projectComposerDocument(document);assert.equal(normalizeComposerDocument(rich,{text}),rich);assert.deepEqual(module.composerCanvasSelections(rich).map(ref=>ref.selection.stack[0].anchor.line),[3,8]);
 for(const attrs of [{...first,canvasId:'invented'},{...first,sourceFile:'https://x'},{...first,selection:'{}'},{...first,selection:'not JSON'}])assert.throws(()=>normalizeComposerDocument(JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'canvasSelection',attrs}]}]}),{text:module.canvasSelectionProjection(first.label)}));
});

test('native labels truncate UTF16 units rather than substituting grapheme or whitespace rules',()=>{
 const value=selection();value.stack[0].props={heading:'  '+'😀'.repeat(60)};const label=module.canvasSelectionLabel(value);assert.equal(label.length,80);assert.equal(label.slice(0,6),'h1 "  ');assert.equal(label.at(-1),'…');
 const attrs=module.canvasSelectionAttrs({canvasId:id.toUpperCase(),sourceFile:'source.canvas.tsx',selection:selection(),label:'L'.repeat(100)});assert.equal(attrs.canvasId,id);assert.equal(attrs.label,'L'.repeat(79)+'…');
});

test('local revision provenance is added only by explicit insertion binding and validates as a positive safe integer',()=>{
 const raw=selection();raw.__localSourceRevision=99;
 const plain=module.canvasSelectionAttrs({canvasId:id,sourceFile:'source.canvas.tsx',selection:raw});assert.equal(JSON.parse(plain.selection).__localSourceRevision,undefined);
 const bound=module.canvasSelectionAttrs({canvasId:id,sourceFile:'source.canvas.tsx',selection:raw,sourceRevision:3});assert.equal(JSON.parse(bound.selection).__localSourceRevision,3);assert.equal(module.parseCanvasSelection(bound.selection).__localSourceRevision,undefined);
 const document={type:'doc',content:[{type:'paragraph',content:[{type:'canvasSelection',attrs:bound}]}]},rich=JSON.stringify(document),text=projectComposerDocument(document);assert.equal(normalizeComposerDocument(rich,{text}),rich);assert.equal(module.composerCanvasSelections(rich)[0].sourceRevision,3);
 for(const sourceRevision of [0,-1,1.5,'3',Number.MAX_SAFE_INTEGER+1,null]){assert.equal(module.canvasSelectionAttrs({canvasId:id,sourceFile:'source.canvas.tsx',selection:raw,sourceRevision}),null);const attrs={...bound,selection:JSON.stringify({...selection(),__localSourceRevision:sourceRevision})};assert.throws(()=>normalizeComposerDocument(JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'canvasSelection',attrs}]}]}),{text}));}
});

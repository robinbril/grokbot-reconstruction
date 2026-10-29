import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCanvasReferenceAttrs,composerCanvasReferences,appendHeldCanvasReference} from '../composer-canvas-reference.js';
import {normalizeComposerDocument,projectComposerDocument} from '../composer-document.js';
const id='A3C91BB0-3D6B-4BBA-A8D1-4F6813FBD3FF',other='f28f9f89-c385-7b3a-bcc2-5ff68864751a';
const doc=content=>JSON.stringify({type:'doc',content:[{type:'paragraph',content}]});
const node=attrs=>({type:'canvasReference',attrs});
test('native reference normalizer canonicalizes UUID and preserves ordinary title whitespace with bounded controls',()=>{
 assert.deepEqual(normalizeCanvasReferenceAttrs({canvasId:' '+id+' ',storeId:null,title:' \tA  B\n\rC\u2028D '}),{canvasId:id.toLowerCase(),storeId:null,title:'A  B C D'});
 const storeId='store-'+id;assert.equal(normalizeCanvasReferenceAttrs({canvasId:id,storeId:' '+storeId+' ',title:'x'.repeat(201)}).storeId,storeId);
 assert.equal(normalizeCanvasReferenceAttrs({canvasId:id,title:'x'.repeat(201)}).title.length,200);
 for(const canvasId of ['bad',id.replace('-4BBA','-6BBA'),null])assert.equal(normalizeCanvasReferenceAttrs({canvasId}),null);
 assert.equal(normalizeCanvasReferenceAttrs({canvasId:id,storeId:id}),null);
});
test('raw append preserves existing nodes and duplicates while extraction deduplicates canonical canvas identity',()=>{
 const richText=doc([{type:'text',text:'  Keep bytes  '}]);
 const first=appendHeldCanvasReference(richText,{canvasId:id,storeId:null,title:' first\n title '},{text:'  Keep bytes  '});
 const twice=appendHeldCanvasReference(first,{canvasId:id.toLowerCase(),storeId:null,title:'second'});
 assert.equal(JSON.parse(twice).content[0].content.filter(n=>n.type==='canvasReference').length,2);
 assert.deepEqual(composerCanvasReferences(twice),[{canvasId:id.toLowerCase(),storeId:null,title:'first  title'}]);
 assert.equal(projectComposerDocument(JSON.parse(twice)),'  Keep bytes  ');
 assert.equal(normalizeComposerDocument(twice,{text:'  Keep bytes  '}),twice);
 assert.equal(projectComposerDocument(JSON.parse(appendHeldCanvasReference(undefined,{canvasId:other,title:'Other'},{text:'one\ntwo'}))),'one\n\ntwo');
});
test('hidden references retain exact durable input bytes without becoming skill authority',()=>{
 const richText=doc([{type:'text',text:'Explain '},node({canvasId:id,storeId:null,title:'Untrusted title'})]);
 assert.equal(normalizeComposerDocument(richText,{text:'Explain '}),richText);
 assert.throws(()=>normalizeComposerDocument(richText,{text:'Explain ',references:[{id}]}));
 assert.throws(()=>normalizeComposerDocument(doc([node({canvasId:'bad',storeId:null,title:'x'})]),{text:''}));
 assert.throws(()=>normalizeComposerDocument(doc([node({canvasId:id,source:'forged'})]),{text:''}));
});
test('raw hidden title controls including NUL remain presentation bytes and normalize only on extraction',()=>{
 const richText=doc([{type:'text',text:'Explain '},node({canvasId:id,storeId:null,title:'Raw\0\n\r title'})]);
 assert.equal(normalizeComposerDocument(richText,{text:'Explain '}),richText);
 assert.deepEqual(composerCanvasReferences(richText),[{canvasId:id.toLowerCase(),storeId:null,title:'Raw  title'}]);
 assert.throws(()=>normalizeComposerDocument(doc([node({canvasId:id+'\0',storeId:null,title:'x'})]),{text:''}));
});

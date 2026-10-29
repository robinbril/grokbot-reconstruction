import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasReferenceHold} from '../live-canvas-reference.js';
const reference={canvasId:'13ef3a12-60b7-4216-b4df-7b8fd3dd34ae',storeId:null,title:'Saved'};
test('stale pane cleanup cannot release replacement canvas context and snapshots are detached',()=>{
 const hold=createCanvasReferenceHold(),first=hold.hold(reference),second=hold.hold({...reference,title:'Replacement'});
 first();assert.equal(hold.current().title,'Replacement');const copy=hold.current();copy.title='Changed';assert.equal(hold.current().title,'Replacement');
 second();assert.equal(hold.current(),null);hold.hold(reference);hold.clear();assert.equal(hold.current(),null);
});

test('maintained absent-document sender preserves multiline and trailing newline projection',async()=>{
 const {appendCanvasSubmissionReference,canvasPayloadMatchesDraft}=await import('../live-canvas-reference.js'),{normalizeComposerDocument}=await import('../composer-document.js');
 const text='First\nSecond\n',payload=appendCanvasSubmissionReference(undefined,reference,{text});
 assert.equal(normalizeComposerDocument(payload,{text}),payload);assert.equal(canvasPayloadMatchesDraft(undefined,payload,text),true);
 assert.equal(JSON.parse(payload).content.length,1);assert.equal(JSON.parse(payload).content[0].content.filter(n=>n.type==='hardBreak').length,2);
});

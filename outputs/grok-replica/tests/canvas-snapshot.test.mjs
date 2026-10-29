import test from 'node:test';
import assert from 'node:assert/strict';
import {HarnessStore} from '../harness/store.mjs';
const store=new HarnessStore({dataDir:'/unused-canvas-snapshot-test'});

test('conversation polling exposes only detached canvas summaries, never source or revision history',()=>{
 const canvas={id:'canvas',storeId:'conversation',title:'Canvas',source:'PRIVATE_SOURCE_NONCE',revision:2,createdAt:'created',updatedAt:'updated'};
 const state={owner:'private-owner',events:[],requests:{private:'receipt'},customServers:[],agentHistory:[],conversationId:'conversation',entries:[],canvases:[canvas],canvasHistory:[{...canvas,revision:1,source:'PRIVATE_HISTORY_NONCE'}]};
 const snapshot=store.snapshot(state);
 assert.equal(JSON.stringify(snapshot).includes('PRIVATE_'),false);
 assert.equal(Object.hasOwn(snapshot,'canvasHistory'),false);
 const {source,...summary}=canvas;assert.deepEqual(snapshot.canvases,[summary]);
 snapshot.canvases[0].title='changed copy';assert.equal(state.canvases[0].title,'Canvas');
 assert.equal(state.canvases[0].source,'PRIVATE_SOURCE_NONCE');assert.equal(state.canvasHistory.length,1);
});

test('old conversation snapshots do not manufacture a canvas field or alter existing payloads',()=>{
 const snapshot=store.snapshot({owner:'private-owner',events:[],requests:{},customServers:[],agentHistory:[],conversationId:'old',entries:[{text:'unchanged'}]});
 assert.deepEqual(snapshot,{conversationId:'old',entries:[{text:'unchanged'}]});
});

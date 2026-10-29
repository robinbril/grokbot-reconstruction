import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {HarnessStore} from '../harness/store.mjs';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const module=await import('../harness/canvas-store.mjs').catch(()=>null);
const conversation='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const source='export default function App(){return <main>synthetic</main>}';
async function fixture(t,limits){
 assert.equal(typeof module?.CanvasStore,'function','real CanvasStore resource must exist');
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'grok-canvas-store-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const store=await new HarnessStore({dataDir}).init();return {store,dataDir,canvas:new module.CanvasStore({store,limits})};
}
test('canvas resource is durable, scoped and cloned across restart',async t=>{
 const {canvas,dataDir}=await fixture(t);const result=await canvas.create('owner',conversation,{requestId:'create',title:'  Synthetisch\ncanvas\u0001 ',source});
 assert.match(result.canvas.id,/^[a-f0-9-]{36}$/);assert.equal(result.canvas.storeId,conversation);assert.equal(result.canvas.title,'Synthetisch canvas');assert.equal(result.canvas.revision,1);
 result.canvas.source='mutated';assert.equal((await canvas.read('owner',conversation,result.canvas.id)).canvas.source,source);
 const list=await canvas.list('owner',conversation);assert.equal(list.canvases.length,1);assert.equal('source' in list.canvases[0],false);
 await assert.rejects(canvas.read('stranger',conversation,result.canvas.id),{code:'NOT_FOUND'});await assert.rejects(canvas.read('owner',other,result.canvas.id),{code:'CANVAS_NOT_FOUND'});
 const restarted=new module.CanvasStore({store:await new HarnessStore({dataDir}).init()});assert.equal((await restarted.read('owner',conversation,result.canvas.id)).canvas.source,source);
});
test('create and update replay exact immutable receipts before stale revision checks',async t=>{
 const {canvas}=await fixture(t);const body={requestId:'create',title:'One',source};const created=await canvas.create('owner',conversation,body);
 assert.deepEqual(await canvas.create('owner',conversation,body),created);await assert.rejects(canvas.create('owner',conversation,{...body,title:'Other'}),error=>error.code==='IDEMPOTENCY_CONFLICT'&&!Object.hasOwn(error,'accepted'));
 const update={requestId:'edit',expectedRevision:1,title:'Two',source:source+'\n'};const changed=await canvas.update('owner',conversation,created.canvas.id,update);assert.equal(changed.canvas.revision,2);
 assert.deepEqual(await canvas.update('owner',conversation,created.canvas.id,update),changed);assert.deepEqual(await canvas.create('owner',conversation,body),created);
 await assert.rejects(canvas.update('owner',conversation,created.canvas.id,{...update,requestId:'stale'}),{code:'CANVAS_REVISION_CONFLICT',accepted:false});
});
test('concurrent edits cannot overwrite one another',async t=>{
 const {canvas}=await fixture(t);const {canvas:c}=await canvas.create('owner',conversation,{requestId:'create',title:'One',source});
 const outcomes=await Promise.allSettled(['left','right'].map(requestId=>canvas.update('owner',conversation,c.id,{requestId,expectedRevision:1,title:requestId,source})));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'CANVAS_REVISION_CONFLICT');assert.equal((await canvas.read('owner',conversation,c.id)).canvas.revision,2);
});
test('invalid fields, IDs and source bounds never create state',async t=>{
 const {canvas,store}=await fixture(t);const body={requestId:'create',title:'One',source};
 for(const input of [{...body,extra:true},{...body,source:'x'.repeat(65537)},{...body,source:'\0'},{...body,title:''},{...body,title:'a'.repeat(201)},{...body,requestId:'../escape'}])await assert.rejects(canvas.create('owner',conversation,input),{code:'INVALID_CANVAS',accepted:false});
 await assert.rejects(canvas.create('owner','not-a-uuid',body),{code:'INVALID_CANVAS_STORE',accepted:false});assert.equal(store.states.size,0);
});
test('resource capacity rejects without dropping prior revisions or receipts',async t=>{
 const {canvas}=await fixture(t,{revisions:2});const body={requestId:'create',title:'One',source};const {canvas:c}=await canvas.create('owner',conversation,body);
 const updated=await canvas.update('owner',conversation,c.id,{requestId:'edit',expectedRevision:1,title:'Two',source});
 await assert.rejects(canvas.update('owner',conversation,c.id,{requestId:'overflow',expectedRevision:2,title:'Three',source}),{code:'CANVAS_CAPACITY',accepted:false});
 assert.deepEqual(await canvas.read('owner',conversation,c.id),updated);assert.equal((await canvas.create('owner',conversation,body)).canvas.revision,1);
});
test('abort before commit cannot save and write failure cannot claim a receipt',async t=>{
 const {canvas,store}=await fixture(t);const body={requestId:'create',title:'One',source};const signal=AbortSignal.abort(new Error('cancelled'));
 await assert.rejects(canvas.create('owner',conversation,body,{signal}),/cancelled/);assert.equal(store.states.size,0);
 const original=store.write;store.write=async()=>{throw new Error('disk unavailable');};await assert.rejects(canvas.create('owner',conversation,body),/disk unavailable/);assert.equal(store.states.size,0);
 store.write=original;assert.equal((await canvas.create('owner',conversation,body)).canvas.revision,1);
});


test('actual canvas UUID and receipt survive post-rename directory sync failure without duplicate creation',async t=>{
 const {canvas,store,dataDir}=await fixture(t);const original=fs.open;let deny=true;
 fs.open=async function(file,...args){const handle=await original.call(this,file,...args);if(path.resolve(String(file))===dataDir&&args[0]==='r'&&deny)return {sync:async()=>{throw Error('directory sync unavailable');},close:()=>handle.close()};return handle;};syncBuiltinESMExports();
 t.after(()=>{fs.open=original;syncBuiltinESMExports();});
 const body={requestId:'uncertain-create',title:'Original UUID',source};await assert.rejects(canvas.create('owner',conversation,body),error=>/directory sync unavailable/.test(error.message)&&!Object.hasOwn(error,'accepted'));
 const disk=JSON.parse(await fs.readFile(path.join(dataDir,'conversation-'+conversation+'.json'),'utf8'));const receipt=disk.requests['canvas:uncertain-create'].response;
 assert.equal(disk.canvases.length,1);assert.equal(store.get('owner',conversation).canvases[0].id,receipt.canvas.id);
 await assert.rejects(canvas.read('owner',conversation,receipt.canvas.id),/directory sync unavailable/);await assert.rejects(canvas.list('owner',conversation),/directory sync unavailable/);
 deny=false;assert.deepEqual(await canvas.create('owner',conversation,body),receipt);assert.equal((await canvas.list('owner',conversation)).canvases.length,1);
 const final=JSON.parse(await fs.readFile(path.join(dataDir,'conversation-'+conversation+'.json'),'utf8'));assert.equal(final.canvases.length,1);assert.equal(final.canvases[0].revision,1);assert.equal(final.canvasHistory.length,0);assert.equal(Object.keys(final.requests).filter(key=>key.startsWith('canvas:')).length,1);
});

test('actual canvas cancellation during temporary file sync cannot publish or acknowledge its receipt',async t=>{
 const {canvas,store,dataDir}=await fixture(t);const original=fs.open,controller=new AbortController();
 fs.open=async function(file,...args){const handle=await original.call(this,file,...args);if(path.resolve(String(file)).startsWith(dataDir+path.sep)&&String(file).endsWith('.tmp')&&args[0]==='wx')return {writeFile:(...values)=>handle.writeFile(...values),sync:async()=>{await handle.sync();controller.abort(new Error('Synthetic cancellation before rename'));},close:()=>handle.close()};return handle;};syncBuiltinESMExports();
 t.after(()=>{fs.open=original;syncBuiltinESMExports();});
 await assert.rejects(canvas.create('owner',conversation,{requestId:'cancel-sync',title:'No publication',source},{signal:controller.signal}),/Synthetic cancellation before rename/);
 assert.equal(store.get('owner',conversation),undefined);assert.deepEqual(await fs.readdir(dataDir),[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {startHarness} from './fixtures/harness-http.mjs';
const id='11111111-1111-4111-8111-111111111111';
const route='/conversations/'+id+'/canvases';
const source='export default function App(){return <h1>Synthetic HTTP canvas</h1>}';
test('real canvas HTTP API preserves owner, CSRF, revision and readable preview contracts',async t=>{
 const app=await startHarness();t.after(()=>app.close());const owner=await app.client(),stranger=await app.client();
 assert.equal(owner.status.capabilities.canvases,true);
 const body={requestId:'create',title:'Synthetic HTTP canvas',source};const created=await owner.request(route,{method:'POST',body});assert.equal(created.status,201);const canvas=created.value.canvas;
 assert.equal((await owner.request(route,{method:'POST',body})).value.canvas.id,canvas.id);
 assert.equal((await owner.request(route+'/'+canvas.id)).value.canvas.source,source);assert.equal((await stranger.request(route+'/'+canvas.id)).status,404);
 assert.equal((await owner.request(route,{method:'POST',body:{...body,requestId:'forbidden'},headers:{'x-harness-csrf':'wrong'}})).status,403);
 const updated=await owner.request(route+'/'+canvas.id,{method:'POST',body:{requestId:'edit',expectedRevision:1,title:'Edited',source}});assert.equal(updated.status,200);assert.equal(updated.value.canvas.revision,2);
 const stale=await owner.request(route+'/'+canvas.id,{method:'POST',body:{requestId:'stale',expectedRevision:1,title:'Stale',source}});assert.equal(stale.status,409);assert.equal(stale.value.error.accepted,false);
 const preview=await owner.request(route+'/'+canvas.id+'/preview?revision=2&theme=dark',{raw:true});assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/text\/html/);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.doesNotMatch(preview.headers.get('content-security-policy'),/allow-same-origin/);assert.match(await preview.text(),/Synthetic HTTP canvas/);
 assert.equal((await owner.request(route+'/'+canvas.id+'/preview?revision=1',{raw:true})).status,409);
 const broken=await owner.request(route,{method:'POST',body:{requestId:'broken',title:'Broken',source:'export default <main>'}});const error=await owner.request(route+'/'+broken.value.canvas.id+'/preview',{raw:true});assert.equal(error.status,422);assert.match(error.headers.get('content-type'),/text\/html/);assert.match(await error.text(),/Canvas TSX could not compile/);
 const snapshot=(await owner.request('/conversations/'+id)).value;assert.equal(snapshot.runs.length,0);assert.equal(snapshot.tools.length,0);
});


test('closing the response after a full request body aborts a queued canvas save before commit',async t=>{
 const app=await startHarness();t.after(()=>app.close());const owner=await app.client();
 let release,entered,observedAbort;
 const gate=new Promise(resolve=>{release=resolve;}),received=new Promise(resolve=>{entered=resolve;}),aborted=new Promise(resolve=>{observedAbort=resolve;});
 const original=app.handler.canvases.create.bind(app.handler.canvases);
 app.handler.canvases.create=(...args)=>{const signal=args[3].signal;signal.addEventListener('abort',()=>observedAbort(true),{once:true});entered();return original(...args);};
 app.handler.store.tail=gate;const controller=new AbortController();
 const sending=owner.request(route,{method:'POST',body:{requestId:'abort-after-body',title:'Cancelled',source},signal:controller.signal}).catch(error=>error);
 await received;controller.abort();let timer;const observed=await Promise.race([aborted,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);clearTimeout(timer);
 release();await app.handler.store.tail;await sending;
 assert.equal(observed,true,'response close must abort the pending mutation signal');assert.equal(app.handler.store.states.has(id),false);
});

test('definite invalid canvas drafts report nonacceptance and corrected input can create exactly one resource',async t=>{
 const app=await startHarness();t.after(()=>app.close());const owner=await app.client();
 for(const body of [{requestId:'invalid-title',title:'',source},{requestId:'invalid-source',title:'Correct title',source:''}]){
  const rejected=await owner.request(route,{method:'POST',body});assert.equal(rejected.status,422);assert.equal(rejected.value.error.accepted,false);
  assert.equal(app.handler.store.states.has(id),false);
 }
 const corrected=await owner.request(route,{method:'POST',body:{requestId:'corrected',title:'Correct title',source}});assert.equal(corrected.status,201);assert.equal(corrected.value.canvas.revision,1);
 const missing=await owner.request(route+'/22222222-2222-4222-8222-222222222222',{method:'POST',body:{requestId:'missing-resource',expectedRevision:1,title:'Missing',source}});assert.equal(missing.status,404);assert.equal(missing.value.error.accepted,false);
 const listed=await owner.request(route);assert.equal(listed.value.canvases.length,1);assert.equal(listed.value.canvases[0].id,corrected.value.canvas.id);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startHarness} from './fixtures/harness-http.mjs';

const content=`<title>Actual browser controls</title>
<input id="command" onkeydown="if(event.key==='Enter')document.querySelector('#entered').textContent='ENTER='+ ++window.enters">
<p id="entered">ENTER=0</p><script>window.enters=0</script>
<select id="choice" onchange="document.querySelector('#chosen').textContent='CHOICE='+this.value"><option value="one">One</option><option value="two">Two</option></select><p id="chosen">CHOICE=one</p>
<div id="scroll" style="height:120px;overflow:auto" onscroll="document.querySelector('#scrolled').textContent='SCROLL='+Math.round(this.scrollTop)"><div style="height:2400px">Real scroll target</div></div><p id="scrolled">SCROLL=0</p>`;

async function controls(t){
 const app=await startHarness();t.after(()=>app.close());
 const client=await app.client(),owner=client.cookie.split('=')[1],id='browser-actions-http';
 const connection=await app.handler.runtime.connect(owner,id);
 await app.handler.runtime.callTool(connection,'workspace_write',{path:'controls.html',content});
 const call=(action,args,requestId=randomUUID())=>client.request(`/conversations/${id}/browser`,{method:'POST',body:{requestId,action,arguments:args}});
 const opened=await call('browser_open',{url:`${app.baseUrl}/api/harness/conversations/${id}/preview/controls.html`});
 assert.equal(opened.status,200,JSON.stringify(opened.value));
 return {app,client,owner,id,call};
}

test('HTTP browser actions operate real input, select and scroll and replay one exact receipt',async t=>{
 const {app,client,id,call}=await controls(t),requestId=randomUUID();
 const pressed=await call('browser_press',{selector:'#command',key:'Enter'},requestId);
 assert.equal(pressed.status,200,JSON.stringify(pressed.value));
 const replay=await call('browser_press',{selector:'#command',key:'Enter'},requestId);
 assert.equal(replay.status,200);assert.deepEqual(replay.value,pressed.value);
 const conflict=await call('browser_press',{selector:'#command',key:'Tab'},requestId);
 assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await call('browser_select',{selector:'#choice',value:'two'})).status,200);
 assert.equal((await call('browser_scroll',{selector:'#scroll',direction:'down',pixels:500})).status,200);
 let snapshot;
 for(let attempt=0;attempt<10;attempt++){
  snapshot=await call('browser_snapshot',{});
  if(/SCROLL=[1-9]\d*/.test(snapshot.value.result.text))break;
 }
 assert.match(snapshot.value.result.text,/ENTER=1/);assert.doesNotMatch(snapshot.value.result.text,/ENTER=2/);
 assert.match(snapshot.value.result.text,/CHOICE=two/);assert.match(snapshot.value.result.text,/SCROLL=[1-9]\d*/);
 const frame=await client.request(`/conversations/${id}/browser/frames/${snapshot.value.result.captureId}`,{raw:true});
 assert.equal(frame.status,200);assert.deepEqual([...new Uint8Array(await frame.arrayBuffer()).subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const outsider=await app.client();const denied=await outsider.request(`/conversations/${id}/browser/frames/${snapshot.value.result.captureId}`,{raw:true});
 assert.ok([403,404].includes(denied.status));
});

test('malformed browser actions reject before connecting or consuming their request identity',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),id='browser-invalid-actions';
 for(const [action,args]of [
  ['browser_scroll',{direction:'down',pixels:'500'}],
  ['browser_scroll',{direction:'outside',pixels:500}],
  ['browser_scroll',{direction:'down',pixels:4001}],
  ['browser_press',{selector:'#command',key:'arbitrary script'}],
  ['browser_select',{selector:'#choice',value:'two',extra:true}],
 ]){
  const requestId=randomUUID(),response=await client.request(`/conversations/${id}/browser`,{method:'POST',body:{requestId,action,arguments:args}});
  assert.equal(response.status,422,JSON.stringify(response.value));
  assert.equal(response.value.error.code,'INVALID_TOOL_ARGUMENTS');
  assert.equal(app.handler.runtime.connections.has(id),false);
  assert.equal(app.handler.store.states.get(id)?.requests?.['browser:'+requestId],undefined);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createGrokToolHost} from '../harness/grok-tool-host.mjs';

async function setup(t){
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'grok-mcp-cancel-'));
 const marker=path.join(workspace,'calls.txt'),gate=path.join(workspace,'release');
 const host=await createGrokToolHost({workspace,customServers:[{id:'synthetic',command:process.execPath,args:[path.resolve('tests/fixtures/mcp-cancellation.mjs'),marker,gate]}]});
 t.after(async()=>{await host.close();await fs.rm(workspace,{recursive:true,force:true});});
 const tool=host.getDefinitions().find(row=>row.serverId==='synthetic');assert.ok(tool);
 const calls=()=>fs.readFile(marker,'utf8').then(text=>text.trim().split('\n'),()=>[]);
 const started=async()=>{
  for(let attempt=0;attempt<400;attempt++){
   if((await calls()).includes('first'))return;
   await delay(5);
  }
  assert.fail('Synthetic first MCP call did not start');
 };
 return {host,tool,calls,started,release:()=>fs.writeFile(gate,'release')};
}

test('queued MCP cancellation settles before its predecessor and retains serialization and discovery',async t=>{
 const fixture=await setup(t),{host,tool}=fixture;
 const first=host.call(tool.name,{id:'first',wait:true});
 await fixture.started();
 const controller=new AbortController(),reason=new Error('Synthetic queued cancellation');
 const second=host.call(tool.name,{id:'never-send',wait:false},{signal:controller.signal}).then(()=>({state:'fulfilled'}),error=>({state:'rejected',error}));
 const third=host.call(tool.name,{id:'third',wait:false});
 controller.abort(reason);
 const beforeRelease=await Promise.race([second,delay(250).then(()=>({state:'pending'}))]);
 const sentBeforeRelease=await fixture.calls();
 await fixture.release();
 const [firstResult,secondResult,thirdResult]=await Promise.all([first,second,third]);
 assert.equal(beforeRelease.state,'rejected');assert.equal(beforeRelease.error,reason);
 assert.equal(secondResult.error,reason);assert.deepEqual(sentBeforeRelease,['first']);
 assert.deepEqual(firstResult.content,[{type:'text',text:'first'}]);
 assert.deepEqual(thirdResult.content,[{type:'text',text:'third'}]);
 assert.deepEqual(await fixture.calls(),['first','third']);
 assert.equal(host.inventory().find(row=>row.id==='synthetic').state,'connected');
 assert.equal(host.getDefinitions().filter(row=>row.serverId==='synthetic').length,1);
});

test('aborting a running MCP call still closes the actual connection and removes its tools',async t=>{
 const fixture=await setup(t),{host,tool}=fixture,controller=new AbortController();
 const first=host.call(tool.name,{id:'first',wait:true},{signal:controller.signal});
 await fixture.started();controller.abort(new Error('Synthetic active cancellation'));
 await assert.rejects(first);
 // Stdio shutdown reports onclose after its process has actually exited.
 for(let attempt=0;attempt<400&&host.inventory().find(row=>row.id==='synthetic').state!=='disconnected';attempt++)await delay(10);
 assert.equal(host.inventory().find(row=>row.id==='synthetic').state,'disconnected');
 assert.equal(host.getDefinitions().some(row=>row.serverId==='synthetic'),false);
 await assert.rejects(host.call(tool.name,{id:'never-send',wait:false}),/closed/);
 assert.deepEqual(await fixture.calls(),['first']);
});

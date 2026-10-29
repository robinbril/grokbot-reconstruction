// Historical protocol adapter coverage, not current product-provider execution.
// Real HTTP/store/runtime lifecycle with the existing protocol CLI fixture.
// This suite does not establish installed-provider or external MCP execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),6000);})]);}finally{clearTimeout(timer);}}
const connect=(client,id)=>client.request('/conversations/'+id+'/connect',{method:'POST',body:{requestId:randomUUID()}});
const catalog=servers=>servers.map(({id,name,tools})=>({id,name,tools}));
const noConnected=servers=>servers.every(server=>server.state!=='connected');
async function fixture(t){const app=await startHarness(),cleanups=[];t.after(async()=>{try{for(const cleanup of cleanups.reverse())await cleanup();}finally{await app.close();}});const client=await app.client();return {app,client,runtime:app.handler.runtime,store:app.handler.store,cleanup:fn=>cleanups.push(fn)};}
async function killOwnedChild(connection){const child=connection.rpc.proc;if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');assert.equal(child.kill('SIGTERM'),true);await bounded(exited,'owned fixture child did not exit');}

test('dropping a connected child preserves its MCP catalog as disconnected and explicit reconnect rediscovers it',{timeout:15000},async t=>{
 const {client,runtime,store}=await fixture(t),id='lifecycle-drop';
 const first=await connect(client,id);assert.equal(first.status,200,JSON.stringify(first.value));
 const before=(await client.request('/conversations/'+id+'/tools')).value.servers;
 assert.ok(before.length);assert.ok(before.every(server=>server.state==='connected'));
 const sequence=first.value.lastSeq;
 await runtime.drop(id);
 const tools=await client.request('/conversations/'+id+'/tools'),snapshot=await client.request('/conversations/'+id);
 assert.equal(tools.status,200);assert.deepEqual(catalog(tools.value.servers),catalog(before));
 assert.ok(tools.value.servers.every(server=>server.state==='disconnected'),'dead child cannot remain connected in the tools API');
 assert.deepEqual(snapshot.value.servers,tools.value.servers);assert.ok(snapshot.value.lastSeq>sequence);
 const changed=store.states.get(id).events.filter(event=>event.seq>sequence&&event.type==='tools.changed');
 assert.equal(changed.length,1);assert.deepEqual(changed[0].data.servers,tools.value.servers);
 assert.equal(runtime.connections.has(id),false);assert.equal([...runtime.bridges.values()].some(c=>c.id===id),false);
 assert.notEqual((await client.request('/status')).value.runtime.state,'connected');
 const reconnected=await connect(client,id);assert.equal(reconnected.status,200,JSON.stringify(reconnected.value));
 assert.ok(reconnected.value.servers.every(server=>server.state==='connected'));assert.deepEqual(catalog(reconnected.value.servers),catalog(before));
 assert.equal(runtime.connections.get(id).rpc.closed,false);
});

test('starting from a persisted connected crash snapshot exposes disconnected inventory without a child or a model call and retains history',{timeout:15000},async t=>{
 const app=await startHarness();let restarted;t.after(async()=>{await restarted?.close();await app.close();await rm(app.dataDir,{recursive:true,force:true});});
 const client=await app.client(),id='lifecycle-restart';
 const run=await client.request('/conversations/'+id+'/runs',{method:'POST',body:{requestId:randomUUID(),text:'Lifecycle protocol fixture history'}});
 assert.equal(run.status,202,JSON.stringify(run.value));await collectUntil(client,run.value.runId,event=>event.type==='run.completed');
 const before=(await client.request('/conversations/'+id)).value,filename=path.join(app.dataDir,'conversation-'+id+'.json'),crashBytes=await readFile(filename);
 assert.ok(before.servers.some(server=>server.state==='connected'));
 const auth={cookie:client.cookie,csrf:client.csrf};await app.close({keepData:true});
 await writeFile(filename,crashBytes); // Restore the exact pre-shutdown on-disk crash state.
 restarted=await startHarness({dataDir:app.dataDir,codexBinary:path.join(app.dataDir,'nonexistent-provider-must-not-be-started')});
 const restoredClient=await restarted.client(auth),after=(await restoredClient.request('/conversations/'+id)).value,tools=await restoredClient.request('/conversations/'+id+'/tools');
 assert.equal(tools.status,200);assert.deepEqual(catalog(tools.value.servers),catalog(before.servers));
 assert.ok(tools.value.servers.every(server=>server.state==='disconnected'),'startup invalidates persisted connected state before serving reads');
 assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.runs,before.runs);assert.equal(after.threadId,before.threadId);assert.equal(after.workspaceRoot,before.workspaceRoot);
 assert.ok(after.lastSeq>before.lastSeq);const changed=restarted.handler.store.states.get(id).events.at(-1);assert.equal(changed.type,'tools.changed');assert.deepEqual(changed.data.servers,tools.value.servers);
 assert.equal(restarted.handler.runtime.connections.size,0);assert.equal(restarted.handler.runtime.connecting.size,0);assert.equal(restarted.handler.runtime.bridges.size,0);
 assert.equal(restoredClient.status.runtime.state,'unavailable','nonexistent provider binary makes model dispatch impossible during restoration');
});

test('unexpected owned child exit aborts active tool work, closes owned tools, removes the bridge and disconnects metadata',{timeout:15000},async t=>{
 const {client,runtime,store,cleanup}=await fixture(t),id='lifecycle-exit';assert.equal((await connect(client,id)).status,200);
 const connection=runtime.connections.get(id),toolEntered=deferred(),disconnectFinished=deferred();let toolSignal,closed=0;
 const close=connection.tools.close.bind(connection.tools),disconnected=runtime.disconnected.bind(runtime);
 connection.tools.close=async()=>{closed++;return close();};
 runtime.disconnected=async c=>{try{return await disconnected(c);}finally{if(c===connection)disconnectFinished.resolve();}};
 connection.tools.callTool=async(_name,_arguments,{signal})=>{toolSignal=signal;toolEntered.resolve();return new Promise((_,reject)=>{const abort=()=>reject(new Error('Owned tool aborted by child teardown'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});};
 const work=runtime.callTool(connection,'workspace_list',{}).then(()=>({completed:true}),error=>({error}));
 cleanup(async()=>{for(const controller of connection.toolControllers.keys())controller.abort();await work;await close();});
 await bounded(toolEntered.promise,'owned tool did not enter');assert.equal(connection.toolControllers.size,1);
 await killOwnedChild(connection);await bounded(disconnectFinished.promise,'unexpected exit did not complete its disconnection transition');await store.tail;
 assert.equal(toolSignal.aborted,true,'child teardown aborts actual runtime tool controller');
 assert.equal(closed,1,'owned workspace tools close exactly once');assert.ok((await work).error);assert.equal(connection.toolControllers.size,0);
 assert.equal(runtime.connections.has(id),false);assert.equal(runtime.bridges.has(connection.handle),false);
 const tools=await client.request('/conversations/'+id+'/tools');assert.ok(tools.value.servers.length);assert.ok(noConnected(tools.value.servers));
 assert.notEqual((await client.request('/status')).value.runtime.state,'connected');
});

test('same-ID reconnect waits for in-flight drop cleanup before initializing a replacement child',{timeout:15000},async t=>{
 const {client,runtime,cleanup}=await fixture(t),id='lifecycle-drop-race';assert.equal((await connect(client,id)).status,200);
 const old=runtime.connections.get(id),closeEntered=deferred(),releaseClose=deferred(),connectEntered=deferred();
 const close=old.tools.close.bind(old.tools),originalConnect=runtime.connect.bind(runtime),initialize=runtime.initialize.bind(runtime);let initialized=false;
 old.tools.close=async()=>{closeEntered.resolve();await releaseClose.promise;return close();};
 const dropping=runtime.drop(id);let reconnecting;
 cleanup(async()=>{releaseClose.resolve();await dropping;await reconnecting;});
 await bounded(closeEntered.promise,'drop did not reach owned tools cleanup');
 runtime.initialize=(...args)=>{if(args[1]===id)initialized=true;return initialize(...args);};
 runtime.connect=(...args)=>{if(args[1]===id)connectEntered.resolve();return originalConnect(...args);};
 reconnecting=connect(client,id);await bounded(connectEntered.promise,'HTTP reconnect did not reach runtime');
 await new Promise(setImmediate);
 const initializedBeforeRelease=initialized;releaseClose.resolve();await dropping;
 const result=await bounded(reconnecting,'reconnect did not finish after cleanup was released');
 assert.equal(initializedBeforeRelease,false,'same-ID initialization must wait for the old cleanup lease');
 assert.equal(result.status,200,JSON.stringify(result.value));const replacement=runtime.connections.get(id);assert.notEqual(replacement,old);assert.equal(replacement.rpc.closed,false);
 assert.equal(runtime.bridges.has(old.handle),false);assert.equal(runtime.bridges.has(replacement.handle),true);
 const tools=(await client.request('/conversations/'+id+'/tools')).value.servers;assert.ok(tools.length);assert.ok(tools.every(server=>server.state==='connected'),'old cleanup must not overwrite new discovery');
});

test('a child exiting while connected inventory is being persisted cannot publish a dead connected child',{timeout:15000},async t=>{
 const {client,runtime,store,cleanup}=await fixture(t),id='lifecycle-publication-race',publicationEntered=deferred(),releasePublication=deferred();
 const write=store.write.bind(store);let held=false,connection;
 store.write=async state=>{if(!held&&state.conversationId===id&&state.servers.some(server=>server.state==='connected')){held=true;connection=[...runtime.bridges.values()].find(c=>c.id===id);publicationEntered.resolve();await releasePublication.promise;}return write(state);};
 const connecting=connect(client,id);
 cleanup(async()=>{releasePublication.resolve();await connecting;if(connection)await connection.tools.close();});
 await bounded(publicationEntered.promise,'connect did not reach inventory publication');assert.ok(connection);assert.equal(runtime.connections.has(id),false);
 await killOwnedChild(connection);assert.equal(connection.rpc.closed,true);releasePublication.resolve();
 const result=await bounded(connecting,'connect did not settle after its child exited');await store.tail;
 assert.ok(result.status>=400,'connect must fail when the discovered child dies before publication completes');
 assert.equal(runtime.connections.has(id),false);assert.equal(runtime.bridges.has(connection.handle),false);
 const tools=(await client.request('/conversations/'+id+'/tools')).value.servers;assert.ok(tools.length);assert.ok(noConnected(tools));
 assert.ok(noConnected((await client.request('/conversations/'+id)).value.servers));assert.notEqual((await client.request('/status')).value.runtime.state,'connected');
});

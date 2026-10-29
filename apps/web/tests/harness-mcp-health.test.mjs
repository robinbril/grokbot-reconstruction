// Historical protocol adapter coverage, not current product-provider execution.
// Production HTTP/store/runtime with a controlled native-protocol fixture.
// These tests do not establish installed-provider or external MCP execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';

const binary=fileURLToPath(new URL('./fixtures/harness-health-codex-fixture.mjs',import.meta.url));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function deadline(promise,message,milliseconds=6000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}finally{clearTimeout(timer);}}
const post=(client,route,body={})=>client.request(route,{method:'POST',body:{requestId:randomUUID(),...body}});
const connect=(client,id)=>post(client,'/conversations/'+id+'/connect');
const native=(connection,method,params={})=>connection.rpc.request('test/health/'+method,params,6000);
const find=(servers,id='grok_workspace')=>servers.find(server=>server.id===id);
const history=state=>({entries:state.entries,runs:state.runs,threadId:state.threadId,workspaceRoot:state.workspaceRoot,terminalSessions:state.terminalSessions,tools:state.tools,browserSessions:state.browserSessions});
async function setup(t,id,{custom=false}={}){
 const app=await startHarness({codexBinary:binary}),cleanups=[];
 t.after(async()=>{try{for(const cleanup of cleanups.reverse())await cleanup();}finally{await app.close();}});
 const client=await app.client();let connected;
 if(custom)connected=await post(client,'/conversations/'+id+'/mcp-servers',{server:{id:'health',name:'Health fixture custom MCP',command:process.execPath,args:[fileURLToPath(new URL('./fixtures/harness-math-mcp.mjs',import.meta.url))]}});
 else connected=await connect(client,id);
 assert.equal(connected.status,200,JSON.stringify(connected.value));
 return {app,client,id,runtime:app.handler.runtime,store:app.handler.store,connection:app.handler.runtime.connections.get(id),cleanup:fn=>cleanups.push(fn)};
}
async function preserveHistory(context){
 const {client,id}=context,result=await post(client,'/conversations/'+id+'/runs',{text:'F76 protocol fixture history'});assert.equal(result.status,202,JSON.stringify(result.value));
 await collectUntil(client,result.value.runId,event=>event.type==='run.completed');
 return structuredClone(context.store.states.get(id));
}

test('GET tools refreshes native failure and unready statuses over cached schemas, persisting only actual inventory changes',{timeout:15000},async t=>{
 const {client,id,store,connection}=await setup(t,'health-status');
 const before=structuredClone(store.states.get(id)),catalog=before.servers[0].tools;
 for(const runtimeStatus of ['failed','starting','notStarted','authenticationRequired','cancelled','disabled',null]){
  await native(connection,'set',{statuses:{grok_workspace:runtimeStatus}});
  const result=await client.request('/conversations/'+id+'/tools');assert.equal(result.status,200);
  const server=find(result.value.servers);assert.ok(server);assert.notEqual(server.state,'connected','native '+runtimeStatus+' must override its cached nonempty tool catalog');
  if(runtimeStatus==='failed')assert.equal(server.state,'failed');
  assert.deepEqual(server.tools,catalog,'failed discovery retains the historical schema as a catalog');
 }
 await native(connection,'set',{statuses:{grok_workspace:'connected'}});
 const recovered=await client.request('/conversations/'+id+'/tools');assert.equal(find(recovered.value.servers).state,'connected');
 const stable=structuredClone(store.states.get(id));await client.request('/conversations/'+id+'/tools');
 assert.equal(store.states.get(id).lastSeq,stable.lastSeq,'unchanged discovery does not manufacture tools.changed events');
 const changes=store.states.get(id).events.filter(event=>event.seq>before.lastSeq);assert.ok(changes.length);assert.ok(changes.every(event=>event.type==='tools.changed'));
 for(let index=1;index<changes.length;index++)assert.ok(changes[index].seq>changes[index-1].seq);
 const stats=await native(connection,'stats');assert.ok(stats.inventoryRequests.length>=10,'each normal tools read performs native discovery');
 assert.equal(stats.methods.filter(method=>method==='turn/start').length,0);
});

test('GET conversation refreshes the existing child and preserves thread/history, while disconnected reads never create a child',{timeout:15000},async t=>{
 const context=await setup(t,'health-snapshot'),{client,id,runtime,store,connection}=context;
 const before=await preserveHistory(context),statsBefore=await native(connection,'stats');
 await native(connection,'set',{statuses:{grok_workspace:'failed'}});
 const snapshot=await client.request('/conversations/'+id);assert.equal(snapshot.status,200);
 assert.equal(find(snapshot.value.servers).state,'failed','normal conversation read must observe the current native failure');
 assert.deepEqual(history(snapshot.value),history(before));assert.equal(runtime.connections.get(id),connection);assert.equal(connection.rpc.closed,false);
 const statsAfter=await native(connection,'stats');assert.ok(statsAfter.inventoryRequests.length>statsBefore.inventoryRequests.length);assert.equal(statsAfter.methods.filter(method=>method==='turn/start').length,1);
 await runtime.drop(id);let initializations=0;const initialize=runtime.initialize.bind(runtime);runtime.initialize=(...args)=>{initializations++;return initialize(...args);};
 const disconnectedBefore=structuredClone(store.states.get(id));
 for(const route of ['/conversations/'+id,'/conversations/'+id+'/tools']){const result=await client.request(route);assert.equal(result.status,200);assert.ok(result.value.servers.every(server=>server.state!=='connected'));}
 assert.equal(initializations,0);assert.equal(runtime.connections.size,0);assert.equal(runtime.bridges.size,0);assert.equal(store.states.get(id).lastSeq,disconnectedBefore.lastSeq);
 assert.deepEqual(history(store.states.get(id)),history(disconnectedBefore));
});

for(const mode of ['error','hang'])test('native inventory '+mode+' is bounded and cannot leave a cached connected claim',{timeout:15000},async t=>{
 const {client,id,connection,store,runtime}=await setup(t,'health-'+mode,{custom:true}),before=structuredClone(store.states.get(id)),count=(await native(connection,'stats')).inventoryRequests.length;
 await native(connection,'set',{mode});const started=performance.now();
 const result=await deadline(client.request('/conversations/'+id+'/tools'),'native discovery failure was not bounded',4500);
 assert.equal(result.status,200);assert.ok(performance.now()-started<4500);
 assert.ok(result.value.servers.every(server=>server.state!=='connected'),'native '+mode+' must invalidate cached connectivity');
 assert.ok(result.value.servers.every(server=>typeof server.reason==='string'&&server.reason.length>0));
 assert.deepEqual(result.value.servers.map(server=>server.tools),before.servers.map(server=>server.tools));
 assert.equal(runtime.connections.get(id),connection,'inventory health failure does not silently restart the app-server');
 assert.deepEqual(history(store.states.get(id)),history(before));
 const stats=await native(connection,'stats');assert.ok(stats.inventoryRequests.length>count);
 await native(connection,'release');
});

test('concurrent normal reads share one held native discovery and one durable inventory change',{timeout:15000},async t=>{
 const {app,client,id,connection,store,cleanup}=await setup(t,'health-coalesce'),before=structuredClone(store.states.get(id));
 const count=(await native(connection,'set',{hold:true,statuses:{grok_workspace:'failed'}})).inventoryRequests.length;
 cleanup(()=>native(connection,'release').catch(()=>{}));
 const first=client.request('/conversations/'+id+'/tools'),entered=native(connection,'wait',{after:count});
 const winner=await deadline(Promise.race([first.then(()=> 'http-finished'),entered.then(()=> 'native-started')]),'held native discovery was not started');
 assert.equal(winner,'native-started','tools API must perform native discovery before responding');
 const secondEntered=deferred(),handle=app.handler.handle;
 app.handler.handle=(request,response)=>{if(request.method==='GET'&&request.url==='/api/harness/conversations/'+id)secondEntered.resolve();return handle(request,response);};
 cleanup(()=>{app.handler.handle=handle;});
 const second=client.request('/conversations/'+id);await deadline(secondEntered.promise,'second HTTP read did not enter the real handler');await new Promise(setImmediate);
 assert.equal((await native(connection,'stats')).inventoryRequests.length,count+1);
 await native(connection,'release');const responses=await Promise.all([first,second]);
 assert.ok(responses.every(result=>result.status===200&&find(result.value.servers).state==='failed'));
 assert.equal((await native(connection,'stats')).inventoryRequests.length,count+1,'both completed reads must have shared exactly one native discovery');
 assert.equal(store.states.get(id).events.filter(event=>event.seq>before.lastSeq&&event.type==='tools.changed').length,1);
});

test('a stale native refresh response cannot publish over a dropped and replaced connection',{timeout:15000},async t=>{
 const {client,id,runtime,store,connection,cleanup}=await setup(t,'health-stale'),entered=deferred(),release=deferred();
 await native(connection,'set',{statuses:{grok_workspace:'failed'}});
 const request=connection.rpc.request.bind(connection.rpc);
 connection.rpc.request=async(method,...args)=>{const result=await request(method,...args);if(method==='mcpServerStatus/list'){entered.resolve();await release.promise;}return result;};
 let refreshing;cleanup(async()=>{release.resolve();await refreshing;});
 refreshing=client.request('/conversations/'+id+'/tools');
 const winner=await deadline(Promise.race([refreshing.then(()=> 'http-finished'),entered.promise.then(()=> 'native-returned')]),'native response barrier was not reached');
 assert.equal(winner,'native-returned','normal read must wait for its actual native response');
 await deadline(runtime.drop(id),'drop did not close the old owned connection');
 const replacement=await connect(client,id);assert.equal(replacement.status,200,JSON.stringify(replacement.value));const current=runtime.connections.get(id);assert.notEqual(current,connection);
 const published=store.states.get(id).lastSeq;release.resolve();await refreshing;await store.tail;
 assert.equal(runtime.connections.get(id),current);assert.equal(find(store.states.get(id).servers).state,'connected');
 assert.equal(store.states.get(id).lastSeq,published,'late old discovery has no authority to publish into the replacement');
 assert.equal(find((await client.request('/conversations/'+id+'/tools')).value.servers).state,'connected');
});

test('explicit connect freshly discovers failure and recovery without cancelling active run or terminal work',{timeout:15000},async t=>{
 const {client,id,runtime,store,connection}=await setup(t,'health-explicit',{custom:true});
 const run=await post(client,'/conversations/'+id+'/runs',{text:'FIXTURE_DEFER'});assert.equal(run.status,202);await collectUntil(client,run.value.runId,event=>event.type==='run.started');
 const terminal=await post(client,'/conversations/'+id+'/terminal',{command:process.execPath+" -e 'setInterval(()=>{},1000)'"});assert.equal(terminal.status,202);
 const before=structuredClone(store.states.get(id)),statsBefore=await native(connection,'stats');
 await native(connection,'set',{statuses:{custom_health:'failed'}});
 const failed=await connect(client,id);assert.equal(failed.status,200,JSON.stringify(failed.value));assert.equal(find(failed.value.servers,'custom_health').state,'failed','explicit connect cannot reuse its cached connected claim');
 assert.equal(runtime.connections.get(id),connection);assert.equal(connection.rpc.closed,false);assert.deepEqual(history(store.states.get(id)),history(before));
 await native(connection,'set',{statuses:{custom_health:'connected'}});
 const recovered=await connect(client,id);assert.equal(recovered.status,200);assert.equal(find(recovered.value.servers,'custom_health').state,'connected');
 assert.equal(runtime.connections.get(id),connection);assert.deepEqual(history(store.states.get(id)),history(before));
 const stats=await native(connection,'stats');assert.ok(stats.inventoryRequests.length>=statsBefore.inventoryRequests.length+2);
 assert.equal(stats.methods.filter(method=>method==='turn/start').length,1);assert.equal(stats.methods.filter(method=>method==='turn/interrupt'||method==='command/exec/terminate').length,0);
});

test('paginated native inventory includes later failed servers and preserves their actual input schemas',{timeout:15000},async t=>{
 const {client,id,connection,store}=await setup(t,'health-pages',{custom:true}),before=structuredClone(store.states.get(id));
 const cached=find(before.servers,'custom_health').tools;
 const count=(await native(connection,'set',{pages:true,statuses:{custom_health:'failed'}})).inventoryRequests.length;
 const result=await client.request('/conversations/'+id+'/tools');assert.equal(result.status,200);assert.equal(find(result.value.servers).state,'connected');
 const custom=find(result.value.servers,'custom_health');assert.ok(custom,'later pages cannot disappear from the canonical catalog');assert.equal(custom.state,'failed');assert.deepEqual(custom.tools,cached);
 assert.deepEqual(custom.tools[0].inputSchema,{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false});
 const requests=(await native(connection,'stats')).inventoryRequests.slice(count);assert.ok(requests.some(request=>request.cursor==='health-page-1'),'all discovery pages must be read');
 assert.ok(requests.every(request=>request.threadId===connection.threadId&&['grok_workspace','custom_health'].includes(request.serverName)),'discovery must reuse only the explicitly owned thread/server connections');
 const changes=store.states.get(id).events.filter(event=>event.seq>before.lastSeq&&event.type==='tools.changed');assert.equal(changes.length,1);assert.equal(find(changes[0].data.servers,'custom_health').state,'failed');
});

test('native toolsError invalidates connected custom-server status while preserving its catalog and healthy workspace',{timeout:15000},async t=>{
 const context=await setup(t,'health-tools-error',{custom:true}),{client,id,connection,store,runtime}=context;
 const before=await preserveHistory(context),cached=find(before.servers,'custom_health').tools,message='Controlled native custom tool discovery failure';
 await native(connection,'set',{statuses:{custom_health:'connected'},errors:{custom_health:message}});
 const result=await client.request('/conversations/'+id+'/tools');assert.equal(result.status,200);
 const custom=find(result.value.servers,'custom_health');assert.equal(custom.state,'failed','a native tool discovery error must override connected runtimeStatus');
 assert.ok(custom.reason.includes(message));assert.deepEqual(custom.tools,cached);assert.equal(find(result.value.servers).state,'connected');
 assert.equal(runtime.connections.get(id),connection);assert.equal(connection.rpc.closed,false);assert.deepEqual(history(store.states.get(id)),history(before));
 const stats=await native(connection,'stats');assert.equal(stats.methods.filter(method=>method==='turn/start').length,1);assert.equal(stats.methods.filter(method=>method==='turn/interrupt'||method==='command/exec/terminate').length,0);
});

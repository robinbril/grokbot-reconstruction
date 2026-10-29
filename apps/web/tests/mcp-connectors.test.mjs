// Historical protocol adapter coverage, not current product-provider execution.
// Real HTTP/store/runtime; controlled native protocol, no provider/model execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startLegacyHarness as startHarness,collectUntil} from './fixtures/legacy-runtime.mjs';
const binary=fileURLToPath(new URL('./fixtures/mcp-connectors-codex-fixture.mjs',import.meta.url));
const server={id:'context7',name:'Context7',url:'https://mcp.context7.com/mcp'};
const post=(client,route,payload={},requestId=randomUUID())=>client.request(route,{method:'POST',body:{requestId,...payload}});
const base='/conversations/connectors';
async function setup(t){const app=await startHarness({codexBinary:binary});t.after(()=>app.close());return {app,client:await app.client()};}
test('HTTP connector is durable and native disabled tool/server configuration is canonical',async t=>{
 const {app,client}=await setup(t),added=await post(client,base+'/mcp-servers',{server});assert.equal(added.status,200,JSON.stringify(added));
 const row=added.value.servers.find(s=>s.id==='custom_context7');assert.deepEqual(row.configuration,{transport:'http',url:server.url,enabled:true,disabledTools:[]});assert.equal(row.state,'connected');
 const disabled=await post(client,base+'/mcp-servers/custom_context7/permissions',{disabledTools:['query-docs']});assert.equal(disabled.status,200,JSON.stringify(disabled));
 const config=(await app.handler.runtime.connections.get('connectors').rpc.request('config/read',{})).config.mcp_servers.custom_context7;
 assert.deepEqual(config.disabled_tools,['query-docs']);assert.equal(config.url,server.url);
 assert.deepEqual(disabled.value.servers.find(s=>s.id==='custom_context7').tools.map(t=>t.name),['resolve-library-id']);
 const off=await post(client,base+'/mcp-servers/custom_context7/state',{enabled:false});assert.equal(off.status,200,JSON.stringify(off));assert.equal(off.value.servers.find(s=>s.id==='custom_context7').state,'disabled');
 assert.equal((await app.handler.runtime.connections.get('connectors').rpc.request('config/read',{})).config.mcp_servers.custom_context7.enabled,false);
 const on=await post(client,base+'/mcp-servers/custom_context7/state',{enabled:true});assert.equal(on.status,200);assert.deepEqual(on.value.servers.find(s=>s.id==='custom_context7').configuration.disabledTools,['query-docs']);
});
test('connector request receipts distinguish payload and survive reconnect failure',async t=>{
 const {app,client}=await setup(t),requestId=randomUUID();assert.equal((await post(client,base+'/mcp-servers',{server},requestId)).status,200);
 assert.equal((await post(client,base+'/mcp-servers',{server},requestId)).status,200);
 assert.equal((await post(client,base+'/mcp-servers',{server:{...server,name:'Different'}},requestId)).status,409);
 const policyId=randomUUID();const connect=app.handler.runtime.connect.bind(app.handler.runtime);app.handler.runtime.connect=async()=>{throw Object.assign(Error('controlled failure'),{code:'TEST_FAILURE',status:503});};
 const beforeSeq=app.handler.store.states.get('connectors').lastSeq;
 assert.equal((await post(client,base+'/mcp-servers/custom_context7/permissions',{disabledTools:['query-docs']},policyId)).status,503);
 const configured=app.handler.store.states.get('connectors');assert.ok(configured.lastSeq>beforeSeq);assert.deepEqual(configured.events.at(-1).data.servers.find(s=>s.id==='custom_context7').configuration.disabledTools,['query-docs']);
 app.handler.runtime.connect=connect;
 const retry=await post(client,base+'/mcp-servers/custom_context7/permissions',{disabledTools:['query-docs']},policyId);assert.equal(retry.status,200,JSON.stringify(retry));assert.deepEqual(retry.value.servers.find(s=>s.id==='custom_context7').configuration.disabledTools,['query-docs']);
 assert.equal((await post(client,base+'/mcp-servers/custom_context7/state',{enabled:false},policyId)).status,409);
});
test('owner boundaries, invalid URLs, unknown tools and busy/history locks fail closed',async t=>{
 const {app,client}=await setup(t);assert.equal((await post(client,base+'/mcp-servers',{server})).status,200);
 const other=await app.client();assert.equal((await post(other,base+'/mcp-servers/custom_context7/state',{enabled:false})).status,404);
 for(const url of ['http://example.com/mcp','https://user:pass@example.com/mcp','https://example.com/mcp?token=secret','https://example.com/mcp#auth','file:///tmp/mcp'])assert.equal((await post(client,'/conversations/invalid/mcp-servers',{server:{...server,url}})).status,400,url);
 assert.equal((await post(client,base+'/mcp-servers/custom_context7/permissions',{disabledTools:['unknown']})).status,400);
 const c=app.handler.runtime.connections.get('connectors'),controller=new AbortController();c.toolControllers.set(controller,null);
 assert.equal((await post(client,base+'/mcp-servers/custom_context7/state',{enabled:false})).status,409);assert.equal(c.rpc.closed,false);c.toolControllers.delete(controller);
 const run=await post(client,base+'/runs',{text:'protocol fixture history'});await collectUntil(client,run.value.runId,e=>e.type==='run.completed');
 const before=structuredClone(app.handler.store.states.get('connectors').runs);
 const locked=await post(client,base+'/mcp-servers/custom_context7/state',{enabled:false});assert.equal(locked.status,409);assert.equal(locked.value.error.code,'MCP_CONFIG_LOCKED');assert.deepEqual(app.handler.store.states.get('connectors').runs,before);
});
test('configuration change denies a new direct tool before stopping the idle child',async t=>{
 const {app,client}=await setup(t);assert.equal((await post(client,base+'/mcp-servers',{server})).status,200);
 const runtime=app.handler.runtime,connection=runtime.connections.get('connectors'),drop=runtime.drop.bind(runtime);let denied=false;
 runtime.drop=async(...args)=>{if(args[0]==='connectors'){await assert.rejects(runtime.callTool(connection,'workspace_list',{}),{code:'MCP_CONFIG_BUSY'});denied=true;}return drop(...args);};
 const changed=await post(client,base+'/mcp-servers/custom_context7/state',{enabled:false});runtime.drop=drop;
 assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(denied,true);
});
test('89-character connector IDs remain controllable and 90-character IDs are rejected',async t=>{
 const {client}=await setup(t),id='a'.repeat(89);
 assert.equal((await post(client,base+'/mcp-servers',{server:{...server,id:'a'.repeat(90)}})).status,400);
 const added=await post(client,base+'/mcp-servers',{server:{...server,id}});assert.equal(added.status,200,JSON.stringify(added));
 const changed=await post(client,base+'/mcp-servers/custom_'+id+'/state',{enabled:false});assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(changed.value.servers.find(s=>s.id==='custom_'+id).state,'disabled');
});
test('custom inherited name collisions fail before an owned bridge or child starts',async t=>{
 const {app,client}=await setup(t),added=await post(client,base+'/mcp-servers',{server:{...server,id:'inherited_collision'}});
 assert.equal(added.status,503,JSON.stringify(added));assert.equal(added.value.error.code,'MCP_CONFIG_COLLISION');
 assert.equal(app.handler.runtime.connections.size,0);assert.equal(app.handler.runtime.bridges.size,0);
 assert.equal(app.handler.store.states.get('connectors')?.customServers.some(s=>s.id==='inherited_collision')??false,false,'rejected registration must not poison durable configuration');
 const recovered=await post(client,base+'/mcp-servers',{server});assert.equal(recovered.status,200,JSON.stringify(recovered));assert.equal(recovered.value.servers.find(s=>s.id==='custom_context7').state,'connected');
});
test('verified native ready with all discovered tools disabled remains connected',async t=>{
 const {client}=await setup(t);assert.equal((await post(client,base+'/mcp-servers',{server})).status,200);
 const changed=await post(client,base+'/mcp-servers/custom_context7/permissions',{disabledTools:['query-docs','resolve-library-id']});
 assert.equal(changed.status,200,JSON.stringify(changed));const row=changed.value.servers.find(s=>s.id==='custom_context7');assert.equal(row.state,'connected');assert.deepEqual(row.tools,[]);
});

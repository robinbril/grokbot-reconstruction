import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {HarnessStore,harnessError} from '../harness/store.mjs';
import {HarnessRuntime} from '../harness/runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const binding={accountId:'sample-account',accountOwner:'never-in-native-config',name:'Demo account',resourceUrl:'https://example.com/mcp',disabledTools:['query-docs']};
async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'runtime-accounts-')),store=await new HarnessStore({dataDir}).init();
 const fixture=await readFile(new URL('./fixtures/mcp-connectors-codex-fixture.mjs',import.meta.url),'utf8'),binary=path.join(dataDir,'account-config-fixture.mjs');
 await writeFile(binary,fixture.replace('enabled|url|command|args|disabled_tools','enabled|url|command|args|disabled_tools|bearer_token_env_var'));await chmod(binary,0o700);
 const runtime=new HarnessRuntime({root,store,baseUrl:'http://127.0.0.1:18799',codexBinary:binary});t.after(()=>runtime.close());
 let authorized=true,bindings=[binding];runtime.resolveAccounts=async(owner,state)=>{if(!authorized||state.botId!=='bot-1')throw harnessError('ACCESS_DENIED','Access revoked',403);return bindings;};
 return {runtime,store,revoke:()=>authorized=false,bindings:value=>bindings=value};
}
test('bound account native configuration uses only an owned authenticated proxy, never provider credentials',async t=>{
 const {runtime,store}=await setup(t);assert.equal(typeof runtime.bindConversationBot,'function');
 const result=await runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'});assert.equal(result.botId,'bot-1');
 const c=runtime.connections.get('chat');assert.deepEqual(c.accountIds,['sample-account']);assert.ok(c.accountServers[0].id.startsWith('account_'));
 const actual=(await c.rpc.request('config/read',{})).config.mcp_servers[c.accountServers[0].id];
 assert.equal(actual.url,`http://127.0.0.1:18799/api/harness/internal/${c.handle}/accounts/sample-account/mcp`);assert.equal(actual.bearer_token_env_var,'HARNESS_MCP_TOKEN');assert.deepEqual(actual.disabled_tools,['query-docs']);
 assert.ok(!JSON.stringify({actual,servers:store.snapshot(store.get('owner','chat')).servers}).includes(binding.accountOwner));
 assert.equal(result.servers.find(s=>s.id===c.accountServers[0].id).state,'connected');
});
test('account revocation denies existing connections and direct tool, terminal and model entrypoints',async t=>{
 const {runtime,revoke}=await setup(t);assert.equal(typeof runtime.bindConversationBot,'function');await runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'});const c=runtime.connections.get('chat');revoke();
 for(const action of [()=>runtime.connect('owner','chat'),()=>runtime.callTool(c,'workspace_list',{}),()=>runtime.terminal('owner','chat','printf must-not-run',randomUUID()),()=>runtime.start('owner','chat',{requestId:randomUUID(),text:'must not submit'})])await assert.rejects(action(),{code:'ACCESS_DENIED'});
 assert.equal(runtime.store.get('owner','chat').runs.length,0);assert.equal(runtime.store.get('owner','chat').terminalSessions.length,0);
});
test('binding is serialized, request bound and blocked after historical or active work',async t=>{
 const {runtime,store}=await setup(t);assert.equal(typeof runtime.bindConversationBot,'function');const input={requestId:randomUUID(),botId:'bot-1'};await runtime.bindConversationBot('owner','chat',input);
 await assert.rejects(runtime.bindConversationBot('owner','chat',{...input,botId:'foreign'}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(runtime.bindConversationBot('foreign','chat',{requestId:randomUUID(),botId:'bot-1'}),{code:'NOT_FOUND'});
 const c=runtime.connections.get('chat'),controller=new AbortController();c.toolControllers.set(controller,null);await assert.rejects(runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'}),{code:'MCP_CONFIG_BUSY'});c.toolControllers.delete(controller);
 await store.transaction('owner','chat',s=>s.runs.push({id:'historic',status:'completed',approvals:[]}));await assert.rejects(runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'}),{code:'MCP_CONFIG_LOCKED'});
});
test('scope revalidation drops unauthorized active children and configuration changes force rediscovery',async t=>{
 const {runtime,revoke,bindings}=await setup(t);assert.equal(typeof runtime.bindConversationBot,'function');await runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'});const old=runtime.connections.get('chat');
 bindings([{...binding,disabledTools:[]}]);const changed=await runtime.revalidateBoundConnections();assert.equal(changed.dropped,1);assert.ok(old.rpc.closed);assert.equal(runtime.connections.size,0);
 await runtime.connect('owner','chat');revoke();const revoked=await runtime.revalidateBoundConnections();assert.equal(revoked.dropped,1);assert.equal(runtime.bridges.size,0);
});
test('revocation between acceptance and dispatch prevents model submission and interrupts accepted work',async t=>{
 const {runtime,store,revoke}=await setup(t);await runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'});const c=runtime.connections.get('chat');
 let submitted=0;const rpcRequest=c.rpc.request.bind(c.rpc);c.rpc.request=(method,...args)=>{if(method==='turn/start')submitted++;return rpcRequest(method,...args);};
 await store.transaction('owner','chat',s=>{s.entries.push({id:'output',role:'assistant',text:'',status:'accepted'});s.runs.push({id:'accepted',status:'accepted',outputEntryId:'output',tools:[],approvals:[]});});
 revoke();await runtime.dispatch(c,store.get('owner','chat').runs[0],{text:'Do not execute after revoke'});
 assert.equal(submitted,0);assert.equal(store.get('owner','chat').runs[0].status,'interrupted');assert.equal(runtime.connections.size,0);
});
test('native account authentication configuration must be read back before connection succeeds',async t=>{
 const {runtime,store}=await setup(t);const unverified=await readFile(new URL('./fixtures/mcp-connectors-codex-fixture.mjs',import.meta.url),'utf8'),binary=path.join(store.dataDir,'omitted-auth-fixture.mjs');await writeFile(binary,unverified);await chmod(binary,0o700);runtime.codexBinary=binary;
 await assert.rejects(runtime.bindConversationBot('owner','chat',{requestId:randomUUID(),botId:'bot-1'}),{code:'MCP_POLICY_UNVERIFIED'});
 assert.equal(runtime.connections.size,0);assert.equal(runtime.bridges.size,0);
});

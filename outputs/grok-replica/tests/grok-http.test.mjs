import test from 'node:test';
import assert from 'node:assert/strict';
import {startHarness} from './fixtures/harness-http.mjs';
test('a clean checkout exposes its independent Grok harness without requiring a coding CLI',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client();assert.equal(client.status.runtime.adapter,'grok-bot-harness');
 const result=await client.request('/conversations/missing-model/runs',{method:'POST',body:{requestId:'first',text:'hello'}});assert.equal(result.status,503);assert.equal(result.value.error.code,'MODEL_NOT_CONFIGURED');
});

import http from 'node:http';
import path from 'node:path';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHarnessHandler} from '../harness/http.mjs';
import {oauthFixture} from './fixtures/oauth-provider.mjs';

test('the independent HTTP harness calls a real OAuth MCP and exposes only SendMessage, then denies revoked access',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());let handler,round=0;
 const server=http.createServer((req,res)=>handler.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl='http://127.0.0.1:'+server.address().port;
 const model={status:()=>({state:'ready',provider:'fixture',model:'fixture'}),complete:async({messages,tools})=>{
  if(++round===1){const sum=tools.find(tool=>tool.name.startsWith('mcp_'));assert.ok(sum);return {text:'INTERNAL-NOT-FOR-CHAT',toolCalls:[{id:'sum-call',name:sum.name,arguments:{a:13,b:29}}]};}
  assert.match(JSON.stringify(messages),/42/);return {text:'PRIVATE-FINAL',toolCalls:[{id:'reply-call',name:'SendMessage',arguments:{text:{content:'Verified tool result: 42'}}}]};
 }};
 handler=await createHarnessHandler({root:path.resolve('.'),dataDir:await mkdtemp(path.join(tmpdir(),'grok-http-owned-')),baseUrl,model});
 t.after(async()=>{await handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const status=await fetch(baseUrl+'/api/harness/status'),cookie=status.headers.get('set-cookie').split(';')[0],csrf=(await status.json()).csrfToken,owner=cookie.split('=')[1];
 const post=async(route,body)=>{const response=await fetch(baseUrl+'/api/harness'+route,{method:'POST',headers:{cookie,Origin:baseUrl,'x-harness-csrf':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const {accounts,access}=await handler.identities(),flow=await accounts.begin(owner,{requestId:'oauth-start',resourceUrl:provider.resourceUrl});
 const auth=await fetch(flow.authorizationUrl,{redirect:'manual'});const account=await accounts.callback({...Object.fromEntries(new URL(auth.headers.get('location')).searchParams),browserBinding:flow.browserBinding});
 const bot=await access.ensureBot(owner,{requestId:'bot',clientKey:'http-proof',name:'Proof Bot'});await access.bindAccount(owner,bot.id,{requestId:'bind',accountId:account.id});
 assert.equal((await post('/conversations/proof/bot',{requestId:'conversation-bind',botId:bot.id})).status,200);
 const started=await post('/conversations/proof/runs',{requestId:'run',text:'Use the real sum tool'});assert.equal(started.status,202);
 for(let i=0;i<300;i++){
  const state=handler.store.get(owner,'proof'),run=state.runs[0];
  for(const approval of run.approvals.filter(a=>a.status==='pending')){assert.deepEqual(approval.operation.arguments,{a:13,b:29});await post('/runs/'+run.id+'/approvals/'+approval.id+'/decision',{requestId:'decision',decision:'approve'});}
  if(['completed','failed','interrupted'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,10));
 }
 const state=handler.store.get(owner,'proof'),snapshot=handler.store.snapshot(state);assert.equal(state.runs[0].status,'completed');assert.equal(snapshot.entries[1].text,'Verified tool result: 42');assert.equal(provider.calls.length,1);assert.equal(snapshot.agentHistory,undefined);assert.ok(!JSON.stringify(snapshot).includes('INTERNAL-NOT-FOR-CHAT'));assert.equal(round,2);
 await writeFile(path.join(state.workspaceRoot,'index.html'),'<title>Owned taskbox proof</title><h1>Actual browser</h1>');
 const browser=await post('/conversations/proof/browser',{requestId:'browser-proof',action:'browser_open',arguments:{url:baseUrl+'/api/harness/conversations/proof/preview/index.html'}});assert.equal(browser.status,200,JSON.stringify(browser.value));assert.match(JSON.stringify(browser.value),/Owned taskbox proof/);
 const c=handler.runtime.connections.get('proof'),oldUrl=c.accountServers[0].url,oldToken=c.token;
 assert.equal((await post('/accounts/'+account.id+'/disconnect',{requestId:'disconnect'})).status,200);
 const denied=await fetch(oldUrl,{headers:{authorization:'Bearer '+oldToken}});assert.ok([401,403].includes(denied.status));assert.equal(provider.calls.length,1);assert.equal(handler.runtime.connections.has('proof'),false);
});

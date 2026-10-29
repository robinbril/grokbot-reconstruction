import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {OAuthAccounts} from '../harness/identity/oauth-accounts.mjs';
import {oauthFixture} from './fixtures/oauth-provider.mjs';

test('real authorization exchange, encrypted owner accounts, refresh, rename/default and revoke',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'grok-oauth-'));
 let clock=Date.now();const service=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876',clock:()=>clock}).init();
 const flow=await service.begin('owner-a',{requestId:'start-1',resourceUrl:provider.resourceUrl,name:'Docs'});
 assert.deepEqual(await service.begin('owner-a',{requestId:'start-1',resourceUrl:provider.resourceUrl,name:'Docs'}),flow);
 const authorization=await fetch(flow.authorizationUrl,{redirect:'manual'});assert.equal(authorization.status,302);
 const callback=new URL(authorization.headers.get('location'));const account=await service.callback({...Object.fromEntries(callback.searchParams),browserBinding:flow.browserBinding});
 assert.equal(account.status,'connected');assert.equal(account.name,'Docs');assert.equal(service.list('owner-b').length,0);
 await assert.rejects(service.callback({...Object.fromEntries(callback.searchParams),browserBinding:flow.browserBinding}),{code:'OAUTH_STATE_INVALID'});
 const credential=await service.getCredentialForUse('owner-a',account.id,{resourceUrl:provider.resourceUrl});assert.match(credential.accessToken,/access-/);
 assert.equal((await fetch(provider.resourceUrl,{headers:{Authorization:`Bearer ${credential.accessToken}`}})).status,200);
 await assert.rejects(service.getCredentialForUse('owner-b',account.id),{code:'NOT_FOUND'});
 await assert.rejects(service.getCredentialForUse('owner-a',account.id,{resourceUrl:'https://wrong.example/mcp'}),{code:'OAUTH_RESOURCE_MISMATCH'});
 clock+=70000;const refreshed=await service.getCredentialForUse('owner-a',account.id);assert.notEqual(refreshed.accessToken,credential.accessToken);assert.equal(provider.refreshes,1);
 await service.rename('owner-a',account.id,'Renamed');await service.setDefault('owner-a',account.id);assert.equal(service.list('owner-a')[0].name,'Renamed');
 const persisted=await readFile(path.join(dataDir,'identity','accounts.enc'),'utf8');assert.ok(!persisted.includes('access-'));assert.ok(!persisted.includes('refresh-'));assert.ok(!JSON.stringify(service.list('owner-a')).includes('accessToken'));
 assert.equal((await stat(path.join(dataDir,'identity','accounts.enc'))).mode&0o777,0o600);
 const reloaded=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876',clock:()=>clock}).init();assert.equal(reloaded.list('owner-a')[0].name,'Renamed');
 await reloaded.disconnect('owner-a',account.id);assert.equal(reloaded.list('owner-a')[0].status,'disconnected');assert.equal(provider.revocations,1);
 await assert.rejects(reloaded.getCredentialForUse('owner-a',account.id),{code:'OAUTH_DISCONNECTED'});
});

test('authorization binds issuer, rejects conflicting requests and hostile endpoints',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'grok-oauth-'));
 const service=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876'}).init();
 const flow=await service.begin('a',{requestId:'one',resourceUrl:provider.resourceUrl});
 await assert.rejects(service.begin('a',{requestId:'one',resourceUrl:provider.resourceUrl,name:'different'}),{code:'IDEMPOTENCY_CONFLICT'});
 const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const params=Object.fromEntries(new URL(response.headers.get('location')).searchParams);
 await assert.rejects(service.callback({...params,browserBinding:flow.browserBinding,iss:'https://attacker.example'}),{code:'OAUTH_ISSUER_MISMATCH'});
 assert.equal(provider.exchanges,0);
 for(const resourceUrl of ['http://example.com/mcp','https://user:pass@example.com/mcp','https://example.com/mcp#x'])await assert.rejects(service.begin('a',{requestId:'bad',resourceUrl}),{code:'OAUTH_URL_INVALID'});
});

test('browser-bound callback, polling, cancellation and expiry are owner-isolated',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'grok-oauth-'));let time=Date.now();
 const service=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876',clock:()=>time}).init();
 const flow=await service.begin('a',{requestId:'flow',resourceUrl:provider.resourceUrl});
 assert.equal(service.flow('a',flow.flowId).status,'pending');assert.throws(()=>service.flow('b',flow.flowId),{code:'NOT_FOUND'});
 const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const params=Object.fromEntries(new URL(response.headers.get('location')).searchParams);
 await assert.rejects(service.callback({...params,browserBinding:'wrong'}),{code:'OAUTH_BROWSER_MISMATCH'});assert.equal(provider.exchanges,0);
 const account=await service.callback({...params,browserBinding:flow.browserBinding});assert.equal(service.flow('a',flow.flowId).accountId,account.id);assert.equal(service.flow('a',flow.flowId).status,'connected');
 const cancelled=await service.begin('a',{requestId:'cancel',resourceUrl:provider.resourceUrl});await service.cancelFlow('a',cancelled.flowId);await service.cancelFlow('a',cancelled.flowId);assert.equal(service.flow('a',cancelled.flowId).status,'cancelled');
 const expired=await service.begin('a',{requestId:'expire',resourceUrl:provider.resourceUrl});time+=600001;assert.equal(service.flow('a',expired.flowId).status,'expired');
});

test('OAuth bearer authorizes actual MCP tools while missing credentials are rejected',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'grok-oauth-'));
 const service=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876'}).init();const flow=await service.begin('a',{requestId:'mcp',resourceUrl:provider.resourceUrl});
 const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const params=Object.fromEntries(new URL(response.headers.get('location')).searchParams);const account=await service.callback({...params,browserBinding:flow.browserBinding});const {accessToken}=await service.getCredentialForUse('a',account.id);
 const invoke=token=>fetch(provider.resourceUrl,{method:'POST',headers:{'content-type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'sum',arguments:{a:13,b:29}}})});
 assert.equal((await invoke()).status,401);const result=await invoke(accessToken);assert.equal(result.status,200);assert.equal((await result.json()).result.structuredContent.sum,42);assert.deepEqual(provider.calls,[{name:'sum',arguments:{a:13,b:29}}]);
});

test('provider downgrade, resource mismatch and redirects never exchange credentials',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const fresh=async fetchImpl=>new OAuthAccounts({dataDir:await mkdtemp(path.join(tmpdir(),'grok-oauth-')),baseUrl:'http://127.0.0.1:8876',fetchImpl}).init();
 const wrap=mutate=>async(url,options)=>{const result=await fetch(url,options);if(String(url).includes('.well-known'))return new Response(JSON.stringify(mutate(await result.json())),{headers:{'content-type':'application/json'}});return result;};
 const badResource=await fresh(wrap(data=>data.resource?{...data,resource:'https://wrong.example/mcp'}:data));await assert.rejects(badResource.begin('a',{requestId:'x',resourceUrl:provider.resourceUrl}),{code:'OAUTH_METADATA_INVALID'});
 const downgrade=await fresh(wrap(data=>data.issuer?{...data,code_challenge_methods_supported:['plain']}:data));await assert.rejects(downgrade.begin('a',{requestId:'x',resourceUrl:provider.resourceUrl}),{code:'OAUTH_PKCE_REQUIRED'});
 const redirect=await fresh(async(url,options)=>{assert.equal(options.redirect,'error');throw new TypeError('redirect disallowed');});await assert.rejects(redirect.begin('a',{requestId:'x',resourceUrl:provider.resourceUrl}),/redirect disallowed/);assert.equal(provider.exchanges,0);
});

test('concurrent refreshes coalesce through the serialized account transaction',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());let time=Date.now();const service=await new OAuthAccounts({dataDir:await mkdtemp(path.join(tmpdir(),'grok-oauth-')),baseUrl:'http://127.0.0.1:8876',clock:()=>time}).init();
 const flow=await service.begin('a',{requestId:'x',resourceUrl:provider.resourceUrl});const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const params=Object.fromEntries(new URL(response.headers.get('location')).searchParams);const account=await service.callback({...params,browserBinding:flow.browserBinding});time+=70000;
 const results=await Promise.all(Array.from({length:5},()=>service.getCredentialForUse('a',account.id)));assert.equal(new Set(results.map(r=>r.accessToken)).size,1);assert.equal(provider.refreshes,1);
});

test('restart interrupts an unfinished token exchange and remote revocation failures remain local disconnects',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'grok-oauth-'));
 let blockRevoke=false;const fetchImpl=(url,options)=>{if(blockRevoke&&String(url).endsWith('/revoke'))return Promise.resolve(new Response('{}',{status:503}));return fetch(url,options);};
 const service=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876',fetchImpl}).init();
 const flow=await service.begin('a',{requestId:'x',resourceUrl:provider.resourceUrl});const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const params=Object.fromEntries(new URL(response.headers.get('location')).searchParams);const account=await service.callback({...params,browserBinding:flow.browserBinding});blockRevoke=true;
 const removed=await service.disconnect('a',account.id);assert.equal(removed.status,'disconnected');assert.equal(removed.revokeConfirmed,false);assert.match(removed.revocationError,/could not be confirmed/);await assert.rejects(service.getCredentialForUse('a',account.id),{code:'OAUTH_DISCONNECTED'});
 const pending=await service.begin('a',{requestId:'pending',resourceUrl:provider.resourceUrl});service.storage.data.flows.find(f=>f.id===pending.flowId).status='exchanging';await service.storage.save();
 const reloaded=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876'}).init();assert.equal(reloaded.flow('a',pending.flowId).status,'error');assert.equal(reloaded.flow('a',pending.flowId).error.code,'OAUTH_INTERRUPTED');
});

test('reauthentication preserves the existing owner-bound account identity and rejects cross-owner/resource replacement',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const service=await new OAuthAccounts({dataDir:await mkdtemp(path.join(tmpdir(),'grok-oauth-')),baseUrl:'http://127.0.0.1:8876'}).init();
 const complete=async input=>{const flow=await service.begin('a',input);const response=await fetch(flow.authorizationUrl,{redirect:'manual'});return service.callback({...Object.fromEntries(new URL(response.headers.get('location')).searchParams),browserBinding:flow.browserBinding});};
 const original=await complete({requestId:'first',resourceUrl:provider.resourceUrl,name:'My docs'});await service.rename('a',original.id,'Personal docs');await service.disconnect('a',original.id);
 await assert.rejects(service.begin('b',{requestId:'bad',resourceUrl:provider.resourceUrl,accountId:original.id}),{code:'NOT_FOUND'});
 await assert.rejects(service.begin('a',{requestId:'wrong',resourceUrl:'https://wrong.example/mcp',accountId:original.id}),{code:'OAUTH_RESOURCE_MISMATCH'});
 const renewed=await complete({requestId:'renew',resourceUrl:provider.resourceUrl,accountId:original.id});assert.equal(renewed.id,original.id);assert.equal(renewed.name,'Personal docs');assert.equal(renewed.status,'connected');assert.equal(service.list('a').length,1);
});

test('reauthentication reuses a previously registered public client when the provider has no DCR',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const fetchImpl=async(url,options)=>{const response=await fetch(url,options);if(String(url).includes('oauth-authorization-server')){const body=await response.json();delete body.registration_endpoint;return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});}return response;};
 const service=await new OAuthAccounts({dataDir:await mkdtemp(path.join(tmpdir(),'grok-oauth-')),baseUrl:'http://127.0.0.1:8876',fetchImpl}).init();
 const flow=await service.begin('a',{requestId:'one',resourceUrl:provider.resourceUrl,clientId:'fixture-public',scope:'docs.read'});const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const account=await service.callback({...Object.fromEntries(new URL(response.headers.get('location')).searchParams),browserBinding:flow.browserBinding});
 const retry=await service.begin('a',{requestId:'two',resourceUrl:provider.resourceUrl,accountId:account.id});assert.equal(new URL(retry.authorizationUrl).searchParams.get('client_id'),'fixture-public');assert.equal(new URL(retry.authorizationUrl).searchParams.get('scope'),'docs.read');
});

test('durable account mutation receipts prevent duplicate revocation and stale rename replay',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'grok-oauth-'));const service=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876'}).init();
 const flow=await service.begin('a',{requestId:'x',resourceUrl:provider.resourceUrl});const auth=new URL(flow.authorizationUrl);assert.equal(service.flowIdForState(auth.searchParams.get('state')),flow.flowId);
 const response=await fetch(flow.authorizationUrl,{redirect:'manual'});const account=await service.callback({...Object.fromEntries(new URL(response.headers.get('location')).searchParams),browserBinding:flow.browserBinding});
 await service.mutate('a',account.id,'rename',{requestId:'first',name:'First'});await service.mutate('a',account.id,'rename',{requestId:'second',name:'Second'});assert.equal((await service.mutate('a',account.id,'rename',{requestId:'first',name:'First'})).name,'Second');
 await assert.rejects(service.mutate('a',account.id,'rename',{requestId:'first',name:'Different'}),{code:'IDEMPOTENCY_CONFLICT'});
 await service.mutate('a',account.id,'disconnect',{requestId:'off'});const restarted=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876'}).init();await restarted.mutate('a',account.id,'disconnect',{requestId:'off'});assert.equal(provider.revocations,1);
});

test('definitive expired credentials require authentication while transient refresh failure does not',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());let clock=Date.now(),failure;
 const fetchImpl=async(url,options)=>{if(String(url).endsWith('/token')&&String(options.body).includes('refresh_token')&&failure)return new Response(JSON.stringify({error:failure==='invalid'?'invalid_grant':'temporarily_unavailable',error_description:'secret provider diagnostics'}),{status:failure==='invalid'?400:503,headers:{'content-type':'application/json'}});return fetch(url,options);};
 const service=await new OAuthAccounts({dataDir:await mkdtemp(path.join(tmpdir(),'grok-oauth-')),baseUrl:'http://127.0.0.1:8876',clock:()=>clock,fetchImpl}).init();
 const complete=async input=>{const flow=await service.begin('a',input);const response=await fetch(flow.authorizationUrl,{redirect:'manual'});return service.callback({...Object.fromEntries(new URL(response.headers.get('location')).searchParams),browserBinding:flow.browserBinding});};
 const account=await complete({requestId:'first',resourceUrl:provider.resourceUrl});const previous=(await service.getCredentialForUse('a',account.id)).accessToken;clock+=70000;failure='transient';await assert.rejects(service.getCredentialForUse('a',account.id),{code:'OAUTH_REFRESH_UNAVAILABLE'});assert.equal(service.list('a')[0].status,'connected');
 failure='invalid';await assert.rejects(service.getCredentialForUse('a',account.id),{code:'OAUTH_REAUTH_REQUIRED'});assert.equal(service.list('a')[0].status,'authenticationRequired');assert.equal(service.list('a')[0].updatedAt,clock);assert.ok(!JSON.stringify(service.list('a')).includes('secret provider'));
 failure=null;const renewed=await complete({requestId:'renew',resourceUrl:provider.resourceUrl,accountId:account.id});assert.equal(renewed.id,account.id);assert.equal(renewed.status,'connected');clock+=100;
 await service.requireAuthentication('a',account.id,{expectedAccessToken:previous});assert.equal(service.list('a')[0].status,'connected');
 await service.requireAuthentication('a',account.id);assert.equal(service.list('a')[0].status,'authenticationRequired');await assert.rejects(service.getCredentialForUse('a',account.id),{code:'OAUTH_REAUTH_REQUIRED'});
 await complete({requestId:'third',resourceUrl:provider.resourceUrl,accountId:account.id});delete service.storage.data.accounts.find(a=>a.id===account.id).refreshToken;clock+=70000;await assert.rejects(service.getCredentialForUse('a',account.id),{code:'OAUTH_REAUTH_REQUIRED'});assert.equal(service.list('a')[0].status,'authenticationRequired');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startHarness} from './fixtures/harness-http.mjs';
import {oauthFixture} from './fixtures/oauth-provider.mjs';

test('OAuth HTTP callback is browser-bound, secret-free and owner-isolated',async t=>{
 const app=await startHarness(),provider=await oauthFixture();t.after(()=>app.close());t.after(()=>provider.close());
 const rawClient=await app.client(),other=await app.client(),ownerCookie=rawClient.cookie;
 // The legacy fixture tracks one cookie; keep its owner alongside the new per-flow cookie.
 const client={request:(route,options={})=>rawClient.request(route,{...options,headers:{...options.headers,cookie:ownerCookie}})};
 const begun=await client.request('/accounts/oauth/start',{method:'POST',body:{requestId:randomUUID(),name:'Protected math',resourceUrl:provider.resourceUrl},raw:true});
 assert.equal(begun.status,200);const flowCookie=begun.headers.get('set-cookie');assert.match(flowCookie,/HttpOnly/i);assert.match(flowCookie,/SameSite=Lax/i);
 const flow=await begun.json();assert.equal(flow.browserBinding,undefined);assert.equal(flow.status,'pending');assert.deepEqual((await client.request('/accounts')).value.accounts,[]);
 const authorization=await fetch(flow.authorizationUrl,{redirect:'manual'}),callback=new URL(authorization.headers.get('location'));
 const missing=await fetch(callback,{redirect:'manual'});assert.equal(missing.status,400);assert.equal(provider.exchanges,0);
 const complete=await fetch(callback,{headers:{cookie:flowCookie.split(';',1)[0]},redirect:'manual'});assert.equal(complete.status,200);assert.match(complete.headers.get('content-security-policy'),/default-src 'none'/);
 const accounts=(await client.request('/accounts')).value.accounts;assert.equal(accounts.length,1);assert.equal(accounts[0].status,'connected');
 assert.ok(!JSON.stringify(accounts).includes('accessToken'));assert.deepEqual((await other.request('/accounts')).value.accounts,[]);
 assert.equal((await other.request('/accounts/'+accounts[0].id+'/rename',{method:'POST',body:{requestId:randomUUID(),name:'hijack'}})).status,404);
 assert.equal((await fetch(callback,{headers:{cookie:flowCookie.split(';',1)[0]}})).status,400);
 const renamed=await client.request('/accounts/'+accounts[0].id+'/rename',{method:'POST',body:{requestId:randomUUID(),name:'Renamed'}});assert.equal(renamed.value.account.name,'Renamed');
 const off=await client.request('/accounts/'+accounts[0].id+'/disconnect',{method:'POST',body:{requestId:randomUUID()}});assert.equal(off.value.account.status,'disconnected');assert.equal(provider.revocations,1);
});

test('Bot and team HTTP roles come from server membership, not supplied roles',async t=>{
 const app=await startHarness();t.after(()=>app.close());const a=await app.client(),b=await app.client();
 const post=(client,path,body)=>client.request(path,{method:'POST',body:{requestId:randomUUID(),...body}});
 const created=await post(a,'/teams',{name:'Proof team'});assert.equal(created.status,200);const team=created.value.team;
 const invited=await post(a,'/teams/'+team.id+'/invitations',{role:'member'});assert.equal(invited.status,200);
 const joined=await post(b,'/teams/join',{token:invited.value.invitation.token,role:'owner'});assert.equal(joined.status,200);assert.equal(joined.value.team.role,'member');
 assert.equal((await post(b,'/teams/'+team.id+'/invitations',{role:'admin'})).status,403);
 const own=await post(a,'/bots',{clientKey:'proof-bot',name:'Proof Bot'});assert.equal(own.status,200);
 assert.equal((await post(a,'/bots/'+own.value.bot.id+'/team',{teamId:team.id})).status,200);
 const visible=(await b.request('/access')).value;assert.ok(visible.bots.some(bot=>bot.id===own.value.bot.id));assert.ok(!JSON.stringify(visible).includes(a.cookie.split('=')[1]));
 const member=visible.principal.id;
 assert.equal((await post(a,'/teams/'+team.id+'/members/'+member,{role:null})).status,200);
 assert.ok(!(await b.request('/access')).value.bots.some(bot=>bot.id===own.value.bot.id));
});

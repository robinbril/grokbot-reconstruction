import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHarnessClient} from '../live-harness-client.js';
function transport(){const calls=[];const client=createLiveHarnessClient({fetchImpl:async(path,options)=>{calls.push({path,...options});return new Response(JSON.stringify(path.endsWith('/status')?{csrfToken:'synthetic-csrf'}:{ok:true}),{headers:{'content-type':'application/json'}});}});return {client,calls};}

test('account client methods use owner-scoped routes and same-origin CSRF transport',async()=>{
 const {client,calls}=transport();
 await client.accounts();await client.startAccountOAuth({requestId:'start',name:'Proof',resourceUrl:'https://example.test/mcp'});await client.accountFlow('flow/id');await client.cancelAccountFlow('flow/id','cancel');await client.renameAccount('account/id','Renamed','rename');await client.defaultAccount('account/id','default');await client.disconnectAccount('account/id','disconnect');
 assert.deepEqual(calls.map(call=>call.path),['/api/harness/accounts','/api/harness/status','/api/harness/accounts/oauth/start','/api/harness/accounts/flows/flow%2Fid','/api/harness/accounts/flows/flow%2Fid/cancel','/api/harness/accounts/account%2Fid/rename','/api/harness/accounts/account%2Fid/default','/api/harness/accounts/account%2Fid/disconnect']);
 for(const call of calls){assert.equal(call.credentials,'same-origin');if(call.method==='POST')assert.equal(call.headers['x-harness-csrf'],'synthetic-csrf');}
 assert.deepEqual(JSON.parse(calls[2].body),{requestId:'start',name:'Proof',resourceUrl:'https://example.test/mcp'});assert.deepEqual(JSON.parse(calls[5].body),{requestId:'rename',name:'Renamed'});
});
test('Bot and team client methods send only requested role and account scope',async()=>{
 const {client,calls}=transport();
 await client.accessOverview();await client.ensureBot({requestId:'bot',clientKey:'local',name:'Proof'});await client.createTeam('Team','team');await client.inviteTeam('team/id','member','invite');await client.joinTeam('synthetic-one-use-code','join');await client.setTeamMember('team/id','principal/id',null,'revoke');await client.shareBot('bot/id',null,'unshare');await client.grantAccount('team/id','account/id',false,'grant');await client.bindAccount('bot/id','account/id','bind');await client.unbindAccount('bot/id','missing/account','unbind');
 const mutations=calls.filter(call=>call.method==='POST');
 assert.deepEqual(mutations.map(call=>call.path),['/api/harness/bots','/api/harness/teams','/api/harness/teams/team%2Fid/invitations','/api/harness/teams/join','/api/harness/teams/team%2Fid/members/principal%2Fid','/api/harness/bots/bot%2Fid/team','/api/harness/teams/team%2Fid/accounts','/api/harness/bots/bot%2Fid/accounts','/api/harness/bots/bot%2Fid/accounts/missing%2Faccount/unbind']);
 assert.deepEqual(JSON.parse(mutations[4].body),{requestId:'revoke',role:null});assert.deepEqual(JSON.parse(mutations[8].body),{requestId:'unbind'});assert.deepEqual(JSON.parse(mutations[6].body),{requestId:'grant',accountId:'account/id',enabled:false});
});

test('conversation binding sends the explicit server conversation and Bot IDs',async()=>{
 const {client,calls}=transport();await client.bindConversationBot('conversation/id','bot-id','binding');const bound=calls.at(-1);
 assert.equal(bound.path,'/api/harness/conversations/conversation%2Fid/bot');assert.deepEqual(JSON.parse(bound.body),{botId:'bot-id',requestId:'binding'});
});

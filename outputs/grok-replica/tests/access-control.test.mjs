import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AccessControl} from '../harness/access/index.mjs';
const owner='owner-browser-secret',admin='admin-browser-secret',member='member-browser-secret',outsider='foreign-browser-secret';
const requestId=()=>crypto.randomUUID();
const input=data=>({requestId:requestId(),...data});
async function setup(t){const dataDir=await mkdtemp(path.join(tmpdir(),'grok-access-'));let now=100000;const accounts=new Map([['accountA',{owner,status:'connected',name:'Public demo account',resourceUrl:'https://example.com/mcp'}]]);const options={dataDir,clock:()=>now,accountLookup:async id=>accounts.get(id)};const access=await new AccessControl(options).init();return {access,options,dataDir,accounts,advance:n=>now+=n};}
async function teamMember(access,who,teamId,role='member'){const invite=await access.invite(owner,teamId,input({role}));return access.join(who,input({token:invite.token}));}
const denied=(promise,code='ACCESS_DENIED')=>assert.rejects(promise,{code});
test('public principals do not leak cookies and stable private Bots persist with strict request receipts',async t=>{
 const {access,options,dataDir}=await setup(t);const bot=await access.ensureBot(owner,input({clientKey:'local-chat-1',name:'My bot'}));
 const retry=await access.ensureBot(owner,input({clientKey:'local-chat-1',name:'Renamed request'}));assert.equal(retry.id,bot.id);
 const snapshot=await access.overview(owner);assert.equal(snapshot.bots[0].id,bot.id);assert.notEqual(snapshot.principal.id,owner);assert.equal((await access.overview(outsider)).bots.length,0);
 const loaded=await new AccessControl(options).init();assert.equal((await loaded.overview(owner)).bots[0].id,bot.id);
 const raw=await readFile(path.join(dataDir,'access','access.json'),'utf8');assert.ok(!raw.includes(owner));assert.equal((await stat(path.join(dataDir,'access','access.json'))).mode&0o777,0o600);
 const id=requestId();await access.createTeam(owner,{requestId:id,name:'Team'});await denied(access.createTeam(owner,{requestId:id,name:'Different'}),'IDEMPOTENCY_CONFLICT');
});
test('single-use expiring invitations derive roles and reject privilege escalation',async t=>{
 const {access,advance}=await setup(t);const team=await access.createTeam(owner,input({name:'Demo team'}));
 await teamMember(access,admin,team.id,'admin');await teamMember(access,member,team.id);
 const adminId=(await access.overview(admin)).principal.id,memberId=(await access.overview(member)).principal.id,ownerId=(await access.overview(owner)).principal.id;
 await denied(access.invite(member,team.id,input({role:'member'})));await denied(access.invite(admin,team.id,input({role:'admin'})));
 await denied(access.setMember(admin,team.id,ownerId,input({role:null})));await denied(access.setMember(owner,team.id,ownerId,input({role:'member'})));
 await denied(access.setMember(admin,team.id,adminId,input({role:null})));await denied(access.setMember(admin,team.id,memberId,input({role:'admin'})));
 const invite=await access.invite(admin,team.id,input({role:'member'}));await access.join(outsider,input({token:invite.token}));await denied(access.join('another-browser',input({token:invite.token})),'INVITE_INVALID');
 const expired=await access.invite(owner,team.id,input({role:'member'}));advance(900001);await denied(access.join('late-browser',input({token:expired.token})),'INVITE_INVALID');
 assert.equal((await access.overview('unknown-browser')).teams.length,0);
});
test('account grants and membership are revalidated for existing bindings on every use',async t=>{
 const {access,accounts}=await setup(t);const team=await access.createTeam(owner,input({name:'Team'}));await teamMember(access,member,team.id);await teamMember(access,admin,team.id,'admin');
 const bot=await access.ensureBot(member,input({clientKey:'member-bot',name:'Private bot'}));await denied(access.bindAccount(member,bot.id,input({accountId:'accountA'})));
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:true}));await access.bindAccount(member,bot.id,input({accountId:'accountA'}));
 assert.equal((await access.accountUse(member,bot.id,'accountA')).accountOwner,owner);await denied(access.accountUse(outsider,bot.id,'accountA'));
 await access.grantAccount(admin,team.id,input({accountId:'accountA',enabled:false}));await denied(access.accountUse(member,bot.id,'accountA'));
 await denied(access.grantAccount(admin,team.id,input({accountId:'accountA',enabled:true})));
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:true}));const memberId=(await access.overview(member)).principal.id;
 await access.setMember(owner,team.id,memberId,input({role:null}));await denied(access.accountUse(member,bot.id,'accountA'));
 await teamMember(access,member,team.id);accounts.get('accountA').status='disconnected';await denied(access.accountUse(member,bot.id,'accountA'),'ACCOUNT_UNAVAILABLE');
});
test('shared Bots forbid accidental private account exposure and member administration',async t=>{
 const {access}=await setup(t);const team=await access.createTeam(owner,input({name:'Team'}));await teamMember(access,member,team.id);
 const bot=await access.ensureBot(owner,input({clientKey:'shared',name:'Shared bot'}));await access.bindAccount(owner,bot.id,input({accountId:'accountA'}));
 await denied(access.shareBot(owner,bot.id,input({teamId:team.id})));
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:true}));await access.shareBot(owner,bot.id,input({teamId:team.id}));
 assert.equal((await access.overview(member)).bots[0].role,'member');assert.equal((await access.accountUse(member,bot.id,'accountA')).accountOwner,owner);
 await denied(access.bindAccount(member,bot.id,input({accountId:'accountA'})));await denied(access.shareBot(member,bot.id,input({teamId:null})));
 await access.shareBot(owner,bot.id,input({teamId:null}));await denied(access.accountUse(member,bot.id,'accountA'));
});
test('revoked invitation issuers cannot admit members and invitation secrets are not persisted',async t=>{
 const {access,options,dataDir}=await setup(t),team=await access.createTeam(owner,input({name:'Team'}));await teamMember(access,admin,team.id,'admin');
 const inviteInput=input({role:'member'}),invite=await access.invite(admin,team.id,inviteInput);
 assert.deepEqual(await access.invite(admin,team.id,inviteInput),invite);
 const persisted=await readFile(path.join(dataDir,'access','access.json'),'utf8');assert.ok(!persisted.includes(invite.token));assert.ok(!persisted.includes(admin));
 const loaded=await new AccessControl(options).init();await denied(loaded.invite(admin,team.id,inviteInput),'INVITE_ALREADY_ISSUED');
 const adminId=(await access.overview(admin)).principal.id;await access.setMember(owner,team.id,adminId,input({role:'member'}));
 await denied(access.join(outsider,input({token:invite.token})),'INVITE_INVALID');
});
test('admins cannot remove or demote peer admins and request receipts cannot be repurposed across methods',async t=>{
 const {access}=await setup(t),team=await access.createTeam(owner,input({name:'Team'}));await teamMember(access,admin,team.id,'admin');await teamMember(access,member,team.id,'admin');
 const peerId=(await access.overview(member)).principal.id;await denied(access.setMember(admin,team.id,peerId,input({role:null})));await denied(access.setMember(admin,team.id,peerId,input({role:'member'})));
 const id=requestId();await access.ensureBot(owner,{requestId:id,clientKey:'x',name:'X'});await denied(access.createTeam(owner,{requestId:id,name:'Escalated'}),'IDEMPOTENCY_CONFLICT');
});
test('shared account metadata and Bot bindings never contain account owner credentials or tokens',async t=>{
 const {access,accounts}=await setup(t),team=await access.createTeam(owner,input({name:'Team'}));accounts.get('accountA').accessToken='do-not-disclose';await teamMember(access,member,team.id);
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:true}));const bot=await access.ensureBot(member,input({clientKey:'bound',name:'Bound'}));await access.bindAccount(member,bot.id,input({accountId:'accountA'}));
 const publicData=JSON.stringify({overview:await access.overview(member),accounts:await access.availableAccounts(member)});assert.ok(!publicData.includes(owner));assert.ok(!publicData.includes('do-not-disclose'));
 const bindings=await access.botBindings(member,bot.id);assert.equal(bindings.length,1);assert.equal(bindings[0].accountOwner,owner);
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:false}));await denied(access.botBindings(member,bot.id));assert.deepEqual(await access.availableAccounts(member),[]);
});
test('team administrators cannot create grant records for unrelated private accounts',async t=>{
 const {access}=await setup(t),team=await access.createTeam(outsider,input({name:'Other team'}));
 await denied(access.grantAccount(outsider,team.id,input({accountId:'accountA',enabled:false})));
});
test('obsolete account bindings can be removed without granting access and healthy bindings remain',async t=>{
 const {access,accounts}=await setup(t),team=await access.createTeam(owner,input({name:'Team'}));await teamMember(access,member,team.id);
 accounts.set('healthy',{owner,status:'connected',name:'Healthy',resourceUrl:'https://example.com/healthy'});
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:true}));await access.grantAccount(owner,team.id,input({accountId:'healthy',enabled:true}));
 const bot=await access.ensureBot(owner,input({clientKey:'recover',name:'Recover'}));await access.bindAccount(owner,bot.id,input({accountId:'accountA'}));await access.bindAccount(owner,bot.id,input({accountId:'healthy'}));await access.shareBot(owner,bot.id,input({teamId:team.id}));
 await access.grantAccount(owner,team.id,input({accountId:'accountA',enabled:false}));await denied(access.botBindings(owner,bot.id));
 assert.equal(typeof access.unbindAccount,'function');await denied(access.unbindAccount(member,bot.id,input({accountId:'accountA'})));
 accounts.delete('accountA');const removal=input({accountId:'accountA'}),removed=await access.unbindAccount(owner,bot.id,removal);assert.deepEqual(removed.accountIds,['healthy']);assert.deepEqual(await access.unbindAccount(owner,bot.id,removal),removed);
 assert.deepEqual((await access.botBindings(member,bot.id)).map(b=>b.accountId),['healthy']);
 await denied(access.unbindAccount(owner,bot.id,input({accountId:'../invalid'})),'INVALID_ACCESS_INPUT');
});
test('team owner viewing another browser Bot cannot share that Bot',async t=>{
 const {access}=await setup(t),team=await access.createTeam(owner,input({name:'Team'}));await teamMember(access,admin,team.id,'admin');
 const bot=await access.ensureBot(admin,input({clientKey:'admin-owned',name:'Admin bot'}));await access.shareBot(admin,bot.id,input({teamId:team.id}));
 assert.equal((await access.overview(owner)).bots.find(b=>b.id===bot.id).canShare,false);assert.equal((await access.overview(admin)).bots.find(b=>b.id===bot.id).canShare,true);
});

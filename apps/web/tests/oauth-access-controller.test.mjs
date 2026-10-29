import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccessController} from '../live-access-controller.js';
import {accessMarkup} from '../live-access-view.js';
import {createAccountsController} from '../live-accounts-controller.js';
const esc=value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;');
const overview={principal:{id:'owner',name:'Local owner'},teams:[],bots:[],grants:[]};

test('team mutations adopt authoritative reads and preserve durable retry IDs',async()=>{
 let fails=true;const calls=[],team={id:'team',name:'Proof team',role:'owner',members:[]};
 const controller=createAccessController({client:{accounts:async()=>({accounts:[]}),accessOverview:async()=>({...overview,teams:fails?[]:[team]}),createTeam:async(...args)=>{calls.push(args);if(fails)throw new Error('Unavailable');return {team};}}});
 await controller.createTeam(team.name);assert.deepEqual(controller.state().teams,[]);assert.equal(controller.state().error.message,'Unavailable');fails=false;await controller.createTeam(team.name);assert.equal(calls[0][1],calls[1][1]);assert.deepEqual(controller.state().teams,[team]);
});
test('pending team requests coalesce without adopting forged optimistic roles',async()=>{
 let resolve;const calls=[];const promise=new Promise(done=>resolve=done);
 const controller=createAccessController({client:{accounts:async()=>({accounts:[]}),accessOverview:async()=>overview,shareBot:(...args)=>{calls.push(args);return promise;}}});
 const first=controller.share('bot','team'),second=controller.share('bot','team');assert.equal(first,second);await Promise.resolve();assert.equal(calls.length,1);assert.deepEqual(controller.state().bots,[]);resolve({bot:{id:'bot',teamId:'team'}});await first;assert.deepEqual(controller.state().bots,[],'the backend overview remains authoritative');
});
test('owner and admin controls follow actual service roles and protect owner membership',()=>{
 const member=(id,role)=>({id,name:id,role});
 const team={id:'team',name:'Proof team',role:'admin',members:[member('Owner','owner'),member('Admin','admin'),member('Member','member')]};
 const html=accessMarkup({esc,...overview,teams:[team]});
 assert.doesNotMatch(html,/data-access-member-role="Owner"/);assert.doesNotMatch(html,/data-access-member-role="Admin"/);assert.match(html,/data-access-member-role="Member"/);assert.doesNotMatch(html,/<option value="admin"/);assert.doesNotMatch(html,/<option value="viewer"/);
 const ownerHtml=accessMarkup({esc,...overview,teams:[{...team,role:'owner'}]});assert.match(ownerHtml,/data-access-member-role="Admin"/);assert.match(ownerHtml,/<option value="admin"/);assert.doesNotMatch(ownerHtml,/data-access-member-role="Owner"/);
});
test('account binding creates a real Bot and preserves the original conversation identity',async()=>{
 const calls=[];let resolve;const pending=new Promise(done=>resolve=done),bound=[];
 const controller=createAccountsController({client:{accounts:async()=>({accounts:[]}),ensureBot:async payload=>{calls.push(['ensure',payload]);await pending;return {bot:{id:'actual-bot'}};},bindAccount:async(...args)=>{calls.push(['account',...args]);return {};},bindConversationBot:async(...args)=>{calls.push(['conversation',...args]);return {schema:1,servers:[]};}},onBound:(receipt,id)=>bound.push({receipt,id})});
 const scope={clientKey:'original',name:'Original Bot',conversationId:'server-original'},action=controller.bind('actual-account',scope);await Promise.resolve();resolve();await action;
 assert.equal(calls[1][1],'actual-bot');assert.equal(calls[1][2],'actual-account');assert.equal(calls[2][1],'server-original');assert.equal(calls[2][2],'actual-bot');assert.equal(bound[0].id,'original');assert.notEqual(calls[1][3],calls[2][3]);
});

test('disconnected account grants remain visible so an owner can revoke access',()=>{
 const html=accessMarkup({esc,...overview,teams:[{id:'team',name:'Proof team',role:'owner',members:[]}],accounts:[{id:'account',name:'Disconnected proof',status:'disconnected'}],grants:[{teamId:'team',accountId:'account'}]});
 assert.match(html,/data-access-grant="account"/);assert.match(html,/data-access-grant="account"[^>]*checked/);assert.doesNotMatch(html,/data-access-grant="account"[^>]*disabled/);
});

test('team admins can see and revoke an existing grant owned by another profile',()=>{
 const html=accessMarkup({esc,...overview,teams:[{id:'team',name:'Proof team',role:'admin',members:[]}],accounts:[],grants:[{teamId:'team',accountId:'foreign-account',accountName:'Shared proof'}]});
 assert.match(html,/Shared proof/);assert.match(html,/data-access-grant="foreign-account"[^>]*checked/);assert.doesNotMatch(html,/data-access-grant="foreign-account"[^>]*disabled/);
});

test('Bot sharing is offered only to Bot owners, not team administrators',()=>{
 const html=accessMarkup({esc,...overview,bots:[{id:'owned',name:'Owned',role:'owner',canShare:true},{id:'admin-bot',name:'Admin',role:'admin',canShare:false},{id:'team-owner',name:'Team owner',role:'owner',canShare:false}]});
 assert.match(html,/data-access-bot-team="owned"/);assert.doesNotMatch(html,/data-access-bot-team="admin-bot"/);assert.doesNotMatch(html,/data-access-bot-team="team-owner"/);
});

test('a shared account does not offer an owner-only new grant to another team',()=>{
 const html=accessMarkup({esc,...overview,teams:[{id:'team',name:'Other team',role:'owner',members:[]}],accounts:[{id:'shared',name:'Shared only',status:'connected',shared:true}]});
 assert.doesNotMatch(html,/data-access-grant="shared"/);
});

test('Bot owners and admins can unbind missing or revoked accounts while members cannot',()=>{
 const bot=(role)=>({id:'bot',name:'Proof',role,accountIds:['revoked','missing']});
 for(const role of ['owner','admin']){
  const html=accessMarkup({esc,...overview,bots:[bot(role)],accounts:[{id:'revoked',name:'Revoked proof',status:'disconnected'}]});
  assert.match(html,/data-action="live-access-bot-unbind"[^>]*data-account-id="revoked"/);assert.match(html,/data-action="live-access-bot-unbind"[^>]*data-account-id="missing"/);
 }
 const memberHtml=accessMarkup({esc,...overview,bots:[bot('member')]});assert.doesNotMatch(memberHtml,/data-action="live-access-bot-unbind"/);
});
test('unbinding keeps the original Bot/account IDs and adopts canonical remaining bindings',async()=>{
 let bound=true;const calls=[];
 const controller=createAccessController({client:{accounts:async()=>({accounts:[]}),accessOverview:async()=>({...overview,bots:[{id:'bot',name:'Proof',role:'owner',accountIds:bound?['missing']:[]}]}),unbindAccount:async(...args)=>{calls.push(args);bound=false;return {bot:{id:'bot',accountIds:[]}};}}});
 await controller.refresh();await controller.unbind('bot','missing');assert.equal(calls[0][0],'bot');assert.equal(calls[0][1],'missing');assert.deepEqual(controller.state().bots[0].accountIds,[]);
});

test('team member controls distinguish browser profiles with equal display names',()=>{
 const html=accessMarkup({esc:String,principal:{id:'principal-a',name:'Dit browserprofiel'},teams:[{id:'team',name:'Proof',role:'owner',members:[{id:'principal-a',name:'Dit browserprofiel',role:'owner'},{id:'principal-b',name:'Dit browserprofiel',role:'member'},{id:'principal-c',name:'Dit browserprofiel',role:'member'}]}]});
 assert.match(html,/Rol voor lid: Dit browserprofiel · principal-b/);assert.match(html,/Rol voor lid: Dit browserprofiel · principal-c/);assert.match(html,/Dit browserprofiel · principal-a · jij/);
});

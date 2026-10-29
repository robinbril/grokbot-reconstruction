import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountsController} from '../live-accounts-controller.js';
import {createLiveHarnessClient} from '../live-harness-client.js';
import {accountsListMarkup,accountFlowMarkup} from '../live-accounts-view.js';
const providers=[{id:'github',name:'GitHub',status:'ready',resourceUrl:'https://api.githubcopilot.com/mcp/'},{id:'notion',name:'Notion',status:'setupRequired',setup:{message:'Configureer de Notion OAuth-integratie.',environmentVariables:['NOTION_CLIENT_ID']}}];

test('provider readiness comes from server and unavailable starts never create fake accounts',async()=>{
 let starts=0;const controller=createAccountsController({client:{accounts:async()=>({accounts:[]}),accountProviders:async()=>({providers}),startProviderOAuth:async()=>{starts++;}}});
 await controller.refresh();assert.deepEqual(controller.state().providers,providers);
 await controller.startProvider('notion');assert.equal(starts,0);assert.deepEqual(controller.state().accounts,[]);assert.match(controller.state().error.message,/Notion/);
 const html=accountsListMarkup({esc:String,...controller.state()});
 assert.match(html,/GitHub verbinden/);assert.match(html,/data-action="live-account-provider-start" data-id="notion"[^>]*disabled/);assert.match(html,/NOTION_CLIENT_ID/);assert.doesNotMatch(html,/role="status">Verbonden/);
});
test('provider start coalesces requests, forwards only identity fields and awaits verified accounts',async()=>{
 let complete=false,release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];
 const account={id:'account',providerId:'github',name:'GitHub',status:'connected'};
 const controller=createAccountsController({client:{accountProviders:async()=>({providers}),accounts:async()=>({accounts:complete?[account]:[]}),startProviderOAuth:async(id,payload)=>{calls.push({id,payload});await gate;return {flowId:'flow',providerId:id,status:'pending',authorizationUrl:'https://github.com/login/oauth/authorize'};},accountFlow:async()=>({flowId:'flow',status:complete?'connected':'pending'})}});
 await controller.refresh();const first=controller.startProvider('github',{name:'GitHub',clientId:'ignored',scope:'ignored'}),duplicate=controller.startProvider('github',{name:'GitHub',clientId:'ignored',scope:'ignored'});
 assert.equal(first,duplicate);release();await first;assert.equal(calls.length,1);assert.equal(calls[0].id,'github');assert.deepEqual(Object.keys(calls[0].payload).sort(),['name','requestId']);
 assert.equal(controller.flow('flow').providerId,'github');assert.deepEqual(controller.state().accounts,[]);
 complete=true;await controller.poll('flow');assert.equal(controller.account('account').providerId,'github');
});
test('failed provider refresh retains accounts but removes stale readiness',async()=>{
 let failed=false;const account={id:'account',status:'connected'};
 const controller=createAccountsController({client:{accounts:async()=>({accounts:[account]}),accountProviders:async()=>{if(failed)throw new Error('Providers offline');return {providers};}}});
 await controller.refresh();failed=true;await controller.refresh();assert.deepEqual(controller.state().accounts,[account]);assert.deepEqual(controller.state().providers,[]);assert.equal(controller.state().providerError.message,'Providers offline');
});
test('provider pending cancellation and failure use the existing truthful flow display',async()=>{
 const controller=createAccountsController({client:{accountProviders:async()=>({providers}),accounts:async()=>({accounts:[]}),startProviderOAuth:async()=>({flowId:'flow',providerId:'github',status:'pending'}),cancelAccountFlow:async()=>({flowId:'flow',status:'cancelled'})}});
 await controller.refresh();await controller.startProvider('github');await controller.cancel('flow');assert.equal(controller.flow('flow').status,'cancelled');assert.deepEqual(controller.state().accounts,[]);
 assert.match(accountFlowMarkup({esc:String,flow:{...controller.flow('flow'),status:'failed',error:'Toestemming geweigerd'}}),/Toestemming geweigerd/);
});
test('provider client transport encodes provider paths and keeps CSRF on mutations',async()=>{
 const calls=[];const client=createLiveHarnessClient({fetchImpl:async(path,options)=>{calls.push({path,...options});return new Response(JSON.stringify(path.endsWith('/status')?{csrfToken:'synthetic-csrf'}:{providers}));}});
 await client.accountProviders();await client.startProviderOAuth('github/id',{requestId:'provider-start'});
 assert.deepEqual(calls.map(call=>call.path),['/api/harness/accounts/providers','/api/harness/status','/api/harness/accounts/providers/github%2Fid/start']);assert.equal(calls[2].headers['x-harness-csrf'],'synthetic-csrf');assert.deepEqual(JSON.parse(calls[2].body),{requestId:'provider-start'});
});

test('provider account reauthentication uses its provider instead of custom OAuth discovery',async()=>{
 const {createLiveAccountsSurface}=await import('../live-accounts-surface.js');
 const requests=[],account={id:'account',name:'GitHub proof',providerId:'github',resourceUrl:providers[0].resourceUrl,status:'authenticationRequired'};
 const host={esc:String,overlay:{open:true,querySelector:()=>null},closePopover(){},showDialog(){},getDialogVersion:()=>1};
 const client={accounts:async()=>({accounts:[account]}),accountProviders:async()=>({providers}),startProviderOAuth:async(id,payload)=>{requests.push({id,payload});return {flowId:'reauth',providerId:id,status:'pending'};},startAccountOAuth:async()=>{assert.fail('Provider accounts must use provider OAuth');}};
 const surface=createLiveAccountsSurface({host,client,isLive:()=>true,key:()=> 'bot'});
 try{surface.handleAction({action:'live-accounts-open'});await new Promise(resolve=>setImmediate(resolve));await surface.handleAction({action:'live-account-authenticate',id:account.id});assert.equal(requests[0].id,'github');assert.equal(requests[0].payload.accountId,'account');assert.equal(requests[0].payload.resourceUrl,undefined);}
 finally{surface.destroy();}
});

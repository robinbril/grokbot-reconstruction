import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountsController} from '../live-accounts-controller.js';
import {safeAuthorizationUrl,accountsListMarkup,accountDetailMarkup,accountFlowMarkup} from '../live-accounts-view.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};

test('OAuth start stays pending until a verified callback creates a backend account',async()=>{
 let verified=false;
 const account={id:'account-1',name:'Proof',resourceUrl:'https://example.test/mcp',status:'connected'};
 const controller=createAccountsController({client:{accounts:async()=>({accounts:verified?[account]:[]}),startAccountOAuth:async()=>({flowId:'flow-1',authorizationUrl:'https://example.test/authorize?state=public-state',expiresAt:Date.now()+1000}),accountFlow:async()=>({flowId:'flow-1',status:verified?'connected':'pending',...(verified?{accountId:account.id}:{})})}});
 await controller.start({name:'Proof',resourceUrl:account.resourceUrl});
 assert.equal(controller.flow('flow-1').status,'pending');assert.deepEqual(controller.state().accounts,[]);
 await controller.poll('flow-1');assert.deepEqual(controller.state().accounts,[]);
 verified=true;await controller.poll('flow-1');assert.equal(controller.account(account.id).status,'connected');
});
test('duplicate OAuth starts coalesce and a failed retry keeps its durable request ID',async()=>{
 const wait=deferred(),requests=[];let failed=true;
 const controller=createAccountsController({client:{accounts:async()=>({accounts:[]}),startAccountOAuth:async payload=>{requests.push(payload);if(failed){await wait.promise;throw new Error('Service unavailable');}return {flowId:'retry-flow',status:'pending'};}}});
 const payload={name:'Proof',resourceUrl:'https://example.test/mcp'},first=controller.start(payload),duplicate=controller.start(payload);
 assert.equal(first,duplicate);await Promise.resolve();assert.equal(requests.length,1);
 wait.resolve();await first;assert.equal(controller.state().error.message,'Service unavailable');
 failed=false;await controller.start(payload);assert.equal(requests[0].requestId,requests[1].requestId);
});
test('a stale account read cannot overwrite a later authoritative mutation',async()=>{
 const read=deferred();let reads=0;
 const updated={id:'account-1',name:'Updated',status:'connected'};
 const controller=createAccountsController({client:{accounts:()=>++reads===1?read.promise:Promise.resolve({accounts:[updated]}),renameAccount:async()=>({account:updated})}});
 const stale=controller.refresh();await controller.rename(updated.id,updated.name);read.resolve({accounts:[{...updated,name:'Stale'}]});await stale;
 assert.equal(controller.account(updated.id).name,'Updated');
});
test('OAuth cancellation supersedes an earlier pending status response',async()=>{
 const read=deferred();const controller=createAccountsController({client:{accounts:async()=>({accounts:[]}),startAccountOAuth:async()=>({flowId:'flow',status:'pending'}),accountFlow:()=>read.promise,cancelAccountFlow:async()=>({flowId:'flow',status:'cancelled'})}});
 await controller.start({resourceUrl:'https://example.test/mcp'});const stale=controller.poll('flow');await controller.cancel('flow');read.resolve({flowId:'flow',status:'pending'});await stale;
 assert.equal(controller.flow('flow').status,'cancelled');
});
test('failed reads retain known accounts and expose a recoverable error',async()=>{
 let failure=false;const account={id:'account-1',name:'Proof',status:'connected'};
 const controller=createAccountsController({client:{accounts:async()=>{if(failure)throw new Error('Offline');return {accounts:[account]};}}});
 await controller.refresh();failure=true;await controller.refresh();assert.deepEqual(controller.state().accounts,[account]);assert.equal(controller.state().error.message,'Offline');
 failure=false;await controller.refresh();assert.equal(controller.state().error,null);
});
test('authorization links reject script URLs and credential-bearing URLs',()=>{
 assert.equal(safeAuthorizationUrl('javascript:alert(1)'),null);assert.equal(safeAuthorizationUrl('https://user:pass@example.test/authorize'),null);assert.equal(safeAuthorizationUrl('http://example.test/authorize'),null);
 assert.equal(safeAuthorizationUrl('https://example.test/authorize?state=abc'),'https://example.test/authorize?state=abc');assert.equal(safeAuthorizationUrl('http://127.0.0.1:8888/authorize'),'http://127.0.0.1:8888/authorize');
});
test('accounts markup shows pending consent separately from connected accounts',()=>{
 const esc=value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;');
 const list=accountsListMarkup({esc,accounts:[],flows:[{flowId:'flow',status:'pending'}]});assert.match(list,/Wacht op toestemming/);assert.doesNotMatch(list,/role="status">Verbonden/);
 const flow=accountFlowMarkup({esc,flow:{flowId:'flow',status:'pending',authorizationUrl:'javascript:alert(1)'}});assert.doesNotMatch(flow,/href=/);
 const detail=accountDetailMarkup({esc,account:{id:'account',name:'Proof',status:'connected'}});assert.match(detail,/data-action="live-account-bind"[^>]*disabled/);
});

test('a rejected stale OAuth poll cannot replace a successful newer mutation with an error',async()=>{
 const stale=deferred(),account={id:'account',name:'Updated',status:'connected'};
 const controller=createAccountsController({client:{accounts:async()=>({accounts:[account]}),accountFlow:()=>stale.promise,renameAccount:async()=>({account})}});
 const poll=controller.poll('old-flow');await controller.rename(account.id,account.name);stale.reject(new Error('Old poll failed'));await poll;
 assert.equal(controller.state().error,null);assert.equal(controller.account(account.id).name,'Updated');
});

test('shared team accounts can bind but expose no owner-only account controls',()=>{
 const html=accountDetailMarkup({esc:value=>String(value),account:{id:'shared',name:'Team proof',resourceUrl:'https://example.test/mcp',status:'connected',shared:true},canBind:true});
 assert.match(html,/Gedeeld teamaccount/);assert.match(html,/data-action="live-account-bind"/);assert.doesNotMatch(html,/data-action="live-account-bind"[^>]*disabled/);
 for(const action of ['rename','default','disconnect','authenticate'])assert.doesNotMatch(html,new RegExp('data-action="live-account-'+action+'"'));
});
test('accounts requiring reauthentication show the true status and cannot bind',()=>{
 const html=accountDetailMarkup({esc:value=>String(value),account:{id:'own',name:'Expired proof',status:'authenticationRequired'},canBind:true});
 assert.match(html,/Opnieuw authenticeren vereist/);assert.match(html,/data-action="live-account-bind"[^>]*disabled/);assert.match(html,/data-action="live-account-authenticate"/);
});

test('a slow token exchange stays verifiable and finishes without offering a second consent link',async()=>{
 let complete=false;
 const controller=createAccountsController({client:{accounts:async()=>({accounts:complete?[{id:'account',status:'connected'}]:[]}),accountFlow:async()=>({flowId:'flow',status:complete?'connected':'exchanging',accountId:complete?'account':undefined,authorizationUrl:'https://example.test/authorize'})}});
 await controller.poll('flow');const flow=controller.flow('flow'),html=accountFlowMarkup({esc:String,flow});
 assert.match(html,/Authenticatie verifiëren/);assert.doesNotMatch(html,/href=/);
 complete=true;await controller.poll('flow');assert.equal(controller.account('account').status,'connected');
});

import {createLiveAccountsSurface} from '../live-accounts-surface.js';
test('the visible OAuth flow keeps polling through exchanging and stops when connected',async()=>{
 const originalInterval=globalThis.setInterval,originalClear=globalThis.clearInterval,originalDocument=globalThis.document;let tick,polls=0;
 globalThis.setInterval=callback=>{tick=callback;return 1;};globalThis.clearInterval=()=>{};globalThis.document={visibilityState:'visible'};
 const host={esc:String,overlay:{open:true,querySelector:()=>null},closePopover(){},showDialog(){},getDialogVersion:()=>1};
 const client={accounts:async()=>({accounts:[],pendingFlows:[]}),accountFlow:async()=>({flowId:'flow',status:++polls===1?'exchanging':'connected'})};
 const surface=createLiveAccountsSurface({host,client,isLive:()=>true,key:()=> 'bot'});
 try{
  await surface.handleAction({action:'live-accounts-open'});await new Promise(resolve=>setImmediate(resolve));
  // Establish the backend exchanging receipt before opening its visible flow.
  await surface.handleAction({action:'live-account-flow-refresh',id:'flow'});
  surface.handleAction({action:'live-account-flow-open',id:'flow'});await new Promise(resolve=>setImmediate(resolve));
  tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(polls,2);
  tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(polls,2);
 }finally{surface.destroy();globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;globalThis.document=originalDocument;}
});

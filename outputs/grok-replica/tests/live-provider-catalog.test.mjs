import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveConnectorsSurface} from '../live-connectors-surface.js';

const providers=[{id:'github',name:'GitHub',status:'ready'},{id:'notion',name:'Notion',status:'setupRequired',setup:{message:'Configureer Notion OAuth.',environmentVariables:['NOTION_CLIENT_ID']}}];
const accounts=[{id:'github-account',providerId:'github',name:'GitHub test account',status:'connected'},{id:'notion-account',providerId:'notion',name:'Notion test account',status:'authenticationRequired'}];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({live=true,providerList=providers}={}){
 let markup='',version=0,surface,pending;const calls=[],legacy=[],state={installed:['github'],authenticated:['github']};
 const root={querySelectorAll:()=>[],contains:()=>false,set outerHTML(value){markup=value;}};
 const overlay={open:false,querySelector:selector=>selector==='[data-live-accounts-root]'&&markup.includes('data-live-accounts-root')?root:null,querySelectorAll:()=>[]};
 const host={esc:String,overlay,closePopover(){},getDialogVersion:()=>version,getState:()=>state,showDialog(kind,title,content){surface.beforeDialogChange();version++;overlay.open=true;markup=content;},getConversation:()=>({name:'Test Bot'})};
 const client={accounts:async()=>({accounts,pendingFlows:[{flowId:'notion-pending',providerId:'notion',status:'pending'},{flowId:'github-pending',providerId:'github',status:'pending'}]}),accountProviders:async()=>({providers:providerList}),startProviderOAuth:async(id,payload)=>{calls.push(['start',id,payload]);return {flowId:'new-flow',providerId:id,status:'pending',authorizationUrl:'https://github.com/login/oauth/authorize'};},disconnectAccount:async id=>{calls.push(['disconnect',id]);return {accounts};},ensureBot:async()=>{calls.push(['bind']);return {bot:{id:'bot'}};},bindAccount:async()=>{},bindConversationBot:async()=>({})};
 surface=createLiveConnectorsSurface({host,client,isLive:()=>live,key:()=> 'test-bot',serverId:()=> 'conversation',snapshot:()=>({servers:[]}),refresh:async()=>{},sync(){}});
 const dispatch=event=>{const {action,id}=event.target.dataset;pending=surface.handleAction({action,id,target:event.target});if(!pending)legacy.push(action);};
 return {calls,legacy,state,html:()=>markup,async click(action,id){const button=new EventTarget();button.dataset={action,id};button.addEventListener('click',dispatch);button.dispatchEvent(new Event('click'));await pending;await settle();},destroy:()=>surface.destroy()};
}

test('live catalog and product chat provider clicks open real provider details without demo or OAuth mutations',async()=>{
 const previous=globalThis.document;globalThis.document={activeElement:null};
 try{for(const action of ['plugin-detail','plugin-add','plugin-auth','plugin-remove','product-chat-connector','product-connector-chat-toggle'])for(const provider of providers){
  const f=fixture();try{await f.click(action,provider.id);assert.deepEqual(f.legacy,[],`${action} must be intercepted`);assert.match(f.html(),new RegExp(`<h1>${provider.name}</h1>`));assert.match(f.html(),new RegExp(provider.id==='github'?'GitHub test account':'Notion test account'));assert.doesNotMatch(f.html(),new RegExp(provider.id==='github'?'Notion test account|notion-pending|NOTION_CLIENT_ID':'GitHub test account|github-pending'));assert.deepEqual(f.calls,[]);assert.deepEqual(f.state,{installed:['github'],authenticated:['github']});}finally{f.destroy();}
 }}finally{globalThis.document=previous;}
});

test('provider readiness, explicit account controls and general account navigation reuse real state',async()=>{
 const previous=globalThis.document;globalThis.document={activeElement:null};const f=fixture();
 try{
  await f.click('plugin-detail','notion');assert.match(f.html(),/Configureer Notion OAuth/);assert.match(f.html(),/NOTION_CLIENT_ID/);assert.match(f.html(),/data-action="live-account-provider-start" data-id="notion" disabled/);
  await f.click('live-account-open','notion-account');assert.match(f.html(),/Opnieuw authenticeren/);assert.match(f.html(),/data-action="live-account-provider-open" data-id="notion"/);
  await f.click('live-account-provider-open','github');await f.click('live-account-open','github-account');assert.match(f.html(),/Verbinding verbreken/);assert.match(f.html(),/Gebruiken voor deze Bot/);assert.deepEqual(f.calls,[]);
  await f.click('live-account-provider-open','github');await f.click('live-account-provider-start','github');assert.equal(f.calls[0][0],'start');assert.equal(f.calls[0][1],'github');assert.match(f.html(),/Doorgaan in browser/);assert.match(f.html(),/data-action="live-account-provider-open" data-id="github"/);
  await f.click('live-accounts-open');assert.match(f.html(),/<h1>Accounts beheren<\/h1>/);assert.match(f.html(),/GitHub test account/);assert.match(f.html(),/Notion test account/);
 }finally{f.destroy();globalThis.document=previous;}
});

test('missing provider configuration stays unavailable and demo mode still delegates',async()=>{
 const previous=globalThis.document;globalThis.document={activeElement:null};const f=fixture({providerList:[]}),demo=fixture({live:false});
 try{await f.click('plugin-detail','github');assert.match(f.html(),/Providerconfiguratie is niet beschikbaar/);assert.doesNotMatch(f.html(),/data-action="live-account-provider-start"/);await demo.click('plugin-add','github');assert.deepEqual(demo.legacy,['plugin-add']);assert.equal(demo.html(),'');}finally{f.destroy();demo.destroy();globalThis.document=previous;}
});

test('live provider catalog cards replace the seeded GitHub load failure with the catalog description',()=>{
 let live=false;const description={textContent:'Kan connector niet laden'};
 const row={dataset:{app:'github'},querySelector:()=>description};
 const host={esc:String,appData:[{id:'github',description:'Werk met GitHub repositories.'}],overlay:{open:true,querySelector:()=>null,querySelectorAll:()=>[row]}};
 const surface=createLiveConnectorsSurface({host,isLive:()=>live,key:()=> 'bot'});
 try{surface.afterDialogChange();assert.equal(description.textContent,'Kan connector niet laden');live=true;surface.afterDialogChange();assert.equal(description.textContent,'Werk met GitHub repositories.');}finally{surface.destroy();}
});

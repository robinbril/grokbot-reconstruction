import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectorSurface} from '../product-connectors.js';

test('repeated dialog augmentation adds exactly one permission and disclosure glyph per tool',async()=>{
 const oldDocument=globalThis.document,children=[],summaryChildren=[];
 const details={dataset:{},querySelector:selector=>selector==='summary strong'?{textContent:'Query docs'}:summary,append:node=>children.push(node),addEventListener(){}};
 const summary={append:node=>summaryChildren.push(node)};
 globalThis.document={createElement:()=>({dataset:{},style:{},innerHTML:''})};
 const host={overlay:{open:true,isConnected:false,querySelectorAll:()=>[details],getAttribute:()=> 'Context7'},getState:()=>({}),esc:value=>value,icon:()=>'',sourceMotion:{ready:Promise.resolve()}};
 const surface=createConnectorSurface(host);
 try{surface.afterDialogChange();surface.afterRender();surface.afterRender();assert.equal(children.length,1);assert.equal(summaryChildren.length,1);}finally{surface.destroy();globalThis.document=oldDocument;}
});

import {createConnectorController} from '../live-connectors-controller.js';
test('duplicate changes coalesce; late receipt is adopted only for its original conversation',async()=>{
 let selected='first',resolve;const calls=[],adoptions=[],promise=new Promise(done=>resolve=done);
 const controller=createConnectorController({key:()=>selected,serverId:id=>'server-'+id,client:{addMcp:(...args)=>{calls.push(args);return promise;}},adopt:(receipt,id)=>adoptions.push({receipt,id}),refresh:async()=>{}});
 const first=controller.add({id:'context',url:'https://mcp.context7.com/mcp'}),duplicate=controller.add({id:'context',url:'https://mcp.context7.com/mcp'});
 assert.equal(first,duplicate);await Promise.resolve();assert.equal(calls.length,1);selected='second';
 resolve({schema:1,servers:[],lastSeq:2});assert.equal(await first,true,'handled async actions must not fall through to demo mutation');assert.equal(adoptions[0].id,'first');assert.equal(controller.busy(),false);
});
test('failed policy keeps previous canonical state and retries the same durable request ID',async()=>{
 let attempt=0;const requests=[],adoptions=[];
 const controller=createConnectorController({key:()=> 'first',serverId:id=>id,client:{mcpPermissions:async(...args)=>{requests.push(args);if(++attempt===1)throw Object.assign(new Error('Policy locked'),{code:'MCP_CONFIG_LOCKED'});return {schema:1,servers:[]};}},adopt:value=>adoptions.push(value),refresh:async()=>{}});
 await controller.permissions('custom_math',['sum']);assert.equal(adoptions.length,0);assert.equal(controller.error().code,'MCP_CONFIG_LOCKED');
 await controller.permissions('custom_math',['sum']);assert.equal(requests[0][3],requests[1][3]);assert.equal(adoptions.length,1);assert.equal(controller.error(),undefined);
});

test('disposing the UI does not pretend to cancel an accepted connector mutation',async()=>{
 let resolve,changes=0;const adoptions=[],promise=new Promise(done=>resolve=done),calls=[];
 const controller=createConnectorController({key:()=> 'first',serverId:id=>id,client:{addMcp:(...args)=>{calls.push(args);return promise;}},adopt:value=>adoptions.push(value),refresh:async()=>{},onChange:()=>changes++});
 const pending=controller.add({id:'context7',name:'Context7',url:'https://mcp.context7.com/mcp'});await Promise.resolve();controller.destroy();
 resolve({schema:1,servers:[]});assert.equal(await pending,true);assert.equal(calls.length,1);assert.equal(adoptions.length,0);assert.equal(changes,1);
});

import {createLiveConnectorsSurface} from '../live-connectors-surface.js';
test('live marketplace labels seeded demo apps as local examples without changing demo mode',()=>{
 let live=false;const count={textContent:'10 verbonden'},button={children:[{},count],label:'10 verbonden',setAttribute(name,value){this.label=value;}};
 const host={esc:value=>value,getState:()=>({installed:Array(10).fill('demo')}),overlay:{open:true,querySelector:()=>button}};
 const surface=createLiveConnectorsSurface({host,isLive:()=>live,key:()=> 'first',snapshot:()=>({servers:[]})});
 surface.afterDialogChange();assert.equal(count.textContent,'10 verbonden');assert.equal(button.label,'10 verbonden');
 live=true;surface.afterDialogChange();assert.equal(count.textContent,'10 lokale voorbeelden');assert.equal(button.label,'10 lokale voorbeelden');surface.destroy();
});

test('live action dispatch safely delegates an unknown action and read-only account controls never mutate legacy connectors',()=>{
 const calls=[];const server={id:'account_proof',name:'OAuth math',state:'connected',tools:[{name:'sum'}],configuration:{enabled:true,disabledTools:[],readOnly:true}};
 const surface=createLiveConnectorsSurface({host:{esc:String},client:{mcpState:()=>calls.push('state'),mcpPermissions:()=>calls.push('permissions')},isLive:()=>true,key:()=> 'proof',snapshot:()=>({servers:[server]})});
 assert.equal(surface.handleAction({action:'unknown',target:{dataset:{}}}),false);
 const markup=surface.serverMarkup(server);assert.match(markup,/data-live-connector-state="account_proof"[^>]*disabled/);assert.match(markup,/data-live-connector-tool="sum"[^>]*disabled/);
 surface.handleChange({target:{dataset:{liveConnectorState:'account_proof'},checked:false}});
 surface.handleChange({target:{dataset:{liveConnectorTool:'sum',serverId:'account_proof'},checked:false}});
 assert.deepEqual(calls,[]);surface.destroy();
});

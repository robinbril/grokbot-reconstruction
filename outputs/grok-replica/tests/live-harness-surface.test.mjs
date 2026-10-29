// Controller regressions only. Transport/DOM doubles do not prove provider execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLiveHarnessSurface} from '../live-harness-surface.js';
import {hasLiveHarnessOwnership,liveHistoryResetMessage,projectLiveMessages} from '../live-harness-model.js';

const conversationId='conversation-a',serverId='owned-server-a';
const response=value=>({ok:true,json:async()=>structuredClone(value)});
const status={schema:1,csrfToken:'controller-test-only',runtime:{state:'available'}};
const snapshot=(lastSeq,extra={})=>({schema:1,conversationId:serverId,entries:[],runs:[],tools:[],terminalSessions:[],browserSessions:[],lastSeq,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function deadline(promise,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),1500);})]);}finally{clearTimeout(timer);}}

function environment(t,initial,{fetchImpl=async()=>response(status)}={}){
 const saved=new Map(['window','document','MutationObserver','fetch','EventSource','setInterval','clearInterval'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const streams=[],intervals=[],errors=[],consumed=[],input={value:'Original exact draft'},renders=[];
 let state=structuredClone(initial),surface;
 globalThis.window=new EventTarget();
 globalThis.document={querySelector:()=>null,head:{append(){}},createElement:()=>({dataset:{},remove(){}}),body:{append(){}},documentElement:{dataset:{theme:'light'}}};
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 globalThis.fetch=fetchImpl;
 globalThis.setInterval=(callback,delay)=>{const interval={callback,delay,cleared:false};intervals.push(interval);return interval;};
 globalThis.clearInterval=interval=>{interval.cleared=true;};
 globalThis.EventSource=class{constructor(url,options){this.url=url;this.options=options;this.closed=false;streams.push(this);}close(){this.closed=true;}};
 const host={overlay:Object.assign(new EventTarget(),{open:false,querySelector:()=>null,querySelectorAll:()=>[]}),getState:()=>state,getConversationKey:()=>conversationId,app:Object.assign(new EventTarget(),{querySelector:selector=>selector==='#message-input'?input:null,querySelectorAll:()=>[],contains:()=>false}),esc:String,persist:()=>true,
  showChatError:error=>errors.push(error),closePopover(){},render:options=>renders.push(options),draftAttachments:()=>[],ensureConversation:()=>({id:conversationId}),
  commit:update=>{state=update(state);return {ok:true};},consumeLiveDraft:draft=>{consumed.push(structuredClone(draft));delete state.liveHarness.pendingSends[conversationId];}};
 surface=createLiveHarnessSurface(host);
 t.after(()=>{try{surface.destroy();assert.ok(streams.every(stream=>stream.closed),'destroy closes every EventSource');assert.ok(intervals.every(interval=>interval.cleared),'destroy clears polling');}finally{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}});
 return {surface,host,input,streams,errors,consumed,renders,poll(){for(const interval of intervals)if(!interval.cleared)interval.callback();},get state(){return state;}};
}

function stateWith(preferences={},messages=[]){return {messages:{[conversationId]:messages},replyDrafts:{},composerSkillReferences:{},liveHarness:{modes:{[conversationId]:'demo'},serverIds:{},pendingSends:{},...preferences}};}

const ownershipCases=[
 ['persisted server attachment with no model history (terminal/browser only)',{serverIds:{[conversationId]:serverId}},[]],
 ['persisted pending send with no loaded snapshot',{pendingSends:{[conversationId]:{payload:{requestId:'unconfirmed-request',text:'Retain me'}}}},[]],
 ['live-owned message with no loaded snapshot',{},[{id:'owned-user',role:'user',productKind:'live-harness',text:'Already accepted'}]],
];
for(const [description,preferences,messages] of ownershipCases){
 for(const action of ['reset-demo','clear-chat'])test(`${action} blocks ${description} after switching to demo and reloading`,t=>{
  const initial=stateWith(preferences,messages),e=environment(t,initial),before=structuredClone(e.state);
  assert.equal(e.surface.diagnostics().conversations,0,'fresh controller has no in-memory history');
  assert.equal(e.surface.isLive(),false,'persisted selection is demo');
  assert.equal(e.surface.handleAction({action}),true,'controller must intercept destructive local fallback');
  assert.equal(e.errors.length,1,'user receives an explicit ownership warning');
  assert.deepEqual(e.state,before,'guard retains durable ownership and pending intent');
 });
}

test('global reset protects an attachment belonging to another conversation',t=>{
 const e=environment(t,stateWith({serverIds:{'conversation-b':'owned-server-b'}}));
 assert.equal(e.surface.handleAction({action:'reset-demo'}),true);
 assert.equal(e.errors.length,1);
 assert.equal(e.state.liveHarness.serverIds['conversation-b'],'owned-server-b');
});

test('clear remains available for a demo conversation when only another conversation is attached',t=>{
 const e=environment(t,stateWith({serverIds:{'conversation-b':'owned-server-b'}}));
 assert.equal(e.surface.handleAction({action:'clear-chat'}),false);
 assert.equal(e.errors.length,0);
});

test('ordinary demo reset and clear still reach the local controller',t=>{
 const e=environment(t,stateWith({},[{id:'local-message',role:'bot',text:'Local example'}]));
 assert.equal(e.surface.handleAction({action:'reset-demo'}),false);
 assert.equal(e.surface.handleAction({action:'clear-chat'}),false);
 assert.equal(e.errors.length,0);
});

test('accepted send obtains a fresh canonical snapshot after an older GET settles, with Computer closed',async t=>{
 const oldGet=deferred(),accepted=deferred(),consumedAcceptance=deferred(),calls=[];
 let snapshotGets=0,requestPayload;
 const quote={title:'Exact quote',text:'Quoted context'},skill={id:'skill-a',name:'Explicit skill'};
 const original=stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}});
 original.replyDrafts[conversationId]=quote;
 original.composerSkillReferences[conversationId]=[skill];
 const canonical=snapshot(3,{entries:[
  {id:'input-entry',role:'user',runId:'accepted-run',text:'Original exact draft',revision:1,status:'completed',createdAt:1},
  {id:'output-entry',role:'assistant',runId:'accepted-run',text:'Canonical partial output',revision:1,status:'running',createdAt:2}],
  runs:[{id:'accepted-run',requestId:'replaced-at-transport',status:'running',inputEntryId:'input-entry',outputEntryId:'output-entry',approvals:[]}]});
 const e=environment(t,original,{fetchImpl:async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method});
  if(url.endsWith('/status'))return response(status);
  if(url.endsWith('/connect'))return response(snapshot(1));
  if(url.endsWith('/runs')){requestPayload=JSON.parse(options.body);canonical.runs[0].requestId=requestPayload.requestId;accepted.resolve();return response({schema:1,accepted:true,conversationId:serverId,runId:'accepted-run',inputEntryId:'input-entry',outputEntryId:'output-entry'});}
  if(url.endsWith('/conversations/'+serverId)){snapshotGets++;return snapshotGets===1?oldGet.promise:response(canonical);}
  throw new Error('Unexpected controller transport: '+method+' '+url);
 }});
 const consume=e.host.consumeLiveDraft;e.host.consumeLiveDraft=draft=>{consume(draft);consumedAcceptance.resolve();};
 e.surface.afterRender(); // Starts initialization before connect/acceptance.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(snapshotGets,1);
 const sending=e.surface.handleAction({action:'send-message'});
 await deadline(accepted.promise,'run POST did not reach durable acceptance');
 await deadline(consumedAcceptance.promise,'accepted acknowledgement was not processed');
 assert.equal(snapshotGets,1,'pre-acceptance GET is still outstanding');
 assert.equal(e.consumed.length,1,'accepted acknowledgement was processed before the older GET returns');
 oldGet.resolve(response(snapshot(0))); // Release stale history only after POST accepted.
 assert.equal(await deadline(sending,'accepted send did not finish canonical recovery'),true);
 assert.equal(snapshotGets,2,'acceptance requires its own new GET, not the older in-flight request');
 assert.equal(calls.filter(call=>call.method==='POST'&&call.url.endsWith('/runs')).length,1,'recovery never resubmits the prompt');
 assert.equal(e.consumed.length,1,'accepted exact draft is consumed once');
 assert.deepEqual(e.consumed[0],{requestId:requestPayload.requestId,conversationId,text:'Original exact draft',quote,attachments:[],skillReferences:[skill]});
 assert.deepEqual(requestPayload,{requestId:e.consumed[0].requestId,text:'Original exact draft',quote:'Exact quote\nQuoted context',skillReferences:[JSON.stringify(skill,null,2)]});
 assert.deepEqual(e.state.liveHarness.pendingSends,{});
 assert.deepEqual(e.state.messages[conversationId].map(message=>[message.id,message.text]),[['input-entry','Original exact draft'],['output-entry','Canonical partial output']]);
 assert.equal(e.state.messages[conversationId][1].liveHarness.status,'running','canonical partial output is never labelled as completion');
 assert.equal(e.surface.diagnostics().streams,1,'known active run establishes SSE without Computer');
 assert.equal(e.streams.length,1);
 assert.equal(e.streams[0].url,'/api/harness/runs/accepted-run/events?after=3');
 assert.deepEqual(e.streams[0].options,{withCredentials:true});
 assert.equal(e.errors.length,0);
});

for(const switchConversation of [false,true])test(`failed post-acceptance history fetch remains recoverable without Computer or a known active run, ${switchConversation?'after selecting another demo conversation':'including demo mode'}`,async t=>{
 const recovered=deferred();let gets=0,starts=0,requestId;
 const initial=stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}});
 const e=environment(t,initial,{fetchImpl:async(url,options={})=>{
  if(url.endsWith('/status'))return response(status);
  if(url.endsWith('/connect'))return response(snapshot(1));
  if(url.endsWith('/runs')){starts++;requestId=JSON.parse(options.body).requestId;return response({schema:1,accepted:true,runId:'recovering-run',lastSeq:2});}
  if(url.endsWith('/conversations/'+serverId)){
   gets++;
   if(gets===1)return {ok:false,status:503,json:async()=>({error:{code:'TEMPORARY_HISTORY_FAILURE',message:'History temporarily unavailable',retryable:true}})};
   recovered.resolve();return response(snapshot(3,{runs:[{id:'recovering-run',requestId,status:'running',approvals:[]}],entries:[{id:'recovered-input',role:'user',runId:'recovering-run',text:'Original exact draft',revision:1,status:'completed'}]}));
  }
  throw new Error('Unexpected recovery transport: '+url);
 }});
 assert.equal(await e.surface.handleAction({action:'send-message'}),true);
 assert.equal(gets,1);
 assert.equal(e.surface.diagnostics().streams,0,'failed history fetch has not invented a known run');
 assert.equal(e.consumed.length,1,'durable acceptance consumes the submitted draft');
 assert.deepEqual(e.state.liveHarness.pendingSends,{});
 e.state.liveHarness.modes[conversationId]='demo';
 if(switchConversation){e.state.messages['other-demo']=[];e.state.liveHarness.modes['other-demo']='demo';e.host.getConversationKey=()=> 'other-demo';}
 e.poll(); // Invoke the actual controller timer callback, without a real clock delay.
 await deadline(recovered.promise,'accepted run recovery was skipped with Computer closed and demo selected');
 await new Promise(setImmediate);
 assert.equal(gets,2);
 assert.equal(starts,1,'history recovery does not replay an accepted model request');
 assert.equal(e.consumed.length,1,'recovery does not consume the draft twice');
 assert.equal(e.state.messages[conversationId][0].id,'recovered-input');
 assert.equal(e.surface.diagnostics().streams,1);
 assert.equal(e.streams[0].url,'/api/harness/runs/recovering-run/events?after=3');
});

test('ownership helper distinguishes global reset protection from scoped demo clearing',()=>{
 for(const [,preferences,messages] of ownershipCases){const state=stateWith(preferences,messages);assert.equal(hasLiveHarnessOwnership(state),true);assert.equal(hasLiveHarnessOwnership(state,conversationId),true);assert.equal(hasLiveHarnessOwnership(state,'other-demo'),false);}
 assert.equal(hasLiveHarnessOwnership(stateWith()),false);
 assert.equal(hasLiveHarnessOwnership(stateWith({modes:{[conversationId]:'live'}})),true);
 assert.ok(liveHistoryResetMessage.includes('geblokkeerd'));
});

for(const attached of [false,true])test(`actual query reset boot statement ${attached?'preserves persisted ownership and flags a warning':'removes unattached demo state'}`,()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const bootReset=source.split('\n').find(line=>line.startsWith("if(new URLSearchParams(location.search).get('reset')==='1')"));
 assert.ok(bootReset,'execute the actual application reset boundary');
 const initial=stateWith(attached?{serverIds:{[conversationId]:serverId}}:{}),storageKey='grok-local-replica-v1',storage=new Map([[storageKey,JSON.stringify(initial)]]);
 const context={URLSearchParams,location:{search:'?reset=1'},storageKey,hasLiveHarnessOwnership,liveResetBlocked:false,localStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)}};
 vm.runInNewContext(bootReset,context,{timeout:100});
 assert.equal(storage.has(storageKey),attached);
 assert.equal(context.liveResetBlocked,attached);
 if(attached)assert.deepEqual(JSON.parse(storage.get(storageKey)),initial);
});

test('explicit connect and tools refresh reopen a previously connected conversation after disconnected snapshots without consuming its draft or history',async t=>{
 const calls=[],toolsView={dataset:{},innerHTML:''};let serverConnected=false,connects=0,sequence=0;
 const entries=[
  {id:'persisted-input',role:'user',runId:'prior-run',text:'Persisted user history',revision:1,status:'completed',createdAt:1},
  {id:'persisted-output',role:'assistant',runId:'prior-run',text:'Persisted assistant history',revision:2,status:'completed',createdAt:2}];
 const servers=()=>[{id:'grok_workspace',name:'grok_workspace',state:serverConnected?'connected':'disconnected',tools:[{name:'workspace_list',description:'Controller transport catalog',inputSchema:{type:'object'}}]}];
 const history=()=>snapshot(sequence,{entries,runs:[{id:'prior-run',requestId:'prior-request',status:'completed',approvals:[]}],servers:servers()});
 const initial=stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId},pendingSends:{[conversationId]:{payload:{requestId:'retained-intent',text:'Retained pending draft'}}}},[{id:'local-history',role:'bot',text:'Existing local history'}]);
 initial.drafts={[conversationId]:'Unsent draft survives reconnect'};
 initial.replyDrafts[conversationId]={title:'Retained quote',text:'Quoted draft context'};
 initial.composerSkillReferences[conversationId]=[{id:'retained-skill',name:'Draft skill'}];
 const e=environment(t,initial,{fetchImpl:async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method});
  if(url.endsWith('/status'))return response(status);
  if(url.endsWith('/connect')){assert.equal(method,'POST');connects++;serverConnected=true;sequence++;return response(history());}
  if(url.endsWith('/tools'))return response({schema:1,servers:servers()});
  if(url.endsWith('/conversations/'+serverId))return response(history());
  throw new Error('Unexpected reconnect transport: '+method+' '+url);
 }});
 const query=e.host.app.querySelector;e.host.app.querySelector=selector=>selector==='.live-computer'?{querySelectorAll:()=>[],querySelector:child=>child==='[data-live-tools]'?toolsView:null}:query(selector);
 e.input.value=initial.drafts[conversationId];
 assert.equal(await e.surface.handleAction({action:'live-connect'}),true);assert.equal(connects,1);
 assert.match(toolsView.innerHTML,/connected/);assert.doesNotMatch(toolsView.innerHTML,/disconnected/);
 const historyBefore=structuredClone(e.state.messages[conversationId]),draftBefore=structuredClone({drafts:e.state.drafts,replies:e.state.replyDrafts,skills:e.state.composerSkillReferences,pending:e.state.liveHarness.pendingSends});
 for(const action of ['live-connect','live-tools-refresh']){
  serverConnected=false;sequence++; // The same open controller observes a restarted backend.
  e.poll();await new Promise(setImmediate);
  assert.match(toolsView.innerHTML,/disconnected/,'canonical polling truthfully shows the lost process');
  const beforeExplicitConnect=connects;
  assert.equal(await e.surface.handleAction({action}),true);
  assert.equal(connects,beforeExplicitConnect+1,action+' must POST again despite its previous in-memory connection cache');
  assert.match(toolsView.innerHTML,/connected/);assert.doesNotMatch(toolsView.innerHTML,/disconnected/,'fresh inventory follows '+action);
 }
 assert.equal(calls.filter(call=>call.method==='POST'&&call.url.endsWith('/runs')).length,0,'reconnecting never submits a model turn');
 assert.equal(e.streams.length,0,'reconnecting completed history never invents an active run stream');
 assert.equal(e.consumed.length,0,'reconnecting never consumes the unsent draft');
 assert.equal(e.input.value,initial.drafts[conversationId]);
 assert.deepEqual({drafts:e.state.drafts,replies:e.state.replyDrafts,skills:e.state.composerSkillReferences,pending:e.state.liveHarness.pendingSends},draftBefore);
 assert.deepEqual(e.state.messages[conversationId],historyBefore,'canonical and local history retain the same entries');
 assert.match(toolsView.innerHTML,/connected/);assert.doesNotMatch(toolsView.innerHTML,/disconnected/,'fresh inventory follows the successful reconnect');
 assert.equal(e.errors.length,0);
});

for(const accepted of [false,undefined])test('failed send '+(accepted===false?'releases only explicitly rejected intent for correction':'keeps uncertain intent to prevent duplicate delivery'),async t=>{
 const original=stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}});
 const e=environment(t,original,{fetchImpl:async url=>{
  if(url.endsWith('/status'))return response(status);
  if(url.endsWith('/runs'))return {ok:false,status:422,json:async()=>({error:{code:'ATTACHMENT_MODEL_UNSUPPORTED',message:'Synthetic rejection',retryable:false,...(accepted===false?{accepted:false}:{})}})};
  return response(snapshot(0));
 }});
 e.input.value='Retained exact draft';
 await e.surface.handleAction({action:'send-message'});
 assert.equal(e.input.value,'Retained exact draft');assert.equal(e.consumed.length,0);
 assert.equal(Boolean(e.state.liveHarness.pendingSends[conversationId]),accepted!==false);
});

for(const text of ['', 'Already visible partial'])test(`reloaded ${text?'partial':'empty'} assistant keeps a stable status target until canonical history restores Stoppen`,async t=>{
 const firstHistory=deferred(),calls=[];let gets=0;
 let canonical=snapshot(2,{runs:[{id:'reload-run',status:'running',approvals:[]}],entries:[
  {id:'reload-output',role:'assistant',runId:'reload-run',text,revision:1,status:'running',createdAt:2}]});
 const message=projectLiveMessages(canonical)[0];
 const e=environment(t,stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}},[message]),{fetchImpl:async(url,options={})=>{
  if(url.endsWith('/status'))return response(status);
  if(url.endsWith('/cancel')){calls.push(JSON.parse(options.body));canonical={...canonical,lastSeq:3,runs:[{...canonical.runs[0],status:'cancelled'}]};return response({accepted:true});}
  if(url.endsWith('/conversations/'+serverId))return gets++===0?firstHistory.promise:response(canonical);
  throw new Error('Unexpected reload transport: '+url);
 }});
 const markup=e.surface.renderSlot('chatEntryStatus',{message});
 assert.match(markup,/<section[^>]*data-live-run="reload-run"[^>]* hidden>/,'render owns a status target before any authoritative run is loaded');
 assert.match(markup,/<button[^>]* hidden>Stoppen<\/button>/,'persisted browser state cannot authorize a stop control');
 assert.doesNotMatch(markup,/Bezig/,'cached run state does not masquerade as current server state');
 const runLabel={textContent:''},stop={hidden:true},statusNode={hidden:true,dataset:{liveRun:'reload-run'},querySelector:selector=>selector==='button'?stop:runLabel};
 e.host.app.querySelectorAll=selector=>selector==='[data-live-run]'?[statusNode]:[];
 e.surface.afterRender();
 firstHistory.resolve(response(canonical));await new Promise(setImmediate);
 assert.equal(e.renders.length,0,'the same persisted entry ID reconciles in place without replacing the transcript');
 assert.equal(statusNode.hidden,false);assert.equal(runLabel.textContent,'Bezig');assert.equal(stop.hidden,false);
 assert.equal(e.state.messages[conversationId][0].id,message.id);assert.equal(e.state.messages[conversationId][0].text,text);
 // The next GET reflects the server's cancellation acknowledgement, with the same entry.
 const history=e.host.getState().messages[conversationId][0];
 assert.equal(await e.surface.handleAction({action:'live-stop',id:'reload-run',target:stop}),true);
 assert.equal(calls.length,1,'restored control dispatches exactly one real cancel request');
 assert.equal(e.state.messages[conversationId][0].id,history.id);assert.equal(stop.hidden,true);assert.equal(runLabel.textContent,'Gestopt');
});

for(const [kind,fields,expected] of [
 ['press',{selector:'#query',key:'Shift+Enter'},{selector:'#query',key:'Shift+Enter'}],
 ['scroll',{selector:'#viewport',direction:'down',pixels:'375'},{selector:'#viewport',direction:'down',pixels:375}],
 ['select',{selector:'#choice',value:'cobalt'},{selector:'#choice',value:'cobalt'}],
])test(`browser ${kind} sends exact arguments and persists only browser drafts`,async t=>{
 const calls=[],e=environment(t,stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}}),{fetchImpl:async(url,options={})=>{
  if(url.endsWith('/status'))return response(status);
  if(url.endsWith('/connect'))return response(snapshot(1));
  if(url.endsWith('/browser')){calls.push(JSON.parse(options.body));return response({accepted:true});}
  if(url.endsWith('/conversations/'+serverId))return response(snapshot(2));
  throw new Error('Unexpected browser transport '+url);
 }});
 for(const [field,value] of Object.entries(fields))e.surface.handleInput({target:{dataset:{liveInput:field},value}});
 e.surface.handleInput({target:{dataset:{liveInput:'mcpEnv'},value:'DO_NOT_PERSIST'}});
 await e.surface.handleAction({action:'live-browser-'+kind});
 assert.equal(calls.length,1);assert.equal(calls[0].action,'browser_'+kind);assert.deepEqual(calls[0].arguments,expected);
 assert.deepEqual(e.state.liveHarness.browserDrafts[conversationId],fields);
});

test('invalid browser scroll pixels retains draft and does not connect or dispatch',async t=>{
 const calls=[],e=environment(t,stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}}),{fetchImpl:async(url)=>{calls.push(url);return response(status);}});
 e.surface.handleInput({target:{dataset:{liveInput:'pixels'},value:'2.5'}});
 await e.surface.handleAction({action:'live-browser-scroll'});
 assert.deepEqual(calls.filter(url=>!url.endsWith('/status')),[]);
 assert.equal(e.state.liveHarness.browserDrafts[conversationId].pixels,'2.5');
 assert.match(e.surface.renderSlot('liveSendError'),/geheel getal/);
});

test('outgoing delivery markup uses owned download URL and inert exact reply context',async()=>{
 const {liveDeliveryAttachmentMarkup,liveDeliveryReplyMarkup}=await import('../live-message-deliveries.js');
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const html=liveDeliveryAttachmentMarkup({attachmentId:'owned-file',name:'report.csv',alt:'<img src=x onerror=bad()>',url:'https://evil.example/private'},'conversation/a',esc);
 assert.match(html,/href="\/api\/harness\/conversations\/conversation%2Fa\/attachments\/owned-file\/download"/);
 assert.match(html,/download="report.csv"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|evil\.example/);
 assert.equal(liveDeliveryAttachmentMarkup({url:'https://evil.example'},'a',esc),'');
 const reply=liveDeliveryReplyMarkup({messageId:'target',entryId:'outer',role:'user',text:'Exact <quoted> text'},esc);
 assert.match(reply,/data-action="live-reply-jump"/);assert.match(reply,/data-reply-message-id="target"/);assert.match(reply,/Exact &lt;quoted&gt; text/);
});

test('live reply jump delegates the exact typed target without changing focus or the current draft',t=>{
 const e=environment(t,stateWith()),calls=[],inner={dataset:{liveMessageId:'target'},scrollIntoView:()=>calls.push('scroll'),focus:()=>calls.push('focus'),hasAttribute:()=>false,setAttribute:()=>{}};
 e.host.app.querySelectorAll=selector=>selector==='[data-live-message-id]'?[inner]:[];
 e.host.transcriptReader={navigateToTarget:resolve=>{assert.equal(resolve(),inner);calls.push('navigate');return 'navigation-1';}};
 assert.equal(e.surface.handleAction({action:'live-reply-jump',target:{dataset:{replyMessageId:'target',replyEntryId:'outer'}}}),true);
 assert.deepEqual(calls,['navigate']);assert.equal(e.input.value,'Original exact draft');
});

test('canonical typed messages and reply identities survive snapshot projection and JSON reload',()=>{
 const deliveries=[{id:'sent-file',callId:'call-file',type:'attachment',attachment:{attachmentId:'file-a',name:'report.csv',type:'text/csv',size:10,sha256:'ab'.repeat(32),alt:'Exact caption'},replyTo:{messageId:'input',entryId:'input',role:'user',text:'Original'},createdAt:2},{id:'sent-text',callId:'call-text',type:'text',content:'**Exact text**',createdAt:3}];
 const canonical=snapshot(4,{entries:[{id:'output',role:'assistant',text:'**Exact text**',revision:3,messages:deliveries,messageDrafts:[{callId:'call-text',text:'**Exact text**',status:'delivered'}]}]});
 const projected=projectLiveMessages(JSON.parse(JSON.stringify(canonical)))[0];
 assert.deepEqual(projected.liveHarness.messages,deliveries);assert.deepEqual(projected.liveHarness.messageDrafts,canonical.entries[0].messageDrafts);assert.equal(projected.text,'**Exact text**');assert.deepEqual(projected.attachments,[]);
 const attachmentOnly=projectLiveMessages(snapshot(2,{entries:[{id:'file-only',role:'assistant',text:'',messages:[deliveries[0]]}]}))[0];
 assert.equal(attachmentOnly.text,'');assert.deepEqual(attachmentOnly.liveHarness.messages,[deliveries[0]]);
});

test('typed delivery confirmation preserves streamed content and inserts attachment before pending next message',async t=>{
 const {createLiveMessageDeliveries}=await import('../live-message-deliveries.js'),saved=globalThis.document;
 class Node{constructor(){this.children=[];this.dataset={};this.innerHTML='';this.attributes={};}setAttribute(name,value){this.attributes[name]=value;}getAttribute(name){return this.attributes[name];}addEventListener(){}append(...nodes){for(const node of nodes)this.insertBefore(node,null);}insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parentNode=this;}remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}}
 globalThis.document={createElement:()=>new Node()};t.after(()=>{globalThis.document=saved;});
 const createContentView=()=>{const element=new Node(),frame=new Node();element.append(frame);return {element,update({entry}){frame.text=entry.text;},destroy(){element.remove();}};};
 const view=createLiveMessageDeliveries({entryId:'outer',createContentView}),entry={revision:1,text:'A'},context={work:{isStreaming:true}},update=(text,deliveries)=>view.update({entry:{...entry,text,revision:entry.revision++},context,deliveries,drafts:text.split('\n\n').map((content,index)=>({callId:index?'b-call':'a-call',text:content,status:deliveries.some(row=>row.callId===(index?'b-call':'a-call'))?'delivered':'streaming'})),conversationId:'c',esc:String});
 update('A',[]);const streamed=view.element.children[0].children[1],frame=streamed.children[0];
 update('A',[{id:'a',callId:'a-call',type:'text',content:'A'}]);assert.equal(view.element.children[0].children[1],streamed);assert.equal(streamed.children[0],frame);
 update('A\n\nB',[{id:'a',callId:'a-call',type:'text',content:'A'}]);const pending=view.element.children.at(-1).children[1];
 update('A\n\nB',[{id:'a',callId:'a-call',type:'text',content:'A'},{id:'x',type:'attachment',attachment:{attachmentId:'file',name:'x'}}]);
 assert.deepEqual(view.element.children.map(node=>node.dataset.liveMessageId||'pending'),['a','x','pending']);
 update('A\n\nB',[{id:'a',callId:'a-call',type:'text',content:'A'},{id:'x',type:'attachment',attachment:{attachmentId:'file',name:'x'}},{id:'b',callId:'b-call',type:'text',content:'B'}]);
 assert.deepEqual(view.element.children.map(node=>node.dataset.liveMessageId),['a','x','b']);assert.equal(view.element.children[2].children[1],pending);view.destroy();
});

test('delivery refresh preserves the foreign unread separator before its exact source',async t=>{
 const {createLiveMessageDeliveries}=await import('../live-message-deliveries.js'),saved=globalThis.document;
 class Node{
  constructor(){this.children=[];this.dataset={};this.attributes={};}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(){}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();this.children.splice(before?this.children.indexOf(before):this.children.length,0,node);node.parentNode=this;}
  remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
 }
 globalThis.document={createElement:()=>new Node()};t.after(()=>{globalThis.document=saved;});
 const view=createLiveMessageDeliveries({entryId:'outer',createContentView:()=>({element:new Node(),update(){},destroy(){}})});
 const a={id:'a',callId:'call-a',type:'text',content:'First'},b={id:'b',callId:'call-b',type:'text',content:'Second'};
 const update=deliveries=>view.update({entry:{text:'',revision:1},context:{work:{isStable:true}},deliveries,esc:String});
 update([a,b]);const [first,second]=view.element.children,marker=new Node();marker.dataset.unreadDivider='';view.element.insertBefore(marker,first);
 for(let poll=0;poll<5;poll++)update([a,b]);
 assert.deepEqual(view.element.children,[marker,first,second],'status polls must not move deliveries ahead of the unread boundary');
 update([a,b,{id:'c',type:'text',content:'Third'}]);
 assert.equal(view.element.children[0],marker);assert.equal(view.element.children[1],first);assert.equal(view.element.children[2],second);
 view.destroy();
});

test('unchanged outgoing polls preserve file controls despite browser HTML serialization',async t=>{
 const {createLiveMessageDeliveries}=await import('../live-message-deliveries.js'),saved=globalThis.document;
 class Node{
  constructor(){this.children=[];this.dataset={};this.writes=0;this.html='';this.attributes={};}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name];}
  // Browsers expand the self-closing SVG path emitted by iconSvg on readback.
  set innerHTML(value){this.writes++;this.html=value.replace(/<path([^>]*?)\/>/g,'<path$1></path>');this.children=value?[{identity:Symbol('rendered descendant')}]:[];}
  get innerHTML(){return this.html;}
  addEventListener(){}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parentNode=this;}
  remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
 }
 globalThis.document={createElement:()=>new Node()};t.after(()=>{globalThis.document=saved;});
 const createContentView=()=>({element:new Node(),update(){},destroy(){}}),icon=()=>'<svg><path d="M0 0L1 1"/></svg>';
 const view=createLiveMessageDeliveries({entryId:'outer',createContentView,icon});
 const update=(name='proof.txt',conversationId='owned')=>view.update({entry:{text:'',revision:1},context:{work:{isStable:true}},theme:'light',conversationId,esc:String,deliveries:[{id:'delivery',callId:'call',type:'attachment',attachment:{attachmentId:'file',name,size:13}}]});
 update();const row=view.element.children[0],file=row.children[2],button=file.children[0];
 assert.equal(row.getAttribute('role'),'group');assert.equal(row.getAttribute('aria-label'),'Botbericht 1');assert.equal(row.tabIndex,0);
 assert.match(file.innerHTML,/<path d="M0 0L1 1"><\/path>/,'readback differs from generated source just as in the browser');
 for(let poll=0;poll<5;poll++)update();
 assert.equal(view.element.children[0],row,'unchanged polling preserves the delivery row');
 assert.equal(file.children[0],button,'unchanged polling preserves actual attachment descendants');
 assert.equal(file.writes,1,'unchanged generated markup is assigned exactly once');
 update('renamed.txt');assert.equal(file.writes,2,'real metadata changes update the card');assert.match(file.innerHTML,/renamed\.txt/);
 update('renamed.txt','another-owned');assert.equal(file.writes,3,'the canonical conversation URL remains part of the update');assert.match(file.innerHTML,/conversations\/another-owned\/attachments\/file/);
 view.destroy();
});

// host.app is a DOM EventTarget. Preserve the real dispatch/listener contract
// in controller doubles instead of swallowing production publication errors.
test('MCP inventory publishes bubbling readonly changes and cached polls do not flicker loading',async t=>{
 const deferredRead=deferred(),requests=[],events=[],server={id:'custom_actual',name:'Actual MCP',state:'disabled',configuration:{transport:'stdio'}};
 let read=0;
 const e=environment(t,stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}}),{fetchImpl:async(url,options={})=>{requests.push(options.method||'GET');if(url.endsWith('/status'))return response(status);if(url.endsWith('/conversations/'+serverId)){read++;return read===1?deferredRead.promise:response(snapshot(0,{servers:[server]}));}throw new Error('Unexpected inventory request');}});
 e.host.app.addEventListener('grok-mcp-references-changed',event=>events.push({bubbles:event.bubbles,conversationKey:event.detail.conversationKey,inventory:e.surface.mcpReferenceInventory()}));
 const first=e.surface.refreshMcpReferences();assert.equal(e.surface.mcpReferenceInventory().loading,true);
 deferredRead.resolve(response(snapshot(0,{servers:[server]})));await first;
 assert.equal(events.length,2);assert.ok(events.every(event=>event.bubbles&&event.conversationKey===conversationId));assert.equal(events[0].inventory.loading,true);assert.equal(events[1].inventory.loading,false);assert.deepEqual(events[1].inventory.servers,[server]);
 const detached=e.surface.mcpReferenceInventory();detached.servers[0].name='Changed outside';assert.equal(e.surface.mcpReferenceInventory().servers[0].name,'Actual MCP');
 await e.surface.refreshMcpReferences();assert.equal(events.length,2);assert.equal(e.surface.mcpReferenceInventory().loading,false);assert.ok(requests.every(method=>method==='GET'));
});

test('canonical rows hidden pending identity mount after reload even when cached IDs are unchanged',async t=>{
 const identity=deferred(),history=deferred(),canonical=snapshot(2,{entries:[{id:'cached-input',role:'user',text:'Exact cached text',createdAt:2}]});
 const cached=projectLiveMessages(canonical),e=environment(t,stateWith({modes:{[conversationId]:'live'},serverIds:{[conversationId]:serverId}},cached),{fetchImpl:async url=>{
  if(url.endsWith('/status'))return identity.promise;
  if(url.endsWith('/skills'))return response({skills:[]});
  if(url.endsWith('/conversations/'+serverId))return history.promise;
  throw Error('Unexpected reload request '+url);
 }});
 const rows=[],transcript={querySelectorAll:()=>rows,insertBefore(row,next){const index=next?rows.indexOf(next):rows.length;rows.splice(index,0,row);},classList:{toggle(){}}};
 e.host.app.querySelector=selector=>selector==='.transcript'?transcript:null;
 e.host.transcriptReader={beforeMutation(){},afterMutation(){}};
 e.host.renderLiveMessage=message=>`<article data-message-id="${message.id}"></article>`;e.host.afterSurfaceChange=()=>{};
 const create=document.createElement;
 document.createElement=tag=>tag==='template'?{set innerHTML(value){this.content={firstElementChild:{dataset:{messageId:/data-message-id="([^"]+)"/.exec(value)[1]}}};}}:create(tag);
 assert.deepEqual(e.host.cloudHistory.filterEntries(cached),[],'cached server rows stay private before identity is confirmed');
 e.surface.afterRender();identity.resolve(response(status));await new Promise(setImmediate);history.resolve(response(canonical));await new Promise(setImmediate);
 assert.deepEqual(rows.map(row=>row.dataset.messageId),['cached-input'],'server-confirmed rows mount despite identical cache IDs');
 assert.deepEqual(e.state.messages[conversationId],cached,'mounting does not rewrite the confirmed payload');
 await e.surface.refreshMcpReferences();assert.equal(rows.length,1,'later refresh does not duplicate the existing row');
});

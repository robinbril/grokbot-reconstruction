import {createCloudHistoryController} from './cloud-history-controller.js';
import {transcriptReaderFor} from './transcript-reader.js';
import {appendCanvasSubmissionReference} from './live-canvas-reference.js';
import {composerController,composerEventInput,readComposerInput} from './composer-input.js';
import {liveSkillPayload} from './composer-commands.js';
import {createLiveSkillsSurface} from './live-skills-surface.js';
import {createLiveCanvasSurface} from './live-canvas-surface.js';
import {liveReplyDraft,liveReplyPayload} from './live-incoming-replies.js';
import {createLiveConnectorsSurface} from './live-connectors-surface.js';
import {createLiveWorkflowsSurface} from './live-workflows-surface.js';
import {createLiveHarnessClient} from './live-harness-client.js';
import {emptyLiveConversation,normalizeLiveSnapshot,reduceLiveEvent,projectLiveMessages,liveActive,safeOutput,stripTerminalControls,hasLiveHarnessOwnership,liveHistoryResetMessage,liveRuntimeText} from './live-harness-model.js';
import {createLiveMessageDeliveries} from './live-message-deliveries.js';
import {createLiveAttachmentPreview} from './live-attachment-preview.js';
import {createChatDiagramService} from './chat-diagram.js';
import {pruneQueuedDrafts} from './live-queued-drafts.js';

const browserDraftFields=new Set(['url','selector','value','key','direction','pixels']);
const browserKeys=['Enter','Shift+Enter','Tab','Shift+Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Space','ControlOrMeta+A'];
const terminalStates=new Set(['completed','failed','cancelled','interrupted']);
const label=status=>({accepted:'Geaccepteerd',starting:'Starten',running:'Bezig',started:'Bezig',waiting_approval:'Wacht op toestemming',cancelling:'Stop aangevraagd','awaiting-approval':'Wacht op toestemming','awaiting-question':'Wacht op antwoord','cancel-requested':'Stop aangevraagd',completed:'Voltooid',cancelled:'Gestopt',failed:'Mislukt',interrupted:'Onderbroken',pending:'Wacht op toestemming',approved:'Goedgekeurd',rejected:'Afgewezen',resolved:'Beoordeeld',expired:'Verlopen',exited:'Afgesloten'}[status]||status||'Onbekend');
const uuid=()=>crypto.randomUUID();
export function createLiveHarnessSurface(host){
 const client=createLiveHarnessClient(),snapshots=new Map(),streams=new Map(),loading=new Map(),recovering=new Map(),connected=new Set(),errors=new Map(),views=new Map(),panelDrafts=new Map(),pending=new Set();
 const parking=document.createElement('div');parking.hidden=true;parking.inert=true;parking.dataset.liveParking='';document.body.append(parking);
 const diagram=createChatDiagramService({icon:host.icon,getTheme:()=>document.documentElement.dataset.theme});
 let workflows,connectors,skillsSurface,canvases;
 let disposed=false,status=null,statusError='',activeTab='terminal',polling=false,previousKey=null;
 const key=()=>host.getConversationKey(),esc=host.esc;
 function prefs(state=host.getState()){if(!state.liveHarness||typeof state.liveHarness!=='object'||Array.isArray(state.liveHarness))state.liveHarness={modes:{}};if(!state.liveHarness.modes||typeof state.liveHarness.modes!=='object'||Array.isArray(state.liveHarness.modes))state.liveHarness.modes={};if(!state.liveHarness.pendingSends||typeof state.liveHarness.pendingSends!=='object'||Array.isArray(state.liveHarness.pendingSends))state.liveHarness.pendingSends={};if(!state.liveHarness.serverIds||typeof state.liveHarness.serverIds!=='object'||Array.isArray(state.liveHarness.serverIds))state.liveHarness.serverIds={};return state.liveHarness;}
 const isLive=(id=key())=>prefs().modes[id]==='live';
 const attachmentPreview=createLiveAttachmentPreview({icon:host.icon,isCurrentConversation:id=>!disposed&&isLive()&&prefs().serverIds[key()]===id,getScope:()=>!disposed&&isLive()?JSON.stringify([key(),prefs().serverIds[key()]]):null});
 function serverId(id=key()){const preferences=prefs();if(typeof preferences.serverIds[id]==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(preferences.serverIds[id]))return preferences.serverIds[id];const value=uuid();preferences.serverIds[id]=value;if(!host.persist())errors.set(id,'Het eigen gespreksadres kon niet worden opgeslagen. De koppeling blijft alleen in dit geopende venster behouden.');return value;}
 const snapshot=(id=key())=>snapshots.get(id)||emptyLiveConversation(id);
 const cloud=createCloudHistoryController({host,client,serverId,isLive,snapshot,adopt});
 host.cloudHistory=cloud;
 host.onCloudDevicePaired=async result=>{await client.status();return cloud.paired(result);};
 host.onCloudIdentityChanged=()=>{for(const stream of streams.values())stream.close();streams.clear();snapshots.clear();loading.clear();connected.clear();errors.clear();recovering.clear();};
 const mcpSignatures=new Map(),mcpReadErrors=new Set();
 function mcpReferenceInventory(id=key()){return {conversationId:isLive(id)?prefs().serverIds[id]??null:null,loading:isLive(id)&&!snapshots.has(id)&&loading.has(id),failed:isLive(id)&&mcpReadErrors.has(id),servers:isLive(id)?structuredClone(snapshot(id).servers.filter(server=>server&&typeof server.configuration==='object')):[]};}
 function publishMcpReferences(id=key()){const value=mcpReferenceInventory(id),signature=JSON.stringify(value);if(mcpSignatures.get(id)===signature)return;mcpSignatures.set(id,signature);host.app.dispatchEvent(new CustomEvent('grok-mcp-references-changed',{bubbles:true,detail:{conversationKey:id}}));}
 const draft=(id=key())=>{if(!panelDrafts.has(id))panelDrafts.set(id,Object.fromEntries(Object.entries(prefs().browserDrafts?.[id]||{}).filter(([field,value])=>browserDraftFields.has(field)&&typeof value==='string')));return panelDrafts.get(id);};
 const owned=message=>message?.productKind==='live-harness';
 const runFor=message=>snapshot().runs.find(run=>run.id===message?.liveHarness?.runId);
 const activeRun=(id=key())=>[...snapshot(id).runs].reverse().find(run=>liveActive(run.status));
 const pendingApproval=approval=>['pending','requested','awaiting-approval'].includes(approval?.status||'pending');
 const errorText=error=>error?.code==='MCP_CONFIG_LOCKED'?'De MCP-configuratie is vastgezet na het eerste bericht. Start een nieuw gesprek om deze server te verbinden. Je concept blijft behouden.':error?.message||'Verbinding met de harness mislukt.';
 function setError(id,error){errors.set(id,errorText(error));sync();}
 function runtimeText(){return liveRuntimeText(snapshot().runtime||status?.runtime,statusError);}
 async function refreshStatus(){try{status=await client.status();cloud.enable(status);statusError='';}catch(error){statusError=errorText(error);}if(!disposed)sync();}
 function project(id){
  const state=host.getState(),old=state.messages[id]||[],messages=projectLiveMessages(snapshot(id)),next=[...old.filter(message=>!owned(message)),...messages];
  const structural=old.length!==next.length||old.some((message,index)=>message.id!==next[index]?.id);
  state.messages[id]=next;
  host.noteTranscriptEntries?.(id);
  const visibleNext=host.visibleTranscriptEntries?.(id,next)??next;
  // A local display cache never authorizes a provider retry or establishes delivery.
  host.persist();
  if(id===key()){
   const transcript=host.app.querySelector('.transcript');
   const reader=transcriptReaderFor(host);reader?.beforeMutation();try{
   const byId=new Map(Array.from(transcript?.querySelectorAll('.message[data-message-id]')||[]).map(node=>[node.dataset.messageId,node]));
   const missingRows=visibleNext.some(message=>!byId.has(message.id));
   if((structural||missingRows)&&transcript&&host.renderLiveMessage){
    for(let index=visibleNext.length-1;index>=0;index--){const message=visibleNext[index];if(byId.has(message.id))continue;const template=document.createElement('template');template.innerHTML=host.renderLiveMessage(message);const row=template.content.firstElementChild,nextRow=byId.get(visibleNext[index+1]?.id);transcript.insertBefore(row,nextRow||null);byId.set(message.id,row);}
    const keep=new Set(visibleNext.map(message=>message.id));for(const oldMessage of old)if(owned(oldMessage)&&!keep.has(oldMessage.id))byId.get(oldMessage.id)?.remove();
    transcript.classList.toggle('is-empty',!visibleNext.length);host.afterSurfaceChange();
   }else if(structural)host.render();else sync();
   }finally{reader?.afterMutation({cause:structural?'structure-change':'stream-delta'});}
  }
 }
 function adopt(value,id){if(disposed)return snapshot(id);const next=normalizeLiveSnapshot(cloud.accept(value.snapshot||value,id),serverId(id)),old=snapshots.get(id);if(old&&next.lastSeq<old.lastSeq)return old;if(!next.runtime&&old?.runtime)next.runtime=old.runtime;
  const obligation=recovering.get(id);if(obligation&&(!obligation.runId||next.runs.some(run=>run.id===obligation.runId))&&next.lastSeq>=(obligation.lastSeq||0)){recovering.delete(id);errors.delete(id);}
  const state=host.getState();
  if(pruneQueuedDrafts(state,id,serverId(id),next.queue)!==state){const result=host.commit(current=>pruneQueuedDrafts(current,id,serverId(id),next.queue),{reason:'live-queued-draft-prune'});if(!result.ok)errors.set(id,'De wachtrij is ververst, maar oude herstelgegevens konden niet worden opgeruimd.');}
  snapshots.set(id,next);project(id);observe(id);publishMcpReferences(id);return next;
 }
 async function refresh(id=key(),{afterPending=false}={}){
  if(id==='new'||disposed)return;
  if(afterPending){const prior=loading.get(id);if(prior)await prior.catch(()=>{});if(disposed)return;}
  else if(loading.has(id))return loading.get(id);
  const version=cloud.generation(),address=serverId(id);
  const task=cloud.register(id).then(()=>client.snapshot(address,cloud.query(id))).then(value=>{if(version!==cloud.generation()||disposed||serverId(id)!==address)return snapshot(id);mcpReadErrors.delete(id);return adopt(value,id);}).catch(error=>{if(version!==cloud.generation()||disposed)return snapshot(id);mcpReadErrors.add(id);if(!recovering.has(id))recovering.set(id,{});setError(id,error);throw error;}).finally(()=>{if(loading.get(id)===task)loading.delete(id);publishMcpReferences(id);});
  loading.set(id,task);publishMcpReferences(id);return task;
 }
 function observe(id){
  const run=activeRun(id),previous=streams.get(id);
  if(!run){previous?.close();streams.delete(id);return;}
  if(previous?.runId===run.id)return;
  previous?.close();const record={runId:run.id,connection:'connecting'};
  record.close=client.events(run.id,snapshot(id).lastSeq,{onConnection:connection=>{record.connection=connection;if(id===key())sync();if(connection==='connected')void refresh(id).catch(()=>{});},onEvent:event=>{
   if(disposed)return;if(event.type==='read.changed'){void refresh(id).catch(()=>{});return;}const result=reduceLiveEvent(snapshot(id),event);
   if(result.gap||result.invalid){void refresh(id).catch(()=>{});return;}
   if(result.duplicate)return;snapshots.set(id,result.snapshot);project(id);observe(id);publishMcpReferences(id);
  }});streams.set(id,record);
 }
 async function connect(id,{force=false}={}){
  if(!force&&connected.has(id))return snapshot(id);
  try{const value=await client.connect(serverId(id),uuid());connected.add(id);errors.delete(id);return adopt(value,id);}
  catch(error){connected.delete(id);throw error;}
 }
 function updateText(node,value){if(node&&node.textContent!==String(value??''))node.textContent=String(value??'');}
 function selectorMarkup(){return `<div class="live-execution"><span id="live-execution-label">Uitvoering</span><div class="live-mode-choice" role="radiogroup" aria-labelledby="live-execution-label"><label class="live-mode-option"><input type="radio" name="live-execution-mode" value="demo" data-live-mode ${isLive()?'':'checked'}><span>Lokale voorbeelden</span></label><label class="live-mode-option"><input type="radio" name="live-execution-mode" value="live" data-live-mode ${isLive()?'checked':''}><span>Echte harness</span></label></div>${isLive()?`<span class="small muted" data-live-connection role="status">${esc(runtimeText())}</span>`:''}</div>`;}
 function statusMarkup(message){const info=message.liveHarness,run=runFor(message);if(info.kind!=='assistant'||!info.runId)return '';return `<section class="chat-run-status live-run-status" data-live-run="${esc(info.runId)}" ${run?'':'hidden'}><span class="small muted">Echte harness</span><span role="status" data-live-run-label>${run?esc(label(run.status)):''}</span><button class="text-button" data-action="live-stop" data-id="${esc(info.runId)}" ${run&&liveActive(run.status)?'':'hidden'}>Stoppen</button></section>`;}
 function cardMarkup(message){
  const info=message.liveHarness;
  if(info.kind==='tool')return `<section class="transcript-card live-tool-card" data-live-tool="${esc(info.toolId)}"><div class="row between"><strong data-live-tool-name></strong><span class="small muted" data-live-tool-status></span></div><p class="small muted" data-live-tool-server></p><details><summary>Aanroep en resultaat</summary><pre data-live-tool-arguments></pre><pre data-live-tool-output></pre></details><p class="live-error" data-live-tool-error hidden></p></section>`;
  if(info.kind==='approval')return `<section class="transcript-card live-approval-card" data-live-approval="${esc(info.approvalId)}" data-run-id="${esc(info.runId)}"><h3 data-live-approval-title>Toestemming nodig</h3><pre data-live-approval-operation></pre><p class="small muted" data-live-approval-status role="status"></p><div class="card-actions"><button class="primary-button" data-action="live-approve" data-id="${esc(info.approvalId)}" data-run-id="${esc(info.runId)}">Goedkeuren</button><button class="outline-button" data-action="live-reject" data-id="${esc(info.approvalId)}" data-run-id="${esc(info.runId)}">Afwijzen</button></div></section>`;
 }
 function browserControlMarkup(values){return `<label class="field-label">Toets<select class="field-input" aria-label="Browsertoets" data-live-input="key">${browserKeys.map(value=>`<option value="${esc(value)}" ${(values.key||'Enter')===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label><button class="outline-button" data-action="live-browser-press">Toets indrukken</button><label class="field-label">Scrollrichting<select class="field-input" aria-label="Browserscrollrichting" data-live-input="direction">${[['down','Omlaag'],['up','Omhoog'],['left','Links'],['right','Rechts']].map(([value,title])=>`<option value="${value}" ${(values.direction||'down')===value?'selected':''}>${title}</option>`).join('')}</select></label><label class="field-label">Scrollafstand in pixels<input class="field-input" aria-label="Browserscrollafstand" data-live-input="pixels" type="number" min="1" max="4000" step="1" value="${esc(values.pixels??'500')}"></label><button class="outline-button" data-action="live-browser-scroll">Pagina scrollen</button>`;}
 function browserRequest(kind,values){
  const names={open:'browser_open',capture:'browser_screenshot',click:'browser_click',fill:'browser_fill',press:'browser_press',scroll:'browser_scroll',select:'browser_select'};
  if(!names[kind])throw new Error('Onbekende browseractie.');
  const selector=values.selector||'',value=values.value||'';let args={};
  if(kind==='open')args={url:values.url||''};
  if(['click','fill','press','select'].includes(kind)&&!selector.trim())throw new Error('Vul een elementselector in.');
  if(kind==='click')args={selector};
  if(kind==='fill'||kind==='select')args={selector,value};
  if(kind==='press'){const key=values.key||'Enter';if(!browserKeys.includes(key))throw new Error('Kies een geldige toets.');args={selector,key};}
  if(kind==='scroll'){
   const direction=values.direction||'down',raw=values.pixels??'500',pixels=Number(raw);
   if(!['up','down','left','right'].includes(direction))throw new Error('Kies een geldige scrollrichting.');
   if(!/^\d+$/.test(raw)||!Number.isInteger(pixels)||pixels<1||pixels>4000)throw new Error('Gebruik een geheel getal van 1 tot en met 4000 pixels.');
   args={...(selector.trim()?{selector}:{}),direction,pixels};
  }
  return {name:names[kind],args};
 }
 function panelMarkup(){const values=draft();return `<section class="live-computer" aria-label="Echte harness computer"><p class="small muted" data-live-runtime>${esc(runtimeText())}</p><p class="small live-workspace" data-live-workspace></p><button class="outline-button" data-action="live-connect">Harness verbinden</button><nav class="live-tabs" data-segmented-control role="tablist" aria-label="Harness computer">${[['browser','Browser'],['terminal','Terminal'],['tools','Tools']].map(([id,title])=>`<button role="tab" aria-selected="${activeTab===id}" data-action="live-tab" data-id="${id}">${title}</button>`).join('')}</nav><div role="tabpanel" aria-label="${activeTab==='browser'?'Browser':activeTab==='tools'?'Tools':'Terminal'}">
  ${activeTab==='terminal'?`<p class="small muted">Opdrachten draaien in de taskbox van dit gesprek. Dit is echte procesuitvoer.</p><label class="field-label" for="live-command">Opdracht</label><textarea class="field-input live-command" id="live-command" aria-label="Terminalopdracht" data-live-input="command" rows="3" placeholder="pwd">${esc(values.command||'')}</textarea><button class="outline-button" data-action="live-terminal-run">Opdracht uitvoeren</button><div data-live-terminal-sessions></div>`:activeTab==='browser'?`<p class="small muted">Chromium draait in de taskbox van dit gesprek. Het beeld toont de laatste echte opname.</p><label class="field-label" for="live-browser-url">URL</label><input class="field-input" id="live-browser-url" aria-label="Browser-URL" data-live-input="url" value="${esc(values.url||'')}" placeholder="https://…"><div class="live-actions"><button class="outline-button" data-action="live-browser-open">Pagina openen</button><button class="text-button" data-action="live-browser-capture">Beeld vastleggen</button></div><div data-live-browser-preview></div><details class="live-browser-controls"><summary>Pagina bedienen</summary><label class="field-label">Elementselector<input class="field-input" aria-label="Browserelement" data-live-input="selector" value="${esc(values.selector||'')}" placeholder="#button"></label><label class="field-label">Waarde<input class="field-input" aria-label="Browserinvoer" data-live-input="value" value="${esc(values.value||'')}"></label><div class="live-actions"><button class="outline-button" data-action="live-browser-click">Element aanklikken</button><button class="outline-button" data-action="live-browser-fill">Veld invullen</button><button class="outline-button" data-action="live-browser-select">Optie selecteren</button></div>${browserControlMarkup(values)}</details>`:`<p class="small muted">Werkelijk ontdekte MCP-tools van dit gesprek.</p><button class="text-button" data-action="live-tools-refresh">Tools vernieuwen</button><div data-live-tools></div>${connectors.formMarkup(values)}`}
  </div><p class="live-error" data-live-panel-error role="status"></p></section>`;}
 function safeFrameUrl(value){try{const url=new URL(value,location.href);return url.origin===location.origin&&url.pathname.startsWith('/api/harness/conversations/')&&url.pathname.includes('/browser/frames/')?url.href:null;}catch{return null;}}
 function paintPanel(){const panel=host.app.querySelector('.live-computer');if(!panel)return;const data=snapshot();updateText(panel.querySelector('[data-live-runtime]'),runtimeText());updateText(panel.querySelector('[data-live-workspace]'),data.workspaceRoot?'Taskbox-werkmap: '+data.workspaceRoot:'De taskbox-werkmap wordt bij verbinden aangemaakt.');updateText(panel.querySelector('[data-live-panel-error]'),errors.get(key())||'');
  for(const button of panel.querySelectorAll('[data-action^=live-browser-]'))button.disabled=pending.has(key()+':'+button.dataset.action);
  const connectButton=panel.querySelector('[data-action=live-connect]');if(connectButton)connectButton.disabled=pending.has(key()+':live-connect');
  const addButton=panel.querySelector('[data-action=live-mcp-add]');if(addButton)addButton.disabled=connectors.busy();
  const sessions=panel.querySelector('[data-live-terminal-sessions]');
  if(sessions){
   if(!data.terminalSessions.length&&!sessions.querySelector('[data-live-terminal-empty]'))sessions.innerHTML='<p class="small muted" data-live-terminal-empty>Nog geen terminaluitvoer.</p>';
   if(data.terminalSessions.length)sessions.querySelector('[data-live-terminal-empty]')?.remove();
   for(const session of data.terminalSessions){let node=Array.from(sessions.children).find(item=>item.dataset.terminalSession===session.id);if(!node){node=document.createElement('section');node.className='live-terminal-session';node.dataset.terminalSession=session.id;node.innerHTML=`<h4 data-terminal-command></h4><p class="small muted" data-terminal-cwd></p><pre aria-label="Terminaluitvoer" data-terminal-stdout></pre><pre aria-label="Terminalfouten" data-terminal-stderr></pre><p class="small muted" role="status" data-terminal-status></p><button class="text-button" data-action="live-terminal-stop" data-id="${esc(session.id)}">Terminal stoppen</button>`;sessions.append(node);}updateText(node.querySelector('[data-terminal-command]'),session.command);updateText(node.querySelector('[data-terminal-cwd]'),session.cwd);updateText(node.querySelector('[data-terminal-stdout]'),stripTerminalControls(session.stdout));updateText(node.querySelector('[data-terminal-stderr]'),stripTerminalControls(session.stderr));updateText(node.querySelector('[data-terminal-status]'),label(session.status)+(Number.isInteger(session.exitCode)?' · exitcode '+session.exitCode:'')+(session.error?' · '+safeOutput(session.error):''));node.querySelector('button').hidden=!['running','started','accepted'].includes(session.status);}
  }
  const preview=panel.querySelector('[data-live-browser-preview]'),browser=data.browserSessions.at(-1);
  if(preview){if(!browser){updateText(preview,'Nog geen browserbeeld.');}else{let frame=preview.querySelector('img');if(!frame){preview.replaceChildren();const title=document.createElement('strong'),url=document.createElement('p'),time=document.createElement('p');title.dataset.browserTitle='';url.dataset.browserPage='';time.dataset.browserTime='';url.className=time.className='small muted';frame=document.createElement('img');frame.alt='Werkelijk opgenomen browserbeeld';frame.dataset.liveBrowserFrame='';preview.append(title,url,time,frame);}updateText(preview.querySelector('[data-browser-title]'),browser.title);updateText(preview.querySelector('[data-browser-page]'),browser.pageUrl);updateText(preview.querySelector('[data-browser-time]'),browser.capturedAt?'Vastgelegd: '+new Date(browser.capturedAt).toLocaleString('nl-NL'):'Nog geen opname');const src=safeFrameUrl(browser.frameUrl||'/api/harness/conversations/'+encodeURIComponent(serverId())+'/browser/frames/'+encodeURIComponent(browser.captureId||''));if(src&&browser.captureId){if(frame.src!==src)frame.src=src;frame.hidden=false;}else frame.hidden=true;}}
  const tools=panel.querySelector('[data-live-tools]');if(tools){const signature=JSON.stringify([data.servers,connectors.busy(),connectors.errorMarkup()]);if(tools.dataset.signature!==signature){tools.dataset.signature=signature;tools.innerHTML=(data.servers.length?data.servers.map(server=>connectors.serverMarkup(server)).join(''):'<p class="small muted">Verbind de harness om echte MCP-tools te ontdekken.</p>')+connectors.toolsFooter();}}
 }
 function paintCards(){for(const node of host.app.querySelectorAll('[data-live-tool]')){const tool=snapshot().tools.find(item=>item.id===node.dataset.liveTool);if(!tool)continue;updateText(node.querySelector('[data-live-tool-name]'),tool.name);updateText(node.querySelector('[data-live-tool-status]'),label(tool.status));updateText(node.querySelector('[data-live-tool-server]'),tool.serverId||'Grok-tool');updateText(node.querySelector('[data-live-tool-arguments]'),safeOutput(tool.arguments));updateText(node.querySelector('[data-live-tool-output]'),safeOutput(tool.output));const error=node.querySelector('[data-live-tool-error]');updateText(error,safeOutput(tool.error));error.hidden=!tool.error;}
  for(const node of host.app.querySelectorAll('[data-live-approval]')){const run=snapshot().runs.find(item=>item.id===node.dataset.runId),approval=run?.approvals?.find(item=>item.id===node.dataset.liveApproval);if(!approval)continue;updateText(node.querySelector('[data-live-approval-title]'),approval.title||'Toestemming nodig');updateText(node.querySelector('[data-live-approval-operation]'),safeOutput(approval.operation||approval.command||approval.arguments||approval));updateText(node.querySelector('[data-live-approval-status]'),approval.decision==='approve'?'Goedgekeurd':approval.decision==='reject'?'Afgewezen':label(approval.status||'pending'));for(const button of node.querySelectorAll('button')){button.hidden=!pendingApproval(approval);button.disabled=pending.has('approval:'+approval.id);}}
 }
 function sync(){if(disposed)return;const reader=transcriptReaderFor(host);reader?.beforeMutation();try{attachmentPreview.sync();for(const node of host.app.querySelectorAll('[data-live-connection]'))updateText(node,runtimeText());const error=host.app.querySelector('[data-live-send-error]');updateText(error,errors.get(key())||'');if(error)error.hidden=!errors.get(key());const retry=host.app.querySelector('[data-action=live-retry]');if(retry){retry.hidden=!prefs().pendingSends[key()];retry.disabled=pending.has(key()+':send');}
  for(const message of host.getState().messages[key()]||[]){if(!owned(message))continue;const view=views.get(key()+':'+message.id);if(view)updateView(view,message);}
  for(const node of host.app.querySelectorAll('[data-live-run]')){const run=snapshot().runs.find(item=>item.id===node.dataset.liveRun);node.hidden=!run;if(!run)continue;const connection=streams.get(key())?.connection;updateText(node.querySelector('[data-live-run-label]'),(run.cancelRequested&&liveActive(run.status)?'Stop aangevraagd':label(run.status))+(connection==='disconnected'&&liveActive(run.status)?' · verbinding verbroken, uitvoering niet bevestigd':'')+(run.error?' · '+safeOutput(run.error):''));const stop=node.querySelector('button');stop.hidden=!liveActive(run.status);stop.disabled=pending.has('cancel:'+run.id);}
  paintCards();paintPanel();canvases?.sync();workflows?.sync();connectors?.sync();skillsSurface?.sync();
  }finally{reader?.afterMutation({cause:'tool-status-change'});}
  host.onTranscriptContentChanged?.();
 }
 function updateView(view,message){const run=runFor(message);view.update({entry:{messageId:message.id,kind:'send-message',revision:message.liveHarness.revision,status:message.liveHarness.status,text:message.text,payload:{layoutMode:'elevated'}},context:{role:'bot',work:{isStreaming:liveActive(run?.status),isStable:terminalStates.has(run?.status)}},theme:document.documentElement.dataset.theme,deliveries:message.liveHarness.messages||[],drafts:message.liveHarness.messageDrafts||[],conversationId:message.liveHarness.conversationId,esc});}
 function beforeRender(){canvases?.beforeRender();for(const view of views.values())if(host.app.contains(view.element))parking.append(view.element);}
 function afterRender(){if(disposed)return;cloud.afterRender();attachmentPreview.sync();for(const slot of host.app.querySelectorAll('[data-live-entry]')){const message=(host.getState().messages[key()]||[]).find(item=>item.id===slot.dataset.liveEntry);if(!message)continue;const address=key()+':'+message.id;let view=views.get(address);if(!view){view=createLiveMessageDeliveries({conversationId:key(),entryId:message.id,copyText:host.copyText,diagram,icon:host.icon,preview:attachmentPreview});views.set(address,view);}slot.replaceWith(view.element);updateView(view,message);}sync();canvases?.afterRender();workflows?.afterRender();if(key()!==previousKey){previousKey=key();if(isLive()){void skillsSurface.refresh();if(key()!=='new')void refresh().catch(()=>{});}}}
 async function send({forceQueue=false}={}){canvases.beforeSubmit();const originalKey=key();if(pending.has(originalKey+':send'))return true;
  if(host.hasPendingAttachments?.()){setError(originalKey,new Error('Wacht tot je bijlagen in deze browser zijn opgeslagen. Je concept blijft behouden.'));return true;}
  const input=host.app.querySelector('#message-input'),composer=readComposerInput(input),text=composer.text,richText=composerController(input)?composer.richText:host.getState().draftRichTexts?.[originalKey],files=structuredClone(host.draftAttachments(originalKey));if(!text.trim()&&!files.length&&!(host.getState().composerSkillReferences?.[originalKey]||[]).length)return true;
  const agent=host.ensureConversation();if(!agent)return true;const id=agent.id;serverId(id);const quote=host.getState().replyDrafts[id],skillReferences=structuredClone(composerController(input)?composer.references:host.getState().composerSkillReferences?.[id]||[]),quoteText=quote?[quote.title,quote.text].filter(Boolean).join('\n'):undefined,skillPayload=liveSkillPayload(skillReferences),skills=skillPayload.skillReferences||[];
  if(text.length>32768||(quoteText&&quoteText.length>10000)||skillReferences.length>20||skills.some(value=>value.length>2000)){setError(id,new Error('Bericht of expliciete context is te lang voor deze harness. Kort de tekst in. Je concept, citaat en vaardigheden blijven behouden.'));return true;}
  let attachmentRefs=[];try{attachmentRefs=workflows.uploads.refs(id,files);}catch(error){setError(id,error);return true;}
  let reply={};try{reply=liveReplyPayload(snapshot(id),quote);}catch(error){setError(id,error);return true;}
  const heldCanvas=canvases.heldReference(),payloadRichText=heldCanvas?appendCanvasSubmissionReference(richText,heldCanvas,{text}):richText;
  const content={text,...(payloadRichText!==undefined?{richText:payloadRichText}:{}),...reply,...(attachmentRefs.length?{attachmentRefs}:{}),...(quoteText?{quote:quoteText}:{}),...skillPayload},signature=JSON.stringify(content)+(files.length?JSON.stringify(files.map(ref=>ref.id)):'');
  const previous=prefs().pendingSends[id];if(previous&&previous.signature!==signature){setError(id,new Error('Een eerdere verzending is nog niet bevestigd. Kies Ontvangst controleren om die aanvraag veilig af te ronden. Je nieuwere concept blijft behouden.'));return true;}
  const queued=forceQueue||Boolean(activeRun(id)||(snapshot(id).queue||[]).some(row=>['queued','preparing','sending','running','blocked'].includes(row.status))||snapshot(id).workflow?.hold);
  const requestId=previous?.payload?.requestId||uuid(),request=previous||{signature,serverConversationId:serverId(id),...(queued?{queued:true}:{}),payload:{requestId,...content},draft:{requestId,conversationId:id,text,...(richText!==undefined?{richText}:{}),quote:quote?structuredClone(quote):undefined,attachments:files,skillReferences}};
  if(!previous&&!host.commit(current=>({...current,liveHarness:{...prefs(current),pendingSends:{...prefs(current).pendingSends,[id]:request}}}),{reason:'live-send-intent'}).ok){setError(id,new Error('De verzendaanvraag kon niet worden bewaard. Je concept blijft behouden.'));return true;}
  return dispatchRequest(id,request);
 }
 function handleKeyDown(event){
  const input=composerEventInput(event.target);
  // ProseMirror suppresses native Enter before bubbling, even without a key command.
  // A registered rich composer therefore does not use defaultPrevented as task intent.
  if(disposed||!isLive()||(event.defaultPrevented&&!composerController(input))||event.key!=='Enter'||!event.shiftKey||event.metaKey||event.ctrlKey||event.altKey||event.isComposing||event.keyCode===229||!input||input!==host.app.querySelector('#message-input')||input.disabled||input.readOnly||input.contentEditable==='false'||input.getAttribute?.('aria-readonly')==='true'||input.dataset?.editorUnavailable!==undefined)return false;
  event.preventDefault();
  if(!event.repeat){const conversationId=key();void send({forceQueue:true}).catch(error=>setError(conversationId,error));}
  return true;
 }
 function releaseRejectedIntent(id,request){return host.commit(current=>{
  const preferences=prefs(current);if(preferences.pendingSends[id]?.payload?.requestId!==request.payload.requestId)return current;
  const pendingSends={...preferences.pendingSends};delete pendingSends[id];
  return {...current,liveHarness:{...preferences,pendingSends}};
 },{reason:'live-send-rejected'}).ok;}
 async function dispatchRequest(id,request){if(pending.has(id+':send'))return true;pending.add(id+':send');errors.delete(id);sync();
  try{const canonicalId=serverId(id);if(request.serverConversationId!==undefined&&request.serverConversationId!==canonicalId)throw new Error('Het oorspronkelijke gespreksadres is gewijzigd. De ontvangen aanvraag wordt niet naar een ander gesprek gestuurd; je concept blijft behouden.');if(!request.queued)await connect(id);if(serverId(id)!==canonicalId)throw new Error('Het oorspronkelijke gespreksadres is gewijzigd. Je concept blijft behouden.');const queued=(snapshot(id).queue||[]).find(row=>row.requestId===request.payload.requestId),known=snapshot(id).runs.find(run=>run.requestId===request.payload.requestId),accepted=queued?{accepted:true,queueId:queued.id,runId:queued.runId,lastSeq:snapshot(id).lastSeq}:known?{accepted:true,runId:known.id,lastSeq:snapshot(id).lastSeq}:request.queued?await client.enqueue(canonicalId,request.payload):await client.start(canonicalId,request.payload);if(!accepted.accepted)throw new Error('De harness heeft je bericht niet geaccepteerd.');if(serverId(id)!==canonicalId)throw new Error('Het oorspronkelijke gespreksadres is gewijzigd na ontvangst. Je concept en aanvraag blijven behouden.');recovering.set(id,{runId:accepted.runId,lastSeq:accepted.lastSeq});const consumed=host.consumeLiveDraft(request.draft,request.queued?{conversationId:id,serverConversationId:canonicalId,queueId:accepted.queueId,request}:undefined);if(consumed?.ok===false||request.queued&&consumed?.ok!==true)throw new Error('De harness heeft je bericht ontvangen, maar het oorspronkelijke concept kon niet veilig worden opgeslagen. Kies Ontvangst controleren.');if(request.draft.attachments?.length)await host.clearLiveAttachments?.(request.draft);await refresh(id,{afterPending:true});if(id===key())host.render({explicitSend:true});}
  catch(error){if(error.accepted===false&&!releaseRejectedIntent(id,request))error=new Error('De afwijzing kon niet worden opgeslagen. Je concept en bijlagen blijven behouden.');setError(id,error);}finally{pending.delete(id+':send');sync();}return true;
 }
 async function command(action,id,target){const conversationId=key(),lock=action==='live-stop'?'cancel:'+id:action.startsWith('live-approve')||action==='live-reject'?'approval:'+id:conversationId+':'+action;if(pending.has(lock))return true;pending.add(lock);errors.delete(conversationId);if(target)target.disabled=true;sync();
  try{
   if(action==='live-connect'){await connect(conversationId,{force:true});await loadTools(conversationId);}
   else if(action==='live-stop')await client.cancel(id,uuid());
   else if(action==='live-approve'||action==='live-reject')await client.decide(target.dataset.runId,id,action==='live-approve'?'approve':'reject',uuid());
   else if(action==='live-terminal-stop')await client.stopTerminal(serverId(conversationId),id,uuid());
   else if(action==='live-terminal-run'){const value=draft(conversationId).command||'';if(!value.trim())throw new Error('Vul een terminalopdracht in.');await connect(conversationId);await client.terminal(serverId(conversationId),value,uuid());}
   else if(action==='live-tools-refresh'){await connect(conversationId,{force:true});await loadTools(conversationId);}

   else if(action.startsWith('live-browser-')){const request=browserRequest(action.slice('live-browser-'.length),draft(conversationId));await connect(conversationId);await client.browser(serverId(conversationId),request.name,request.args,uuid());}
   await refresh(conversationId);
  }catch(error){setError(conversationId,error);}finally{pending.delete(lock);if(target?.isConnected)target.disabled=false;sync();}return true;
 }
 async function loadTools(id){const sequence=snapshot(id).lastSeq,value=await client.tools(serverId(id));if(disposed||snapshot(id).lastSeq!==sequence)return;snapshots.set(id,{...snapshot(id),servers:Array.isArray(value.servers)?value.servers:[]});sync();publishMcpReferences(id);}
 async function openMcpReference(runtimeId){
  const conversation=key(),canonical=prefs().serverIds[conversation],version=host.getDialogVersion();
  if(!isLive(conversation)||typeof canonical!=='string'){setError(conversation,new Error('Deze server is niet beschikbaar in dit gesprek.'));return true;}
  try{
   await refresh(conversation,{afterPending:true});
   if(disposed||key()!==conversation||prefs().serverIds[conversation]!==canonical||version!==host.getDialogVersion())return true;
   if(!connectors.openReference(runtimeId))setError(conversation,new Error('Deze server is niet beschikbaar in dit gesprek.'));
  }catch(error){if(!disposed&&key()===conversation&&prefs().serverIds[conversation]===canonical)setError(conversation,error);}
  return true;
 }
 function handleAction({action,id,target}){
  if(action==='live-mcp-reference-open')return openMcpReference(id);
  if(action==='reply-message'){
   const message=(host.getState().messages[key()]||[]).find(message=>message.id===id);if(!owned(message))return false;
   try{const quote=liveReplyDraft(snapshot(),{entryId:id,messageId:target?.dataset.replyMessageId});
    const result=host.commit(current=>({...current,replyDrafts:{...current.replyDrafts,[key()]:quote}}),{reason:'live-reply-draft'});
    if(!result.ok)throw new Error('Het antwoordconcept kon niet worden opgeslagen.');
    host.render();host.app.querySelector('#message-input')?.focus();
   }catch(error){setError(key(),error);}return true;
  }
  if(action==='live-reply-jump'){
   const messageId=target?.dataset.replyMessageId,entryId=target?.dataset.replyEntryId,conversation=key();
   const ids=[messageId,entryId].filter(value=>typeof value==='string'&&value);
   const resolve=()=>conversation!==key()?null:Array.from(host.app.querySelectorAll('[data-live-message-id]')).find(item=>item.dataset.liveMessageId===messageId)
    ||Array.from(host.app.querySelectorAll('[data-chat-entry-id], [data-message-id]')).find(item=>ids.includes(item.dataset.chatEntryId)||ids.includes(item.dataset.messageId));
   if(resolve())transcriptReaderFor(host)?.navigateToTarget(resolve);
   else host.revealTranscriptEntry?.(conversation,messageId||entryId);
   return true;
  }
  const canvasHandled=canvases?.handleAction({action,id,target});if(canvasHandled)return canvasHandled;
  const skillHandled=skillsSurface?.handleAction({action,id,target});if(skillHandled)return skillHandled;
  const connectorHandled=connectors?.handleAction({action,id,target});if(connectorHandled)return connectorHandled;
  const workflowHandled=workflows?.handleAction({action,id,target});if(workflowHandled)return workflowHandled;
  if(action==='send-message'&&isLive())return send();
  if(action==='live-retry'){const request=prefs().pendingSends[key()];return request?dispatchRequest(key(),request):true;}
  if(action==='reset-demo'&&hasLiveHarnessOwnership(host.getState())){host.closeDialog?.();host.showChatError(liveHistoryResetMessage);return true;}
  if(action==='clear-chat'&&hasLiveHarnessOwnership(host.getState(),key())){host.closePopover();setError(key(),new Error('Echte geschiedenis wordt op deze Mac bewaard. Start een nieuw gesprek om met een leeg gesprek te werken. Stop lopende uitvoering eerst via Stoppen.'));host.showChatError(errors.get(key()));return true;}
  if(action==='computer-settings'&&isLive())return handleAction({action:'live-open-computer'});
  if(!action.startsWith('live-'))return false;
  if(action==='live-tab'){activeTab=id;const current=host.app.querySelector('.live-computer');if(current)current.outerHTML=panelMarkup();sync();host.app.querySelector('.live-tabs [aria-selected=true]')?.focus({preventScroll:true});if(id==='tools'&&key()!=='new')void loadTools(key()).catch(error=>setError(key(),error));return true;}
  if(action==='live-open-computer'){if(key()==='new'&&!host.ensureConversation())return true;host.getState().context=true;host.getState().contextTab='computer';host.render();return true;}
  if(key()==='new'){const agent=host.ensureConversation();if(!agent)return true;}
  return command(action,id,target);
 }
 function handlePanelInput(event){queueMicrotask(()=>workflows.paintComposer());const field=event.target.dataset.liveInput;if(field){draft()[field]=event.target.value;if(browserDraftFields.has(field)){const preferences=prefs();preferences.browserDrafts??={};preferences.browserDrafts[key()]=Object.fromEntries(Object.entries(draft()).filter(([name])=>browserDraftFields.has(name)));if(!host.persist())setError(key(),new Error('Browserinvoer kon niet worden opgeslagen.'));}}}
 const timer=setInterval(()=>{
  if(disposed||polling)return;
  const ids=new Set(recovering.keys()),current=key();
  if(current!=='new'&&isLive(current))ids.add(current);
  if(!ids.size)return;polling=true;
  Promise.allSettled([...ids].map(id=>refresh(id))).finally(()=>{polling=false;});
 },1200);
 const themeObserver=new MutationObserver(sync);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 skillsSurface=createLiveSkillsSurface({host,client,isLive});
 canvases=createLiveCanvasSurface({host,client,isLive,key,serverId});
 connectors=createLiveConnectorsSurface({host,client,key,serverId,isLive,snapshot,adopt,refresh,draft,sync,setError});
 workflows=createLiveWorkflowsSurface({host,client,key,serverId,isLive,snapshot,refresh,setError,clearError:id=>{errors.delete(id);sync();},activeRun});
 void refreshStatus();
 return {id:'live-harness',isTranscriptGenerating:()=>Boolean(activeRun()),isLive,mcpReferenceInventory,refreshMcpReferences:()=>isLive()&&key()!=='new'?refresh(key(),{afterPending:true}):Promise.resolve(),promoteConversation(candidate,id){const value=prefs(candidate);if(value.modes.new){value.modes={...value.modes,[id]:value.modes.new};delete value.modes.new;}},
  beforeRender,afterRender,handleAction,handleKeyDown,beforeDialogChange(){skillsSurface.beforeDialogChange();connectors.beforeDialogChange();},afterDialogChange(){skillsSurface.afterDialogChange();connectors.afterDialogChange();},handleSubmit(context){const handled=workflows.handleSubmit(context);if(handled)return handled;if(context.submit==='composer-form'&&isLive())return send();return false;},
  handleInput(event){canvases.handleInput(event);skillsSurface.handleInput(event);handlePanelInput(event);},
  handleChange(event){if(event.target.dataset.liveInput)handlePanelInput(event);connectors.handleChange(event);workflows.handleChange(event);if(!event.target.matches('[data-live-mode]')||!event.target.checked)return;const value=event.target.value==='live'?'live':'demo',id=key();prefs().modes[id]=value;host.persist();errors.delete(id);host.render();host.app.querySelector(`[data-live-mode][value="${value}"]`)?.focus({preventScroll:true});if(value==='live'){void skillsSurface.refresh();void refreshStatus();if(id!=='new')void refresh(id).catch(()=>{});}},
  renderSlot(name,context={}){const canvasSlot=canvases.renderSlot(name,context);if(canvasSlot!==undefined)return canvasSlot;const skillSlot=skillsSurface.renderSlot(name);if(skillSlot!==undefined)return skillSlot;const {message}=context,workflowSlot=workflows.renderSlot(name,context);if(workflowSlot!==undefined)return workflowSlot;if(name==='liveExecutionSelector')return selectorMarkup();if(name==='liveSendError')return isLive()?`<div class="live-send-feedback"><p class="live-error" role="status" data-live-send-error ${errors.get(key())?'':'hidden'}>${esc(errors.get(key())||'')}</p><button class="text-button small" data-action="live-retry" ${prefs().pendingSends[key()]?'':'hidden'}>Ontvangst controleren</button></div>`:'';
   if(name==='computerPanel'&&isLive())return panelMarkup();if(name==='chatEntryBody'&&owned(message))return message.liveHarness.kind==='assistant'?`<div class="message-body" data-live-entry="${esc(message.id)}"></div>`:'';
   if(name==='chatEntryStatus'&&owned(message))return statusMarkup(message);if(name==='transcriptCard'&&owned(message))return cardMarkup(message)||'';
   if(name==='messageCopyText'&&owned(message))return message.text;if(name==='chatComposerNotice'&&isLive())return `<div class="chat-composer-mode small"><span>Echte uitvoering in de taskbox van dit gesprek</span><button class="text-button" data-action="live-open-computer">Computer openen</button></div>`;
   return undefined;},
  diagnostics:()=>({conversations:snapshots.size,streams:streams.size,mode:isLive()?'live':'demo'}),
  destroy(){disposed=true;cloud.destroy();attachmentPreview.destroy();canvases.destroy();skillsSurface.destroy();connectors.destroy();workflows.destroy();clearInterval(timer);themeObserver.disconnect();for(const stream of streams.values())stream.close();streams.clear();for(const view of views.values())view.destroy();views.clear();diagram.destroy();parking.remove();}
 };
}

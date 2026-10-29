import {createLiveAccountsSurface} from './live-accounts-surface.js';
import {createConnectorController} from './live-connectors-controller.js';
const preset={id:'context7',name:'Context7',url:'https://mcp.context7.com/mcp'};
const stateLabel=state=>({connected:'Verbonden',disabled:'Uitgeschakeld',authenticationRequired:'Authenticatie vereist',failed:'Verbinding mislukt',unavailable:'Niet beschikbaar',disconnected:'Niet verbonden',starting:'Verbinden…',notStarted:'Nog niet gestart',cancelled:'Verbinding gestopt'}[state]||'Nog niet verbonden');
export function createLiveConnectorsSurface({host,client,key,serverId,isLive,snapshot,adopt,refresh,draft,sync,setError}){
 let detail=null,disposed=false;
 const esc=host.esc;
 const accounts=createLiveAccountsSurface({host,client,key,serverId,isLive,refresh});
 const controller=createConnectorController({key,serverId,client,adopt,refresh,onChange:()=>{if(!disposed){paintDetail();sync();}}});
 const contextServer=()=>snapshot().servers.find(server=>server.id==='custom_context7');
 const toolNames=server=>[...new Set([...(server.tools||[]).map(tool=>tool.name),...(server.configuration?.disabledTools||[])])];
 function errorMarkup(){const error=controller.error();if(!error)return '';const text=error.code==='MCP_CONFIG_LOCKED'?'De MCP-configuratie is vastgezet na het eerste bericht. Start een nieuw gesprek om deze instelling te wijzigen. De vorige instelling blijft behouden.':error.message;return `<p class="live-error" role="alert">${esc(text)}</p>`;}
 function toolsMarkup(server){
  const names=toolNames(server),disabled=server.configuration?.disabledTools||[],busy=controller.busy(),editable=Boolean(server.configuration)&&!server.configuration.readOnly;
  return names.map(name=>{const tool=server.tools?.find(tool=>tool.name===name),checked=!disabled.includes(name);return `<details class="tool-row" data-permissions-bound><summary><strong>${esc(name)}</strong></summary><p>${esc(tool?.description||'Deze tool is uitgeschakeld in de MCP-configuratie.')}</p><label class="product-team-choice"><span>Deze tool inschakelen</span><input type="checkbox" aria-label="${esc(name)} inschakelen" data-live-connector-tool="${esc(name)}" data-server-id="${esc(server.id)}" ${checked?'checked':''} ${busy||!editable?'disabled':''}></label></details>`;}).join('');
 }
 function serverMarkup(server){
  const configured=server.configuration,enabled=configured?.enabled!==false;
  return `<section class="live-tool-server"><h4>${esc(server.name||server.id)} <span class="small muted">${esc(server.state)}</span></h4>${server.reason?`<p>${esc(server.reason)}</p>`:''}${configured?`<label class="product-team-choice"><span>Connector inschakelen</span><input type="checkbox" aria-label="${esc(server.name||server.id)} inschakelen" data-live-connector-state="${esc(server.id)}" ${enabled?'checked':''} ${controller.busy()||configured.readOnly?'disabled':''}></label>`:''}${toolsMarkup(server)}</section>`;
 }
 function detailMarkup(){
  const server=contextServer(),busy=controller.busy(),names=server?toolNames(server):[],disabled=server?.configuration?.disabledTools||[],app=host.appData.find(app=>app.id==='context');
  return `<div class="market-scroll"><button class="market-back" data-action="market-back" aria-label="Terug">${host.icon('left')}Terug</button><div class="detail-hero">${host.logo(app)}<div class="fill"><h1>Context7</h1><p>Context7 MCP</p></div><button class="primary-button" data-action="live-context7-connect" ${busy?'disabled':''}>${busy?'Verbinden…':server?.state==='connected'?'Opnieuw verbinden':server?'Opnieuw proberen':'Toevoegen'}</button></div><p class="detail-description">${esc(app.description)}</p><section class="detail-section"><h2>Accounts</h2>${accounts.buttonMarkup()}<div class="account-state"><span class="fill">default</span><span role="status">${busy?'Verbinden…':stateLabel(server?.state)}</span></div>${server?.reason?`<p>${esc(server.reason)}</p>`:''}${server?.state==='authenticationRequired'?'<p>Deze server vraagt authenticatie. Er is geen account verbonden. Gebruik een MCP-server waarvoor je al toegang hebt.</p>':''}${server?.configuration?`<label class="product-team-choice"><span>Connector inschakelen</span><input type="checkbox" aria-label="Context7 inschakelen" data-live-connector-state="${esc(server.id)}" ${server.configuration.enabled!==false?'checked':''} ${busy?'disabled':''}></label>`:''}</section><section class="detail-section"><h2>Tools <span class="muted">${names.length-disabled.filter(name=>names.includes(name)).length} van ${names.length} ingeschakeld</span></h2>${server?toolsMarkup(server):'<p>Verbind deze app om de werkelijke tools te ontdekken.</p>'}</section><section class="detail-section"><h2>Informatie</h2><div class="setting-row"><span>Server</span><span class="muted">mcp.context7.com</span></div><div class="setting-row"><span>Gesprek</span><span class="muted">${esc(host.getAgent?.(key())?.name||key())}</span></div><p class="small muted">Echte MCP-configuratie voor dit gesprek. Wijzig instellingen vóór het eerste bericht.</p></section>${errorMarkup()}</div>`;
 }
 function referenceMarkup(server){return `<div class="live-mcp-reference-details"><h1>${esc(server.name||server.id)}</h1><p class="mcp-runtime-id">${esc(server.id)}</p>${serverMarkup(server)}</div>`;}
 function openReference(runtimeId){
  const server=snapshot().servers.find(row=>row.id===runtimeId&&row.configuration);if(!server)return false;
  host.closePopover();host.showDialog('settings-dialog',server.name||server.id,referenceMarkup(server));detail={serverId:runtimeId,conversation:key(),version:host.getDialogVersion(),signature:''};paintDetail();return true;
 }
 function openDetail(){
  if(key()==='new'&&!host.ensureConversation())return true;
  host.closePopover();host.showDialog('marketplace','Context7',detailMarkup());detail={conversation:key(),version:host.getDialogVersion(),signature:''};paintDetail();
  void refresh(key()).catch(()=>{});return true;
 }
 function paintDetail(){
  if(!detail||!host.overlay.open||detail.conversation!==key()||detail.version!==host.getDialogVersion())return;
  const server=detail.serverId?snapshot().servers.find(row=>row.id===detail.serverId&&row.configuration):null;
  const markup=detail.serverId?(server?referenceMarkup(server):'<div class="live-mcp-reference-details"><p>Deze server is niet beschikbaar in dit gesprek.</p></div>'):detailMarkup();if(markup===detail.signature)return;
  const openTools=new Set(Array.from(host.overlay.querySelectorAll('details[open] strong')).map(node=>node.textContent));
  const content=host.overlay.querySelector(detail.serverId?'.live-mcp-reference-details':'.market-scroll');if(!content)return;content.outerHTML=markup;detail.signature=markup;
  for(const node of host.overlay.querySelectorAll('details.tool-row'))if(openTools.has(node.querySelector('strong')?.textContent))node.open=true;
 }
 function paintCatalogBoundary(){
  if(!isLive()||!host.overlay?.open)return;
  for(const row of host.overlay.querySelectorAll?.('.app-row[data-app="github"], .app-row[data-app="notion"]')||[]){
   const app=host.appData?.find(item=>item.id===row.dataset.app),description=row.querySelector('.app-info p');
   if(app&&description)description.textContent=app.description;
  }
  const button=host.overlay.querySelector('.connected-button[data-action="market-installed"]');if(!button)return;
  const label=host.getState().installed.length+' lokale voorbeelden';
  if(button.children[1])button.children[1].textContent=label;
  button.setAttribute('aria-label',label);
 }
 function formMarkup(values){return `<details class="live-mcp-form"><summary>MCP-server toevoegen</summary><p class="small muted">Voeg servers toe vóór het eerste bericht. Geen geheime waarden in deze velden.</p><label class="field-label">Verbinding<select class="field-input" aria-label="MCP-transport" data-live-input="mcpTransport"><option value="stdio" ${values.mcpTransport!=='http'?'selected':''}>Lokaal proces (stdio)</option><option value="http" ${values.mcpTransport==='http'?'selected':''}>HTTP-server</option></select></label><label class="field-label">Server-ID<input class="field-input" aria-label="MCP-server-ID" data-live-input="mcpId" value="${esc(values.mcpId||'')}" placeholder="mijn_server"></label><label class="field-label">Naam<input class="field-input" aria-label="MCP-servernaam" data-live-input="mcpName" value="${esc(values.mcpName||'')}"></label><label class="field-label">HTTP-server-URL<input class="field-input" aria-label="MCP-server-URL" data-live-input="mcpUrl" value="${esc(values.mcpUrl||'')}" placeholder="https://voorbeeld.nl/mcp"></label><label class="field-label">Absoluut commando (stdio)<input class="field-input" aria-label="MCP-commando" data-live-input="mcpCommand" value="${esc(values.mcpCommand||'')}" placeholder="/absoluut/pad/naar/server"></label><label class="field-label">Argumenten als JSON-array (stdio)<textarea class="field-input live-command" aria-label="MCP-argumenten" data-live-input="mcpArgs" rows="2">${esc(values.mcpArgs||'[]')}</textarea></label><button class="outline-button" data-action="live-mcp-add" ${controller.busy()?'disabled':''}>Server verbinden</button></details>`;}
 function customServer(){
  const values=draft(),id=values.mcpId?.trim(),name=values.mcpName?.trim()||id;
  if(!id)throw new Error('Vul een server-ID in.');
  if(values.mcpTransport==='http'){
   let url;try{url=new URL(values.mcpUrl||'');}catch{throw new Error('Vul een geldige HTTP-server-URL in.');}
   if(url.protocol!=='https:'&&!/^http:\/\/(127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(url.href)||url.username||url.password||url.search||url.hash)throw new Error('Gebruik HTTPS of HTTP op loopback, zonder inloggegevens of queryparameters.');
   return {id,name,url:url.href};
  }
  let args;try{args=JSON.parse(values.mcpArgs||'[]');}catch{throw new Error('Argumenten moeten een JSON-array zijn.');}
  if(!Array.isArray(args)||args.some(value=>typeof value!=='string'))throw new Error('Gebruik een JSON-array met uitsluitend tekstargumenten.');
  if(!values.mcpCommand?.startsWith('/'))throw new Error('Vul een absoluut commando in.');
  return {id,name,command:values.mcpCommand,args};
 }
 function handleAction({action,id,target}){
  if(!isLive())return false;
  const accountHandled=accounts.handleAction({action,id,target});if(accountHandled)return accountHandled;
  if(['plugin-detail','plugin-add','plugin-remove','plugin-auth','product-chat-connector','product-connector-chat-toggle'].includes(action)&&['github','notion'].includes(id))return accounts.openProvider(id);
  if(['plugin-detail','plugin-add','plugin-remove','plugin-auth','product-chat-connector','product-connector-chat-toggle'].includes(action)&&id==='context')return action==='plugin-detail'?openDetail():openAndConnect();
  if(action==='live-context7-connect')return controller.add(preset);
  if(action==='live-mcp-add'){try{return controller.add(customServer());}catch(error){setError(key(),error);return true;}}
  return false;
 }
 function openAndConnect(){openDetail();return controller.add(preset);}
 function handleChange(event){
  accounts.handleChange(event);
  const target=event.target;if(!isLive())return;
  if(target.dataset.liveInput==='mcpTransport')draft().mcpTransport=target.value;
  if(target.dataset.liveConnectorState){const server=snapshot().servers.find(server=>server.id===target.dataset.liveConnectorState);if(!server||server.configuration?.readOnly)return;const enabled=target.checked;target.checked=server.configuration?.enabled!==false;return controller.state(server.id,enabled);}
  if(target.dataset.liveConnectorTool){const server=snapshot().servers.find(server=>server.id===target.dataset.serverId);if(!server?.configuration||server.configuration.readOnly)return;const name=target.dataset.liveConnectorTool,checked=target.checked,disabled=new Set(server.configuration.disabledTools||[]);target.checked=!disabled.has(name);if(checked)disabled.delete(name);else disabled.add(name);return controller.permissions(server.id,[...disabled].sort());}
 }
 return {handleAction,handleChange,openReference,serverMarkup,formMarkup,errorMarkup,busy:controller.busy,
  toolsFooter:()=>`${accounts.buttonMarkup()}<button class="outline-button" data-action="live-context7-connect" ${controller.busy()?'disabled':''}>Context7 verbinden</button>${errorMarkup()}`,
  afterDialogChange(){accounts.afterDialogChange();paintCatalogBoundary();paintDetail();},beforeDialogChange(){accounts.beforeDialogChange();detail=null;},sync(){accounts.sync();paintCatalogBoundary();paintDetail();},destroy(){disposed=true;accounts.destroy();controller.destroy();}};
}

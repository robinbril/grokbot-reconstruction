import { source,bindWorkspace,ownScope } from './product-workspace-utils.js';
export function createConnectorSurface(host) {
  const scope=ownScope(host);let pending=null;
  function augment() {
    if(!host.overlay.open)return;
    for(const details of host.overlay.querySelectorAll('.detail-section details.tool-row')) {
      if(Object.hasOwn(details.dataset,'permissionsBound'))continue;details.dataset.permissionsBound='';
      const name=details.querySelector('summary strong')?.textContent||'Tool',key=`${host.overlay.getAttribute('aria-label')}:${name}`,label=document.createElement('label');label.className='product-team-choice';label.innerHTML=`<span>Deze tool inschakelen</span><input type="checkbox" aria-label="${host.esc(name)} inschakelen" data-connector-permission="${host.esc(key)}" ${host.getState().connectorPermissions?.[key]===false?'':'checked'}>`;details.append(label);
      const summary=details.querySelector('summary');if(summary){const glyph=document.createElement('span');glyph.innerHTML=host.icon('down');glyph.dataset.sourceInstance='INSTANCE-051';glyph.style.marginInlineStart='auto';summary.append(glyph);details.addEventListener('toggle',()=>glyph.style.transform=details.open?'rotate(180deg)':'rotate(0deg)',{signal:scope.signal});}
    }
    bindWorkspace(host);
  }
  function saveError(target,message){const root=target?.closest('.product-connector-card,.detail-hero')||(host.overlay.open?host.overlay:host.app);let status=root.querySelector('[data-connector-save-error]');if(!status){status=document.createElement('p');status.dataset.connectorSaveError='';status.setAttribute('role','alert');root.append(status);}status.textContent=message;}
  function picker(){host.closePopover();host.showDialog('small-dialog','App koppelen aan gesprek',`<div class="product-dialog-header"><h1>App koppelen aan gesprek</h1></div><div class="product-dialog-body">${host.appData.map(app=>`<button class="file-row" data-action="product-chat-connector" data-id="${host.esc(app.id)}" ${source(162)}>${host.logo(app)}<span>${host.esc(app.name)}</span></button>`).join('')}</div>`);bindWorkspace(host);}
  return {
    renderSlot(name,{message}={}){if(name!=='transcriptCard'||!message?.productConnector)return;const app=host.appData.find(a=>a.id===message.productConnector);if(!app)return '';const installed=host.getState().installed.includes(app.id);return `<section class="tool-card product-connector-card" aria-label="${host.esc(app.name)} koppeling"><div class="row">${host.logo(app)}<strong>${host.esc(app.name)}</strong></div><p>${host.esc(app.description)}</p><div class="row between"><span ${source(166)}>${installed?'Lokaal toegevoegd':'Nog niet toegevoegd'}</span><button class="outline-button" data-action="product-connector-chat-toggle" data-id="${host.esc(app.id)}" ${source(164)}>${installed?'Verwijderen':'Toevoegen'}</button></div><p class="product-local-boundary">De koppeling wordt lokaal bewaard. Voor echte tools is authenticatie bij de dienst nodig.</p></section>`;},
    afterDialogChange(){augment();},afterRender(){augment();},
    handleAction({action,id,target}) {
      if(action==='connect-app-chat'){picker();return true;}
      if(action==='product-chat-connector'){const app=host.appData.find(a=>a.id===id);if(!app)return true;const conversation=host.ensureConversation();if(!conversation)return true;const key=conversation.id,state=host.getState(),previous=state.messages[key]?[...state.messages[key]]:undefined;const saved=host.update(state=>{state.messages[key]||=[];state.messages[key].push({id:crypto.randomUUID(),role:'bot',text:`Koppel ${app.name} aan dit gesprek.`,productConnector:id,createdAt:Date.now()});},{render:false});if(saved===false){if(previous)state.messages[key]=previous;else delete state.messages[key];saveError(target,'Koppeling niet opgeslagen. Je keuze blijft beschikbaar; probeer opnieuw.');return true;}host.closeDialog();host.render();return true;}
      if(action==='product-connector-chat-toggle'){const state=host.getState(),previous={installed:[...state.installed],authenticated:[...state.authenticated]},saved=host.update(state=>{state.installed=state.installed.includes(id)?state.installed.filter(x=>x!==id):[...state.installed,id];state.authenticated=state.authenticated.filter(x=>state.installed.includes(x));},{render:false});if(saved===false){Object.assign(state,previous);saveError(target,'Koppeling niet opgeslagen. De vorige instelling blijft behouden; probeer opnieuw.');return true;}host.render();return true;}

      if(action==='plugin-add'||action==='plugin-remove'){
        if(!host.appData.some(app=>app.id===id))return false;
        const remove=action==='plugin-remove',version=host.getDialogVersion(),generation=scope.generation;pending=id;const originalHTML=target.innerHTML;target.disabled=true;
        const spinner=document.createElement('span');spinner.dataset.sourceInstance='INSTANCE-053';spinner.innerHTML=host.icon('refresh');target.prepend(spinner);bindWorkspace(host);
        return new Promise(resolve=>queueMicrotask(()=>{if(generation!==scope.generation||version!==host.getDialogVersion()){resolve(true);return;}const state=host.getState(),previous={installed:[...state.installed],authenticated:[...state.authenticated]},saved=host.update(state=>{state.installed=state.installed.filter(value=>value!==id);if(!remove)state.installed.push(id);if(remove)state.authenticated=state.authenticated.filter(value=>value!==id);},{render:false});pending=null;spinner.remove();target.disabled=false;if(saved===false){Object.assign(state,previous);target.innerHTML=originalHTML;saveError(target,'App niet opgeslagen. De vorige instelling blijft behouden; probeer opnieuw.');resolve(true);return;}host.overlay.querySelector('[data-connector-save-error]')?.remove();target.dataset.action=remove?'plugin-add':'plugin-remove';target.textContent=remove?'Toevoegen':'Verwijderen';resolve(true);}));
      }
      return false;
    },
    handleChange(event){const target=event.target,key=target.dataset.connectorPermission;if(key){const state=host.getState(),previous=state.connectorPermissions?{...state.connectorPermissions}:undefined,saved=host.update(state=>{state.connectorPermissions||={};state.connectorPermissions[key]=target.checked;},{render:false});if(saved===false){if(previous)state.connectorPermissions=previous;else delete state.connectorPermissions;target.checked=previous?.[key]!==false;saveError(target,'Toolinstelling niet opgeslagen. De vorige keuze blijft behouden; probeer opnieuw.');}else host.overlay.querySelector('[data-connector-save-error]')?.remove();}},
    beforeDialogChange(){scope.clear();pending=null;},destroy(){scope.clear();},
  };
}

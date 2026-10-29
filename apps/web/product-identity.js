import { source, bindWorkspace, ownScope } from './product-workspace-utils.js';
import { selectionContour, characterSwatch } from './product-identity-decoration.js';
import { CREATE_COLORS, createIdentityChoice } from './product-identity-choice.js';
import { LOGO_FLIGHT_SPRING } from './product-workspace-motion.js';
import { createAvatarGeneration } from './product-identity-pending.js';
import { createTemplateSurface } from './product-template.js';

export function createIdentitySurface(host) {
  const { esc, avatar, icon } = host, colors=host.colors.map((c,i)=>({...c,value:CREATE_COLORS[i]})), scope = ownScope(host);
  const shapeLabels=['blob','wolk','vierkant','sprankel','klaver','hart','bloem','druppel','tablet','wig','huis','ster','zeshoek'];
  let draft = null, editorId = null, uploaded = null, uploadSequence = 0;
  const generation = createAvatarGeneration(host, { avatar, getCandidate() {
    const state = host.getState(), agent = editorId === 'identity' ? { shape: state.botShape, color: state.botColor } : host.getAgent(editorId);
    if (!agent) return null;
    return { shape: ((uploaded?.shape ?? agent.shape) + 1) % 13, color: agent.color, avatarDescription: host.overlay.querySelector('[aria-label="Beschrijving van personage"]')?.value || '' };
  }, acceptCandidate(candidate) { uploaded = candidate; } });
  const templates = createTemplateSurface(host, openCreate);
  function openCreate(name = '', configuration = {}) {
    scope.clear(); draft = {name,...createIdentityChoice(crypto.randomUUID()), ...configuration};
    host.showDialog('product-bot-dialog','Nieuwe Bot maken', `<form class="product-bot-create" data-submit="product-new-bot"><h1>Nieuwe Bot maken</h1><button type="button" class="product-bot-hero" data-bot-hero aria-label="Personage" ${source(278)}>${avatar(draft,'large')}</button><input class="product-bot-name" name="name" aria-label="Bot-naam" placeholder="Geef je Bot een naam" maxlength="80" value="${esc(name)}" required autocomplete="off"><div class="product-shape-grid" role="group" aria-label="Vorm van personage">${Array.from({length:13},(_,shape)=>`<button type="button" aria-label="Vorm van personage ${shapeLabels[shape]}" aria-pressed="${shape===draft.shape}" data-action="product-bot-shape" data-value="${shape}">${avatar({...draft,shape},'static')}${selectionContour(shape,'create')}</button>`).join('')}</div><div class="product-color-grid" role="group" aria-label="Kleur van personage">${colors.map((c,index)=>`<button type="button" aria-label="${esc(c.name)}" aria-pressed="${c.value===draft.color}" data-action="product-bot-color" data-value="${c.value}" style="--swatch:${characterSwatch(c.value,index)}"></button>`).join('')}</div><div class="form-actions"><button type="button" class="outline-button" data-action="close-modal">Annuleren</button><button class="primary-button" type="submit" ${name?'':'disabled'}>Maken</button></div></form>`);
    bindWorkspace(host); host.overlay.querySelector('[name=name]')?.focus();
  }
  function updateChoices() {
    host.overlay.querySelector('[data-bot-hero]').innerHTML=avatar(draft,'large');
    host.overlay.querySelectorAll('[data-action=product-bot-shape]').forEach(node=>{node.setAttribute('aria-pressed',String(Number(node.dataset.value)===draft.shape));node.innerHTML=avatar({...draft,shape:Number(node.dataset.value)},'static')+selectionContour(Number(node.dataset.value),'create');});
    host.overlay.querySelectorAll('[data-action=product-bot-color]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.value===draft.color)));
    host.afterSurfaceChange?.();
  }
  function openEditor(id) {
    scope.clear(); editorId=id||host.getConversationKey(); uploaded=null; uploadSequence++;
    const state=host.getState(), agent=editorId==='identity'?{color:state.botColor,shape:state.botShape}:host.getAgent(editorId);if(!agent)return;
    host.showDialog('small-dialog','Avatar wijzigen',`<div class="product-dialog-header"><h1>Avatar wijzigen</h1></div><div class="product-avatar-editor"><div data-avatar-editor-preview>${avatar(agent,'large')}</div><div role="tablist" aria-label="Avatarbron"><button role="tab" aria-selected="true" data-action="product-avatar-tab" data-value="generate">Personage</button><button role="tab" aria-selected="false" data-action="product-avatar-tab" data-value="upload">Uploaden</button></div><label class="field-label">Beschrijving<input class="field-input" aria-label="Beschrijving van personage" placeholder="Kies een naam voor je personage"></label><button class="outline-button" data-action="product-avatar-generate">Personage variëren</button><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Avatar uploaden" data-avatar-upload hidden><p class="product-local-boundary">Personages worden lokaal gevarieerd. Uploads blijven in deze browser.</p><button class="primary-button" data-action="product-avatar-save">Gebruiken</button></div>`);bindWorkspace(host);
  }
  function finishCreate(form,data) {
    const name=String(data.get('name')||'').trim();if(!draft||!name)return true;
    const hero=host.overlay.querySelector('[data-bot-hero]'),from=hero?.getBoundingClientRect(), newAgent={id:crypto.randomUUID(),name,shape:draft.shape,color:draft.color,description:draft.description||'',...(draft.config?{config:structuredClone(draft.config)}:{}),preview:'Nieuw gesprek'};
    const previous={agents:[...host.getState().agents],selected:host.getState().selected,context:host.getState().context,contextTab:host.getState().contextTab};
    const saved=host.update(state=>{state.agents.push(newAgent);state.selected=newAgent.id;state.context=true;state.contextTab='details';},{render:false});
    if(saved===false){Object.assign(host.getState(),previous);let status=form.querySelector('[role=status]');if(!status){status=document.createElement('p');status.setAttribute('role','status');form.append(status);}status.textContent='Bot niet opgeslagen. Je keuzes blijven beschikbaar; probeer opnieuw.';return true;}
    host.closeDialog();host.render();
    const target=[...host.app.querySelectorAll('[data-action=select-agent]')].find(n=>n.dataset.id===newAgent.id)?.querySelector('.avatar');
    if(from&&target) {
      const to=target.getBoundingClientRect(), flight=document.createElement('div');flight.className='product-logo-flight';flight.setAttribute('data-source-instance','INSTANCE-278 INSTANCE-279');flight.innerHTML=avatar(newAgent,'large');Object.assign(flight.style,{position:'fixed',zIndex:'2000',pointerEvents:'none',left:'0',top:'0',width:`${from.width}px`,height:`${from.height}px`});document.body.append(flight);host.sourceMotion.bindTree(flight);
      const start=`translate(${from.left}px,${from.top}px) scale(1)`, end=`translate(${to.left}px,${to.top}px) scale(${to.width/from.width})`;flight.style.transformOrigin='top left';flight.style.transform=end;
      const a=scope.animate(flight,[{transform:start},{transform:end}],{duration:host.sourceMotion.reduced?0:531,easing:LOGO_FLIGHT_SPRING},{family:'logo-flight',trigger:'created-bot-roster-handoff'});if(a)a.finished.then(()=>flight.remove(),()=>flight.remove());else flight.remove();
    }
    draft=null;return true;
  }
  return {
    handleAction({action,id,value}) {
      if(action==='new-bot'){host.closePopover();openCreate();return true;}
      if(action==='create-template'){templates.open(id);return true;}
      if(templates.handleAction({action,id,value}))return true;
      if(action==='product-bot-shape'&&draft){draft.shape=Math.max(0,Math.min(12,Number(value)||0));updateChoices();return true;}
      if(action==='product-bot-color'&&draft){if(colors.some(c=>c.value===value))draft.color=value;updateChoices();return true;}
      if(action==='avatar-editor'){openEditor(id);return true;}
      if(action==='product-avatar-tab'){const upload=value==='upload';host.overlay.querySelector('[data-avatar-upload]').hidden=!upload;host.overlay.querySelectorAll('[role=tab]').forEach(n=>n.setAttribute('aria-selected',String(n.dataset.value===value)));return true;}
      if(action==='product-avatar-generate'){void generation.generate();return true;}
      if(action==='product-avatar-save'){if(generation.pending)return true;if(uploaded){const state=host.getState(),previous={agents:structuredClone(state.agents),botShape:state.botShape,botPhoto:state.botPhoto},saved=host.update(state=>{if(editorId==='identity'){state.botShape=uploaded.shape??state.botShape;if(uploaded.photo)state.botPhoto=uploaded.photo;else if(uploaded.shape!==undefined)delete state.botPhoto;}else{const agent=state.agents.find(a=>a.id===editorId);if(agent){Object.assign(agent,uploaded);if(uploaded.shape!==undefined&&!uploaded.photo)delete agent.photo;}}},{render:false});if(saved===false){Object.assign(state,previous);let status=host.overlay.querySelector('[data-avatar-save-error]');if(!status){status=document.createElement('p');status.dataset.avatarSaveError='';status.setAttribute('role','alert');host.overlay.querySelector('.product-avatar-editor').append(status);}status.textContent='Avatar niet opgeslagen. Je keuze blijft beschikbaar; probeer opnieuw.';return true;}}host.closeDialog();host.render();scope.clear();return true;}
      return false;
    },
    handleSubmit({submit,form,data}) {if(submit==='product-new-bot')return finishCreate(form,data);return false;},
    handleInput(event){templates.handleInput(event);if(event.target.matches('.product-bot-name')&&draft){draft.name=event.target.value;host.overlay.querySelector('[type=submit]').disabled=!draft.name.trim();}},
    async handleChange(event){if(generation.pending||!event.target.matches('[data-avatar-upload]'))return;const file=event.target.files?.[0],sequence=++uploadSequence,version=host.getDialogVersion();if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)return;const reader=new FileReader();reader.onload=()=>{if(sequence!==uploadSequence||version!==host.getDialogVersion())return;uploaded={photo:String(reader.result)};const img=document.createElement('img');img.src=uploaded.photo;img.alt='Gekozen avatar';img.width=100;img.height=100;host.overlay.querySelector('[data-avatar-editor-preview]')?.replaceChildren(img);};reader.readAsDataURL(file);},
    beforeDialogChange(){generation.clear();uploadSequence++;scope.clear();},
    renderSlot(name,{agent}={}) {if(name==='contextIdentity'&&agent)return `<div class="context-avatar"><button data-action="avatar-picker" data-id="${esc(agent.id)}" aria-label="Bot-avatar wijzigen">${avatar(agent,'large')}</button><h2>${esc(agent.name)}</h2><span class="small muted">${agent.team?'Gedeeld met je lokale team':'Alleen jij'}</span></div>`;},
    destroy(){generation.clear();scope.clear();uploadSequence++;},
  };
}

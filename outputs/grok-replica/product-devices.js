const timeLabel=value=>Number.isFinite(value)?new Date(value).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}):'';
export function devicePanelMarkup({esc,devices=null,pairing=null,busy=false,error='',notice=''}={}){
 const disabled=busy?' disabled':'';
 const rows=devices?.devices||[];
 return `<div class="device-panel" data-devices-root aria-busy="${busy}">
 <header class="device-panel-heading"><h1>Apparaten</h1><p>Koppel je apparaten om gesprekken en leesstatus op dezelfde server te gebruiken.</p></header>
 ${error?`<p class="device-feedback device-error" role="alert">${esc(error)}</p>`:''}${notice?`<p class="device-feedback" role="status">${esc(notice)}</p>`:''}
 <div class="device-pairing-grid"><section class="device-section" aria-labelledby="device-allow-title"><h2 id="device-allow-title">Ander apparaat toelaten</h2><p>Maak hier een code en vul deze in op je andere apparaat.</p>
 <button type="button" class="outline-button" data-action="device-pair-start"${disabled}>${pairing?'Nieuwe koppelcode maken':'Koppelcode maken'}</button>
 ${pairing?`<label class="field-label" for="device-generated-code">Eenmalige koppelcode</label><textarea id="device-generated-code" class="field-input device-code" aria-label="Eenmalige koppelcode" readonly autocomplete="off" spellcheck="false" data-device-generated-code>${esc(pairing.code)}</textarea><p class="device-code-help">Vul deze eenmalige code op je andere apparaat in. Alleen met iemand delen die toegang mag krijgen.</p><p class="device-expiry">Geldig tot <time>${esc(timeLabel(pairing.expiresAt))}</time>.</p>`:''}</section>
 <section class="device-section" aria-labelledby="device-join-title"><h2 id="device-join-title">Op dit apparaat koppelen</h2><p>Gebruik de code van het apparaat waarop je gesprekken staan. Gebruik hiervoor een browserprofiel zonder eigen servergesprekken.</p>
 <label class="field-label" for="device-join-code">Koppelcode</label><textarea id="device-join-code" class="field-input device-code" data-device-field="code" aria-label="Koppelcode" autocomplete="off" spellcheck="false" maxlength="128" rows="2"></textarea>
 <label class="field-label" for="device-label">Apparaatnaam</label><input id="device-label" class="field-input" data-device-field="label" aria-label="Apparaatnaam" autocomplete="off" maxlength="80" placeholder="Bijvoorbeeld mijn telefoon">
 <button type="button" class="primary-button device-join-button" data-action="device-pair-accept"${disabled}>Apparaat koppelen</button></section></div>
 <section class="device-list-section" aria-labelledby="device-list-title"><div class="device-list-heading"><h2 id="device-list-title">Apparaten met toegang</h2><button type="button" class="text-button" data-action="devices-refresh"${disabled}>Vernieuwen</button></div>
 ${!devices?'<p class="small muted" role="status">Apparaten laden…</p>':rows.length?`<ul class="device-list">${rows.map(device=>`<li class="device-row" data-device-id="${esc(device.id)}"><div class="device-row-label"><strong>${esc(device.label||'Browser')}</strong>${device.current?'<span class="device-current">Dit apparaat</span>':''}</div><button type="button" class="outline-button" data-action="device-revoke" data-id="${esc(device.id)}" aria-label="${esc('Toegang intrekken: '+(device.label||'Browser'))}"${disabled}>Toegang intrekken</button></li>`).join('')}</ul>`:'<p class="small muted">Geen apparaten gevonden.</p>'}
 </section></div>`;
}

export function createDeviceSurface(host,{client,onPaired=()=>{}}){
 let dialog=null,disposed=false,operation=0;
 const state={devices:null,pairing:null,busy:false,error:'',notice:''};
 const current=()=>!disposed&&dialog&&host.overlay.open&&dialog.version===host.getDialogVersion();
 const fields=()=>Object.fromEntries([...host.overlay.querySelectorAll('[data-device-field]')].map(input=>[input.dataset.deviceField,input.value]));
 function paint(){
  if(!current())return;
  const root=host.overlay.querySelector('[data-devices-root]');if(!root)return;
  const values=fields(),focus=root.contains(document.activeElement)?document.activeElement.dataset.deviceField:null;
  root.outerHTML=devicePanelMarkup({esc:host.esc,...state});
  for(const input of host.overlay.querySelectorAll('[data-device-field]'))if(Object.hasOwn(values,input.dataset.deviceField))input.value=values[input.dataset.deviceField];
  if(focus)host.overlay.querySelector(`[data-device-field="${focus}"]`)?.focus({preventScroll:true});
 }
 async function perform(task){
  if(!current()||state.busy)return true;
  const token=++operation,version=dialog.version;state.busy=true;state.error='';state.notice='';paint();
  try{await task(()=>current()&&version===dialog.version&&token===operation);}
  catch(error){if(current()&&token===operation)state.error=error?.message||'Het apparaat kon niet worden bijgewerkt.';}
  finally{if(current()&&token===operation){state.busy=false;paint();}}
  return true;
 }
 function refresh(){return perform(async valid=>{const devices=await client.devices();if(valid())state.devices=devices;});}
 function open(){
  if(disposed)return false;
  Object.assign(state,{devices:null,pairing:null,busy:false,error:'',notice:''});
  host.closePopover();host.showDialog('marketplace','Apparaten',devicePanelMarkup({esc:host.esc,...state}));
  dialog={version:host.getDialogVersion()};void refresh();return true;
 }
 function handleAction({action,id}){
  if(action==='devices-open')return open();
  if(!current())return false;
  if(action==='devices-refresh')return refresh();
  if(action==='device-pair-start')return perform(async valid=>{const pairing=await client.startDevicePairing();if(valid())state.pairing=pairing;});
  if(action==='device-pair-accept'){
   const input=fields(),code=input.code?.trim(),label=input.label?.trim();
   if(!code){state.error='Vul de koppelcode van je andere apparaat in.';paint();return true;}
   return perform(async valid=>{
    const result=await client.acceptDevicePairing(code,label||undefined);
    if(valid()){
     state.devices=null;state.pairing=null;state.notice='Dit apparaat is gekoppeld.';
     const field=host.overlay.querySelector('[data-device-field="code"]');if(field)field.value='';
    }
    await onPaired(result);if(valid())state.devices=await client.devices();
   });
  }
  if(action==='device-revoke')return perform(async valid=>{
   const result=await client.revokeDevice(id);
   if(valid()){state.devices=null;state.notice=result.current?'Dit apparaat is afgemeld.':'De toegang van dit apparaat is ingetrokken.';}
   if(result.current)await onPaired(result);if(valid())state.devices=await client.devices();
  });
  return false;
 }
 const timer=setInterval(()=>{
  if(!current()||state.busy||!state.pairing||Date.now()<state.pairing.expiresAt)return;
  state.pairing=null;state.notice='De koppelcode is verlopen. Maak een nieuwe code.';paint();
 },1000);
 return {id:'devices',handleAction,beforeDialogChange(){operation++;dialog=null;state.pairing=null;state.busy=false;},afterDialogChange(){paint();},destroy(){disposed=true;operation++;dialog=null;clearInterval(timer);state.pairing=null;}};
}

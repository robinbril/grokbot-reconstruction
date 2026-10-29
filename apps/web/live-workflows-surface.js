import {composerText} from './composer-input.js';
import {queueRows,queueStatusLabel,scheduleHistory,scheduleRuleText} from './live-workflows-model.js';
import {createLiveWorkflowAttachments} from './live-workflows-attachments.js';
import {createLiveWorkflowActions,workflowActionHoldMessage} from './live-workflows-actions.js';
import {createLiveQueueDraftRecovery} from './live-queue-draft-recovery.js';
const uuid=()=>crypto.randomUUID();
const scope='Deze planning draait zolang de lokale server en deze Mac aan staan. Na uitval wordt hoogstens de laatste uitvoering binnen 24 uur ingehaald.';
export function createLiveWorkflowsSurface({host,client,key,serverId,isLive,snapshot,refresh,setError,clearError=()=>{},activeRun}){
 const esc=host.esc,actions=createLiveWorkflowActions({host,client,serverId}),paintedContent=new WeakMap();let view=null,disposed=false,paintedQueue=null;
 const draftRecovery=createLiveQueueDraftRecovery({host,serverId,snapshot});
 const uploads=createLiveWorkflowAttachments({host,client,serverId,isLive,onChange:()=>{if(!disposed)host.render();},onError:setError});
 const schedules=(conversationId=key())=>snapshot(conversationId).schedules||[];
 const schedule=(id,conversationId=key())=>schedules(conversationId).find(row=>row.id===id);
 // Every asynchronous response belongs to the conversation and dialog that started it.
 const origin=()=>({conversationId:key(),view,version:host.getDialogVersion?.()});
 const current=operation=>!disposed&&key()===operation.conversationId&&view===operation.view&&host.getDialogVersion?.()===operation.version;
 const savedIntents=()=>host.getState().liveHarness?.workflowSaves||{};
 function saveIntent(conversationId,serverConversationId,scheduleId,command,files){
  const signature=JSON.stringify({scheduleId,command});
  const unresolved=Object.values(savedIntents()).filter(row=>row.conversationId===conversationId&&row.scheduleId===scheduleId);
  const prior=unresolved.find(row=>row.signature===signature);
  if(prior)return structuredClone(prior);
  if(unresolved.length)throw new Error('Een eerdere routineaanvraag is nog niet bevestigd. Open de routine opnieuw en controleer eerst die ongewijzigde aanvraag. Je nieuwere invoer blijft behouden.');
  const intent={conversationId,serverConversationId,scheduleId,signature,files:structuredClone(files),command:{requestId:uuid(),...structuredClone(command)}};
  const result=host.commit(state=>({...state,liveHarness:{...state.liveHarness,workflowSaves:{...state.liveHarness?.workflowSaves,[intent.command.requestId]:intent}}}),{reason:'live-routine-save-intent'});
  if(!result.ok)throw new Error('De routineaanvraag kon niet worden opgeslagen. Je invoer blijft behouden.');
  return intent;
 }
 function clearSave(intent,rejected=false){
  const result=host.commit(state=>{const intents={...state.liveHarness?.workflowSaves};delete intents[intent.command.requestId];return {...state,liveHarness:{...state.liveHarness,workflowSaves:intents}};},{reason:rejected?'live-routine-save-rejected':'live-routine-save-ack'});
  if(!result.ok)throw new Error(rejected?'De routineaanvraag is afgewezen, maar dit kon niet worden opgeslagen. Probeer dezelfde aanvraag opnieuw.':'De routine is ontvangen, maar de bevestiging kon niet worden opgeslagen. Probeer dezelfde aanvraag opnieuw.');
 }

 function recoveryLabel(record){
  const label={pause:'Pauzeren',enable:'Hervatten',delete:'Verwijderen','run-now':'Nu uitvoeren',cancel:'Annuleren','recover-draft':'Terug naar concept',retry:'Opnieuw proberen',resume:'Wachtrij voortzetten'}[record.action];
  if(record.action==='resume')return label;
  const target=actions.routine(record.action)?schedule(record.targetId)?.title:(snapshot().queue||[]).find(row=>row.id===record.targetId)?.payload?.text;
  return label+': '+(target?target.slice(0,80):record.targetId);
 }
 function recoveryMarkup(filter=()=>true){
  return actions.records(key()).filter(filter).map(record=>`<div class="live-queue-hold"><p role="status">${esc(record.valid?workflowActionHoldMessage:'Een opgeslagen actieaanvraag is ongeldig. Nieuwe acties blijven geblokkeerd; de identiteit blijft behouden.')}</p>${record.valid?button('Ontvangst controleren: '+recoveryLabel(record),'recover',record.lock):''}</div>`).join('');
 }
 const routineRecovery=()=>`<div data-live-action-recovery>${recoveryMarkup(record=>!record.valid||actions.routine(record.action))}</div>`;
 function actionDisabled(action,id){return actions.held(key(),action,id)||(action!=='edit'&&actions.routine(action)&&actions.saveHeld(key(),id));}
 function paintContent(node,markup){if(node&&paintedContent.get(node)!==markup){node.innerHTML=markup;paintedContent.set(node,markup);}}
 function syncActions(){
  if(disposed)return;
  paintQueue();
  if(view?.conversationId!==key()||!host.overlay.open)return;
  const mount=host.overlay.querySelector('[data-live-action-recovery]');
  paintContent(mount,recoveryMarkup(record=>!record.valid||actions.routine(record.action)));
  for(const node of host.overlay.querySelectorAll('[data-live-action-control]'))node.disabled=actionDisabled(node.dataset.liveActionControl,node.dataset.id);
 }
 const date=value=>value?new Date(value).toLocaleString('nl-NL'):'Geen volgende uitvoering';
 const button=(text,action,id='',extra='')=>`<button type="button" class="outline-button" data-action="live-workflow-${action}" data-id="${esc(id)}" ${extra} ${['pause','enable','delete','run-now','cancel','recover-draft','retry','resume','edit'].includes(action)?`data-live-action-control="${action}" ${actionDisabled(action,id)?'disabled':''}`:''}>${esc(text)}</button>`;
 function queueMarkup(){const data=snapshot(),rows=queueRows(data.queue),hold=data.workflow?.hold,active=activeRun();if(!rows.length&&!hold&&!actions.records(key()).length)return '<div data-live-queue-mount></div>';
  return `<section class="live-workflow-queue" data-live-queue-mount role="region" aria-label="Echte wachtrij"><div class="row between"><strong>Echte wachtrij</strong><span class="small muted">${rows.length} wachtend of bezig</span></div>${active&&!rows.some(row=>row.runId===active.id)?`<div class="live-queue-predecessor small muted">Bezig met de huidige opdracht</div>`:''}${hold?`<div class="live-queue-hold"><p role="status">${esc(hold.message||'Een eerdere uitvoering is onderbroken. De gevolgen zijn niet bevestigd.')}</p><p class="small muted">Voortzetten voert de onderbroken opdracht niet opnieuw uit.</p>${button('Wachtrij voortzetten','resume')}</div>`:''}${recoveryMarkup()}${rows.map(row=>`<article class="live-queue-row" data-live-queue-id="${esc(row.id)}"><div class="live-queue-copy"><span>${esc(row.payload?.text||row.attachments?.map(file=>file.name).join(', ')||'Bericht met bijlage')}</span><span class="small muted" role="status">${esc(queueStatusLabel(row.status))}${row.error?.message?' · '+esc(row.error.message):''}</span></div>${row.status==='blocked'?button('Opnieuw proberen','retry',row.id,`aria-label="Opnieuw proberen: ${esc(row.payload?.text||'bijlage')}"`):''}${draftRecovery.eligible(key(),row)?button('Terug naar concept','recover-draft',row.id,`aria-label="Terug naar concept: ${esc(row.payload?.text||'bijlage')}"`):''}${(['queued','preparing'].includes(row.status)||(row.status==='blocked'&&!row.runId))?button('Annuleren','cancel',row.id,`aria-label="Annuleren: ${esc(row.payload?.text||'bijlage')}"`):''}</article>`).join('')}</section>`;
 }
 function paintQueue(){
  const mount=host.app.querySelector('[data-live-queue-mount]');
  if(mount){const markup=queueMarkup();if(paintedQueue?.mount!==mount||paintedQueue.markup!==markup){mount.outerHTML=markup;paintedQueue={mount:host.app.querySelector('[data-live-queue-mount]'),markup};}}
  paintComposer();
 }
 function paintComposer(){if(!isLive())return;const send=host.app.querySelector('.send-button'),busy=Boolean(activeRun()||queueRows(snapshot().queue).length||snapshot().workflow?.hold);if(send&&send.dataset.hasPayload==='true'){send.setAttribute('aria-label',busy?'In wachtrij':'Bericht sturen');send.title=busy?'In wachtrij':'Bericht sturen';}}
 function showList(conversationId=key()){if(key()!==conversationId||disposed)return;view={kind:'list',conversationId};host.closePopover();host.showDialog('small-dialog','Routines',`<div class="form-dialog live-routines"><h1>Routines</h1><span class="small muted">Echte harness</span><p class="small muted">${scope}</p>${schedules().filter(row=>row.status!=='deleted').map(row=>`<div class="tool-row"><div class="row between"><strong>${esc(row.title)}</strong><span class="small muted" data-live-schedule-status="${esc(row.id)}">${row.enabled?'Actief':row.status==='completed'?'Voltooid':'Gepauzeerd'}</span></div><p>${esc(scheduleRuleText(row.rule))}</p><span class="small muted">${esc(row.rule?.timeZone)}</span>${button('Openen','open',row.id,`aria-label="Routine openen: ${esc(row.title)}"`)}</div>`).join('')||'<p class="muted">Nog geen routines op deze server.</p>'}${button('Routine toevoegen','new')}${routineRecovery()}<p role="status" data-live-routine-error></p></div>`);}
 function showDetail(id,conversationId=key()){if(key()!==conversationId||disposed)return;const row=schedule(id,conversationId);if(!row){showList(conversationId);return;}view={kind:'detail',id,conversationId};const history=scheduleHistory(id,snapshot(conversationId).queue||[],snapshot(conversationId).runs||[]);
  host.showDialog('small-dialog',row.title,`<div class="form-dialog live-routines"><h1>${esc(row.title)}</h1><span class="small muted">Echte harness</span><p class="live-routine-prompt">${esc(row.payload?.text)}</p><dl class="live-routine-metadata"><div><dt>Status</dt><dd data-live-routine-status>${row.enabled?'Actief':row.status==='completed'?'Voltooid':'Gepauzeerd'}</dd></div><div><dt>Planning</dt><dd>${esc(scheduleRuleText(row.rule))}</dd></div><div><dt>Tijdzone</dt><dd>${esc(row.rule?.timeZone)}</dd></div><div><dt>Volgende uitvoering</dt><dd data-live-routine-next>${esc(date(row.nextDueAt))}${row.nextDueAt?`<small>${esc(row.nextDueAt)}</small>`:''}</dd></div></dl><p class="small muted">${scope}</p><div class="live-actions">${button('Bewerken','edit',id)}${button(row.enabled?'Pauzeren':'Hervatten',row.enabled?'pause':'enable',id)}${button('Nu uitvoeren','run-now',id)}${button('Verwijderen','delete',id)}</div>${routineRecovery()}<h3 class="setting-group-title">Geschiedenis</h3><div data-live-routine-history>${historyMarkup(history)}</div><p role="status" data-live-routine-error></p></div>`);
 }
 function historyMarkup(history){return history.length?history.map(row=>`<div class="live-routine-history-row" ${row.runId?`data-live-history-run="${esc(row.runId)}"`:''}><span>${esc(date(row.source?.dueAt||row.createdAt))}</span><span role="status">${esc(queueStatusLabel(row.executionStatus))}</span>${row.runId?`<small>Uitvoering ${esc(row.runId)}</small>${button('Uitvoering bekijken','history-run',row.runId)}`:''}</div>`).join(''):'<p class="small muted">Nog geen uitvoeringen.</p>';}
 function formMarkup(row,values={}){const rule=values.rule||row?.rule||{kind:'once',at:new Date(Date.now()+3600_000).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},kind=rule.kind;
  return `<form class="form-dialog live-routines" data-submit="live-workflow-save"><h1>${row?'Routine bewerken':'Routine toevoegen'}</h1>${row?'<p class="small muted">Bewerken wijzigt alleen toekomstige uitvoeringen.</p>':''}<input type="hidden" name="scheduleId" value="${esc(row?.id||'')}"><input type="hidden" name="revision" value="${esc(values.revision??row?.revision??'')}"><label class="field-label" for="live-routine-title">Naam</label><input class="field-input" id="live-routine-title" name="title" value="${esc(values.title??row?.title??'')}" required maxlength="200"><label class="field-label" for="live-routine-prompt">Opdracht</label><textarea class="field-input" id="live-routine-prompt" name="prompt" rows="4" required maxlength="32768">${esc(values.prompt??row?.payload?.text??composerText(host.app.querySelector('#message-input')))}</textarea><label class="field-label" for="live-routine-kind">Herhaling</label><select class="field-input" id="live-routine-kind" name="kind" data-live-rule-kind>${[['once','Eenmalig'],['daily','Dagelijks'],['weekly','Wekelijks']].map(([value,text])=>`<option value="${value}" ${kind===value?'selected':''}>${text}</option>`).join('')}</select><div data-live-once ${kind==='once'?'':'hidden'}><label class="field-label" for="live-routine-at">Datum en tijd</label><input class="field-input" id="live-routine-at" name="at" type="text" value="${esc(rule.at||'')}" placeholder="2026-10-20T09:00:00+02:00"><p class="small muted">Gebruik een exact tijdstip met Z of een UTC-offset.</p></div><div data-live-recurring ${kind==='once'?'hidden':''}><label class="field-label" for="live-routine-time">Tijd</label><input class="field-input" id="live-routine-time" name="time" type="time" value="${esc(rule.time||'09:00')}"></div><fieldset class="live-weekdays" data-live-weekly ${kind==='weekly'?'':'hidden'}><legend>Dagen</legend>${['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'].map((day,index)=>`<label><input type="checkbox" name="weekdays" value="${index+1}" ${(rule.weekdays||[1]).includes(index+1)?'checked':''}>${day}</label>`).join('')}</fieldset><label class="field-label" for="live-routine-zone">Tijdzone</label><input class="field-input" id="live-routine-zone" name="zone" value="${esc(rule.timeZone)}" required><label class="live-routine-enabled"><input type="checkbox" name="enabled" ${values.enabled??row?.enabled?'checked':''}>Inschakelen na opslaan</label><p class="small muted">${scope}</p>${row?.payload?.attachmentRefs?.length?'<p class="small muted">De opgeslagen bijlagen blijven aan deze routine gekoppeld.</p>':''}${routineRecovery()}<p role="status" data-live-routine-error></p><div class="form-actions">${button('Annuleren','list')}<button class="primary-button" type="submit">Routine opslaan</button></div></form>`;
 }
 function showForm(id){
  if(key()==='new'){const agent=host.ensureConversation();if(!agent||key()==='new'){setError(key(),new Error('Maak eerst een gesprek om deze routine te bewaren.'));return;}}
  const conversationId=key(),row=id?schedule(id,conversationId):null;
  if(actions.held(conversationId,'edit',id)){errorInDialog(new Error(workflowActionHoldMessage));return;}
  const pendingSave=Object.values(savedIntents()).findLast(intent=>intent.conversationId===conversationId&&intent.scheduleId===(id||''));
  const values=pendingSave?{title:pendingSave.command.title,prompt:pendingSave.command.payload.text,rule:pendingSave.command.rule,enabled:pendingSave.command.enabled,revision:pendingSave.command.expectedRevision}:{};
  view={kind:'form',id,conversationId,files:structuredClone(pendingSave?.files||host.draftAttachments(conversationId)),pendingSave};
  host.showDialog('small-dialog',row?'Routine bewerken':'Routine toevoegen',formMarkup(row,values));
 }
 function errorInDialog(error,operation=origin()){
  if(current(operation)){const node=host.overlay.querySelector('[data-live-routine-error]');if(node)node.textContent=error.message;}
  setError(operation.conversationId,error);
 }
 function presentAction(record,operation,error,result){
  if(!current(operation)){if(error)setError(operation.conversationId,error);return;}
  if(actions.routine(record.action)&&view?.kind!=='form'){
   if(record.action==='delete'&&!error)showList(operation.conversationId);else showDetail(record.targetId,operation.conversationId);
  }
  if(error)errorInDialog(error,origin());
  else if(result?.inFlightRunIds?.length){const node=host.overlay.querySelector('[data-live-routine-error]');if(node)node.textContent='Een lopende uitvoering gaat door. Gebruik Stoppen om die te stoppen.';}
 }
 async function perform(action,id){
  const operation=origin(),conversationId=operation.conversationId;let record,acquired=false;
  try{
   if(action==='recover')record=actions.recover(conversationId,id);
   else {
    const row=actions.routine(action)?schedule(id,conversationId):null;
    if(actions.routine(action)&&!row)throw new Error('Routine niet gevonden. Vernieuw de lijst.');
    record=actions.begin(conversationId,action,id,row?.revision);
   }
   acquired=actions.acquire(record);if(!acquired)return true;syncActions();
   let result;
   try{
    if(record.action==='recover-draft'){
     if(draftRecovery.releaseStarted(record,actions))throw draftRecovery.started();
     await draftRecovery.prepare(record);
    }
    if(disposed)throw new Error('De oorspronkelijke interface is gesloten.');
    result=await actions.dispatch(record);
   }
   catch(error){
    if(record.action==='recover-draft'&&error.code==='QUEUE_IN_FLIGHT'){
     await refresh(conversationId,{afterPending:true}).catch(()=>{});
     if(draftRecovery.rejectStarted(record,error,actions))throw draftRecovery.started();
    }
    if(error.code==='REVISION_CONFLICT'&&actions.routine(record.action)){
     await refresh(conversationId,{afterPending:true});
     try{actions.retire(record,true);}catch(retirementError){throw Object.assign(new Error(retirementError.message+' '+error.message),{code:error.code});}
    }
    throw error;
   }
   await refresh(conversationId,{afterPending:true});
   if(record.action==='recover-draft'){
    if(draftRecovery.terminalResponse(record,result,actions))throw draftRecovery.started();
    draftRecovery.finish(record,result,actions);clearError(conversationId);
   }
   else if(record.action==='cancel'){draftRecovery.discard(record,result,actions);clearError(conversationId);}
   else actions.retire(record);
   presentAction(record,operation,null,result);
  }catch(error){
   if(record)presentAction(record,operation,error);else errorInDialog(error,operation);
  }finally{if(record)draftRecovery.cleanup(record);if(acquired)actions.release(record);syncActions();}return true;
 }
 async function save(form,data){
  const operation=origin(),conversationId=operation.conversationId;
  if(view?.kind!=='form'||view.conversationId!==conversationId)return true;
  const id=String(data.get('scheduleId')||''),rule={kind:String(data.get('kind')),timeZone:String(data.get('zone')||'').trim()};
  if(rule.kind==='once')rule.at=String(data.get('at')||'').trim();else {rule.time=String(data.get('time')||'');if(rule.kind==='weekly')rule.weekdays=data.getAll('weekdays').map(Number);}
  const submit=form.querySelector('[type=submit]');if(submit.disabled)return true;
  let intent;
  try{
   if(actions.held(conversationId,'edit',id))throw new Error(workflowActionHoldMessage);
   const pendingSave=view.pendingSave;
   const attachmentRefs=pendingSave?pendingSave.command.payload.attachmentRefs:id?schedule(id,conversationId)?.payload?.attachmentRefs:uploads.refs(conversationId,view.files||[]);
   const payload={...(pendingSave?.command.payload||(id?schedule(id,conversationId)?.payload:{})),...(attachmentRefs?.length?{attachmentRefs}:{}),text:String(data.get('prompt')||'')};
   const command={title:String(data.get('title')||'').trim(),payload,rule,enabled:data.has('enabled'),...(id?{expectedRevision:Number(data.get('revision'))}:{})};
   if(rule.kind==='once'&&!/(?:Z|[+-]\d{2}:\d{2})$/i.test(rule.at))throw new Error('Gebruik een exact tijdstip met Z of een UTC-offset.');
   // Resolve the canonical mapping before committing the intent, so that commit pins both.
   const canonicalId=serverId(conversationId);
   intent=saveIntent(conversationId,canonicalId,id,command,view.files||[]);
   view.pendingSave=intent;submit.disabled=true;
   let result;
   try{result=id?await client.scheduleAction(intent.serverConversationId,id,'edit',intent.command):await client.createSchedule(intent.serverConversationId,intent.command);}
   catch(error){
    if(error.code==='INVALID_SCHEDULE'||error.code==='INVALID_TEXT'){
     clearSave(intent,true);
     if(current(operation)&&view.pendingSave?.command.requestId===intent.command.requestId)view.pendingSave=null;
    }
    throw error;
   }
   await refresh(conversationId,{afterPending:true});clearSave(intent);
   if(current(operation))showDetail(result.schedule.id,conversationId);
  }catch(error){
   if(error.code==='REVISION_CONFLICT'){
    await refresh(conversationId,{afterPending:true}).catch(()=>{});
    if(intent)try{clearSave(intent);}catch(clearError){errorInDialog(clearError,operation);}
    if(current(operation)){
     const revision=form.elements.namedItem('revision'),row=schedule(id,conversationId);
     if(revision&&row)revision.value=String(row.revision);
     view.pendingSave=null;
    }
   }
   errorInDialog(error,operation);
  }finally{if(submit.isConnected)submit.disabled=false;}return true;
 }
 return {uploads,queueMarkup,paintComposer,afterRender(){if(!isLive())return;uploads.reconcile();paintQueue();},sync(){if(!isLive())return;syncActions();for(const node of host.overlay?.querySelectorAll('[data-live-schedule-status]')||[]){const row=schedule(node.dataset.liveScheduleStatus);if(row)node.textContent=row.enabled?'Actief':row.status==='completed'?'Voltooid':'Gepauzeerd';}const count=host.app.querySelector('[data-live-routine-count]');if(count)count.textContent=String(schedules().filter(row=>row.status!=='deleted').length);if(view?.kind==='detail'&&view.conversationId===key()&&host.overlay.open){const current=schedule(view.id),statusNode=host.overlay.querySelector('[data-live-routine-status]'),nextNode=host.overlay.querySelector('[data-live-routine-next]');if(current&&statusNode)statusNode.textContent=current.enabled?'Actief':current.status==='completed'?'Voltooid':'Gepauzeerd';if(current&&nextNode)nextNode.textContent=date(current.nextDueAt)+(current.nextDueAt?' · '+current.nextDueAt:'');const node=host.overlay.querySelector('[data-live-routine-history]');paintContent(node,historyMarkup(scheduleHistory(view.id,snapshot().queue||[],snapshot().runs||[])));}},
  handleAction({action,id}){if(action==='routines'&&isLive()){const operation=origin();void refresh(operation.conversationId).then(()=>{if(current(operation))showList(operation.conversationId);}).catch(error=>errorInDialog(error,operation));return true;}if(action==='live-upload-retry')return uploads.retry(key(),id).then(()=>true);if(!action.startsWith('live-workflow-'))return false;const name=action.slice('live-workflow-'.length);if(name==='history-run'){host.closeDialog();host.app.querySelector('[data-live-run="'+CSS.escape(id)+'"]')?.scrollIntoView({block:'center'});return true;}if(name==='list'){showList();return true;}if(name==='new'){showForm();return true;}if(name==='open'){showDetail(id);return true;}if(name==='edit'){showForm(id);return true;}return perform(name,id);},
  handleSubmit({submit,form,data}){return submit==='live-workflow-save'?save(form,data):false;},handleChange(event){if(!event.target.matches('[data-live-rule-kind]'))return;const form=event.target.form,kind=event.target.value;form.querySelector('[data-live-once]').hidden=kind!=='once';form.querySelector('[data-live-recurring]').hidden=kind==='once';form.querySelector('[data-live-weekly]').hidden=kind!=='weekly';},
  renderSlot(name,{message}={}){if(name==='liveMessageAttachments'&&message?.productKind==='live-harness')return uploads.messageMarkup(message);if(!isLive())return undefined;if(name==='liveQueue')return queueMarkup();if(name==='liveRoutineCount')return schedules().filter(row=>row.status!=='deleted').length;if(name==='composerMenu')return host.menuItem('Taak plannen','clock','live-workflow-new');if(name==='liveAttachmentDraft')return host.draftAttachments(key()).length?`<div class="attachment-list" aria-label="Bijlagen">${uploads.draftMarkup(host.draftAttachments(key()),key())}</div><p class="attachment-limit small muted">Bij verzending gedeeld met het ingestelde model.</p>`:'';if(name==='liveMessageAttachments'&&message?.productKind==='live-harness')return uploads.messageMarkup(message);},destroy(){disposed=true;draftRecovery.destroy();uploads.destroy();}};
}

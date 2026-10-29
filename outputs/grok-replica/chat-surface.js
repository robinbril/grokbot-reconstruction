import {transcriptReaderFor} from './transcript-reader.js';
import {normalizeComposerDocument} from './composer-document.js';
import {composerController,composerSelection,readComposerInput} from './composer-input.js';
import {normalizeEntry} from './chat-entry-model.js';
import {createChatRunController} from './chat-run-controller.js';
import {createLocalTextAdapter} from './chat-local-adapter.js';
import {createChatContentView} from './chat-content-frames.js';
import {createChatDiagramService} from './chat-diagram.js';

const defaults=Object.freeze({operation:'normal',style:'short',layoutMode:'elevated'});
const operations=new Set(['normal','count','upper','markdown']);
// This scheduler yields only when the actual local adapter has more work.
function chatWorkYield(signal){return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
 let settled=false,callbackId;
 const abort=()=>{if(settled)return;settled=true;cancelAnimationFrame(callbackId);signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};
 signal.addEventListener('abort',abort,{once:true});
 callbackId=requestAnimationFrame(()=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(signal.aborted)reject(new DOMException('Aborted','AbortError'));else resolve();});
});}
export function createChatSurface(host){
 const views=new Map(),pendingStatusActions=new Map(),parking=document.createElement('div');parking.dataset.chatParking='';parking.dataset.productPortal='';parking.inert=true;parking.setAttribute('aria-hidden','true');Object.assign(parking.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden'});document.body.append(parking);
 const diagram=createChatDiagramService({icon:host.icon,getTheme:()=>document.documentElement.dataset.theme});
 let disposed=false,currentKey=null,savedInput=null,sending=false;
 const key=()=>host.getConversationKey(),state=()=>host.getState();
 const preferences=(conversationId=key())=>{const raw=Object.hasOwn(state().chatPreferences||{},conversationId)?state().chatPreferences[conversationId]:null;return raw&&operations.has(raw.operation)&&['short','full'].includes(raw.style)&&['bubble','elevated'].includes(raw.layoutMode)?raw:defaults;};
 const makeController=()=>createChatRunController({getState:host.getState,commit:host.commit,publishChatProgress:host.publishChatProgress,getChatSaveState:host.getChatSaveState,adapter:createLocalTextAdapter({yieldWork:chatWorkYield}),onEntryChange:change=>{
  if(disposed)return;if(change.reason==='accepted')host.clearChatError(change.conversationId);if(change.conversationId!==key())return;
  const ids=change.entryIds||[];if(ids.some(id=>!Array.from(host.app.querySelectorAll('.message[data-message-id]')).some(n=>n.dataset.messageId===id)))host.render({explicitSend:true});else sync(change.entryIds);
 }});
 let controller=makeController();
 function typed(message){return !message.productKind&&Object.hasOwn(message,'transcript');}
 function runFor(message){const entry=normalizeEntry(message,{conversationId:key()});return entry.runId&&Object.hasOwn(state().chatRuns||{},entry.runId)?state().chatRuns[entry.runId]:null;}
 function statusMarkup(message){const run=runFor(message);if(!run)return '';const runtime=controller.getRuntime({conversationId:key(),runId:run.id});
  let label=runtime.delivered?'Voltooid':runtime.effectivePhase==='cancelled'?(runtime.statusSaved?'Gestopt':'Gestopt; status nog niet opgeslagen'):runtime.effectivePhase==='interrupted'?(runtime.errorCode==='reload-save-failed'?'Onderbroken; status nog niet opgeslagen':'Onderbroken'):runtime.effectivePhase==='failed'?'Mislukt':runtime.effectivePhase==='final-pending-delivery'?(runtime.textSaved?'Tekst opgeslagen; afronden opnieuw proberen':'Resultaat nog niet opgeslagen'):runtime.effectivePhase==='running'?'Bezig':'Tekst lokaal verwerken';
  const warning=runtime.effectivePhase==='running'&&!runtime.textSaved?' <span>Voortgang nog niet opgeslagen</span>':'';
  const progress=runtime.progress&&!['delivered','cancelled','failed','interrupted'].includes(runtime.effectivePhase)?` <span>${runtime.progress.processed} / ${runtime.progress.total}</span>`:'';
  const control=runtime.errorCode==='reload-save-failed'?`<button class="text-button" data-action="chat-reconcile">Status opslaan</button>`:runtime.canRetryDelivery?`<button class="text-button" data-action="chat-save" data-id="${host.esc(run.id)}">Resultaat opslaan</button>`:runtime.canResume?`<button class="text-button" data-action="chat-resume" data-id="${host.esc(run.id)}">Lokaal hervatten</button>`:['accepted','running'].includes(runtime.effectivePhase)?`<button class="text-button" data-action="chat-stop" data-id="${host.esc(run.id)}">Stoppen</button>`:'';
  return `<span class="small muted">${run.operation==='markdown'?'Lokale Markdown-weergave':'Lokale berekening'}</span><span role="status"><span>${label}</span>${warning}${progress}</span>${control}`;
 }
 function context(message,entry){const run=runFor(message),runtime=run?controller.getRuntime({conversationId:key(),runId:run.id}):null,phase=runtime?.effectivePhase;
  return {role:message.role,images:Array.isArray(message.images)?message.images:[],attachments:Array.isArray(message.attachments)?message.attachments:[],channel:typeof message.channel==='string'?message.channel:null,specialized:null,work:{isStreaming:['accepted','running'].includes(phase),isStable:phase?['final-pending-delivery','delivered'].includes(phase):entry.status==='stable'}};
 }
 function updateView(message,view){const entry=normalizeEntry(message,{conversationId:key()});view.update({entry,context:context(message,entry),adjacency:{isGroupStart:false,isContinuedFromPrev:false,isContinuedToNext:false},theme:document.documentElement.dataset.theme});}
 function syncStatuses(){if(disposed)return;for(const node of host.app.querySelectorAll('[data-chat-run-id]')){if(pendingStatusActions.has(node.dataset.chatRunId))continue;const message=(state().messages[key()]||[]).find(m=>runFor(m)?.id===node.dataset.chatRunId);if(message){const markup=statusMarkup(message);if(node.innerHTML===markup)continue;
   const template=document.createElement('template');template.innerHTML=markup;
   const control=node.querySelector('button'),nextControl=template.content.querySelector('button');
   if(control&&nextControl&&control.isEqualNode(nextControl)){
    // Status-only updates must not disconnect the current action or its keyboard focus.
    for(const child of Array.from(node.childNodes))if(child!==control)child.remove();
    nextControl.remove();node.insertBefore(template.content,control);
   }else node.innerHTML=markup;
  }}}
 // A save attempt's temporary controller lock must not project a missing retry action.
 async function retryVisibleDelivery(args){
  const id=args.runId;pendingStatusActions.set(id,(pendingStatusActions.get(id)||0)+1);
  try{await controller.retryDelivery(args);return true;}finally{
   const remaining=pendingStatusActions.get(id)-1;if(remaining)pendingStatusActions.set(id,remaining);else pendingStatusActions.delete(id);
   sync();
  }
 }
 function sync(entryIds){if(disposed)return;const changed=entryIds?new Set(entryIds):null,reader=transcriptReaderFor(host);reader?.beforeMutation();
  try{for(const message of state().messages[key()]||[]){if(changed&&!changed.has(message.id))continue;const saved=views.get(JSON.stringify([key(),message.id]));if(saved)updateView(message,saved);}syncStatuses();}
  finally{reader?.afterMutation({cause:'stream-delta'});}
 }
 let renderedTheme=document.documentElement.dataset.theme;
 const themeObserver=new MutationObserver(()=>{
  if(disposed)return;const theme=document.documentElement.dataset.theme;if(theme===renderedTheme)return;
  renderedTheme=theme;sync();
 });
 themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 function beforeRender(options={}){const input=host.app.querySelector('#message-input');savedInput=input?{node:input,key:currentKey,focused:document.activeElement===input||Boolean(input.contains?.(document.activeElement)),...composerSelection(input),explicitSend:options.explicitSend}:null;if(input)parking.moveBefore(input,null);for(const view of views.values())if(host.app.contains(view.element))parking.moveBefore(view.element,null);}
 function afterRender(){if(disposed)return;currentKey=key();for(const placeholder of host.app.querySelectorAll('[data-chat-slot]')){const message=(state().messages[key()]||[]).find(m=>m.id===placeholder.dataset.chatSlot);if(!message)continue;const address=JSON.stringify([key(),message.id]);let view=views.get(address);if(!view){view=createChatContentView({conversationId:key(),entryId:message.id,copyText:host.copyText,diagram});views.set(address,view);}if(view.element.isConnected)placeholder.parentNode.moveBefore(view.element,placeholder);else placeholder.parentNode.insertBefore(view.element,placeholder);placeholder.remove();updateView(message,view);}
  for(const[address,view]of views){const [conversationId,entryId]=JSON.parse(address);if(!(state().messages[conversationId]||[]).some(message=>message.id===entryId&&typed(message))){view.destroy();views.delete(address);}}
  if(savedInput&&parking.contains(savedInput.node))savedInput.node.remove();savedInput=null;syncStatuses();
 }
 function settings(){host.closePopover();const pref=preferences(),option=(value,label,current)=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`;
  host.showDialog('small-dialog','Gespreksbewerking',`<form class="form-dialog" data-submit="chat-preferences"><h1>Gespreksbewerking</h1><label class="field-label" for="chat-operation">Lokale bewerking</label><select class="field-input" id="chat-operation" name="operation">${[['normal','Normaal bericht'],['count','Woorden tellen'],['upper','Hoofdletters'],['markdown','Markdown weergeven']].map(([v,l])=>option(v,l,pref.operation)).join('')}</select><label class="field-label" for="chat-style">Uitvoervorm</label><select class="field-input" id="chat-style" name="style">${option('short','Kort',pref.style)}${option('full','Volledig',pref.style)}</select><label class="field-label" for="chat-layout">Antwoordweergave</label><select class="field-input" id="chat-layout" name="layoutMode">${option('elevated','Verhoogd',pref.layoutMode)}${option('bubble','Tekstballon',pref.layoutMode)}</select><p role="status" data-chat-preference-status></p><div class="form-actions"><button type="button" class="outline-button" data-action="close-modal">Annuleren</button><button type="submit" class="primary-button">Gebruiken</button></div></form>`);
 }
 function savePreferences(pref){return host.commit(current=>({...current,chatPreferences:{...current.chatPreferences,[key()]:pref}}),{reason:'chat-preferences'}).ok;}
 async function send(){if(sending)return true;sending=true;try{const pref={...preferences()},input=host.app.querySelector('#message-input'),composer=readComposerInput(input),text=composer.text,richText=composerController(input)?composer.richText:state().draftRichTexts?.[key()];
  if((state().composerSkillReferences?.[key()]||[]).length){host.showChatError('Lokale bewerking ondersteunt geen vaardigheidsreferenties. Je concept en vaardigheden blijven behouden.');return true;}
  try{normalizeComposerDocument(richText,{text,references:[]});}catch{host.showChatError('Lokale bewerking ondersteunt deze documentopmaak niet. Je concept en opmaak blijven behouden. Kies Normaal bericht om ze te verzenden.');return true;}
  if(host.hasPendingAttachments?.()||host.draftAttachments(key()).length){host.showChatError('Lokale bewerking ondersteunt alleen tekst. Je concept en bijlagen blijven behouden.');return true;}
  if(state().localOffline||state().localOutbox?.[key()]){host.showChatError('Lokale bewerking is niet beschikbaar met de lokale wachtrij. Je concept blijft behouden.');return true;}
  if(!text.trim())return true;const agent=host.ensureConversation();if(!agent)return true;
  if(!Array.isArray(state().messages[agent.id])&&!host.commit(current=>({...current,messages:{...current.messages,[agent.id]:[]}}),{reason:'chat-conversation'}).ok){host.showChatError('Gesprek niet opgeslagen. Je concept blijft behouden.');return true;}
  const quote=state().replyDrafts[agent.id],result=await controller.start({conversationId:agent.id,submissionId:crypto.randomUUID(),text,...(richText!==undefined?{richText}:{}),operation:pref.operation,style:pref.style,layoutMode:pref.layoutMode,...(quote?{quote}:{})});
  if(!result.ok)host.showChatError(result.code==='storage'?'Bericht niet opgeslagen. Je concept blijft behouden.':'Deze lokale bewerking kon niet starten. Je concept blijft behouden.');return true;
 }finally{sending=false;}}
 function handleAction({action,id,target}){if(action==='chat-settings'){settings();return true;}if(action==='chat-normal'){const pref={...preferences(),operation:'normal'};if(savePreferences(pref)){host.clearChatError(key());host.render();}return true;}
  if(action==='send-message'&&preferences().operation!=='normal')return send();
  if(action==='chat-reconcile')return controller.reconcileReload().then(()=>{sync();return true;});
  if(['chat-stop','chat-save','chat-resume'].includes(action)){const args={conversationId:key(),runId:id};if(action==='chat-save')return retryVisibleDelivery(args);return Promise.resolve(action==='chat-stop'?controller.cancel(args):controller.resume(args)).then(()=>{sync();return true;});}
  if(action==='retry-message'){const message=(state().messages[key()]||[]).find(m=>m.id===id);if(typed(message||{})){const run=runFor(message);if(run){const runtime=controller.getRuntime({conversationId:key(),runId:run.id});if(runtime.canRetryDelivery)return retryVisibleDelivery({conversationId:key(),runId:run.id});if(runtime.canResume)return controller.resume({conversationId:key(),runId:run.id}).then(()=>true);}return true;}}
  return false;
 }
 return {id:'chat',isTranscriptGenerating:()=>(state().messages[key()]||[]).some(message=>{const run=runFor(message);return run&&['accepted','running'].includes(controller.getRuntime({conversationId:key(),runId:run.id}).effectivePhase);}),usesLocalOperation:()=>preferences().operation!=='normal',get controller(){return controller;},revokeConversation:conversationId=>controller.revokeConversation(conversationId),reset(){controller.destroy();controller=makeController();},reconcileReload:()=>controller.reconcileReload(),syncStatuses,beforeRender,afterRender,handleAction,handleSubmit({submit,data,form}){if(submit==='composer-form'&&preferences().operation!=='normal')return send();if(submit!=='chat-preferences')return false;const pref={operation:String(data.get('operation')),style:String(data.get('style')),layoutMode:String(data.get('layoutMode'))};if(!operations.has(pref.operation)||!['short','full'].includes(pref.style)||!['elevated','bubble'].includes(pref.layoutMode))return true;if(savePreferences(pref)){host.closeDialog();host.render();}else form.querySelector('[data-chat-preference-status]').textContent='Keuze niet opgeslagen. Probeer opnieuw.';return true;},
  renderSlot(name,{message}={}){if(name==='chatEntryBody'&&typed(message||{}))return `<div class="message-body" data-chat-slot="${host.esc(message.id)}"></div>`;if(name==='chatEntryStatus'&&typed(message||{})){const run=runFor(message);return run?`<section class="chat-run-status" data-chat-run-id="${host.esc(run.id)}">${statusMarkup(message)}</section>`:'';}if(name==='composerMenu')return host.menuItem('Gespreksbewerking','edit','chat-settings');if(name==='chatComposerNotice'&&preferences().operation!=='normal')return `<div class="chat-composer-mode small"><span>Lokale bewerking · ${preferences().operation==='markdown'?'Markdown weergeven':preferences().operation==='count'?'Woorden tellen':'Hoofdletters'}</span> <button class="text-button" data-action="chat-normal">Normaal bericht</button></div>`;return undefined;},
  destroy(){if(disposed)return;disposed=true;themeObserver.disconnect();controller.destroy();for(const view of views.values())view.destroy();views.clear();diagram.destroy();parking.remove();}
 };
}

import {composerController} from './composer-input.js';
import {createCanvasDesignController} from './live-canvas-design.js';
import {canvasDesignMarkup} from './live-canvas-design-view.js';
import {createCanvasReferenceHold} from './live-canvas-reference.js';
import {createCanvasController} from './live-canvas-controller.js';
import {canvasLibraryMarkup,canvasStageMarkup,canvasListMarkup,canvasPreviewUrl,canvasStatus} from './live-canvas-view.js';

export function createLiveCanvasSurface({host,client,isLive,key,serverId}){
 let disposed=false,tab='source',listSignature='',heldSignature='',releaseHold,pendingSelection=null;
 const design=createCanvasDesignController({onChange:paintDesign});
 const referenceHold=createCanvasReferenceHold();
 const controller=createCanvasController({client,onChange:paint});
 const canonical=()=>isLive()&&key()!=='new'?serverId(key()):null;
 const theme=()=>document.documentElement.dataset.theme==='dark'?'dark':'light';
 const options=()=>({esc:host.esc,tab,theme:theme()});
 function current(){return !disposed&&isLive()&&controller.state().scope===canonical();}
 function visible(){const state=host.getState();return current()&&state.context===true&&state.contextTab==='library'&&Boolean(host.app.querySelector('[data-live-canvas-root]'));}
 function heldReference(){
  const state=controller.state(),editor=state.editor,reference=visible()&&editor?.id?{canvasId:editor.id,storeId:null,title:editor.savedTitle}:null,signature=JSON.stringify(reference);
  if(signature!==heldSignature){releaseHold?.();heldSignature=signature;releaseHold=reference?referenceHold.hold(reference):undefined;}
  return referenceHold.current();
 }
 function paintDesign(){
  const root=host.app.querySelector('[data-canvas-design-controls]');if(!root)return;root.hidden=!visible()||tab!=='preview';const state=design.state(),signature=JSON.stringify(state);
  if(root.dataset.signature!==signature){root.dataset.signature=signature;root.innerHTML=canvasDesignMarkup(state,host.esc);}
 }
 function bindDesign(){
  const state=controller.state(),editor=state.editor,frame=host.app.querySelector('[data-live-canvas-stage] iframe');
  design.bind(visible()&&editor?.id&&frame?.contentWindow?{frame,frameWindow:frame.contentWindow,scope:state.scope,canvasId:editor.id,revision:editor.revision}:null);if(tab!=='preview')design.standDown();paintDesign();
 }
 function insertSelection(payload){
  const input=host.app.querySelector('#message-input'),editor=composerController(input);
  if(editor?.insertCanvasSelection?.(payload)){pendingSelection=null;return true;}
  pendingSelection={agentKey:key(),payload};return false;
 }
 function flushSelection(){if(!pendingSelection)return;if(pendingSelection.agentKey!==key()){pendingSelection=null;return;}insertSelection(pendingSelection.payload);}
 const windowTarget=host.app.ownerDocument?.defaultView??globalThis;
 const receiveDesign=event=>{bindDesign();design.message(event);};windowTarget.addEventListener?.('message',receiveDesign);
 function capture(){if(!current())return;for(const field of host.app.querySelectorAll('[data-canvas-field]')){const value=controller.state().editor?.[field.dataset.canvasField];if(value!==field.value)controller.edit(field.dataset.canvasField,field.value);}}
 function paint(){
  if(!current()){design.bind(null);return;}const root=host.app.querySelector('[data-live-canvas-root]');if(!root){design.bind(null);return;}const state=controller.state(),editor=state.editor,stage=root.querySelector('[data-live-canvas-stage]'),identity=editor?state.scope+':'+(editor.id??'new'):null;
  if(!editor){design.bind(null);const signature=JSON.stringify([state.items,state.error,state.items.length?false:state.loading]);if(stage||signature!==listSignature){root.innerHTML=canvasListMarkup(state,host.esc);listSignature=signature;}return;}
  listSignature='';
  if(!stage||stage.dataset.canvasKey!==identity){const active=document.activeElement,field=root.contains(active)?active?.dataset.canvasField:null,start=active?.selectionStart,end=active?.selectionEnd;root.innerHTML=canvasStageMarkup(state,options());const next=field?root.querySelector(`[data-canvas-field="${field}"]`):null;next?.focus({preventScroll:true});next?.setSelectionRange?.(start,end);bindDesign();return;}
  for(const field of stage.querySelectorAll('[data-canvas-field]'))if(field.value!==editor[field.dataset.canvasField])field.value=editor[field.dataset.canvasField];
  const status=stage.querySelector('[data-canvas-status]');status.textContent=canvasStatus(editor);
  const error=stage.querySelector('[data-canvas-journal-error]');error.textContent=state.error;error.hidden=!state.error;
  const save=stage.querySelector('[data-action=live-canvas-save]');save.disabled=editor.busy||editor.conflict;save.textContent=editor.pending?'Ontvangst controleren':'Opslaan';
  const reload=stage.querySelector('[data-action=live-canvas-reload]');reload.hidden=!editor.conflict&&!(editor.remoteRevision>editor.revision);reload.disabled=editor.busy||editor.pending;
  for(const button of stage.querySelectorAll('[role=tab]'))button.setAttribute('aria-selected',String(button.dataset.id===tab));
  stage.querySelector('[data-canvas-source-panel]').hidden=tab!=='source';stage.querySelector('[data-canvas-preview-panel]').hidden=tab!=='preview';
  const frame=stage.querySelector('iframe');if(frame&&editor.id){const url=canvasPreviewUrl(state.scope,editor.id,editor.revision,theme());if(frame.getAttribute('src')!==url){const next=document.createElement('iframe');for(const name of frame.getAttributeNames())if(name!=='src')next.setAttribute(name,frame.getAttribute(name));next.src=url;frame.replaceWith(next);}}
  bindDesign();
 }
 function selectScope(){controller.selectScope(canonical());}
 function refresh(){selectScope();return controller.state().scope?controller.refresh():Promise.resolve();}
 function handleAction({action,id}){
  if(!isLive()||!action.startsWith('live-canvas-'))return false;
  if(key()==='new'&&!host.ensureConversation())return true;selectScope();
  if(action.startsWith('live-canvas-design-')&&(!visible()||tab!=='preview'))return true;
  if(action==='live-canvas-design-toggle'){design.toggle();return true;}
  if(action==='live-canvas-design-clear'){design.clear();return true;}
  if(action==='live-canvas-design-depth'){design.select(Number(id));return true;}
  if(action==='live-canvas-design-ask'){const payload=design.take();if(payload)insertSelection(payload);return true;}
  if(action==='live-canvas-new'){tab='source';controller.newCanvas();return true;}
  if(action==='live-canvas-open'){tab='preview';return controller.open(id).then(()=>true);}
  if(action==='live-canvas-save')return controller.save().then(()=>true);
  if(action==='live-canvas-refresh')return refresh().then(()=>true);
  if(action==='live-canvas-back'){controller.back();void refresh();return true;}
  if(action==='live-canvas-reload')return controller.reload().then(()=>true);
  if(action==='live-canvas-tab'){tab=id==='preview'?'preview':'source';paint();host.app.querySelector(`[data-action=live-canvas-tab][data-id=${tab}]`)?.focus({preventScroll:true});return true;}
  return false;
 }
 const timer=setInterval(()=>{if(visible()&&document.visibilityState!=='hidden')void refresh();},2200);
 return {handleAction,heldReference,beforeSubmit(){pendingSelection=null;},sync:paint,
  renderSlot(name){if(name!=='libraryPanel'||!isLive())return undefined;selectScope();return canvasLibraryMarkup(controller.state(),options());},
  beforeRender:capture,afterRender(){selectScope();paint();flushSelection();if(visible()&&!controller.state().items.length&&!controller.state().loading)void refresh();},
  handleInput(event){if(current()&&event.target?.dataset.canvasField)controller.edit(event.target.dataset.canvasField,event.target.value);},
  destroy(){disposed=true;windowTarget.removeEventListener?.('message',receiveDesign);design.destroy();pendingSelection=null;releaseHold?.();referenceHold.clear();clearInterval(timer);controller.destroy();}};
}

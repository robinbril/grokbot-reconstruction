import {composerText,readComposerInput,replaceComposerText} from './composer-input.js';
import { iconsReady, iconSvg } from './icon-library.js';
import {transcriptReaderFor} from './transcript-reader.js';
import {handleTranscriptEnd} from './transcript-keyboard.js';
// Explicit opt-in offline queue. Ordinary sends continue through the original durable sender.
export function createComposerSurface(host) {
  let releaseReader=null,scrollAbort=null,jump=null,queueSending=false,savedNotice=null,savedJump=null;
  const parking=document.createElement('div');parking.dataset.productPortal='';parking.dataset.composerParking='';parking.inert=true;parking.setAttribute('aria-hidden','true');Object.assign(parking.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden'});document.body.append(parking);
  // CK composes Zn.circle with p2.button and p2.dock. Atomic layout classes
  // preserve centering during :active; a generic scale transform would move the hit target.
  const jumpBase='product-jump-latest sand-kit-icon-button sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-9f619 sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-1firant sand-9lcvmn sand-149ho13 sand-10l6tqk sand-1nrll8i sand-uuh30 sand-zkaem6 sand-1td3qas sand-10w6t97 sand-10e981r sand-18o3ruo sand-tyxrsu sand-12sv23o';
  const jumpIcon=()=>iconsReady()?iconSvg('arrow-down',{size:24}):'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16m-7-7 7 7 7-7"/></svg>';
  const retiringOwners=new WeakMap();
  const key=()=>host.getConversationKey(),esc=host.esc;
  function phase(node,id){for(const a of node.getAnimations())a.cancel();host.sourceMotion.unbind(node,'INSTANCE-231');host.sourceMotion.unbind(node,'INSTANCE-232');node.className=jumpBase;delete node.dataset.sourceClasses;host.sourceMotion.bind(node,id);}
  function dock(frame){let node=frame.querySelector('[data-product-jump-dock]');if(!node){node=document.createElement('div');node.dataset.productJumpDock='';frame.append(node);
      // Chromium needs the fresh dock's layout established before an atomic move
      // can preserve the connected button's existing CSSAnimation object.
      void node.offsetHeight;}return node;}
  const queue=()=>host.getState().localOutbox?.[key()];
  function settings(){
    host.closePopover();host.showDialog('small-dialog','Lokale wachtrij',`<div class="form-dialog"><h1>Lokale wachtrij</h1><p class="small muted">Bewaar een echt concept tot deze lokale offlinemodus uit staat. De normale berichtopslag blijft dezelfde.</p><label class="setting-row"><span>Offlinemodus</span><input type="checkbox" role="switch" aria-label="Offlinemodus" data-product-offline ${host.getState().localOffline?'checked':''}></label><p role="status" data-queue-settings-status>${host.getState().localOffline?'Nieuwe berichten wachten lokaal.':'Berichten worden direct lokaal opgeslagen.'}</p><button class="outline-button" data-action="close-modal">Sluiten</button></div>`);
  }
  function enqueue(){
    if(!host.ensureConversation?.()&&!host.getAgent(key()))return true;
    const state=host.getState(),input=host.app.querySelector('#message-input'),text=composerText(input),refs=host.draftAttachments?.(key())||[];
    if(!text.trim()&&!refs.length)return true;
    state.localOutbox??={};const previous=state.localOutbox[key()];
    if(previous){previous.error='Er staat al een concept in de wachtrij. Verzend of annuleer dat eerst.';host.persist();host.render();return true;}
    state.localOutbox[key()]={id:crypto.randomUUID(),text,...(readComposerInput(input).richText!==undefined?{richText:readComposerInput(input).richText}:{}),attachmentIds:refs.map(r=>r.id),sinceMs:Date.now(),status:'queued'};
    if(!host.persist()){delete state.localOutbox[key()];state.localQueueError='Wachtrij niet bewaard. Je concept en bijlagen zijn behouden.';}
    host.render();return true;
  }
  function commit(){
    if(queueSending)return true;const state=host.getState(),q=queue();if(!q)return true;
    const refs=host.draftAttachments?.(key())||[],ids=refs.map(r=>r.id);
    if(state.localOffline){q.error='Zet Offlinemodus eerst uit.';host.persist();host.render();return true;}
    if(composerText(host.app.querySelector('#message-input'))!==q.text||readComposerInput(host.app.querySelector('#message-input')).richText!==q.richText||JSON.stringify(ids)!==JSON.stringify(q.attachmentIds)){
      q.error='Het concept is intussen gewijzigd. Annuleer de oude wachtrij om de nieuwe tekst te verzenden.';host.persist();host.render();return true;
    }
    const conversation=key(),before=(state.messages[conversation]||[]).filter(m=>m.role==='user').length;queueSending=true;q.status='committing';host.render();
    return Promise.resolve(host.sendMessage()).then(()=>{
      const current=host.getState(),same=current.localOutbox?.[conversation]?.id===q.id;
      if(same&&(current.messages[conversation]||[]).filter(m=>m.role==='user').length>before)delete current.localOutbox[conversation];
      else if(same){const retained=current.localOutbox[conversation];retained.status='queued';retained.error='Bericht niet vastgelegd. Je concept en bijlagen blijven behouden.';}
      host.persist();host.render();return true;
    },()=>{const retained=host.getState().localOutbox?.[conversation];if(retained?.id===q.id){retained.status='queued';retained.error='Lokale opslag is mislukt. Probeer opnieuw.';}host.render();return true;}).finally(()=>{queueSending=false;const button=host.app.querySelector('[data-action="product-queue-send"]');if(button)button.disabled=false;});
  }
  function notice(){const state=host.getState(),q=queue();
    if(!q&&!state.localQueueError&&!state.localOffline)return '';
    const delay=q?Math.max(0,q.sinceMs+2000-Date.now()):0;
    return `<section class="product-composer-notice" role="status" data-queued-id="${esc(q?.id||'')}"><span class="product-inline-status">${q?.status==='committing'?'Lokaal opslaan…':q?'Bericht staat in de lokale wachtrij':'Offlinemodus'}</span>${q?`<span class="product-send-progress" data-source-instance="INSTANCE-228" data-send-progress data-reveal-delay-ms="${delay}" style="animation-delay:${delay}ms" aria-hidden="true"><span class="product-send-progress-track"><span data-source-instance="INSTANCE-229" data-source-classes="sand-146r89t sand-1aquc0h sand-yftanf sand-4hg4is sand-a4qsjk"></span></span></span><button class="text-button" data-action="product-queue-send" ${queueSending?'disabled':''}>Wachtrij verzenden</button><button class="text-button" data-action="product-queue-cancel">Wachtrij annuleren</button>`:'<button class="text-button" data-action="product-queue-settings">Wachtrij instellen</button>'}${q?.error||state.localQueueError?`<p class="product-queue-error" role="alert">${esc(q?.error||state.localQueueError)}</p>`:''}</section>`;
  }
  function scrollToBottom(){return transcriptReaderFor(host)?.jumpToBottom();}
  function handleAction(ctx){
    const {action}=ctx;
    if(action==='send-message'&&host.getState().localOffline)return enqueue();
    if(action==='product-queue-settings'){settings();return true;}
    if(action==='product-queue-send')return commit();
    if(action==='product-queue-cancel'){const state=host.getState();if(state.localOutbox)delete state.localOutbox[key()];delete state.localQueueError;host.persist();host.render();return true;}
    if(action==='product-jump-latest'){
      // Native bottom navigation is instant; the button's enter/exit motion is independent.
      scrollToBottom();return true;
    }
    if(action==='product-prompt'){
      const input=host.app.querySelector('#message-input');if(input){if(!replaceComposerText(input,'Tel de woorden in mijn tekst'))return true;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}return true;
    }
    return false;
  }
  function handleSubmit({form}){return form?.id==='composer-form'&&host.getState().localOffline?enqueue():false;}
  function handleChange(event){if(!event.target.matches('[data-product-offline]'))return;host.getState().localOffline=event.target.checked;host.persist();const status=host.overlay.querySelector('[data-queue-settings-status]');if(status)status.textContent=event.target.checked?'Nieuwe berichten wachten lokaal.':'Berichten worden direct lokaal opgeslagen.';host.render();}
  function beforeRender(renderedKey){const liveJump=host.app.querySelector('.product-jump-latest');savedJump=liveJump?{node:liveJump,key:renderedKey??key()}:null;if(liveJump)parking.moveBefore(liveJump,null);const node=host.app.querySelector('.product-composer-notice:not([data-clearing])');savedNotice=node?{node,key:renderedKey??key(),id:node.dataset.queuedId,slot:node.querySelector('[data-send-progress]'),height:node.getBoundingClientRect().height}:null;if(node){parking.style.width=node.getBoundingClientRect().width+'px';parking.moveBefore(node,null);}}
  function afterRender(){
    const fresh=host.app.querySelector('.product-composer-notice:not([data-clearing])');
    if(savedNotice?.key===key()){
      if(fresh?.dataset.queuedId===savedNotice.id&&savedNotice.slot){const slot=fresh.querySelector('[data-send-progress]');if(slot){slot.parentNode.moveBefore(savedNotice.slot,slot);slot.remove();}}
      else if(savedNotice.id&&fresh?.dataset.queuedId!==savedNotice.id){const saved=savedNotice,node=saved.node;node.dataset.clearing='';node.inert=true;node.setAttribute('aria-hidden','true');node.style.height=saved.height+'px';node.style.overflow='hidden';const composerRoot=host.app.querySelector('.composer-wrap');if(composerRoot)composerRoot.moveBefore(node,composerRoot.firstChild);
        host.sourceMotion.animate(node,{opacity:[1,0]},{duration:host.sourceMotion.reduced?0:150,fill:'forwards'},{derivedFrom:'INSTANCE-230',nativeRecipe:'opacity150ms; local pre-send queue lifecycle',role:'offline-notice-clear'});
        const collapse=host.sourceMotion.animate(node,{height:[saved.height+'px','0px'],paddingTop:[getComputedStyle(node).paddingTop,'0px'],paddingBottom:[getComputedStyle(node).paddingBottom,'0px']},{duration:host.sourceMotion.reduced?0:200,delay:host.sourceMotion.reduced?0:150,fill:'forwards'},{derivedFrom:'INSTANCE-230',nativeRecipe:'height200ms after150ms; local pre-send queue lifecycle',role:'offline-notice-collapse'});collapse.finished.then(()=>node.remove(),()=>node.remove());
      }
    }
    const frame=host.app.querySelector('.thread-frame');if(savedJump?.key===key()&&frame){jump=savedJump.node;dock(frame).moveBefore(jump,null);}else if(savedJump){for(const a of savedJump.node.getAnimations())a.cancel();savedJump.node.remove();}savedJump=null;
    savedNotice=null;for(const old of [...parking.children]){for(const a of old.getAnimations({subtree:true}))a.cancel();old.remove();}
    releaseReader?.();releaseReader=null;scrollAbort?.abort();scrollAbort=new AbortController();jump=frame?.querySelector('.product-jump-latest')||null;
    const transcript=host.app.querySelector('.transcript');if(!transcript||!frame)return;
    const reader=transcriptReaderFor(host);
    function sync(){const state=reader.view(),away=!state.isPinnedToBottom&&state.distanceFromBottomPx>80&&host.isTranscriptCovered?.()!==true;
      if(away){
        if(jump?.isConnected){if(jump.hasAttribute('data-exiting')){retiringOwners.delete(jump);delete jump.dataset.exiting;jump.inert=false;phase(jump,'INSTANCE-231');}return;}
        jump=document.createElement('button');jump.type='button';jump.className=jumpBase;jump.dataset.action='product-jump-latest';jump.setAttribute('aria-label','Naar laatste bericht');jump.innerHTML=jumpIcon();dock(frame).append(jump);host.sourceMotion.bind(jump,'INSTANCE-231');
      }else if(jump?.isConnected&&!jump.hasAttribute('data-exiting')){
        const retiring=jump,owner=Symbol('jump-exit');retiringOwners.set(retiring,owner);retiring.dataset.exiting='';retiring.inert=true;phase(retiring,'INSTANCE-232');
        const done=()=>{if(retiringOwners.get(retiring)===owner&&retiring.hasAttribute('data-exiting')){retiringOwners.delete(retiring);retiring.remove();if(jump===retiring)jump=null;}};
        const animations=retiring.getAnimations();if(animations.length)Promise.allSettled(animations.map(a=>a.finished)).then(done);else done();
      }
    }
    transcript.addEventListener('keydown',event=>handleTranscriptEnd(event,()=>scrollToBottom(transcript)),{signal:scrollAbort.signal});
    releaseReader=reader.subscribe(sync);sync();
    for(const[selector,id]of [['.composer','INSTANCE-235'],['[data-ui-composer-padding]','INSTANCE-243'],['[data-composer-glyph="send"]','INSTANCE-238'],['[data-composer-glyph="mic"]','INSTANCE-239'],['.attachment-remove','INSTANCE-241']])for(const node of host.app.querySelectorAll(selector))host.sourceMotion.bind(node,id);
  }
  return{notice,handleAction,handleSubmit,handleChange,beforeRender,afterRender,destroy(){releaseReader?.();scrollAbort?.abort();jump?.remove();savedNotice=null;savedJump=null;parking.remove();}};
}

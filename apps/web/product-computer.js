import { iconSvg, iconsReady, fetchIconData } from './icon-library.js';
import { controllerFor, loadMotionData } from './avatar-motion.js';
import { source, bindWorkspace, ownScope } from './product-workspace-utils.js';
export function createComputerSurface(host) {
  const {esc,icon}=host,scope=ownScope(host),preparationScope=ownScope(host);let preparation=null,preparationToken=0;let phase='idle', teaching=false, frames=[], frameCounter=0, canvas=null, blocked=false;
  function panel(agent) {
    return `<div class="product-computer-preview" data-action="computer-preview" role="button" tabindex="0" aria-label="Computervoorbeeld openen"><span class="product-computer-stage-avatar" data-stage-avatar data-stage="asleep"><span class="product-computer-asleep-wrapper" ${source(17)} data-source-classes="sand-3nfvp2 sand-1q1rmc8 sand-gs473x sand-1aquc0h sand-njfjcd sand-4hg4is sand-a4qsjk">${host.avatar({id:`computer-asleep-${agent?.id||'local'}`,shape:agent?.shape??0,color:'#949494',motionState:'sleeping',pointerMode:'none'},'')}</span><span class="product-computer-sleep-letters" aria-hidden="true"><span class="product-sleep-letter" ${source(13)} style="left:0;animation-delay:0s">z</span><span class="product-sleep-letter" ${source(13)} style="left:4px;animation-delay:-.8s">z</span><span class="product-sleep-letter" ${source(13)} style="left:8px;animation-delay:-1.6s">z</span></span></span><span class="outline-button product-open-pill" aria-hidden="true" ${source(18)}>Openen</span></div><h3 style="font-size:14px;font-weight:500">De computer slaapt</h3><p class="context-hint">Je Bot maakt de computer wakker wanneer die nodig is.</p><p class="product-local-boundary">Het computervoorbeeld is lokaal en bestuurt je Mac niet.</p><button class="context-link" data-action="computer-settings"><span>Computerinstellingen</span>${icon('right')}</button>`;
  }
  function open(isTeaching=false) {
    cancelPreparation();scope.clear();phase='idle';teaching=isTeaching;frames=[];frameCounter=0;
    host.showDialog('product-computer-dialog',teaching?'Een taak aanleren':'Computer van de Bot',`<div class="product-dialog-header"><h1>${teaching?'Een taak aanleren':'Computer van de Bot'}</h1></div>${teaching?'<div style="padding:0 24px"><label class="field-label">Taaknaam<input class="field-input" aria-label="Taaknaam" data-teach-name placeholder="Geef je taak een naam"></label></div>':''}<div class="product-computer-screen" data-computer-screen><canvas data-local-computer-canvas width="768" height="360" aria-label="Lokale werkruimte"></canvas><img class="product-held-frame" data-held-frame="false" ${source(55)} alt="Vastgehouden lokaal computerbeeld"><div class="product-preview-cursor" data-preview-cursor></div><div data-computer-blocked hidden></div></div><div style="padding:0 24px"><label class="field-label">Notitie<input class="field-input" aria-label="Computernotitie" placeholder="Schrijf een notitie"></label><p role="status" data-local-computer-result>Gereed</p><button class="outline-button" data-action="product-computer-step">Notitie vastleggen</button><button class="text-button" data-action="product-computer-prepare">Werkruimte voorbereiden</button><button class="text-button" data-action="product-computer-block">Werkruimte vergrendelen</button></div><div style="padding:0 24px"><p class="product-local-boundary">Alleen interacties in dit voorbeeld worden lokaal opgenomen. Geen schermtoegang, browserbesturing of externe computer.</p><div role="status" data-recording-status>Gereed om op te nemen</div></div><div class="product-dialog-footer" data-computer-controls></div>`);
    canvas=host.overlay.querySelector('[data-local-computer-canvas]');blocked=false;draw();const screen=host.overlay.querySelector('[data-computer-screen]'),cursor=screen.querySelector('[data-preview-cursor]');
    screen.addEventListener('pointermove',event=>{const rect=screen.getBoundingClientRect(),x=Math.max(0,Math.min(rect.width,event.clientX-rect.left)),y=Math.max(0,Math.min(rect.height,event.clientY-rect.top));cursor.style.transform=`translate(${x}px,${y}px)`;cursor.toggleAttribute('data-visible',true);if(phase==='recording')capture('pointer',{x:x/rect.width,y:y/rect.height});},{signal:scope.signal});
    screen.addEventListener('pointerleave',()=>cursor.removeAttribute('data-visible'),{signal:scope.signal});screen.addEventListener('pointerdown',()=>cursor.dataset.pressed='true',{signal:scope.signal});screen.addEventListener('pointerup',()=>delete cursor.dataset.pressed,{signal:scope.signal});
    host.overlay.querySelector('[aria-label=Computernotitie]').addEventListener('input',event=>{if(phase!=='paused')draw(event.target.value);},{signal:scope.signal});
    host.overlay.addEventListener('input',event=>{if(phase==='recording')capture('input',{field:event.target.ariaLabel,value:event.target.value});},{signal:scope.signal});paintControls();bindWorkspace(host);
  }
  function draw(note=host.overlay.querySelector('[aria-label=Computernotitie]')?.value||'',target=canvas) {if(!target)return;const context=target.getContext('2d');if(!context)return;const dark=document.documentElement.dataset.theme==='dark';context.fillStyle=dark?'#121212':'#f1f1f1';context.fillRect(0,0,768,360);context.fillStyle=dark?'#242424':'#fff';context.fillRect(160,70,448,220);context.fillStyle=dark?'#f5f5f5':'#1c1c1c';context.font='500 20px X, sans-serif';context.fillText('Lokale werkruimte',185,108);context.font='14px X, sans-serif';context.fillText(note.slice(0,54)||'Schrijf hieronder een notitie om je taak te oefenen.',185,158);context.fillStyle=dark?'#aaa':'#777';context.font='12px X, sans-serif';context.fillText('Alleen dit lokale voorbeeld wordt opgenomen.',185,262);return true;}
  function capture(type,data){if(frames.length<1000)frames.push({id:++frameCounter,type,data,time:performance.now()});}
  function paintControls(){const controls=host.overlay.querySelector('[data-computer-controls]');if(!controls)return;controls.innerHTML=phase==='idle'?'<button class="primary-button" data-action="product-record-start">Opname starten</button>':phase==='recording'?'<button class="outline-button" data-action="product-record-pause">Opname pauzeren</button><button class="primary-button" data-action="product-record-stop">Opname stoppen</button>':phase==='paused'?'<button class="outline-button" data-action="product-record-resume">Opname hervatten</button><button class="primary-button" data-action="product-record-stop">Opname stoppen</button>':'<button class="primary-button" data-action="product-record-start">Opname starten</button>';
    host.overlay.querySelector('[data-recording-status]').textContent=phase==='recording'?'Opname actief':phase==='paused'?'Gepauzeerd':phase==='stopped'?`${frames.length} lokale stappen bewaard`:'Gereed om op te nemen';host.overlay.querySelector('[data-held-frame]').dataset.heldFrame=String(phase==='paused');
  }
  function stop(){const priorPhase=phase;phase='stopped';const note=host.overlay.querySelector('[aria-label=Computernotitie]')?.value||'',name=host.overlay.querySelector('[data-teach-name]')?.value.trim()||'Lokale taak';const state=host.getState(),priorRecordings=[...(state.localComputerRecordings||[])],priorSkills=[...state.privateSkills];const saved=host.update(state=>{state.localComputerRecordings||=[];state.localComputerRecordings.push({id:crypto.randomUUID(),name,botId:host.getConversationKey(),frames:structuredClone(frames),frame:canvas?.toDataURL('image/png')||null,note,createdAt:Date.now()});if(teaching){state.privateSkills.push({name,description:`${frames.length} lokaal opgenomen stappen. ${note}`});}},{render:false});if(saved===false){state.localComputerRecordings=priorRecordings;state.privateSkills=priorSkills;phase=priorPhase;paintControls();host.overlay.querySelector('[data-recording-status]').textContent='Opname niet opgeslagen. De lokale stappen blijven behouden; probeer opnieuw.';return;}paintControls();}
  // Local operation analogue of kU/WOe: retain the last operation while its
  // two opacity tracks close. This does real canvas work, never a remote rebuild.
  function cancelPreparation({remove=true}={}) {
    const previous=preparation;preparationToken++;preparation=null;preparationScope.clear();
    if(previous){retirePreparationSteps(previous);clearTimeout(previous.deadline);for(const animation of previous.element.getAnimations({subtree:true}))animation.cancel();if(remove)previous.element.remove();}
  }
  const preparationStepLabels=['Voorbeeldscherm tekenen','PNG-beeld opbouwen','Beeld herstellen en toepassen'];
  const stepStateText={pending:'niet gestart',active:'bezig',done:'voltooid'};
  function preparationStepsMarkup(){return `<ol class="product-computer-steps" aria-label="Taakstappen">${preparationStepLabels.map(label=>`<li data-state="pending"><span class="product-computer-step-glyph" data-computer-step-glyph aria-hidden="true"></span><span>${esc(label)}</span><span class="product-computer-step-state" data-computer-step-state>, niet gestart</span></li>`).join('')}</ol>`;}
  function paintPreparationSteps(operation,index,{working=true}={}){
    if(!preparationCurrent(operation))return;operation.currentStep=index;
    for(const [i,row] of [...operation.element.querySelectorAll('.product-computer-steps li')].entries()){
      const state=i<index?'done':i===index&&working?'active':'pending',glyph=row.querySelector('[data-computer-step-glyph]'),name=state==='active'?'spinner':state==='done'?'check-circle':'circle';
      row.dataset.state=state;if(state==='active')row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');row.querySelector('[data-computer-step-state]').textContent=`, ${stepStateText[state]}`;
      if(glyph.dataset.stepIcon!==name||(!glyph.firstElementChild&&iconsReady())){
        for(const animation of glyph.getAnimations({subtree:true}))animation.cancel();host.sourceMotion.unbind(glyph,'INSTANCE-217');glyph.innerHTML=iconsReady()?iconSvg(name,{size:16}):'';glyph.dataset.stepIcon=name;
      }
      if(state==='active')host.sourceMotion.bind(glyph,'INSTANCE-217',{classes:'sand-1so62im sand-r5sbw0 sand-1aquc0h sand-3ryk4j sand-1esw782 sand-a4qsjk'});
      else host.sourceMotion.unbind(glyph,'INSTANCE-217');
    }
  }
  function retirePreparationSteps(operation){
    for(const row of operation.element.querySelectorAll('.product-computer-steps li')){
      row.removeAttribute('aria-current');if(row.dataset.state==='active'){row.dataset.state='pending';row.querySelector('[data-computer-step-state]').textContent=', niet gestart';}
      const glyph=row.querySelector('[data-computer-step-glyph]');for(const animation of glyph.getAnimations({subtree:true}))animation.cancel();host.sourceMotion.unbind(glyph,'INSTANCE-217');
    }
  }
  function failPreparation(operation,error){if(!preparationCurrent(operation))return;paintPreparationSteps(operation,operation.currentStep,{working:false});operation.phase='failed';operation.element.dataset.preparePhase='failed';const status=operation.element.querySelector('[data-prepare-operation-status]');status.setAttribute('role','alert');status.textContent=error instanceof Error?error.message:'Het lokale beeld kon niet worden opgebouwd.';}
  function preparationCurrent(operation){return preparation===operation&&operation.token===preparationToken&&operation.element.isConnected&&operation.canvas===canvas&&canvas?.isConnected;}
  function disposePreparation(operation){if(preparation!==operation)return;cancelPreparation();}
  function armPreparationDeadline(operation){
    clearTimeout(operation.deadline);operation.deadline=null;
    if(!preparationCurrent(operation)||operation.phase!=='closing'||host.sourceMotion.inspect)return;
    const elapsed=Math.min(...operation.animations.map(animation=>Number(animation.currentTime)||0));
    operation.deadline=setTimeout(()=>{if(preparationCurrent(operation))disposePreparation(operation);},Math.max(0,160-elapsed));
  }
  function closePreparation(operation){
    if(!preparationCurrent(operation))return;operation.phase='closing';operation.element.dataset.preparePhase='closing';
    operation.animations=[...operation.element.children].map(node=>{node.style.opacity='0';return preparationScope.animate(node,[{opacity:1},{opacity:0}],{duration:160,easing:'ease'},{family:'transcript-placeholder-and-scrim',role:'local-computer-preparation-close'});}).filter(Boolean);
    Promise.all(operation.animations.map(animation=>animation.finished)).then(()=>{if(preparationCurrent(operation))disposePreparation(operation);},()=>{});
    armPreparationDeadline(operation);
  }
  function beginPreparation(){
    const retained=preparation?.element;cancelPreparation({remove:false});const screen=host.overlay.querySelector('[data-computer-screen]');if(!screen||!canvas?.isConnected){retained?.remove();return;}
    const element=retained||document.createElement('div');element.className='product-computer-prepare';
    if(!retained)element.innerHTML=`<div class="product-prepare-scrim" ${source(220)}></div><div class="product-prepare-card" ${source(219)} role="status"><strong>Lokale werkruimte voorbereiden</strong><p data-prepare-operation-status>Het lokale voorbeeldscherm wordt opnieuw opgebouwd.</p>${preparationStepsMarkup()}<button class="outline-button" data-action="product-computer-prepare-cancel">Annuleren</button></div>`;
    for(const node of element.children){node.style.transition='none';node.style.opacity='1';}screen.append(element);void element.offsetHeight;for(const node of element.children)node.style.removeProperty('transition');
    const operation={token:preparationToken,element,canvas,phase:'building',currentStep:0,animations:[],deadline:null};preparation=operation;element.dataset.preparePhase='building';element.querySelector('[data-prepare-operation-status]').removeAttribute('role');element.querySelector('[data-prepare-operation-status]').textContent='Het lokale voorbeeldscherm wordt opnieuw opgebouwd.';paintPreparationSteps(operation,0);if(!iconsReady())fetchIconData().then(()=>{if(preparationCurrent(operation))paintPreparationSteps(operation,operation.currentStep,{working:operation.phase==='building'});}).catch(()=>{});bindWorkspace(host);
    const note=host.overlay.querySelector('[aria-label=Computernotitie]')?.value||'',candidate=document.createElement('canvas');candidate.width=canvas.width;candidate.height=canvas.height;try{if(!draw(note,candidate))throw new Error('Het lokale tekenvlak is niet beschikbaar.');paintPreparationSteps(operation,1);
    // Encoding and decoding a fresh local frame is the actual asynchronous work.
    // Every continuation checks ownership; cancel/reopen cannot write an old frame.
    candidate.toBlob(async blob=>{let bitmap=null;try{
      if(!preparationCurrent(operation))return;if(!blob)throw new Error('Het lokale beeld kon niet worden opgebouwd.');paintPreparationSteps(operation,2);bitmap=await createImageBitmap(blob);
      if(!preparationCurrent(operation))return;const context=operation.canvas.getContext('2d');if(!context)throw new Error('Het lokale tekenvlak is niet beschikbaar.');context.drawImage(bitmap,0,0);paintPreparationSteps(operation,3,{working:false});element.querySelector('[data-prepare-operation-status]').textContent='Het lokale voorbeeldscherm is opnieuw opgebouwd.';closePreparation(operation);
    }catch(error){failPreparation(operation,error);}
    finally{bitmap?.close();}},'image/png');}catch(error){failPreparation(operation,error);}
  }
  return {
    renderSlot(name,{agent}={}){if(name==='computerPanel')return panel(agent);},
    handleAction({action}){
      if(action==='computer-preview'){open();return true;}if(action==='teach-task'){host.closePopover();open(true);return true;}
      if(action==='product-record-start'){frames=[];phase='recording';capture('started',{});paintControls();return true;}
      if(action==='product-record-pause'){if(phase==='recording'){capture('paused',{});const held=host.overlay.querySelector('[data-held-frame]');if(canvas)held.src=canvas.toDataURL('image/png');phase='paused';paintControls();}return true;}
      if(action==='product-record-resume'){if(phase==='paused'){phase='recording';draw();capture('resumed',{});paintControls();}return true;}
      if(action==='product-record-stop'){if(['recording','paused'].includes(phase))stop();return true;}
      if(action==='product-computer-prepare'){beginPreparation();return true;}
      if(action==='product-computer-prepare-cancel'){cancelPreparation();return true;}
      if(action==='product-computer-block'){blocked=true;const surface=host.overlay.querySelector('[data-computer-blocked]');surface.hidden=false;surface.innerHTML=`<div class="product-blocked-background" aria-hidden="true"><span class="sand-c8nplq sand-1aquc0h sand-18r2a5t sand-1esw782 sand-a4qsjk sand-pz12be" data-derived-motion="INSTANCE-282"><span class="sand-1jgey22 sand-1aquc0h sand-jr034s sand-1esw782 sand-a4qsjk sand-pz12be"><span class="sand-14j9vb sand-1aquc0h sand-1x0l5pi sand-1esw782 sand-a4qsjk">${host.avatar({color:'#9159fe',shape:0},'large')}</span></span></span></div><div class="product-blocked-content"><h2>Werkruimte vergrendeld</h2><p>Deze lokale werkruimte is gepauzeerd.</p><button class="outline-button" data-action="product-computer-unblock">Werkruimte ontgrendelen</button></div>`;bindWorkspace(host);return true;}
      if(action==='product-computer-unblock'){blocked=false;const surface=host.overlay.querySelector('[data-computer-blocked]');for(const a of surface.getAnimations({subtree:true}))a.cancel();surface.replaceChildren();surface.hidden=true;draw();return true;}
      if(action==='product-computer-step'){const value=host.overlay.querySelector('[aria-label=Computernotitie]')?.value||'';host.overlay.querySelector('[data-local-computer-result]').textContent=value?`Vastgelegd: ${value}`:'Schrijf eerst een notitie';if(phase==='recording')capture('commit-note',{value});draw(value);return true;}
      return false;
    },
    afterRender(){for(const avatar of host.app.querySelectorAll('[data-stage-avatar] .motion-avatar')){if(avatar.dataset.computerStageBound)continue;avatar.dataset.computerStageBound='';const controller=controllerFor(avatar);controller?.setPointer(false);controller?.pause();loadMotionData().then(()=>{if(avatar.isConnected){controller?.setState('sleeping');controller?.pause();}}).catch(()=>{});}const preview=host.app.querySelector('.product-computer-preview[role=button]');if(preview&&!preview.dataset.keyboardBound){preview.dataset.keyboardBound='';preview.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target===preview){event.preventDefault();open();}});}},
    setInspect(){if(preparation)armPreparationDeadline(preparation);},
    beforeDialogChange(){cancelPreparation();scope.clear();phase='idle';canvas=null;},
    destroy(){cancelPreparation();scope.clear();frames=[];canvas=null;},
  };
}

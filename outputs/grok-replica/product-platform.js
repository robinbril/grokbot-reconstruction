export function createPlatformSurface(host){
 const {sourceMotion:source}=host, abort=new AbortController(), signal=abort.signal;
 let tooltip=null,tipTrigger=null,tipTimer=null,toast=null,toastSerial=0,tabObserver=null;let savedToggles=new Map(),navigation=null;const departing=new Set(),platformDialogs=new Set();let covered=false,coverTrigger=null,dialogInvoker=null;
 const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
 function hideTooltip(){clearTimeout(tipTimer);tipTimer=null;if(tipTrigger){tipTrigger.removeAttribute('aria-describedby');tipTrigger=null;}tooltip?.remove();tooltip=null;}
 function showTooltip(trigger){
  hideTooltip();if(!trigger?.isConnected||trigger.disabled||trigger.closest('[role=menu]'))return;
  const label=trigger.dataset.productTooltip||trigger.title;if(!label)return;
  tipTimer=setTimeout(()=>{if(!trigger.isConnected)return;tipTrigger=trigger;tooltip=document.createElement('div');tooltip.dataset.productPortal='';tooltip.className='product-tooltip';tooltip.id='product-tooltip';tooltip.role='tooltip';tooltip.textContent=label;tooltip.dataset.sourceInstance='INSTANCE-308';document.body.append(tooltip);const r=trigger.getBoundingClientRect();const b=tooltip.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(innerWidth-b.width-8,r.left+(r.width-b.width)/2))+'px';tooltip.style.top=(r.bottom+b.height+14<innerHeight?r.bottom+8:Math.max(8,r.top-b.height-8))+'px';trigger.setAttribute('aria-describedby',tooltip.id);source.bindTree(tooltip);},300);
 }
 document.addEventListener('pointerover',e=>{const t=e.target.closest('[data-product-tooltip]');if(t&&!t.contains(e.relatedTarget))showTooltip(t);},{signal});
 document.addEventListener('pointerout',e=>{if(e.target.closest('[data-product-tooltip]')&&!e.target.closest('[data-product-tooltip]').contains(e.relatedTarget))hideTooltip();},{signal});
 document.addEventListener('focusin',e=>{if(e.target.matches('[data-product-tooltip]'))showTooltip(e.target);},{signal});
 document.addEventListener('focusout',hideTooltip,{signal});document.addEventListener('pointerdown',hideTooltip,{signal});document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTooltip();},{signal});
 // Source mG retains the last URL while the passive bottom preview fades out.
 let linkPreview=null,linkTrigger=null;
 function previewLink(anchor){
  let url;try{url=new URL(anchor.href);if(!['http:','https:'].includes(url.protocol))return;}catch{return;}
  if(!linkPreview){linkPreview=document.createElement('div');linkPreview.dataset.productPortal='';linkPreview.className='product-link-preview';linkPreview.setAttribute('aria-hidden','true');linkPreview.dataset.sourceInstance='INSTANCE-171';document.body.append(linkPreview);source.bindTree(linkPreview);}
  linkTrigger=anchor;linkPreview.textContent=url.href;void getComputedStyle(linkPreview).opacity;linkPreview.dataset.visible='';
 }
 function hideLinkPreview(){linkTrigger=null;linkPreview?.removeAttribute('data-visible');}
 document.addEventListener('pointerover',event=>{const anchor=event.target.closest('a[href]');if(anchor&&!anchor.contains(event.relatedTarget))previewLink(anchor);},{signal});
 document.addEventListener('pointerout',event=>{const anchor=event.target.closest('a[href]');if(anchor&&anchor===linkTrigger&&!anchor.contains(event.relatedTarget))hideLinkPreview();},{signal});
 document.addEventListener('focusin',event=>{if(event.target.matches('a[href]'))previewLink(event.target);},{signal});
 document.addEventListener('focusout',event=>{if(event.target===linkTrigger)hideLinkPreview();},{signal});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hideLinkPreview();},{signal});
 const textRolls=new Map();
 host.rollText=(node,text,{fade=false}={})=>{
  if(!node)return;const value=String(text),old=textRolls.get(node);if(old?.text===value)return;
  if(old){clearTimeout(old.timer);old.previous?.remove();}
  const prior=old?.text;node.classList.add('product-text-roll');node.dataset.status=prior!==undefined&&prior!==value&&!source.reduced?'rolling':'idle';node.setAttribute('aria-label',value);node.replaceChildren();
  const current=document.createElement('span');current.dataset.slot='current';current.setAttribute('aria-hidden','true');current.textContent=value;node.append(current);
  const record={text:value,current,timer:null,previous:null};textRolls.set(node,record);
  if(node.dataset.status==='rolling'){
   const previous=document.createElement('span');previous.dataset.slot='previous';previous.setAttribute('aria-hidden','true');previous.textContent=prior;node.prepend(previous);record.previous=previous;source.bind(current,fade?'INSTANCE-330':'INSTANCE-328');source.bind(previous,fade?'INSTANCE-331':'INSTANCE-329');
   const finish=()=>{if(source.inspect&&!source.reduced){record.timer=setTimeout(finish,100);return;}previous.remove();record.previous=null;node.dataset.status='idle';source.unbind(current,fade?'INSTANCE-330':'INSTANCE-328');};record.timer=setTimeout(finish,300);
  }
 };
 function beforeRender(){savedToggles=new Map();for(const button of qa('.header-buttons [data-action=toggle-context],.task-pin',host.app)){const wrap=q('[data-product-swap]',button);if(wrap){for(const layer of wrap.children)void getComputedStyle(layer).opacity;savedToggles.set(button.dataset.action+':'+(button.dataset.id||''),wrap);}}}
 function swapButton(button,pressed){
  if(!button)return;let wrap=q('[data-product-swap]',button);
  if(!wrap){const saved=savedToggles.get(button.dataset.action+':'+(button.dataset.id||''));if(saved){button.querySelector('.icon')?.replaceWith(saved);wrap=saved;}}
  if(!wrap){const old=q('.icon',button);if(!old)return;wrap=document.createElement('span');wrap.dataset.productSwap='';wrap.className='product-toggle-glyphs';for(let i=0;i<2;i++){const layer=document.createElement('span');layer.className='product-toggle-glyph';layer.dataset.sourceInstance='INSTANCE-002';layer.setAttribute('aria-hidden','true');layer.innerHTML=i?host.icon('panel'):old.outerHTML;wrap.append(layer);}old.replaceWith(wrap);}
  for(const layer of wrap.children)void getComputedStyle(layer).opacity;
  [...wrap.children].forEach((n,i)=>n.toggleAttribute('data-swap-active',i===Number(pressed)));button.setAttribute('aria-pressed',String(pressed));
 }
 function bindSegment(root){
  if(root.dataset.segmentReady)return;root.dataset.segmentReady='';root.classList.add('product-segment');
  let indicator=q('[data-segment-indicator]',root);if(!indicator){indicator=document.createElement('span');indicator.dataset.segmentIndicator='';indicator.dataset.sourceInstance='INSTANCE-000';indicator.setAttribute('aria-hidden','true');root.prepend(indicator);}
  const tabs=qa('[role=tab]',root);
  function measure(){const selected=tabs.find(t=>t.getAttribute('aria-selected')==='true')||tabs[0];if(!selected)return;const r=selected.getBoundingClientRect(),b=root.getBoundingClientRect();Object.assign(indicator.style,{left:r.left-b.left+'px',top:r.top-b.top+'px',width:r.width+'px',height:r.height+'px'});tabs.forEach(t=>{t.tabIndex=t===selected?0:-1;source.bind(t,'INSTANCE-001');});}
  root.addEventListener('keydown',e=>{const index=tabs.indexOf(e.target);if(index<0)return;const rtl=document.dir==='rtl';const delta=e.key==='ArrowRight'?(rtl?-1:1):e.key==='ArrowLeft'?(rtl?1:-1):0;let next=delta?(index+delta+tabs.length)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(next===null)return;e.preventDefault();tabs[next].focus();tabs[next].click();},{signal});
  root.addEventListener('product-segment-change',measure,{signal});const observer=new ResizeObserver(measure);observer.observe(root);root.productSegmentObserver=observer;measure();
 }
 function toastResult(text){
  toast?.remove();const serial=++toastSerial;toast=document.createElement('div');toast.dataset.productPortal='';toast.className='product-toast';toast.role='status';toast.textContent=text;const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Melding sluiten');close.innerHTML=host.icon('close');close.addEventListener('click',()=>dismissToast(serial),{once:true});toast.append(close);document.body.append(toast);return toast;
 }
 function dismissToast(serial=toastSerial){if(!toast||serial!==toastSerial)return;toast.remove();toast=null;}
 host.notify=toastResult;
 host.openPlatformDialog=(label,content)=>{
  const dialog=document.createElement('dialog');dialog.dataset.productPortal='';dialog.className='product-platform-dialog';dialog.setAttribute('aria-label',label);dialog.dataset.sourceInstance='INSTANCE-320';dialog.innerHTML=`<header><h2>${host.esc(label)}</h2><button type="button" class="icon-button" aria-label="Details sluiten">${host.icon('close')}</button></header><div class="product-platform-dialog-body">${content}</div>`;document.body.append(dialog);platformDialogs.add(dialog);const trigger=document.activeElement;coverTrigger=trigger;let closing=false;
  const finish=()=>{dialog.close();dialog.remove();platformDialogs.delete(dialog);if(trigger?.isConnected)trigger.focus({preventScroll:true});};
  const close=()=>{if(closing)return;closing=true;dialog.inert=true;dialog.dataset.closing='';source.bind(dialog,'INSTANCE-321');const end=e=>{if(e.target===dialog&&e.animationName==='ui-fh2zsw-B')finish();};dialog.addEventListener('animationend',end);dialog.addEventListener('animationcancel',end);if(source.reduced)finish();};
  source.bind(dialog.querySelector('header button'),'INSTANCE-323');dialog.querySelector('header button').addEventListener('click',close,{signal});dialog.addEventListener('cancel',e=>{e.preventDefault();close();},{signal});dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();},{signal});dialog.showModal();source.bindTree(dialog);return {dialog,close};
 };
 function updateCover(force=false){const next=host.overlay.open&&host.overlay.classList.contains('settings')&&Boolean(document.querySelector('dialog.language-picker[open],dialog.product-platform-dialog[open]'));if(next===covered&&!force)return;covered=next;if(host.overlay.open&&host.overlay.classList.contains('settings')){for(const id of ['INSTANCE-031','INSTANCE-032'])source.unbind(host.overlay,id);if(!source.reduced)source.bind(host.overlay,next?'INSTANCE-031':'INSTANCE-032');void getComputedStyle(host.overlay).transform;host.overlay.style.transform=next&&!source.reduced?'scale(.95)':'scale(1)';host.overlay.toggleAttribute('data-settings-covered',next);host.overlay.inert=next;if(!next&&coverTrigger?.isConnected){coverTrigger.focus({preventScroll:true});coverTrigger=null;}source.bindTree(host.overlay);}else{host.overlay.style.transform='';host.overlay.inert=false;}}
 const coverObserver=new MutationObserver(updateCover);coverObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
 function afterRender(){
  for(const [node,record] of textRolls)if(!node.isConnected){clearTimeout(record.timer);textRolls.delete(node);}
  qa('.icon-button[title],.circle-button[title],.account-button[title]').forEach(n=>{if(!n.dataset.productTooltip)n.dataset.productTooltip=n.title;n.removeAttribute('title');source.bind(n,'INSTANCE-304');});
  const state=host.getState();qa('[data-action="toggle-context"]').filter(n=>n.closest('.header-buttons')).forEach(n=>swapButton(n,state.context));qa('.task-pin').forEach(n=>swapButton(n,n.getAttribute('aria-pressed')==='true'));
  qa('[role=switch]').forEach(n=>{source.bind(n,'INSTANCE-121');n.classList.add('product-switch');if(!q('[data-switch-thumb]',n)){const thumb=document.createElement('span');thumb.dataset.switchThumb='';thumb.dataset.sourceInstance='INSTANCE-120';thumb.setAttribute('aria-hidden','true');n.append(thumb);}});
  qa('[data-segmented-control]').forEach(bindSegment);
  qa('[data-source-instance~="INSTANCE-323"],[data-source-instance~="INSTANCE-325"]').forEach(n=>{source.unbind(n,'INSTANCE-323');source.unbind(n,'INSTANCE-325');});
  qa('dialog [data-action=close-modal],dialog [data-dialog-close],.product-platform-dialog header button').forEach(n=>source.bind(n,'INSTANCE-323'));
  qa('.menu-row').forEach(n=>source.bind(n,'INSTANCE-099'));
  qa('input[type=checkbox],input[type=radio]').forEach(n=>{if(n.dataset.productCheck)return;n.dataset.productCheck='';n.classList.add('product-native-choice');source.bind(n,n.type==='radio'?'INSTANCE-097':'INSTANCE-093');});
  qa('details.tool-row summary').forEach(n=>source.bind(n,'INSTANCE-115'));
  qa('.connected-button').forEach(n=>source.bind(n,'INSTANCE-117'));
  qa('.search-field').forEach(n=>source.bind(n,'INSTANCE-095'));
  qa('.icon-button:not([data-source-instance]),.circle-button:not([data-source-instance])').forEach(n=>source.bind(n,'INSTANCE-107'));
  qa('.outline-button:not([data-source-instance]),.primary-button:not([data-source-instance])').forEach(n=>source.bind(n,'INSTANCE-112'));
  qa('.field-input').filter(n=>!n.hasAttribute('data-source-instance')).forEach(n=>source.bind(n,'INSTANCE-111'));
  if(host.overlay.open){host.overlay.dataset.sourceBound='';host.overlay.style.animationName='none';source.bind(host.overlay,'INSTANCE-113');}
  const pane=host.app.querySelector('.context-pane');
  if(pane&&!pane.querySelector('[data-info-resize]')){
    const grip=document.createElement('div');grip.dataset.infoResize='';grip.className='product-info-resize';grip.setAttribute('role','separator');grip.setAttribute('aria-label','Breedte van gespreksdetails');grip.setAttribute('aria-orientation','vertical');grip.tabIndex=0;const line=document.createElement('span');line.className='product-info-resize-line';line.dataset.sourceInstance='INSTANCE-153';line.setAttribute('aria-hidden','true');grip.append(line);pane.prepend(grip);
    const setWidth=width=>{const sidebar=host.app.querySelector('.sidebar')?.getBoundingClientRect().width||280,max=Math.max(0,innerWidth-sidebar-424),bounded=Math.max(Math.min(240,max),Math.min(max,width));host.app.style.setProperty('--sand-info-pane-width',bounded+'px');host.getState().infoPaneWidth=bounded;grip.setAttribute('aria-valuenow',String(Math.round(bounded)));return bounded;};
    if(Number.isFinite(state.infoPaneWidth))setWidth(state.infoPaneWidth);
    grip.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const start=e.clientX,width=pane.getBoundingClientRect().width,sign=document.dir==='rtl'?-1:1;grip.setPointerCapture(e.pointerId);const move=event=>setWidth(width+(start-event.clientX)*sign);const stop=()=>{grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',stop);grip.removeEventListener('pointercancel',stop);host.persist();};grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',stop,{once:true});grip.addEventListener('pointercancel',stop,{once:true});},{signal});
    grip.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const width=Number.isFinite(host.getState().infoPaneWidth)?host.getState().infoPaneWidth:pane.getBoundingClientRect().width;setWidth(e.key==='Home'?240:e.key==='End'?innerWidth:width+(e.key==='ArrowLeft'?20:-20));host.persist();},{signal});
  }
  source.bindTree(host.app);source.bindTree(host.overlay);
 }
 function afterDialogChange(context={}){
  if(context.close&&dialogInvoker){const {node,action,id,label}=dialogInvoker;dialogInvoker=null;const target=node?.isConnected?node:[...host.app.querySelectorAll('button')].find(n=>(action&&n.dataset.action===action&&(!id||n.dataset.id===id))||label&&n.getAttribute('aria-label')===label);target?.focus({preventScroll:true});}
  if(navigation&&host.overlay.open){
    const {old,direction}=navigation;navigation=null;
    // Native W combines the shared incoming/outgoing styles with its direction.
    // The outgoing branch alone contains only animation-name, yielding a zero-second exit.
    const incomingBase='sand-1n2onr6 sand-1ja2u2z sand-9f619 sand-78zum5 sand-dt5ytf sand-euugli sand-1us19tq sand-h8yej3 sand-5yr21d sand-gcd1z6';
    const outgoingBase='sand-10l6tqk sand-13vifvy sand-1ey2m1c sand-1o0tod sand-tijo5x sand-1ja2u2z sand-9f619 sand-78zum5 sand-dt5ytf sand-euugli sand-gcd1z6 sand-47corl sand-rez4as sand-q56fva sand-10e4vud';
    const incoming=document.createElement('div');incoming.className=`product-navigation-page ${incomingBase}`;incoming.dataset.sourceInstance=direction==='push'?'INSTANCE-083':'INSTANCE-084';
    if(direction==='push'){incoming.classList.remove('sand-1ja2u2z');incoming.classList.add('sand-1vjfegm');}
    for(const child of [...host.overlay.children])if(!child.matches('.modal-close'))incoming.append(child);host.overlay.append(incoming);
    old.className=`product-navigation-departing ${outgoingBase}`;old.dataset.sourceInstance=direction==='push'?'INSTANCE-086':'INSTANCE-087';if(direction==='pop'){old.classList.remove('sand-1ja2u2z');old.classList.add('sand-1vjfegm');}old.inert=true;old.setAttribute('aria-hidden','true');host.overlay.append(old);departing.add(old);source.bindTree(incoming);source.bindTree(old);
    const finish=event=>{if(event&&event.target!==old)return;old.removeEventListener('animationend',finish);old.removeEventListener('animationcancel',finish);old.remove();departing.delete(old);};old.addEventListener('animationend',finish);old.addEventListener('animationcancel',finish);if(source.reduced)finish();
  }
  afterRender();
 }
 function beforeDialogChange(context={}){
  if(!host.overlay.open&&!context.close){let node=document.activeElement;if(node?.closest?.('[role=menu]'))node=host.app.querySelector('[aria-haspopup=menu][aria-expanded=true]')||node;dialogInvoker={node,action:node?.dataset?.action,id:node?.dataset?.id,label:node?.getAttribute?.('aria-label')};}
  hideTooltip();for(const n of qa('[data-segmented-control]',host.overlay))n.productSegmentObserver?.disconnect();
  for(const n of departing)n.remove();departing.clear();
  const current=host.overlay.getAttribute('aria-label');const direction=current==='Bot-sjablonen'&&context.nextKind==='small-dialog'?'push':context.kind==='small-dialog'&&context.nextLabel==='Bot-sjablonen'?'pop':null;
  if(direction&&!context.close){const old=document.createElement('div');for(const child of [...host.overlay.children])if(!child.matches('.modal-close'))old.append(child);navigation={old,direction};}else navigation=null;
 }
 function destroy(){coverObserver.disconnect();host.overlay.inert=false;for(const dialog of platformDialogs){dialog.close();dialog.remove();}platformDialogs.clear();for(const n of departing)n.remove();navigation?.old.remove();abort.abort();hideTooltip();linkPreview?.remove();for(const record of textRolls.values())clearTimeout(record.timer);textRolls.clear();toast?.remove();for(const n of qa('[data-segmented-control]'))n.productSegmentObserver?.disconnect();tabObserver?.disconnect();}
 return {id:'platform',beforeRender,afterRender,afterDialogChange,beforeDialogChange,destroy,handleAction:({action,target})=>{if(action==='language-picker')coverTrigger=target;if(action==='product-dismiss-toast'){dismissToast();return true;}return false;},setReducedMotion(value){updateCover(true);if(value)for(const [node,record] of textRolls){clearTimeout(record.timer);record.previous?.remove();record.previous=null;node.dataset.status='idle';for(const id of ['INSTANCE-328','INSTANCE-330'])source.unbind(record.current,id);}},diagnostics:()=>({tooltip:Boolean(tooltip),toast:Boolean(toast)})};
}

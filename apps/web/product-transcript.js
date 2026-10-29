import {createPRReferenceSurface} from './pr-reference-surface.js';
import {transcriptReaderFor} from './transcript-reader.js';
import { createLocalTaskSurface } from './product-task.js';
import { createVoiceSurface } from './product-voice.js';
import { createDraftSurface } from './product-drafts.js';
import { createComposerSurface } from './product-composer.js';
import { createMediaSurface } from './product-media.js';
import { syncRosterActivity } from './product-activity.js';
import { createUIMotion } from './ui-motion.js';

// Real product islands compose with the existing sender, textarea retention and timeline capture.
export function createTranscriptSurface(host) {
  const tasks=createLocalTaskSurface(host),voice=createVoiceSurface(host),drafts=createDraftSurface(host),composer=createComposerSurface(host),media=createMediaSurface(host);
  const prReferences=createPRReferenceSurface(host);
  const retained=new Map(),seen=new Map(),messageHeights=new Map(),reactionStates=new Map(),highlights=new Map();
  const parking=document.createElement('div');parking.dataset.productPortal='';parking.dataset.transcriptParking='';parking.setAttribute('aria-hidden','true');parking.inert=true;Object.assign(parking.style,{position:'fixed',left:'-100000px',top:'0px',visibility:'hidden',pointerEvents:'none'});document.body.append(parking);
  let currentKey=null,statusSnapshot=null,disposed=false,renderedMessages=new Map(),retiringReaction=null;
  const layout=createUIMotion({root:host.app,reducedMotion:()=>host.sourceMotion.reduced,inspect:()=>host.sourceMotion.inspect});
  const currentMessages=()=>host.getState().messages[host.getConversationKey()]||[];
  const findMessage=id=>currentMessages().find(m=>m.id===id);
  const messageCopyText=message=>message?.productKind==='run'?tasks.getCopyText(message):message?.productKind==='draft'?message.localDraft?.body||'':message?.productKind==='voice'?message.voiceMemo?.caption||'':undefined;
  function signature(m){return JSON.stringify(m.productKind==='voice'?{kind:m.productKind,caption:m.voiceMemo?.caption}:m.productKind==='run'?{kind:m.productKind,id:m.localRun?.id,question:m.localRun?.status==='question',approval:m.localRun?.status==='approval'}:m.localDraft);}
  function disposeCard(node){voice.dispose(node);drafts.dispose(node);tasks.disposeRoot(node);}
  function beforeRender(){
    composer.beforeRender(currentKey);
    // State.selected may already be the destination, while the DOM still belongs to the prior key.
    const oldKey=currentKey??host.getConversationKey();
    for(const node of host.app.querySelectorAll('[data-product-card]')){const m=renderedMessages.get(node.dataset.productCard),address=`${oldKey}:${m?.id}`;if(m&&!retained.has(address))retained.set(address,{node,message:m,signature:signature(m)});}
    const status=host.app.querySelector('[data-product-run-status]:not([data-exiting])');statusSnapshot=status?{node:status,runId:status.dataset.productRunStatus,key:oldKey}:null;
    for(const node of host.app.querySelectorAll('.message[data-message-id]')){
      const m=renderedMessages.get(node.dataset.messageId);if(m&&node.dataset.committedRevision!==undefined)messageHeights.set(`${oldKey}:${m.id}`,{height:node.getBoundingClientRect().height,revision:Number(node.dataset.committedRevision),committed:true});
      for(const chip of node.querySelectorAll('[data-reaction-id]'))reactionStates.set(`${oldKey}:${node.dataset.messageId}:${chip.dataset.reactionId}`,true);
    }
    // Keep CSSAnimation/CSSTransition objects connected while the host replaces its root.
    // A detached node cancels its CSS effects even when reinserted later in the same render.
    for(const node of host.app.querySelectorAll('[data-product-card]'))parking.moveBefore(node,null);
    if(status){parking.style.width=status.getBoundingClientRect().width+'px';parking.moveBefore(status,null);}
  }
  function afterRender(){
    if(disposed)return;const key=host.getConversationKey(),messages=currentMessages();currentKey=key;renderedMessages=new Map(messages.map(m=>[m.id,m]));
    for(const placeholder of host.app.querySelectorAll('[data-product-card]')){
      const message=findMessage(placeholder.dataset.productCard);if(!message)continue;
      const address=`${key}:${message.id}`,saved=retained.get(address);let node=placeholder;
      if(saved&&saved.message===message&&saved.signature===signature(message)){node=saved.node;if(node!==placeholder){placeholder.parentNode.moveBefore(node,placeholder);placeholder.remove();}}
      else if(saved){disposeCard(saved.node);saved.node.remove();retained.delete(address);}
      if(message.productKind==='run')tasks.mount(node,message);else if(message.productKind==='voice')voice.mount(node,message);else if(message.productKind==='draft')drafts.mount(node,message);
      retained.set(address,{node,message,signature:signature(message)});
    }
    for(const[address,saved]of retained){if(!address.startsWith(key+':')||!saved.node.isConnected){disposeCard(saved.node);retained.delete(address);}}
    const first=!seen.has(key),known=seen.get(key)||new Set();
    for(const row of host.app.querySelectorAll('.message[data-message-id]')){
      const m=findMessage(row.dataset.messageId);if(!m)continue;
      row.classList.add('sand-transcript-row','sand--default-marker');row.dataset.role=m.role==='user'?'user':'assistant';
      host.sourceMotion.bind(row,'INSTANCE-234',{classes:[]});
      if(!first&&!known.has(m.id)){row.dataset.enter='new';const clear=event=>{if(event.animationName!=='sand-1rqlz9z-B')return;delete row.dataset.enter;row.removeEventListener('animationend',clear);};row.addEventListener('animationend',clear);}
      const content=row.querySelector('.bubble,.message-body');if(content)host.sourceMotion.bind(content,'INSTANCE-233',{classes:['sand-1rtwpoi','sand-1q9hv78','sand-1voxwag','sand-1u7bc6y','sand-3yt3ym','sand-ononfz','sand-jfxk63','sand-1n1rhdv','sand-1fmekgq','sand-isi5sn','sand-ahcu8d',...(m.role==='user'?['sand-b3owv9','sand-euoelj']:[])]});
      const tray=row.querySelector('.message-actions');if(tray){tray.classList.remove('sand-message-action-anchor');host.sourceMotion.bind(tray,'INSTANCE-194');
        let anchor=row.querySelector('[data-product-action-anchor]');if(!anchor){anchor=document.createElement('div');anchor.dataset.productActionAnchor='';anchor.className='sand-message-action-anchor sand--default-marker sand-17i7h53 sand-1hmns74 sand-xx281p sand-xyica1 sand-kk1bqk sand-8vq1ef sand-1m7bgnx sand-utkhn6 sand-juh2to sand-1nzs1mw';anchor.style.position='relative';anchor.style.borderRadius='12px';const body=row.querySelector('.message-body');if(body){body.before(anchor);void anchor.offsetHeight;let item=body;while(item&&item!==tray.nextSibling){const next=item.nextSibling;anchor.moveBefore(item,null);if(item===tray)break;item=next;}}}
      }
      for(const quote of row.querySelectorAll('.reply-quote > .product-quote-jump'))host.sourceMotion.bind(quote,'INSTANCE-197',{classes:['sand-t3l3uh','sand-1firant','sand-wji4o3',...(m.role==='user'?['sand-cz9g5z','sand-ig2fxa']:['sand-1o0liin','sand-n4ifyr'])]});
      for(const copy of row.querySelectorAll('.code-copy'))host.sourceMotion.bind(copy,'INSTANCE-176');
      for(const chip of row.querySelectorAll('[data-reaction-id]')){
        host.sourceMotion.bind(chip,'INSTANCE-182');
        if(!first&&!reactionStates.has(`${key}:${m.id}:${chip.dataset.reactionId}`))host.sourceMotion.bind(chip,'INSTANCE-183');
      }
      const before=messageHeights.get(`${key}:${m.id}`),run=m.localRun;
      // Only a changed, already committed streaming entry qualifies. Reply edits and width changes do not.
      if(before?.committed&&run?.committedOutput&&run.revision!==before.revision){layout.lateShrink(row,{fromHeight:before.height,toHeight:row.getBoundingClientRect().height,eligible:true,committed:true});}
      if(run?.committedOutput)row.dataset.committedRevision=String(run.revision||0);
      known.add(m.id);
    }
    seen.set(key,known);composer.afterRender();prReferences.afterRender();
    syncRosterActivity(host,{getRuntime:tasks.getRuntime});
    if(retiringReaction){
      const retiring=retiringReaction;retiringReaction=null;
      if(retiring.key===key){const row=[...host.app.querySelectorAll('.message[data-message-id]')].find(n=>n.dataset.messageId===retiring.messageId),list=row?.querySelector('[data-reaction-list]');
        if(list){list.style.position='relative';Object.assign(retiring.clone.style,{position:'absolute',insetInlineStart:`${retiring.left}px`,top:'0px',width:`${retiring.width}px`,pointerEvents:'none'});list.append(retiring.clone);host.sourceMotion.bind(retiring.clone,'INSTANCE-185');
          const done=()=>retiring.clone.remove(),animations=retiring.clone.getAnimations();if(animations.length)Promise.allSettled(animations.map(a=>a.finished)).then(done);else done();}
      }
    }
    const status=host.app.querySelector('[data-product-run-status]:not([data-exiting])');
    if(status&&statusSnapshot?.key===key&&statusSnapshot.runId===status.dataset.productRunStatus&&status!==statusSnapshot.node){status.parentNode.moveBefore(statusSnapshot.node,status);status.remove();};
    if(statusSnapshot&&statusSnapshot.key===key&&(!status||status.dataset.productRunStatus!==statusSnapshot.runId)){
      const old=statusSnapshot.node;old.inert=true;old.setAttribute('aria-hidden','true');old.dataset.exiting='';
      const composerRoot=host.app.querySelector('.composer-wrap');if(composerRoot)composerRoot.moveBefore(old,composerRoot.firstChild);
      const effect=host.sourceMotion.animate(old,{opacity:[1,0]},{duration:host.sourceMotion.reduced?0:100,easing:'cubic-bezier(.23,1,.32,1)'},{source:'INSTANCE-265',role:'outgoing-run-status'});
      effect.finished.then(()=>old.remove(),()=>old.remove());
      const transcript=host.app.querySelector('.transcript');if(transcript&&!host.sourceMotion.reduced)host.sourceMotion.animate(transcript,{opacity:[0,1]},{duration:200,delay:150,easing:'linear',fill:'backwards'},{source:'INSTANCE-266',role:'completed-transcript'});
    }
    statusSnapshot=null;
    for(const leftover of [...parking.children]){for(const animation of leftover.getAnimations({subtree:true}))animation.cancel();leftover.remove();}
  }
  function runStatus(){const message=currentMessages().find(m=>m.localRun&&tasks.getRuntime({conversationId:host.getConversationKey(),runId:m.localRun.id})?.working);if(!message)return '';const run=message.localRun;
    return `<div class="product-run-status" data-product-run-status="${host.esc(run.id)}" data-source-instance="INSTANCE-262"><button class="product-working-pill" data-action="product-run-compact" aria-expanded="true"><span class="product-working-dot" aria-hidden="true"></span><span class="product-working-body"><span data-source-instance="INSTANCE-263"><span data-source-instance="INSTANCE-264">Tekst lokaal verwerken</span></span></span><span>${host.icon('down')}</span></button><button class="text-button" data-action="product-run-stop" data-run-id="${host.esc(run.id)}">Stoppen</button></div>`;
  }
  function highlightEntry(row){
        highlights.get(row)?.();delete row.dataset.highlighted;row.classList.remove('product-quote-flash');void row.offsetWidth;
        row.dataset.highlighted='';row.classList.add('product-quote-flash');host.sourceMotion.bind(row,'INSTANCE-234',{classes:['sand-1soy34','sand-fjfevm','sand-xpn8y5','sand-a3vuyk']});
        let active=true,timer=null;const deadline=Date.now()+2500;const done=()=>{if(!active)return;active=false;clearTimeout(timer);row.classList.remove('product-quote-flash');delete row.dataset.highlighted;row.classList.remove('sand-1soy34','sand-fjfevm','sand-xpn8y5','sand-a3vuyk');host.sourceMotion.unbind(row,'INSTANCE-234');host.sourceMotion.bind(row,'INSTANCE-234',{classes:[]});highlights.delete(row);};highlights.set(row,done);
        const effects=row.getAnimations({subtree:true}).filter(a=>['sand-1ozwp7x-B','sand-zzcn73-B'].includes(a.animationName));const settled=()=>{if(!active)return;if(host.sourceMotion.reduced)timer=setTimeout(done,Math.max(0,deadline-Date.now()));else done();};if(effects.length)Promise.allSettled(effects.map(a=>a.finished)).then(settled);else settled();
  }
  function handleAction(ctx){
    if(['copy-message','reply-message','retry-message'].includes(ctx.action)){
      const message=findMessage(ctx.id);
      if(['run','draft','voice'].includes(message?.productKind)){
        const payload=messageCopyText(message)??'';
        if(ctx.action==='copy-message'){
          const feedback=ok=>{if(ctx.target.isConnected)ctx.target.setAttribute('aria-label',ok?'Antwoord gekopieerd':'Kopiëren mislukt');return true;};
          return navigator.clipboard?.writeText? navigator.clipboard.writeText(payload).then(()=>feedback(true),()=>feedback(false)):feedback(false);
        }
        if(ctx.action==='reply-message'){host.getState().replyDrafts[host.getConversationKey()]={messageId:message.id,text:payload,title:host.selectedBot()?.name||'Bot'};host.persist();host.render();return true;}
        if(message.productKind==='run')return tasks.restart(message);
        if(message.productKind==='voice')return voice.handleAction({action:'product-voice-new',target:ctx.target});
        if(message.productKind==='draft'){const card=[...host.app.querySelectorAll('[data-draft-id]')].find(n=>n.dataset.draftId===message.id);if(card)return drafts.handleAction({action:'product-draft-edit',target:card});return true;}
      }
    }
    if(ctx.action==='reaction-toggle'){
      const row=[...host.app.querySelectorAll('.message[data-message-id]')].find(n=>n.dataset.messageId===ctx.id),chip=[...row?.querySelectorAll('[data-reaction-id]')||[]].find(n=>n.dataset.reactionId===ctx.value);
      if(chip){const clone=chip.cloneNode(true);for(const attribute of ['data-action','data-reaction-id','aria-label','aria-pressed','data-source-instance','data-source-bound'])clone.removeAttribute(attribute);clone.inert=true;clone.setAttribute('aria-hidden','true');clone.className='product-reaction-retiring';retiringReaction={clone,key:host.getConversationKey(),messageId:ctx.id,left:chip.offsetLeft,width:chip.getBoundingClientRect().width};}
      return false;
    }
    const own=composer.handleAction(ctx)||voice.handleAction(ctx)||drafts.handleAction(ctx)||tasks.handleAction(ctx)||media.handleAction(ctx);if(own)return own;
    const {action,target}=ctx;
    if(action==='product-run-compact'){const root=target.closest('[data-product-run-status]'),compact=root.dataset.compact!=='true';root.dataset.compact=String(compact);target.setAttribute('aria-expanded',String(!compact));return true;}
    if(action==='product-run-stop'){const id=target.dataset.runId,node=[...host.app.querySelectorAll('[data-local-run]')].find(n=>n.dataset.localRun===id);if(node)return tasks.handleAction({action:'product-task-stop',target:node});return true;}
    if(action==='product-quote-jump'){
      const conversation=host.getConversationKey(),id=target.dataset.quoteMessageId;
      const resolve=()=>conversation===host.getConversationKey()?[...host.app.querySelectorAll('.message[data-message-id]')].find(n=>n.dataset.messageId===id):null;
      const row=resolve(),agentId=target.dataset.quoteAgentId||conversation;
      if(agentId!==conversation||!row){host.revealTranscriptEntry?.(agentId,id);return true;}
      if(transcriptReaderFor(host)?.navigateToTarget(resolve)!=null){
        highlightEntry(row);
      }return true;
    }
    return false;
  }
  function handleSubmit(ctx){return composer.handleSubmit(ctx)||drafts.handleSubmit(ctx)||tasks.handleSubmit(ctx);}
  function renderSlot(name,ctx){
    if(name==='messageCopyText')return messageCopyText(ctx.message);
    if(name==='transcriptCard'){
      const message=ctx.message;if(message?.productKind==='run')return tasks.card(message);if(message?.productKind==='voice')return voice.markup(message);if(message?.productKind==='draft')return drafts.markup(message);
    }
    if(name==='runStatus')return runStatus();
    if(name==='composerNotice')return composer.notice();
    if(name==='composerVoice')return '';
    if(name==='composerMenu')return '';
    return undefined;
  }
  return{id:'transcript',highlightEntry,beforeRender,afterRender,renderSlot,handleAction,handleSubmit,handleChange(event){composer.handleChange(event);drafts.handleChange(event);},
    setInspect:layout.setInspect,setReducedMotion:layout.setReducedMotion,
    diagnostics:()=>({retainedIslands:retained.size,seenConversations:seen.size,nativeParityClaim:false}),
    destroy(){disposed=true;prReferences.destroy();tasks.destroy();voice.destroy();drafts.destroy();composer.destroy();media.destroy();layout.destroy();for(const{node}of retained.values())disposeCard(node);retained.clear();seen.clear();messageHeights.clear();reactionStates.clear();for(const done of highlights.values())done();highlights.clear();parking.remove();}
  };
}

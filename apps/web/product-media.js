import { attachmentPreviewKind } from './attachments.js';

// Actual imported image bytes, decoded locally. All object URLs have a dialog owner.
export function createMediaSurface(host){
  let generation=0,choiceGeneration=0,active=null;
  const esc=host.esc;
  function references(){const state=host.getState(),draft=host.draftAttachments?.(host.getConversationKey())||[];return [...draft,...(state.messages[host.getConversationKey()]||[]).flatMap(m=>m.attachments||[])];}
  const imageRef=ref=>ref&&typeof ref.name==='string'&&typeof ref.type==='string'&&attachmentPreviewKind(ref)==='image';
  function dispose(){generation++;choiceGeneration++;if(!active)return;active.abort.abort();for(const item of active.items)URL.revokeObjectURL(item.url);active=null;}
  function choose(index){
    if(!active)return;const session=active,choice=++choiceGeneration;session.index=Math.max(0,Math.min(session.items.length-1,index));
    const item=session.items[session.index],root=host.overlay.querySelector('[data-product-media]');if(!root)return;
    const image=root.querySelector('[data-media-image]'),skeleton=root.querySelector('[data-media-skeleton]');image.className='product-media-image';image.style.opacity='0';skeleton.hidden=false;root.querySelector('[data-media-status]').textContent='';root.querySelector('[data-media-name]').textContent=item.name;image.alt=item.name;image.src=item.url;
    root.querySelector('[data-action="attachment-download"]').dataset.id=item.id;
    for(const button of root.querySelectorAll('[data-media-index]'))button.setAttribute('aria-current',String(Number(button.dataset.mediaIndex)===session.index));
    // A -> B -> A reuses the same index and DOM image. Only the latest choose
    // operation may publish decode success, failure or delayed reveal cleanup.
    const ownsChoice=()=>active===session&&choiceGeneration===choice&&image.isConnected&&root.isConnected;
    image.decode().then(()=>{
      if(!ownsChoice())return;
      image.style.opacity='1';host.sourceMotion.bind(image,'INSTANCE-191');
      const done=()=>{if(ownsChoice())skeleton.hidden=true;};
      const animations=image.getAnimations();if(animations.length)Promise.allSettled(animations.map(a=>a.finished)).then(done);else done();
    },()=>{if(ownsChoice()){skeleton.hidden=true;root.querySelector('[data-media-status]').textContent='Deze lokale afbeelding kan niet worden gedecodeerd.';}});
  }
  function open(id){
    const refs=references().filter(imageRef);if(!refs.some(ref=>ref.id===id))return false;
    const key=host.getConversationKey(),version=host.getDialogVersion(),turn=++generation;
    return Promise.all(refs.map(async r=>({record:await host.readAttachment(r.id),ref:r}))).then(records=>{
      if(turn!==generation||key!==host.getConversationKey()||version!==host.getDialogVersion())return true;
      const eligible=records.filter(({record})=>imageRef(record));
      if(!eligible.some(({ref})=>ref.id===id))return false;
      const items=eligible.map(({record,ref})=>({id:ref.id,name:record.name,url:URL.createObjectURL(record.blob||new Blob([record.bytes],{type:record.type}))}));
      const ref=items.find(item=>item.id===id);
      // showDialog disposes the preceding dialog before this new session takes ownership.
      host.showDialog('preview-dialog',ref.name,`<article class="product-media" data-product-media><header class="preview-toolbar"><strong class="fill" data-media-name>${esc(ref.name)}</strong><button class="text-button" data-action="attachment-download" data-id="${esc(ref.id)}">Downloaden</button></header><div class="product-media-stage"><div class="product-media-skeleton" data-media-skeleton data-source-instance="INSTANCE-192"></div><button class="product-media-open" data-action="product-media-zoom" aria-label="Afbeelding vergroten" data-source-instance="INSTANCE-190"><img class="product-media-image" data-media-image alt="${esc(ref.name)}"></button></div><nav class="product-media-thumbs" aria-label="Afbeeldingen">${items.map((item,i)=>`<button class="product-media-thumb" data-source-instance="INSTANCE-188" data-action="product-media-select" data-media-index="${i}" aria-label="Afbeelding ${i+1} van ${items.length}" aria-current="${item.id===id}"><img data-source-instance="INSTANCE-189" src="${esc(item.url)}" alt="${esc(item.name)}"></button>`).join('')}</nav><p class="small muted" role="status" data-media-status></p></article>`);
      // Native192 shimmer needs its actual gradient and background-size support
      // classes as well as motion; gallery geometry remains owned by this stage.
      host.sourceMotion.bind(host.overlay.querySelector('[data-media-skeleton]'),'INSTANCE-192',{classes:'sand-190mmpe sand-akli9p sand-wqnnt6 sand-1aquc0h sand-1i92p7d sand-4hg4is sand-a4qsjk'});
      active={items,index:items.findIndex(item=>item.id===id),abort:new AbortController()};choose(active.index);
      host.setPreviewCleanup?.(dispose);return true;
    },()=>{if(turn===generation&&key===host.getConversationKey())host.showDialog('small-dialog','Afbeelding niet beschikbaar','<div class="form-dialog"><h1>Afbeelding niet beschikbaar</h1><p role="alert">De lokale bestandsbytes konden niet worden gelezen.</p></div>');return true;});
  }
  function handleAction({action,id,target}){
    if(action==='attachment-open')return open(id);
    if(action==='product-media-select'){choose(Number(target.dataset.mediaIndex));return true;}
    if(action==='product-media-zoom'){const root=target.closest('[data-product-media]'),zoomed=root.dataset.zoomed!=='true';root.dataset.zoomed=String(zoomed);target.setAttribute('aria-label',zoomed?'Afbeelding verkleinen':'Afbeelding vergroten');return true;}
    return false;
  }
  return{handleAction,destroy:dispose};
}

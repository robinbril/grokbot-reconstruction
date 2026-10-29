// Generate actual, bounded PCM bytes locally. This is an audiosignal, not a microphone recording.
function localAudio() {
  const sampleRate=8000,length=sampleRate*2, buffer=new ArrayBuffer(44+length*2), view=new DataView(buffer);
  const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,36+length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,length*2,true);
  const peaks=Array(64).fill(0);
  for(let i=0;i<length;i++){const t=i/sampleRate,envelope=Math.min(1,t*12,(2-t)*12),sample=Math.sin(2*Math.PI*(t<1?330:440)*t)*.14*envelope;view.setInt16(44+i*2,sample*32767,true);const bin=Math.min(63,Math.floor(i/length*64));peaks[bin]=Math.max(peaks[bin],Math.abs(sample));}
  return {blob:new Blob([buffer],{type:'audio/wav'}),peaks,sampleRate,channels:view.getUint16(22,true),sampleBits:view.getUint16(34,true),samples:length};
}
const localPCM=localAudio();
const waveformPath=localPCM.peaks.map((peak,i)=>{const height=Math.max(3,Math.round(Math.max(0,Math.min(1,peak/.14))*20));return`M${i*4+1} ${(20-height)/2+1}V${(20-height)/2+height-1}`;}).join('');

export function createVoiceSurface(host) {
  const players=new Map();
  const caption='Twee lokaal gegenereerde tonen. Dit audiosignaal bevat geen gesproken opname en gebruikt de microfoon niet.';
  function markup(message) {
    const memo=message.voiceMemo;
    return `<section class="product-voice transcript-card" data-product-card="${host.esc(message.id)}" data-voice-id="${host.esc(message.id)}">
      <header class="row between"><strong>Lokaal audiosignaal</strong><span class="small muted">2 seconden · PCM</span></header>
      <div class="product-audio-controls"><button class="circle-button" data-action="product-voice-play" aria-label="Afspelen">${host.icon('play')}</button><input type="range" min="0" max="2" step="0.01" value="0" aria-label="Audiopositie" data-product-audio-seek><span data-audio-time>0:00 / 0:02</span><button class="pill" data-action="product-voice-speed" aria-label="Afspeelsnelheid" aria-haspopup="menu" data-source-instance="INSTANCE-187"><span data-playback-rate>1×</span>${host.icon('down')}</button></div>
      <svg class="product-audio-waveform" data-voice-memo-waveform data-source-instance="INSTANCE-300" data-source-classes="sand-1lliihq sand-2lah0s sand-1heor9g sand-7eptgl sand-5ve5x3" data-bars="64" data-played="0" aria-label="Audiogolf" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="2000" aria-valuenow="0" viewBox="0 0 254 20" preserveAspectRatio="none"><path d="${waveformPath}" opacity=".35"></path><path data-voice-memo-waveform-played data-source-instance="INSTANCE-300" data-source-classes="sand-bh8q5q sand-73je2i sand-vlca1e sand-1owpc8m sand-1hc1fzr sand-7ayfe5 sand-4wkmsb sand-1firant sand-cj1dhv" d="${waveformPath}" style="clip-path:inset(0 254px 0 0) view-box"></path></svg>
      <audio preload="metadata" aria-label="Lokaal audiosignaal"></audio>
      <div class="row between"><button class="text-button" data-action="product-voice-transcript" aria-expanded="${Boolean(memo.expanded)}">${memo.expanded?'Transcript verbergen':'Transcript tonen'}</button><button class="text-button" data-action="product-voice-feedback">Feedback geven</button></div>
      <div class="product-voice-transcript" role="region" aria-label="Spraakmemotranscript" data-expanded="${Boolean(memo.expanded)}" data-source-instance="INSTANCE-079" data-source-classes="sand-1qn9uv2 sand-4wkmsb sand-1da2sx9 sand-1e6nqfh" ${memo.expanded?'':'inert aria-hidden="true"'}><div data-source-instance="INSTANCE-079" data-source-classes="sand-11xpdln sand-4wkmsb sand-1da2sx9 sand-1e6nqfh"><p>${host.esc(memo.caption||caption)}</p></div></div>
      <div class="row between"><button class="text-button" data-action="product-voice-details" aria-expanded="${Boolean(memo.detailsExpanded)}">${memo.detailsExpanded?'Audiogegevens verbergen':'Audiogegevens tonen'}</button></div>
      <div class="product-voice-details" role="region" aria-label="Audiogegevens" data-audio-details data-expanded="${Boolean(memo.detailsExpanded)}" data-source-instance="INSTANCE-077" data-source-classes="sand-1qn9uv2 sand-4wkmsb sand-1vgdfw2 sand-1e6nqfh" ${memo.detailsExpanded?'':'inert aria-hidden="true"'}><div><div class="row between"><strong>Gegevens van dit audiosignaal</strong><div class="row"><div data-audio-tools data-source-instance="INSTANCE-076" ${memo.detailsExpanded?'':'hidden'}><button class="text-button" data-action="product-voice-tools" aria-label="Audio-opties" aria-haspopup="menu">${host.icon('more')}</button></div><button class="circle-button" data-action="product-voice-details-close" aria-label="Audiogegevens sluiten" data-source-instance="INSTANCE-075" ${memo.detailsExpanded?'':'hidden'}>${host.icon('close')}</button></div></div><dl><dt>Bron</dt><dd>Lokaal gegenereerde PCM-bytes</dd><dt>Samplefrequentie</dt><dd>${localPCM.sampleRate} Hz</dd><dt>Kanalen</dt><dd>${localPCM.channels}</dd><dt>Precisie</dt><dd>${localPCM.sampleBits} bit</dd><dt>Samples</dt><dd>${localPCM.samples}</dd><dt>Afspeelsnelheid</dt><dd data-audio-detail-rate>1×</dd><dt>Positie</dt><dd data-audio-detail-position>0 ms</dd></dl><p class="small muted" data-audio-hints ${memo.showsHints?'':'hidden'}>0–1 seconde: 330 Hz. 1–2 seconden: 440 Hz. Sleep de audiogolf om te zoeken; tik om het transcript te openen.</p></div></div>
      <div class="product-voice-feedback"><div><div class="row" data-voice-rating hidden><button class="pill" data-action="product-voice-rate" data-value="useful" aria-pressed="${memo.rating==='useful'}">Nuttig</button><button class="pill" data-action="product-voice-rate" data-value="improve" aria-pressed="${memo.rating==='improve'}">Kan beter</button></div><div class="product-voice-feedback-detail" data-expanded="false" inert aria-hidden="true" data-source-instance="INSTANCE-078"><div><label class="field-label">Toelichting<input class="field-input" aria-label="Feedback toelichting" data-voice-feedback-text maxlength="2000" value="${host.esc(memo.feedback||'')}"></label><button class="pill" data-action="product-voice-feedback-save">Feedback bewaren</button><span role="status" data-voice-feedback-status></span></div></div></div></div>
    </section>`;
  }
  function mount(root,message) {
    if(players.has(root))return;
    const audio=root.querySelector('audio'), url=URL.createObjectURL(localPCM.blob),abort=new AbortController();audio.src=url;
    const slider=root.querySelector('[data-product-audio-seek]'),time=root.querySelector('[data-audio-time]'),play=root.querySelector('[data-action="product-voice-play"]');
    const sync=()=>{slider.value=String(audio.currentTime);time.textContent=`0:${String(Math.floor(audio.currentTime)).padStart(2,'0')} / 0:02`;play.setAttribute('aria-label',audio.paused?'Afspelen':'Pauzeren');play.innerHTML=host.icon(audio.paused?'play':'pause');root.querySelector('[data-audio-detail-position]').textContent=`${Math.round(audio.currentTime*1000)} ms`;root.querySelector('[data-audio-detail-rate]').textContent=`${audio.playbackRate}×`;const wave=root.querySelector('[data-voice-memo-waveform]'),fraction=Math.max(0,Math.min(1,audio.currentTime/2));const bars=fraction>=1?64:Math.floor(fraction*64);wave.dataset.played=String(bars);wave.setAttribute('aria-valuenow',String(Math.round(audio.currentTime*1000)));wave.querySelector('[data-voice-memo-waveform-played]').style.clipPath=`inset(0 ${254-(bars?bars*4-2:0)}px 0 0) view-box`;};
    for(const name of ['timeupdate','play','pause','ended','ratechange'])audio.addEventListener(name,sync,{signal:abort.signal});
    slider.addEventListener('input',()=>{audio.currentTime=Math.max(0,Math.min(2,Number(slider.value)||0));sync();},{signal:abort.signal});
    audio.addEventListener('error',()=>{root.querySelector('[data-voice-feedback-status]').textContent='Audio kon niet worden afgespeeld.';},{signal:abort.signal});
    const wave=root.querySelector('[data-voice-memo-waveform]'),played=wave.querySelector('[data-voice-memo-waveform-played]');let pointer=null;
    const normal=['sand-bh8q5q','sand-73je2i','sand-vlca1e','sand-1owpc8m','sand-1hc1fzr','sand-7ayfe5','sand-4wkmsb','sand-cj1dhv'];
    const seeking=value=>{wave.toggleAttribute('data-seeking',value);host.sourceMotion.unbind(played,'INSTANCE-300');host.sourceMotion.bind(played,'INSTANCE-300',{classes:[...normal,value?'sand-1mq3mr6':'sand-1firant']});};
    const stop=(event,tap)=>{if(!pointer||pointer.id!==event.pointerId)return;const old=pointer;pointer=null;seeking(false);if(wave.hasPointerCapture?.(event.pointerId))wave.releasePointerCapture(event.pointerId);if(tap&&!old.scrubbed&&Date.now()-old.at<=400)handleAction({action:'product-voice-transcript',target:root.querySelector('[data-action=product-voice-transcript]')});};
    wave.addEventListener('pointerdown',event=>{if(event.button!==0||pointer)return;event.preventDefault();event.stopPropagation();const box=wave.getBoundingClientRect();wave.setPointerCapture(event.pointerId);pointer={id:event.pointerId,x:event.clientX,y:event.clientY,at:Date.now(),left:box.left,width:box.width,scrubbed:false};},{signal:abort.signal});
    wave.addEventListener('pointermove',event=>{if(!pointer||pointer.id!==event.pointerId)return;if(!pointer.scrubbed){if((event.clientX-pointer.x)**2+(event.clientY-pointer.y)**2<36)return;pointer.scrubbed=true;seeking(true);}event.preventDefault();audio.currentTime=Math.round(Math.max(0,Math.min(1,(event.clientX-pointer.left)/pointer.width))*2000)/1000;sync();},{signal:abort.signal});
    wave.addEventListener('pointerup',event=>stop(event,true),{signal:abort.signal});wave.addEventListener('pointercancel',event=>stop(event,false),{signal:abort.signal});wave.addEventListener('lostpointercapture',event=>{if(pointer?.id===event.pointerId){pointer=null;seeking(false);}},{signal:abort.signal});
    wave.addEventListener('keydown',event=>{let time;if(event.key==='ArrowRight')time=audio.currentTime+.1;else if(event.key==='ArrowLeft')time=audio.currentTime-.1;else if(event.key==='Home')time=0;else if(event.key==='End')time=2;else return;event.preventDefault();audio.currentTime=Math.max(0,Math.min(2,time));sync();},{signal:abort.signal});
    players.set(root,{audio,url,abort,message,feedbackRating:message.voiceMemo.rating});sync();
  }
  function handleAction({action,target,value}) {
    if(!action.startsWith('product-voice-'))return false;
    if(action==='product-voice-new'){
      if(!host.ensureConversation?.()&&!host.getAgent(host.getConversationKey()))return true;const key=host.getConversationKey();
      host.closePopover();host.update(state=>{(state.messages[key]||=[]).push({id:crypto.randomUUID(),role:'bot',createdAt:Date.now(),text:'',productKind:'voice',voiceMemo:{caption,expanded:false}});});return true;
    }
    const root=target.closest('.product-voice[data-voice-id]')||[...players.keys()].find(node=>node.dataset.voiceId===target.dataset.voiceId),entry=players.get(root);if(!entry)return true;
    const {audio,message}=entry;
    if(action==='product-voice-play'){
      if(!audio.paused)audio.pause();else return audio.play().then(()=>true,()=>{root.querySelector('[data-voice-feedback-status]').textContent='Afspelen is niet beschikbaar.';return true;});
    }else if(action==='product-voice-speed'){
      const menu=host.popover(target,[2,1.5,1,.5].map(rate=>`<button class="menu-row" role="menuitemradio" aria-checked="${rate===audio.playbackRate}" data-action="product-voice-speed-select" data-value="${rate}" data-voice-id="${host.esc(message.id)}">${rate}×</button>`).join(''),'product-audio-speed-menu');
      const trigger=target.getBoundingClientRect(),rect=menu.getBoundingClientRect();menu.style.left=Math.max(10,Math.min(innerWidth-rect.width-10,trigger.right-rect.width))+'px';menu.style.top=Math.max(10,trigger.top-rect.height-6)+'px';
    }else if(action==='product-voice-speed-select'){
      const rate=Number(value);if([2,1.5,1,.5].includes(rate)){audio.playbackRate=rate;root.querySelector('[data-playback-rate]').textContent=`${rate}×`;}host.closePopover();
    }else if(action==='product-voice-tools'){
      host.popover(target,`<button class="menu-row" role="menuitemcheckbox" aria-checked="${Boolean(message.voiceMemo.showsHints)}" data-action="product-voice-hints" data-voice-id="${host.esc(message.id)}">Aanwijzingen tonen</button>`,'product-audio-tools-menu');
    }else if(action==='product-voice-hints'){
      const before=Boolean(message.voiceMemo.showsHints);message.voiceMemo.showsHints=!before;if(!host.persist()){message.voiceMemo.showsHints=before;root.querySelector('[data-voice-feedback-status]').textContent='Aanwijzingen niet bewaard. Probeer opnieuw.';}root.querySelector('[data-audio-hints]').hidden=!message.voiceMemo.showsHints;host.closePopover();
    }else if(action==='product-voice-details'||action==='product-voice-details-close'){
      const before=Boolean(message.voiceMemo.detailsExpanded),open=action==='product-voice-details-close'?false:!before;message.voiceMemo.detailsExpanded=open;if(!host.persist()){message.voiceMemo.detailsExpanded=before;root.querySelector('[data-voice-feedback-status]').textContent='Audiogegevens niet bewaard. Probeer opnieuw.';return true;}
      const body=root.querySelector('[data-audio-details]'),toggle=root.querySelector('[data-action=product-voice-details]');body.dataset.expanded=String(open);body.inert=!open;body.setAttribute('aria-hidden',String(!open));toggle.textContent=open?'Audiogegevens verbergen':'Audiogegevens tonen';toggle.setAttribute('aria-expanded',String(open));body.querySelector('[data-audio-tools]').hidden=!open;body.querySelector('[data-action=product-voice-details-close]').hidden=!open;host.sourceMotion.bindTree(body);
    }else if(action==='product-voice-transcript'){
      message.voiceMemo.expanded=!message.voiceMemo.expanded;host.persist();
      const body=root.querySelector('.product-voice-transcript'),open=message.voiceMemo.expanded;
      body.dataset.expanded=String(open);body.inert=!open;body.setAttribute('aria-hidden',String(!open));target.setAttribute('aria-expanded',String(open));target.textContent=open?'Transcript verbergen':'Transcript tonen';
    }else if(action==='product-voice-feedback'){
      root.querySelector('[data-voice-rating]').hidden=false;
      if(entry.feedbackRating){const detail=root.querySelector('.product-voice-feedback-detail');detail.dataset.expanded='true';detail.inert=false;detail.removeAttribute('aria-hidden');}
    }
    else if(action==='product-voice-rate'){
      if(!['useful','improve'].includes(value))return true;
      const memo=message.voiceMemo,hadRating=Object.hasOwn(memo,'rating'),before=memo.rating;entry.feedbackRating=value;memo.rating=value;
      const detail=root.querySelector('.product-voice-feedback-detail');detail.dataset.expanded='true';detail.inert=false;detail.removeAttribute('aria-hidden');
      for(const button of root.querySelectorAll('[data-action=product-voice-rate]'))button.setAttribute('aria-pressed',String(button.dataset.value===value));
      if(!host.persist()){if(hadRating)memo.rating=before;else delete memo.rating;root.querySelector('[data-voice-feedback-status]').textContent='Beoordeling niet bewaard. Je kunt opnieuw bewaren.';}
      else root.querySelector('[data-voice-feedback-status]').textContent='';
    }else if(action==='product-voice-feedback-save'){
      const memo=message.voiceMemo,previous={rating:memo.rating,feedback:memo.feedback},hadRating=Object.hasOwn(memo,'rating'),hadFeedback=Object.hasOwn(memo,'feedback');
      memo.feedback=root.querySelector('[data-voice-feedback-text]').value.slice(0,2000);if(entry.feedbackRating)memo.rating=entry.feedbackRating;
      if(!host.persist()){if(hadRating)memo.rating=previous.rating;else delete memo.rating;if(hadFeedback)memo.feedback=previous.feedback;else delete memo.feedback;root.querySelector('[data-voice-feedback-status]').textContent='Feedback niet bewaard. Je tekst blijft staan. Probeer opnieuw.';}
      else root.querySelector('[data-voice-feedback-status]').textContent='Lokaal bewaard';
    }
    return true;
  }
  function dispose(root){const p=players.get(root);if(!p)return;p.audio.pause();p.audio.removeAttribute('src');p.audio.load();p.abort.abort();URL.revokeObjectURL(p.url);players.delete(root);}
  return{markup,mount,handleAction,dispose,destroy(){for(const root of players.keys())dispose(root);}};
}

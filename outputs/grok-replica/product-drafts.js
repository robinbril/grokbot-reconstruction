// Local email/Slack draft revisions. Functional comparison is independent of target JS.
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('und',{granularity:'word'}):null;
const tokens=text=>segmenter?[...segmenter.segment(text)].map(t=>({text:t.segment,word:t.isWordLike===true})):text.split(/(\s+)/).filter(Boolean).map(text=>({text,word:/\S/.test(text)}));
export function compareDraftRevision(before,after) {
  if(!before||!after||!['email','slack'].includes(after.platform)||before.platform!==after.platform)return null;
  if(after.platform==='slack'&&(before.target!==after.target||before.workspace!==after.workspace))return null;
  const a=tokens(before.body),b=tokens(after.body),aw=a.filter(t=>t.word),bw=b.filter(t=>t.word);
  if(!bw.length||(aw.length+1)*(bw.length+1)>1e6)return null;
  const stride=bw.length+1,dp=new Uint32Array((aw.length+1)*stride);
  for(let i=aw.length-1;i>=0;i--)for(let k=bw.length-1;k>=0;k--)dp[i*stride+k]=aw[i].text===bw[k].text?1+dp[(i+1)*stride+k+1]:Math.max(dp[(i+1)*stride+k],dp[i*stride+k+1]);
  if(dp[0]/bw.length<.5)return null;
  const kept=new Set();let i=0,k=0;
  while(i<aw.length&&k<bw.length){if(aw[i].text===bw[k].text){kept.add(bw[k]);i++;k++;}else if(dp[(i+1)*stride+k]>=dp[i*stride+k+1])i++;else k++;}
  const segments=[];let addedWords=0,runs=0;
  for(const t of b){const added=t.word&&!kept.has(t),last=segments.at(-1);if(added)addedWords++;if(last&&last.added===added)last.text+=t.text;else{segments.push({text:t.text,added});if(added)runs++;}}
  // Whitespace between adjacent added words belongs to the same visual run.
  const merged=[];for(let n=0;n<segments.length;n++){const s=segments[n];if(s.added&&merged.at(-1)?.added)merged.at(-1).text+=s.text;else if(!s.added&&!/\S/.test(s.text)&&merged.at(-1)?.added&&segments[n+1]?.added){merged.at(-1).text+=s.text+segments[++n].text;runs--;}else merged.push({...s});}
  if(runs>3||addedWords>Math.max(20,.25*bw.length))return null;
  const fields=(after.platform==='email'?['to','subject']:['workspace','target']).filter(key=>String(before[key]||'')!==String(after[key]||''));
  return addedWords||fields.length?{segments:merged,fields,keptWords:dp[0],wordCount:bw.length}:null;
}

export function selectDraftRevision(messages,current) {
  if(!current?.localDraft||current.streaming||current.localDraft.sendState!=='draft')return null;
  let turns=0;const candidates=[];
  for(let i=messages.indexOf(current)-1;i>=0&&turns<=3;i--){
    const entry=messages[i];if(entry.role==='user'){turns++;continue;}
    if(!turns||turns>3||entry.productKind!=='draft'||entry.streaming||entry.requestId&&entry.requestId===current.requestId)continue;
    const comparison=compareDraftRevision(entry.localDraft,current.localDraft);if(comparison)candidates.push({entry,turns,comparison});
  }
  if(!candidates.length)return null;
  const best=Math.max(...candidates.map(c=>c.comparison.keptWords)),count=candidates[0].comparison.wordCount;
  const close=candidates.filter(c=>(best-c.comparison.keptWords)/count<.2),earliest=Math.min(...close.map(c=>c.turns));
  const chosen=close.filter(c=>c.turns===earliest);
  const route=d=>d.platform==='email'?String(d.to).toLocaleLowerCase():`${d.workspace||''}\0${d.target||''}`;
  const routed=chosen.length>1?chosen.filter(c=>route(c.entry.localDraft)===route(current.localDraft)):chosen;
  return routed.length===1?{baselineEntryId:routed[0].entry.id,highlight:routed[0].comparison}:null;
}

function writeLocalDraftRecord(state,message,{reject=false,persist}) {
  // The user-selected fault branch rejects the same real local sink before any commit.
  if(reject)throw new Error('De lokale fouttest weigert deze schrijfactie. Tekst en ontvangers zijn behouden.');
  const previous=Array.isArray(state.localSentDrafts)?state.localSentDrafts:[];
  if(previous.some(record=>record.id===message.id))return true;
  const d=message.localDraft,record={id:message.id,platform:d.platform,body:d.body,to:d.to,subject:d.subject,createdAt:Date.now()};
  state.localSentDrafts=[...previous,record];
  if(!persist()){state.localSentDrafts=previous;throw new Error('Het lokale verzonden record kon niet worden bewaard. Je concept blijft behouden.');}
  return true;
}

export function createDraftSurface(host) {
  const observers=new Map(),timers=new Map(),urls=new Map();let editing=null;
  const esc=host.esc;
  function open(message=null,revision=false) {
    host.closePopover();if(!host.ensureConversation?.()&&!host.getAgent(host.getConversationKey()))return;editing={message,key:host.getConversationKey(),revision,version:0};
    const draft=message?.localDraft||{platform:'email',to:'demo@example.test',subject:'Nieuw bericht',body:''};
    const title=revision?'Concept herzien':message?'Concept bewerken':'E-mailconcept';
    host.showDialog('small-dialog',title,`<form class="form-dialog product-draft-form" data-submit="product-draft-save"><h1>${title}</h1><p class="small muted">Een lokaal concept. Verzenden legt een record vast in deze browser.</p><label class="field-label" for="product-draft-platform">Type</label><select id="product-draft-platform" name="platform" aria-label="Concepttype"><option value="email" ${draft.platform==='email'?'selected':''}>E-mail</option><option value="slack" ${draft.platform==='slack'?'selected':''}>Slack</option></select><label class="field-label" for="product-draft-to">Aan</label><input id="product-draft-to" class="field-input" name="to" data-source-instance="INSTANCE-026" aria-label="Aan" value="${esc(draft.to||draft.target||'')}" required><label class="field-label" for="product-draft-subject">Onderwerp</label><input id="product-draft-subject" class="field-input" name="subject" data-source-instance="INSTANCE-026" aria-label="Onderwerp" value="${esc(draft.subject||'')}" ${draft.platform==='email'?'required':''}><label class="field-label" for="product-draft-body">Conceptinhoud</label><textarea id="product-draft-body" class="field-input" name="body" data-source-instance="INSTANCE-027" aria-label="Conceptinhoud" rows="6" required>${esc(draft.body)}</textarea><p role="status" data-draft-form-status></p><div class="form-actions"><button type="button" class="outline-button" data-action="close-modal">Annuleren</button><button class="primary-button" type="submit">${revision?'Herziening bewaren':'Concept bewaren'}</button></div></form>`);
    editing.version=host.getDialogVersion();
  }
  function markup(message) {
    const d=message.localDraft,h=d.highlight,show=h&&d.highlightPhase!=='done',fading=d.highlightPhase==='fading';
    const body=show?h.segments.map(s=>s.added?`<ins class="product-draft-added ${fading?'is-fading':''}" data-source-instance="INSTANCE-063">${esc(s.text)}</ins>`:esc(s.text)).join(''):esc(d.body);
    return `<section class="product-draft transcript-card" data-product-card="${esc(message.id)}" data-draft-id="${esc(message.id)}"><header class="row between"><strong>${d.platform==='slack'?'Slack-concept':'E-mailconcept'}</strong><span class="small muted">${d.sendState==='sent'?'Lokaal vastgelegd':'Concept'}</span></header><a class="product-draft-open sand-1n2onr6 sand-c8icb0 sand-1heor9g sand-krqix3 sand-1ypdohk sand-1t137rt sand-1qkqx8m sand-1kieu7x sand-8eqrhl sand-1bmqlua sand-7wdnp7 sand-1cpjm7i sand-1hmns74 sand-y5mcqj sand-1nc033x sand-10xxvl sand-10iaubt sand-fk2i74 sand-8h0f0h sand-1es3dr sand-kk1bqk" data-draft-artifact data-source-instance="INSTANCE-025" target="_blank" rel="noopener noreferrer">Conceptbestand openen <span class="sand-3nfvp2 sand-6s0dn4 sand-qcrz7y sand-2lah0s sand-g2ss61 sand-vc5jky sand-1o0liin sand-19jjzik" aria-hidden="true" data-source-instance="INSTANCE-028">${host.icon('arrow')}</span></a><dl><dt>Aan</dt><dd class="${show&&h.fields.includes('to')?'product-draft-field-changed':''} ${fading?'is-fading':''}" ${show&&h.fields.includes('to')?'data-source-instance="INSTANCE-062"':''}>${esc(d.to||d.target)}</dd><dt>Onderwerp</dt><dd class="${show&&h.fields.includes('subject')?'product-draft-field-changed':''} ${fading?'is-fading':''}">${esc(d.subject)}</dd></dl><div class="product-draft-body">${body}</div>${d.error?`<div class="product-draft-error" role="alert"><strong>Lokaal verzenden mislukt</strong><p>${esc(d.error)}</p><button class="text-button" data-action="product-draft-edit">Concept bewerken</button><button class="pill" data-action="product-draft-send">Opnieuw verzenden</button></div>`:''}<div class="card-actions">${d.sendState==='sent'?'<span role="status">Lokaal verzonden record bewaard</span>':'<button class="text-button" data-action="product-draft-edit">Concept bewerken</button><button class="text-button" data-action="product-draft-revise">Herziening maken</button><button class="outline-button" data-action="product-draft-send">Lokaal verzenden</button><button class="text-button small" data-action="product-draft-fail">Verzenden laten mislukken</button>'}</div></section>`;
  }
  function find(target){const id=target.closest('[data-draft-id]')?.dataset.draftId;return(host.getState().messages[host.getConversationKey()]||[]).find(m=>m.id===id);}
  function finishHighlight(message,root){message.localDraft.highlightPhase='done';for(const n of root.querySelectorAll('.product-draft-added,.product-draft-field-changed')){n.classList.remove('is-fading','product-draft-field-changed');if(n.tagName==='INS')n.replaceWith(document.createTextNode(n.textContent));}host.persist();}
  function mount(root,message){
    const d=message.localDraft;
    if(!urls.has(root)){const url=URL.createObjectURL(new Blob([JSON.stringify({platform:d.platform,to:d.to,subject:d.subject,body:d.body},null,2)],{type:'text/plain;charset=utf-8'}));urls.set(root,url);const anchor=root.querySelector('[data-draft-artifact]');if(anchor)anchor.href=url;}
    if(!d.highlight||d.highlightPhase==='done'||observers.has(root))return;
    let seen=false;
    const see=entry=>{
      const viewport=entry.rootBounds?.height||Infinity;
      if(seen||!entry.isIntersecting||entry.intersectionRect.height<.5*Math.min(entry.boundingClientRect.height,viewport)||document.visibilityState!=='visible'||!document.hasFocus())return;
      seen=true;d.highlightPhase='showing';host.persist();
      const timer=setTimeout(()=>{timers.delete(root);if(!root.isConnected||d.sendState==='sent')return;
        if(host.sourceMotion.reduced){finishHighlight(message,root);return;}
        d.highlightPhase='fading';for(const n of root.querySelectorAll('.product-draft-added,.product-draft-field-changed'))n.classList.add('is-fading');
        const end=setTimeout(()=>{timers.delete(root);finishHighlight(message,root);},400);timers.set(root,end);
      },10000);timers.set(root,timer);
    };
    let last=null;const observer=new IntersectionObserver(entries=>{last=entries.at(-1);if(last)see(last);},{root:root.closest('.transcript'),threshold:Array.from({length:101},(_,i)=>i/100)});
    const onFocus=()=>{if(last)see(last);};observer.observe(root);window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
    observers.set(root,()=>{observer.disconnect();window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);});
  }
  function dispose(root){const url=urls.get(root);if(url)URL.revokeObjectURL(url);urls.delete(root);observers.get(root)?.();observers.delete(root);clearTimeout(timers.get(root));timers.delete(root);}
  function handleAction({action,target}){
    if(action==='product-draft-new'){open();return true;}
    if(!action.startsWith('product-draft-'))return false;
    const m=find(target);if(!m)return true;
    if(action==='product-draft-edit'||action==='product-draft-revise'){dispose(target.closest('[data-draft-id]'));m.localDraft.highlightPhase='done';open(m,action==='product-draft-revise');}
    if(action==='product-draft-send'||action==='product-draft-fail'){
      const d=m.localDraft;if(d.sendState==='sent')return true;
      dispose(target.closest('[data-draft-id]'));const previous=structuredClone(d);
      d.highlightPhase='done';d.sendState='pending';
      try{d.sendState='sent';delete d.error;writeLocalDraftRecord(host.getState(),m,{reject:action==='product-draft-fail',persist:host.persist});}
      catch(error){Object.assign(d,previous,{sendState:'failed',error:error.message});host.persist();}
      host.render();
    }
    return true;
  }
  function handleSubmit({submit,form,data}){
    if(submit!=='product-draft-save')return false;
    const pending=editing;if(!pending||pending.key!==host.getConversationKey()||pending.version!==host.getDialogVersion())return true;
    const read=key=>String(data.get(key)||'').trim(),body=read('body');if(!body)return true;
    const platform=read('platform')==='slack'?'slack':'email',draft={platform,to:read('to'),target:read('to'),workspace:'Lokale werkruimte',subject:read('subject'),body,sendState:'draft'};
    const state=host.getState();state.messages[pending.key] ||= [];
    const messages=state.messages[pending.key],before=structuredClone(messages);
    if(pending.message&&!pending.revision)pending.message.localDraft=draft;
    else{
      if(pending.revision)messages.push({id:crypto.randomUUID(),role:'user',text:'Herzie het lokale concept:\n'+body,createdAt:Date.now()});
      const current={id:crypto.randomUUID(),role:'bot',text:'',createdAt:Date.now(),productKind:'draft',localDraft:draft};messages.push(current);
      const revision=selectDraftRevision(messages,current);draft.highlight=revision?.highlight||null;draft.highlightPhase=revision?'unseen':'done';draft.baselineEntryId=revision?.baselineEntryId;
      // A later revision suppresses the highlight of the draft it supersedes.
      if(revision){const baseline=messages.find(m=>m.id===revision.baselineEntryId);if(baseline?.localDraft)baseline.localDraft.highlightPhase='done';}
    }
    if(!host.persist()){state.messages[pending.key]=before;form.querySelector('[data-draft-form-status]').textContent='Concept niet bewaard. De invoer blijft in dit venster.';return true;}
    host.closeDialog();editing=null;host.render();return true;
  }
  function handleChange(event){if(event.target.id!=='product-draft-platform')return;const subject=host.overlay.querySelector('#product-draft-subject');if(subject)subject.required=event.target.value==='email';}
  return{markup,mount,dispose,handleAction,handleSubmit,handleChange,destroy(){for(const root of new Set([...observers.keys(),...urls.keys()]))dispose(root);editing=null;}};
}

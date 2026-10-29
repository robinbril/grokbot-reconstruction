import {replaceComposerText} from './composer-input.js';
import { createFlowingText } from './product-flowing-text.js';
import { activityMarkup, createActivityController } from './product-activity.js';

export function createLocalTaskSurface(host) {
  const runs=new Map(),activity=createActivityController(host),flowing=createFlowingText(host),copyTimers=new Map(),disclosures=new Map(),mounted=new WeakSet(),esc=host.esc;
  const ids=new Set(),pending=new Map();let request=null,disposed=false;
  const label=run=>run.status==='running'?'Bezig':run.status==='question'?'Antwoord nodig':run.status==='approval'?'Beoordeling nodig':run.status==='cancelled'?'Gestopt':run.status==='interrupted'?'Onderbroken':'Voltooid';
  const resultOf=run=>pending.get(run.id)?.result?.output??pending.get(run.id)?.preview??run.output??'';
  // Only owned scalar fields are staged. Other messages and live work keep identity.
  function saveFields(run,fields){
    const previous=new Map(Object.keys(fields).map(key=>[key,Object.getOwnPropertyDescriptor(run,key)]));
    Object.assign(run,fields);if(host.persist())return true;
    for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(run,key,descriptor);else delete run[key];
    return false;
  }
  function open(){
    host.closePopover();if(!host.ensureConversation?.()&&!host.getAgent(host.getConversationKey()))return;const key=host.getConversationKey();
    host.showDialog('small-dialog','Lokale taak',`<form class="form-dialog" data-submit="product-task-start"><h1>Lokale taak</h1><p class="small muted">Verwerk tekst in deze browser. Er wordt geen model of externe tool aangeroepen.</p><label class="field-label" for="product-task-text">Tekst voor lokale taak</label><textarea class="field-input" id="product-task-text" name="text" rows="6" aria-label="Tekst voor lokale taak" required maxlength="100000"></textarea><label class="field-label" for="product-task-operation">Bewerking</label><select id="product-task-operation" name="operation" aria-label="Bewerking"><option value="count">Woorden tellen</option><option value="upper">Hoofdletters</option></select><label class="product-local-approval"><input type="checkbox" name="approval">Eerst lokaal beoordelen</label><label class="product-local-approval"><input type="checkbox" name="chooseFormat">Uitvoervorm kiezen</label><label class="product-local-approval"><input type="checkbox" name="multiFormat">Meerdere uitvoeronderdelen kiezen</label><p role="status" data-task-create-status></p><div class="form-actions"><button type="button" class="outline-button" data-action="close-modal">Annuleren</button><button class="primary-button" type="submit">Taak starten</button></div></form>`);
    request={key,version:host.getDialogVersion()};
  }
  function detailBody(run){return `<dl><dt>Bewerking</dt><dd>${esc(run.operation)}</dd><dt>Bron</dt><dd>Lokaal ingevoerde tekst</dd></dl><pre data-run-result></pre><button class="pill" data-action="product-task-disclosure" data-source-instance="INSTANCE-179" aria-controls="output-${esc(run.id)}" aria-expanded="false">Uitvoer verbergen</button>`;}
  function card(message){
    const run=message.localRun,active=run.status==='running',waiting=run.status==='approval';
    return `<section class="product-task transcript-card" data-product-card="${esc(message.id)}" data-local-run="${esc(run.id)}" data-source-instance="INSTANCE-008"><header class="row between"><button class="text-button product-task-title" data-action="product-task-open">${run.operation==='upper'?'Tekst naar hoofdletters':'Woorden tellen'}</button><span class="product-task-badge" data-run-status data-source-instance="INSTANCE-177">${label(run)}</span></header>
      <div data-run-approval ${waiting?'':'hidden'}><p>Deze lokale tekstbewerking wacht op je beoordeling.</p><div class="card-actions"><button class="primary-button" data-action="product-task-approve">Goedkeuren</button><button class="outline-button" data-action="product-task-reject">Afwijzen</button></div><button class="text-button" data-action="product-review-rules" data-source-instance="INSTANCE-004">Beoordelingsregels</button></div>
      ${run.replyParts?`<p class="small muted" data-output-chosen>Gekozen: ${run.replyParts.map(part=>({words:'Woorden',characters:'Tekens',lines:'Regels'})[part]).join(', ')}</p>`:''}
      ${run.status==='question'&&run.multiFormat?`<section class="product-output-question" aria-label="Uitvoervorm kiezen"><h3>Welke onderdelen wil je zien?</h3><form data-submit="product-task-parts" data-source-instance="INSTANCE-080">${[['words','Woorden'],['characters','Tekens'],['lines','Regels']].map(([value,label])=>`<label class="product-local-approval"><input type="checkbox" name="parts" value="${value}">${label}</label>`).join('')}<button class="pill" type="submit" data-source-instance="INSTANCE-082">Keuze gebruiken</button><p role="status" data-question-status></p></form></section>`:run.status==='question'?`<section class="product-output-question" aria-label="Uitvoervorm kiezen"><h3>Hoe wil je het resultaat zien?</h3><div data-source-instance="INSTANCE-080"><p>Je keuze bepaalt de uitvoer van deze lokale taak.</p><div class="card-actions"><button class="pill" data-action="product-task-answer" data-value="short">Kort</button><button class="pill" data-action="product-task-answer" data-value="full">Uitgebreid</button></div><form data-submit="product-task-choice"><label class="field-label">Eigen inleiding<input class="field-input" name="prefix" aria-label="Eigen inleiding" maxlength="500" required></label><button class="pill" type="submit" data-source-instance="INSTANCE-082">Eigen antwoord gebruiken</button></form><p role="status" data-question-status></p></div></section>`:''}
      <div class="product-task-progress"><span data-run-spinner ${active?'':'hidden'}>${host.icon('refresh')}</span><progress max="1" value="${Number.isFinite(run.progress)?Math.max(0,Math.min(1,run.progress)):0}" aria-label="Taakvoortgang"></progress><span data-run-counter>${esc(run.wordCount===undefined?'Tekst inlezen':run.wordCount+' woorden')}</span></div>
      <div data-run-activity>${activityMarkup(host,run)}</div>
      <div class="product-task-skeleton" data-run-skeleton ${active?'':'hidden'}></div>
      <div class="product-task-output" data-run-output aria-live="polite">${run.status==='complete'?esc(resultOf(run)):''}</div>
      <div class="card-actions"><button class="outline-button" data-action="product-task-save-result" hidden>Resultaat opslaan</button><button class="outline-button" data-action="product-task-save-status" hidden>Status opslaan</button><button class="text-button" data-action="product-task-disclosure" data-source-instance="INSTANCE-178" aria-controls="output-${esc(run.id)}" aria-expanded="false">Uitvoer tonen</button><button class="text-button" data-action="product-task-raw" aria-expanded="false">Ruwe uitvoer tonen</button><button class="text-button" data-action="product-task-copy" data-source-instance="INSTANCE-176">Resultaat kopiëren</button><button class="text-button" data-action="product-task-compose">Resultaat als concept</button><button class="outline-button" data-action="product-task-stop" ${active||waiting?'':'hidden'}>Stoppen</button></div>
      <div data-run-disclosure data-expanded="false" aria-hidden="true" inert class="sand-rvj5dj sand-ihq33y sand-h8yej3 sand-euugli sand-1qn9uv2 sand-1bqoo3p sand-1132tj4 sand-19frgs0"><div class="product-run-disclosure-clip"><div data-run-details id="output-${esc(run.id)}">${detailBody(run)}</div></div></div><div data-run-raw-region hidden><button class="text-button product-output-filename ui-1iuyybk" data-action="product-task-document" data-source-instance="INSTANCE-029">Taakresultaat.txt</button><pre class="product-raw-output" data-run-raw></pre></div><p role="status" class="small muted" data-run-feedback></p></section>`;
  }
  const find=id=>Object.entries(host.getState().messages).flatMap(([key,list])=>Array.isArray(list)?list.map(message=>({key,message})):[]).find(x=>x.message.localRun?.id===id);
  function getRuntime({conversationId,runId}){
    const found=find(runId);if(!found||found.key!==conversationId)return null;
    const run=found.message.localRun,waiting=pending.get(runId),token=runs.get(runId);
    const working=run.status==='running'&&!waiting&&(ids.has(runId)||!!token&&!token.cancelled);
    const effectiveStatus=waiting?.kind==='status'?waiting.status:waiting?'save-pending':run.status==='running'&&!working?'interrupted':run.status;
    return Object.freeze({effectiveStatus,working});
  }
  function paint(root,message){
    const run=message.localRun,waitingSave=pending.get(run.id),effective=waitingSave?.kind==='status'?{...run,status:waitingSave.status}:run,active=run.status==='running'&&!waitingSave;
    root.querySelector('progress').value=Math.max(0,Math.min(1,Number(run.progress)||0));
    root.querySelector('[data-run-status]').textContent=waitingSave&&waitingSave.kind!=='status'?'Opslaan nodig':label(effective);
    root.querySelector('[data-action="product-task-save-result"]').hidden=!waitingSave||waitingSave.kind==='status'||waitingSave.busy;
    root.querySelector('[data-action="product-task-save-status"]').hidden=waitingSave?.kind!=='status';
    const feedback=root.querySelector('[data-run-feedback]');
    if(waitingSave){feedback.dataset.taskSaveFeedback='';feedback.textContent=waitingSave.kind==='output'?'Resultaat nog niet opgeslagen':waitingSave.kind==='complete'?'Afronding nog niet opgeslagen':waitingSave.status==='cancelled'?'Gestopt; status nog niet opgeslagen':'Onderbroken; status nog niet opgeslagen';}
    else if(feedback.dataset.taskSaveFeedback!==undefined){feedback.textContent='';delete feedback.dataset.taskSaveFeedback;}
    root.querySelector('[data-run-spinner]').hidden=!active;root.querySelector('[data-run-skeleton]').hidden=!active;
    root.querySelector('[data-action="product-task-stop"]').hidden=effective.status!=='running'&&effective.status!=='approval';root.querySelector('[data-run-approval]').hidden=run.status!=='approval';
    if(run.wordCount!==undefined)root.querySelector('[data-run-counter]').textContent=`${run.wordCount} woorden`;
    const detail=root.querySelector('[data-run-result]');if(detail)detail.textContent=resultOf(run);
    root.querySelector('[data-run-raw]').textContent=JSON.stringify({input:run.input,operation:run.operation,wordCount:run.wordCount,characters:run.input.length,status:run.status,output:resultOf(run)},null,2);
    if(['complete','cancelled','interrupted'].includes(effective.status))activity.finish(root.querySelector('[data-product-activity]'),effective.status);
  }
  function rootFor(id){return[...host.app.querySelectorAll('[data-local-run]')].find(n=>n.dataset.localRun===id);}
  function start(message,key){
    const run=message.localRun;if(runs.has(run.id)||pending.has(run.id)||run.status!=='running'||disposed)return;
    const token={cancelled:false,raf:0,animations:[],message,key,preview:''};runs.set(run.id,token);
    const valid=()=>owns(message,token);
    const frame=()=>new Promise(resolve=>{token.resolve=resolve;token.raf=requestAnimationFrame(()=>{token.raf=0;token.resolve=null;resolve();});});
    const execute=async()=>{
      await host.sourceMotion.ready;if(!valid())return;
      const parts=run.input.match(/\S+\s*/gu)||[],chunk=512;let count=0,converted='';
      for(let at=0;at<parts.length;at+=chunk){
        if(!valid())return;
        const slice=parts.slice(at,at+chunk);count+=slice.length;if(run.operation==='upper')converted+=slice.join('').toLocaleUpperCase();
        run.progress=parts.length?Math.min(.8,(at+slice.length)/parts.length*.8):.8;run.wordCount=count;
        token.preview=run.operation==='upper'?converted.trimEnd():`${count} woorden`;
        const root=rootFor(run.id);if(root){paint(root,message);flowing.render(root.querySelector('[data-run-output]'),token.preview,{live:true});}await frame();
      }
      if(!valid())return;
      const summary=run.replyParts?.length?run.replyParts.map(part=>part==='words'?`${count} woorden`:part==='characters'?`${run.input.length} tekens`:`${run.input.split('\n').length} ${run.input.includes('\n')?'regels':'regel'}`).join(' · '):run.replyStyle==='short'?`${count} woorden`:`${count} woorden · ${run.input.length} tekens · ${run.input.split('\n').length} ${run.input.includes('\n')?'regels':'regel'}`;
      const result=Object.freeze({output:(run.replyPrefix?run.replyPrefix+'\n':'')+(run.operation==='upper'?converted.trimEnd():summary),wordCount:count});
      await finish(message,token,result);
    };
    execute().catch(error=>{if(valid())cancel(message,'interrupted',error.message);});
  }
  function owns(message,token){return !disposed&&!token.cancelled&&runs.get(message.localRun.id)===token&&find(message.localRun.id)?.message===message;}
  async function finish(message,token,result,stage='output'){
    const run=message.localRun;if(!owns(message,token))return;
    const record={kind:stage,result,busy:true};pending.set(run.id,record);
    if(stage==='output'){
      const saved=saveFields(run,{output:result.output,wordCount:result.wordCount,committedOutput:true,revision:(run.revision||0)+1});
      const root=rootFor(run.id),output=root?.querySelector('[data-run-output]');
      if(output)token.animations=flowing.render(output,result.output,{live:true});
      if(!saved){record.busy=false;if(root)paint(root,message);return;}
      pending.delete(run.id);
      // Processing is complete; preserve the source word reveal before retiring the skeleton.
      if(output){run.progress=1;paint(root,message);const row=root.closest('.message[data-message-id]');if(row)row.dataset.committedRevision=String(run.revision);await Promise.allSettled(token.animations.map(a=>a.finished));}
    }
    if(!owns(message,token))return;
    if(!saveFields(run,{status:'complete',progress:1,revision:(run.revision||0)+1})){
      record.kind='complete';record.busy=false;pending.set(run.id,record);const root=rootFor(run.id);if(root)paint(root,message);return;
    }
    pending.delete(run.id);runs.delete(run.id);
    // Capture the committed height before the real skeleton retirement reconciliation.
    host.render({reason:'local-output-reconcile'});
  }
  function cancel(message,status='cancelled',error){
    const run=message.localRun,token=runs.get(run.id),previous=pending.get(run.id);
    const preview=previous?.result?.output??previous?.preview??token?.preview;
    if(token){token.cancelled=true;if(token.raf)cancelAnimationFrame(token.raf);token.resolve?.();for(const a of token.animations)a.cancel();runs.delete(run.id);}
    ids.delete(run.id);pending.delete(run.id);
    const fields={status,...(error?{error}:{})};
    if(!saveFields(run,fields))pending.set(run.id,{kind:'status',status,fields,preview});
    const root=rootFor(run.id);if(root)paint(root,message);host.render();
  }
  function mount(root,message){
    if(!mounted.has(root)){mounted.add(root);const trigger=root.querySelector('[data-source-instance="INSTANCE-178"]');host.sourceMotion.animate(trigger,{opacity:[0,1]},{duration:host.sourceMotion.reduced?1:150,easing:'cubic-bezier(.16,1,.3,1)'},{source:'INSTANCE-178',role:'disclosure-trigger-mount'});}
    const run=message.localRun;paint(root,message);if(run.status==='complete')flowing.render(root.querySelector('[data-run-output]'),run.output||'',{live:false});
    const waitingSave=pending.get(run.id);
    if(waitingSave){const text=waitingSave.result?.output??waitingSave.preview,output=root.querySelector('[data-run-output]');if(text!==undefined&&output.textContent!==text)flowing.render(output,text,{live:false});return;}
    if(run.status==='running'){
      if(ids.has(run.id))start(message,host.getConversationKey());else{
        const fields={status:'interrupted'};
        if(!saveFields(run,fields))pending.set(run.id,{kind:'status',status:'interrupted',fields});
        paint(root,message);if(!pending.has(run.id))root.querySelector('[data-run-feedback]').textContent='Onderbroken bij herladen. Er wordt niets automatisch hervat.';
      }
    }
  }
  function handleSubmit({submit,form,data}){
    if(submit!=='product-task-start')return false;
    if(!request||request.key!==host.getConversationKey()||request.version!==host.getDialogVersion())return true;
    const text=String(data.get('text')||'').slice(0,100000);if(!text.trim())return true;
    const state=host.getState(),key=request.key,hadList=Object.hasOwn(state.messages,key),list=state.messages[key] ||= [],operation=data.get('operation')==='upper'?'upper':'count',id=crypto.randomUUID();
    const message={id:crypto.randomUUID(),role:'bot',text:'',createdAt:Date.now(),productKind:'run',localRun:{id,input:text,operation,status:data.get('chooseFormat')||data.get('multiFormat')?'question':data.get('approval')?'approval':'running',needsApproval:Boolean(data.get('approval')),multiFormat:Boolean(data.get('multiFormat')),progress:0}};
    const owner=state.agents.find(agent=>agent.id===key),oldPreview=owner?.preview;if(owner)owner.preview=text.slice(0,140);
    list.push({id:crypto.randomUUID(),role:'user',text,createdAt:Date.now()},message);
    if(!host.persist()){list.splice(list.length-2,2);if(!hadList)delete state.messages[key];if(owner)owner.preview=oldPreview;form.querySelector('[data-task-create-status]').textContent='Taak niet bewaard. Je tekst blijft in dit venster.';return true;}
    ids.add(id);request=null;host.closeDialog();host.render();return true;
  }
  function handleAction({action,target}){
    if(action==='product-task-new'){open();return true;}
    if(action==='product-review-rules'){
      host.showDialog('small-dialog','Beoordelingsregels',`<form class="form-dialog" data-submit="product-review-rules-save"><h1>Beoordelingsregels</h1><label class="field-label">Lokale regel<input class="field-input" name="rule" aria-label="Lokale beoordelingsregel" value="${esc(host.getState().localReviewRule||'Vraag voor een lokale tekstbewerking')}" required></label><p class="small muted">Deze regel geldt alleen voor de lokale taakinterface.</p><button class="primary-button" type="submit">Regel bewaren</button></form>`);return true;
    }
    if(!action.startsWith('product-task-'))return false;
    const root=target.closest('[data-local-run]'),found=find(root?.dataset.localRun);if(!found)return true;const {message,key}=found,run=message.localRun;
    if(action==='product-task-save-result'){
      const record=pending.get(run.id),token=runs.get(run.id);if(record&&record.kind!=='status'&&!record.busy&&token)return finish(message,token,record.result,record.kind).then(()=>true);return true;
    }else if(action==='product-task-save-status'){
      const record=pending.get(run.id);if(record?.kind==='status'&&saveFields(run,record.fields)){pending.delete(run.id);host.render();}else paint(root,message);return true;
    }else if(action==='product-task-answer'){
      if(run.status!=='question')return true;const old=structuredClone(run);run.replyStyle=target.dataset.value==='short'?'short':'full';run.status=run.needsApproval?'approval':'running';
      if(!host.persist()){Object.assign(run,old);root.querySelector('[data-question-status]').textContent='Antwoord niet bewaard. Je kunt opnieuw kiezen.';return true;}ids.add(run.id);host.render();
    }else if(action==='product-task-approve'){run.status='running';if(!host.persist()){run.status='approval';root.querySelector('[data-run-feedback]').textContent='Beoordeling niet bewaard. De taak blijft wachten.';return true;}ids.add(run.id);host.render();}
    else if(action==='product-task-stop'||action==='product-task-reject')cancel(message);
    else if(action==='product-task-disclosure'||action==='product-task-raw'){
      if(action==='product-task-raw'){const body=root.querySelector('[data-run-raw-region]');body.hidden=!body.hidden;target.setAttribute('aria-expanded',String(!body.hidden));}else toggleDisclosure(root);paint(root,message);
    }else if(action==='product-task-document'){
      const state=host.getState(),previous=structuredClone(state.workspaceDocuments||[]),id=`local-task-result:${run.id}`,docs=state.workspaceDocuments ||= [];let doc=docs.find(d=>d.id===id);if(!doc){doc={id,title:'Taakresultaat.txt',html:`<pre>${esc(resultOf(run))}</pre>`,botId:key,revision:1,updatedAt:Date.now()};docs.push(doc);if(!host.persist()){state.workspaceDocuments=previous;root.querySelector('[data-run-feedback]').textContent='Resultaatdocument niet bewaard. Probeer opnieuw.';return true;}}host.openDocument?.(id);
    }else if(action==='product-task-open'){toggleDisclosure(root,true);paint(root,message);}
    else if(action==='product-task-compose'){
      const input=host.app.querySelector('#message-input');if(!replaceComposerText(input,resultOf(run)))return true;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
    }else if(action==='product-task-copy'){
      clearTimeout(copyTimers.get(root));const payload=resultOf(run);
      return Promise.resolve().then(()=>{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');return navigator.clipboard.writeText(payload);}).then(()=>{if(root.isConnected){root.querySelector('[data-run-feedback]').textContent='Resultaat gekopieerd';target.dataset.copyState='copied';target.innerHTML=host.icon('check')+'<span>Resultaat kopiëren</span>';copyTimers.set(root,setTimeout(()=>{copyTimers.delete(root);if(target.isConnected){delete target.dataset.copyState;target.textContent='Resultaat kopiëren';}},2000));}return true;},()=>{if(root.isConnected){root.querySelector('[data-run-feedback]').textContent='Kopiëren mislukt. Probeer opnieuw.';delete target.dataset.copyState;}return true;});
    }
    return true;
  }
  function handleRules({submit,data,form}){
    if(submit==='product-task-parts'){
      const root=form.closest('[data-local-run]'),found=find(root?.dataset.localRun);if(!found||found.message.localRun.status!=='question')return true;
      const run=found.message.localRun,parts=['words','characters','lines'].filter(part=>data.getAll('parts').includes(part));if(!parts.length){root.querySelector('[data-question-status]').textContent='Kies ten minste één onderdeel.';return true;}const old=structuredClone(run);run.replyParts=parts;run.status=run.needsApproval?'approval':'running';
      if(!host.persist()){Object.assign(run,old);delete run.replyParts;root.querySelector('[data-question-status]').textContent='Keuze niet bewaard. Je selectie blijft behouden.';return true;}ids.add(run.id);host.render();return true;
    }
    if(submit==='product-task-choice'){
      const root=form.closest('[data-local-run]'),found=find(root?.dataset.localRun);if(!found||found.message.localRun.status!=='question')return true;
      const run=found.message.localRun,old=structuredClone(run);run.replyPrefix=String(data.get('prefix')||'').trim().slice(0,500);if(!run.replyPrefix)return true;run.replyStyle='full';run.status=run.needsApproval?'approval':'running';
      if(!host.persist()){Object.assign(run,old);root.querySelector('[data-question-status]').textContent='Antwoord niet bewaard. Je invoer blijft behouden.';return true;}ids.add(run.id);host.render();return true;
    }
    if(submit!=='product-review-rules-save')return false;host.getState().localReviewRule=String(data.get('rule')||'').slice(0,2000);if(host.persist())host.closeDialog();return true;
  }
  function toggleDisclosure(root,force){
    const grid=root.querySelector('[data-run-disclosure]'),open=force??grid.dataset.expanded!=='true';disclosures.get(grid)?.();disclosures.delete(grid);
    grid.dataset.expanded=String(open);grid.inert=!open;grid.setAttribute('aria-hidden',String(!open));
    for(const button of root.querySelectorAll('[data-action=product-task-disclosure]'))button.setAttribute('aria-expanded',String(open));
    const body=grid.querySelector('[data-run-details]');if(open&&!body.hasChildNodes()){const run=find(root.dataset.localRun)?.message.localRun;if(run){body.innerHTML=detailBody(run);const result=body.querySelector('[data-run-result]');if(result)result.textContent=resultOf(run);}}body.hidden=false;grid.classList.toggle('sand-ihq33y',!open);grid.classList.toggle('sand-1tu4anv',open);
    void grid.offsetHeight;host.sourceMotion.bindTree(grid);
    if(!open){let active=true;const cleanup=()=>{active=false;grid.removeEventListener('transitionend',end);};const done=()=>{if(!active||grid.dataset.expanded==='true')return;body.replaceChildren();cleanup();disclosures.delete(grid);};const end=event=>{if(event.target===grid&&event.propertyName==='grid-template-rows')done();};grid.addEventListener('transitionend',end);disclosures.set(grid,cleanup);const effects=grid.getAnimations().filter(a=>a.transitionProperty==='grid-template-rows');if(effects.length)Promise.allSettled(effects.map(a=>a.finished)).then(done);else done();}
  }
  function disposeRoot(root){clearTimeout(copyTimers.get(root));copyTimers.delete(root);const grid=root.querySelector('[data-run-disclosure]');disclosures.get(grid)?.();disclosures.delete(grid);flowing.dispose(root.querySelector('[data-run-output]'));for(const a of root.getAnimations({subtree:true}))a.cancel();}
  function restart(message){
    const state=host.getState(),key=host.getConversationKey(),run=message.localRun;if(!run||run.status==='running')return true;
    const list=state.messages[key] ||= [],next={id:crypto.randomUUID(),role:'bot',text:'',createdAt:Date.now(),productKind:'run',localRun:{id:crypto.randomUUID(),input:run.input,operation:run.operation,status:run.needsApproval?'approval':'running',needsApproval:run.needsApproval,replyStyle:run.replyStyle,replyPrefix:run.replyPrefix,progress:0}};
    list.push(next);if(!host.persist()){list.pop();host.render();return true;}ids.add(next.localRun.id);host.render();return true;
  }
  return{card,mount,handleAction,restart,getRuntime,getCopyText(message){return message?.localRun&&find(message.localRun.id)?.message===message?resultOf(message.localRun):undefined;},handleSubmit(ctx){return handleSubmit(ctx)||handleRules(ctx);},disposeRoot,destroy(){disposed=true;for(const token of runs.values()){token.cancelled=true;if(token.raf)cancelAnimationFrame(token.raf);token.resolve?.();for(const a of token.animations)a.cancel();}runs.clear();pending.clear();for(const timer of copyTimers.values())clearTimeout(timer);copyTimers.clear();for(const cleanup of disclosures.values())cleanup();disclosures.clear();flowing.destroy();activity.destroy();}};
}

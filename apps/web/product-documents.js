import { source, bindWorkspace, ownScope } from './product-workspace-utils.js';
const ALLOWED = new Set(['P','DIV','BR','STRONG','B','EM','I','U','S','H1','H2','H3','UL','OL','LI','BLOCKQUOTE','CODE','PRE','A']);
const safeHref = raw => {try{const url=new URL(raw);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}};
export function safeDocumentHTML(raw) {
  const parsed=new DOMParser().parseFromString(String(raw),'text/html'),clean=document.createElement('div');
  function copy(node,parent) {
    if(node.nodeType===Node.TEXT_NODE){parent.append(document.createTextNode(node.textContent));return;}
    if(node.nodeType!==Node.ELEMENT_NODE||['SCRIPT','STYLE','IFRAME','OBJECT','IMG','SVG'].includes(node.tagName))return;
    if(!ALLOWED.has(node.tagName)){for(const child of node.childNodes)copy(child,parent);return;}
    const element=document.createElement(node.tagName.toLowerCase());if(node.tagName==='A'){const href=safeHref(node.getAttribute('href'));if(href){element.href=href;element.rel='noopener noreferrer';element.target='_blank';}}
    parent.append(element);for(const child of node.childNodes)copy(child,element);
  }
  for(const node of parsed.body.childNodes)copy(node,clean);return clean.innerHTML;
}
export function createDocumentSurface(host) {
  const {esc,icon}=host, scope=ownScope(host);let active=null, range=null, revision=0, saving=false, history=[], priorTitle='';
  const documents=()=>{const value=host.getState().workspaceDocuments;return Array.isArray(value)?value:[];};
  function library(agent) {
    const docs=documents().filter(d=>d.botId===agent.id);
    return `<div class="product-library-actions"><button class="outline-button" data-action="new-document">Nieuw document</button><label class="outline-button">CSV openen<input type="file" accept=".csv,text/csv" data-document-csv hidden></label></div>${docs.map(d=>`<button class="file-row" data-action="open-document" data-id="${esc(d.id)}">${icon('file')}<span>${esc(d.title||'Naamloos document')}</span></button>`).join('')}${!docs.length?'<p class="context-hint">Pagina’s, bestanden en apps die deze Bot maakt, verschijnen hier</p>':''}`;
  }
  function openDocument(id) {
    scope.clear();active=id?documents().find(d=>d.id===id):{id:crypto.randomUUID(),botId:host.getConversationKey(),title:'Naamloos document',html:'',revision:0};if(!active)return;active={...active};revision=active.revision||0;saving=false;history=[];
    host.showDialog('product-document-dialog',active.title,`<div class="product-dialog-header"><span class="product-document-title-chip" data-stage-title-chip="renamable" ${source(157)}><button class="product-document-title-control" data-action="product-document-rename" title="${esc(active.title)}"><span data-document-title-label>${esc(active.title)}</span><span class="product-document-pencil" aria-hidden="true" ${source(159)}><span class="product-document-pencil-icon" ${source(158)}>${icon('edit')}</span></span></button><label class="product-document-title-edit" hidden><input class="product-document-title" aria-label="Documenttitel" value="${esc(active.title)}"><span class="product-document-pencil" aria-hidden="true" ${source(159)}><span class="product-document-pencil-icon" ${source(158)}>${icon('edit')}</span></span></label></span></div><div class="product-doc-toolbar" role="toolbar" aria-label="Tekstopmaak"><button class="icon-button" aria-label="Vet" data-action="product-document-format" data-value="strong"><strong>B</strong></button><button class="icon-button" aria-label="Cursief" data-action="product-document-format" data-value="em"><em>I</em></button><button class="icon-button" aria-label="Link invoegen" data-action="product-document-link">${icon('link')}</button><button class="text-button" data-action="product-document-local-link">Document koppelen</button><button class="text-button" data-action="product-document-undo">Ongedaan maken</button></div><div class="product-doc-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Documentinhoud" data-placeholder="Begin met schrijven" spellcheck="true">${safeDocumentHTML(active.html)}</div><div class="product-dialog-footer"><span class="product-doc-status" role="status" data-document-status>Niet opgeslagen</span><button class="outline-button" data-action="close-modal">Sluiten</button><button class="primary-button" data-action="product-document-save">Document opslaan</button></div>`);
    const title=host.overlay.querySelector('[aria-label=Documenttitel]');title.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();title.value=priorTitle;finishTitle({restoreFocus:true});}else if(event.key==='Enter'){event.preventDefault();finishTitle({restoreFocus:true});}},{signal:scope.signal});title.addEventListener('blur',finishTitle,{signal:scope.signal});
    const editor=host.overlay.querySelector('[contenteditable]');editor.addEventListener('beforeinput',()=>{history.push(editor.innerHTML);if(history.length>100)history.shift();},{signal:scope.signal});
    const toolbar=host.overlay.querySelector('.product-doc-toolbar');toolbar.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();},{signal:scope.signal});
    editor.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&['b','i'].includes(event.key.toLowerCase())){event.preventDefault();captureRange();format(event.key.toLowerCase()==='b'?'strong':'em');}},{signal:scope.signal});
    editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.closest('[data-local-document-id]')){event.preventDefault();event.stopPropagation();openDocument(event.target.closest('[data-local-document-id]').dataset.localDocumentId);}},{signal:scope.signal});
    editor.addEventListener('click',event=>{const link=event.target.closest('[data-local-document-id]');if(link&&(event.metaKey||event.ctrlKey)){event.preventDefault();openDocument(link.dataset.localDocumentId);}},{signal:scope.signal});
    decorateLinks(editor);document.addEventListener('selectionchange',captureRange,{signal:scope.signal});
    editor.addEventListener('keyup',captureRange,{signal:scope.signal});editor.addEventListener('mouseup',captureRange,{signal:scope.signal});editor.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData?.getData('text/plain')||'';const sel=getSelection();if(sel?.rangeCount){const r=sel.getRangeAt(0);if(editor.contains(r.commonAncestorContainer)){r.deleteContents();const node=document.createTextNode(text);r.insertNode(node);r.setStartAfter(node);r.collapse(true);sel.removeAllRanges();sel.addRange(r);revision++;}}},{signal:scope.signal});bindWorkspace(host);editor.focus();
  }
  function decorateLinks(editor){for(const link of editor.querySelectorAll('a[href]')){link.dataset.sourceInstance='INSTANCE-019';try{const url=new URL(link.href),id=url.origin===location.origin?new URLSearchParams(url.hash.slice(1)).get('document'):null,doc=documents().find(d=>d.id===id);if(doc){link.dataset.sourceInstance='INSTANCE-019 INSTANCE-020';link.dataset.localDocumentId=id;link.dataset.richLinkAnchor='';link.tabIndex=0;if(!link.querySelector('[data-rich-link-label]')){const label=document.createElement('span');label.dataset.richLinkLabel='';label.textContent=doc.title||'Naamloos document';link.replaceChildren(label);const status=document.createElement('span');status.dataset.richLinkStatus='';status.contentEditable='false';status.ariaLive='polite';status.textContent=', lokaal document';link.append(status);}}}catch{}}bindWorkspace(host);}
  function selectionActions(){
    const editor=host.overlay.querySelector('[contenteditable]');let field=host.overlay.querySelector('[data-document-selection-actions]');
    if(!editor||!range||range.collapsed||!editor.contains(range.commonAncestorContainer)){field?.remove();return;}
    if(!field){field=document.createElement('fieldset');field.dataset.documentSelectionActions='';field.className='product-selection-actions';field.ariaLabel='Selectieacties';field.innerHTML=`<button type="button" aria-pressed="false" data-action="product-document-format" data-value="strong" ${source(23)}>Vetmaken</button><button type="button" aria-pressed="false" data-action="product-document-format" data-value="em" ${source(23)}>Cursiefmaken</button>`;field.addEventListener('pointerdown',event=>event.preventDefault(),{signal:scope.signal});host.overlay.append(field);}
    const anchor=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement;
    for(const button of field.querySelectorAll('[data-value]'))button.setAttribute('aria-pressed',String(Boolean(anchor?.closest(button.dataset.value==='strong'?'strong,b':'em,i'))));
    const rect=range.getBoundingClientRect(),bounds=host.overlay.getBoundingClientRect(),above=rect.top-bounds.top-field.offsetHeight-8>=8,direction=above?'above':'below';
    field.style.left=`${Math.max(8,Math.min(bounds.width-field.offsetWidth-8,rect.left-bounds.left))}px`;
    field.style.top=`${above?rect.top-bounds.top-field.offsetHeight-8:Math.max(8,Math.min(bounds.height-field.offsetHeight-8,rect.bottom-bounds.top+8))}px`;
    // Native hn chooses one directional animation. Retain its clock while the
    // same selection is re-observed; replace only when placement changes.
    if(field.dataset.sourceDirection!==direction){host.sourceMotion.unbind(field,'INSTANCE-024');field.dataset.sourceDirection=direction;host.sourceMotion.bind(field,'INSTANCE-024',{classes:`${above?'ui-hqbpk2':'ui-kebrot'} ui-1aquc0h ui-ykr0s4 ui-lzhlbq ui-1u6ievf`});}
    bindWorkspace(host);
  }
  function finishTitle({restoreFocus=false}={}){const title=host.overlay.querySelector('[aria-label=Documenttitel]'),button=host.overlay.querySelector('[data-action=product-document-rename]'),label=title?.closest('.product-document-title-edit');if(!title||!button||label.hidden)return;const name=title.value.trim()||'Naamloos document';button.querySelector('[data-document-title-label]').textContent=name;button.title=name;label.hidden=true;button.hidden=false;button.closest('[data-stage-title-chip]').dataset.stageTitleChip='renamable';if(restoreFocus)button.focus({preventScroll:true});}
  function captureRange(){const selection=getSelection(),editor=host.overlay.querySelector('[contenteditable]');if(selection?.rangeCount&&editor?.contains(selection.anchorNode)){range=selection.getRangeAt(0).cloneRange();for(const [label,tag] of [['Vet','strong,b'],['Cursief','em,i']]){const anchor=selection.anchorNode instanceof Element?selection.anchorNode:selection.anchorNode?.parentElement;host.overlay.querySelector(`[aria-label="${label}"]`)?.setAttribute('aria-pressed',String(Boolean(anchor?.closest(tag))));}selectionActions();}else{host.overlay.querySelector('[data-document-selection-actions]')?.remove();}}
  function format(tag,href) {
    const editor=host.overlay.querySelector('[contenteditable]');if(!editor)return;if(!range||!editor.contains(range.commonAncestorContainer)){editor.focus();return;}
    history.push(editor.innerHTML);if(history.length>100)history.shift();const node=document.createElement(tag);if(tag==='a'){node.href=href;node.rel='noopener noreferrer';node.target='_blank';node.dataset.sourceInstance='INSTANCE-019';}
    node.append(range.extractContents());if(!node.textContent)node.textContent=tag==='a'?href:'tekst';range.insertNode(node);range.selectNodeContents(node);getSelection()?.removeAllRanges();getSelection()?.addRange(range);revision++;decorateLinks(editor);bindWorkspace(host);editor.focus();captureRange();
  }
  function save() {
    if(!active||saving)return;const editor=host.overlay.querySelector('[contenteditable]'),title=host.overlay.querySelector('[aria-label=Documenttitel]'),status=host.overlay.querySelector('[data-document-status]'),button=host.overlay.querySelector('[data-action=product-document-save]');if(!editor||!title)return;
    saving=true;const version=host.getDialogVersion(),editedRevision=revision,snapshot={...active,title:title.value.trim()||'Naamloos document',html:safeDocumentHTML(editor.innerHTML),revision:editedRevision,updatedAt:Date.now()};button.disabled=true;status.textContent='Opslaan…';bindWorkspace(host);
    // Persistence is synchronous. The completion microtask checks scope/version and
    // never overwrites an edit made while the result feedback is pending.
    const previous=structuredClone(documents()),saved=host.update(state=>{const docs=Array.isArray(state.workspaceDocuments)?state.workspaceDocuments:[];const i=docs.findIndex(d=>d.id===snapshot.id);if(i<0)docs.push(snapshot);else docs[i]=snapshot;state.workspaceDocuments=docs;},{render:false});
    if(saved===false){host.getState().workspaceDocuments=previous;saving=false;button.disabled=false;status.textContent='Document niet opgeslagen. Je tekst blijft behouden; probeer opnieuw.';return;}
    // The library lives in app while this editor lives in the separate overlay.
    // Refresh its durable entry without rebuilding the editor or its selection.
    host.render();
    queueMicrotask(()=>{if(version!==host.getDialogVersion())return;saving=false;button.disabled=false;active=snapshot;status.removeAttribute('data-source-instance');for(const a of status.getAnimations())a.cancel();status.textContent=revision===editedRevision?'Opgeslagen':'Nieuwere wijzigingen nog niet opgeslagen';bindWorkspace(host);});
  }
  async function openCSV(file) {
    const version=host.getDialogVersion();if(!file||file.size>2*1024*1024)return;const text=await file.text();if(version!==host.getDialogVersion())return;
    // RFC4180 quoted cells, including embedded newlines, without interpreting HTML.
    const rows=[],row=[];let cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push([...row]);row.length=0;cell='';}else cell+=c;}if(cell||row.length){row.push(cell);rows.push(row);}if(!rows.length)rows.push(['']);
    host.showDialog('product-document-dialog',file.name,`<div class="product-csv-wrap"><div class="product-table-toolbar" ${source(54)}><strong>${esc(file.name)}</strong><span class="small muted"> · ${rows.length} rijen · ${file.size} bytes lokaal</span></div><table><tbody>${rows.map((r,i)=>`<tr>${r.map(v=>`<${i?'td':'th'}>${esc(v)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`);const wrap=host.overlay.querySelector('.product-csv-wrap');wrap.addEventListener('scroll',()=>wrap.firstElementChild.toggleAttribute('data-scrolled',wrap.scrollTop>0),{signal:scope.signal});bindWorkspace(host);
  }
  return {
    renderSlot(name,{agent}={}){if(name==='libraryPanel'&&agent)return library(agent);},
    handleAction({action,id,value,target}) {
      if(action==='product-document-rename'){const title=host.overlay.querySelector('[aria-label=Documenttitel]'),button=host.overlay.querySelector('[data-action=product-document-rename]');priorTitle=title.value;button.hidden=true;title.closest('.product-document-title-edit').hidden=false;button.closest('[data-stage-title-chip]').dataset.stageTitleChip='editing';title.focus();title.select();return true;}
      if(action==='new-document'){openDocument();return true;}if(action==='open-document'){openDocument(id);return true;}if(action==='product-document-save'){save();return true;}
      if(action==='product-document-format'){format(['strong','em'].includes(value)?value:'strong');return true;}
      if(action==='product-document-local-link'){captureRange();const toolbar=host.overlay.querySelector('.product-doc-toolbar'),old=toolbar.querySelector('[data-document-local-links]');if(old){old.remove();return true;}const menu=document.createElement('div');menu.dataset.documentLocalLinks='';menu.innerHTML=documents().filter(d=>d.id!==active.id).map(d=>`<button type="button" class="text-button" data-action="product-document-local-link-apply" data-id="${esc(d.id)}">${esc(d.title)}</button>`).join('')||'<span>Bewaar eerst een ander document.</span>';menu.addEventListener('pointerdown',event=>event.preventDefault(),{signal:scope.signal});toolbar.append(menu);return true;}
      if(action==='product-document-local-link-apply'){format('a',`${location.origin}/#document=${encodeURIComponent(id)}`);host.overlay.querySelector('[data-document-local-links]')?.remove();return true;}
      if(action==='product-document-link'){captureRange();const toolbar=host.overlay.querySelector('.product-doc-toolbar');if(!toolbar.querySelector('[data-document-link-url]')){const field=document.createElement('input');field.type='url';field.placeholder='https://';field.ariaLabel='Link-URL';field.dataset.documentLinkUrl='';toolbar.append(field);const button=document.createElement('button');button.textContent='Link toepassen';button.dataset.action='product-document-link-apply';toolbar.append(button);field.focus();}return true;}
      if(action==='product-document-link-apply'){const field=host.overlay.querySelector('[data-document-link-url]'),url=safeHref(field?.value);if(url){format('a',url);field.nextElementSibling?.remove();field.remove();}else if(field)field.setCustomValidity('Gebruik een volledige http- of https-link.');return true;}
      if(action==='product-document-undo'&&active){const editor=host.overlay.querySelector('[contenteditable]');editor.innerHTML=safeDocumentHTML(history.length?history.pop():active.html);revision++;captureRange();return true;}
      return false;
    },
    handleInput(event){if(event.target.matches('[data-document-link-url]'))event.target.setCustomValidity('');if(event.target.matches('.product-doc-editor,.product-document-title')){revision++;const status=host.overlay.querySelector('[data-document-status]');if(status)status.textContent='Niet opgeslagen';}},
    handleChange(event){if(event.target.matches('[data-document-csv]'))return openCSV(event.target.files?.[0]);},
    beforeDialogChange(){scope.clear();range=null;},
    destroy(){scope.clear();range=null;},
  };
}

const attr=(value,esc)=>esc(String(value??''));
export function canvasPreviewUrl(scope,id,revision,theme='light'){
 return `/api/harness/conversations/${encodeURIComponent(scope)}/canvases/${encodeURIComponent(id)}/preview?revision=${encodeURIComponent(revision)}&theme=${theme==='dark'?'dark':'light'}`;
}
export function canvasStatus(editor){
 if(editor.busy)return 'Opslaan…';
 if(editor.conflict)return 'Dit canvas is elders gewijzigd. Je concept blijft behouden.';
 if(editor.error)return editor.error;
 if(editor.remoteRevision>editor.revision)return `Nieuwere opgeslagen versie ${editor.remoteRevision} beschikbaar. Je concept blijft behouden.`;
 if(editor.pending)return 'Ontvangst nog niet bevestigd. Controleer dezelfde opslag opnieuw.';
 if(editor.dirty)return editor.id?'Niet-opgeslagen wijzigingen. Voorbeeld toont de opgeslagen versie.':'Nog niet opgeslagen.';
 return `Opgeslagen · versie ${editor.revision}`;
}
export function canvasListMarkup(state,esc){
 return `<div class="live-canvas-list" data-live-canvas-list><div class="live-canvas-heading"><h3>Canvassen</h3><button class="outline-button" data-action="live-canvas-new">Nieuw canvas</button></div><p class="context-hint">Bewaard bij dit gesprek op deze Mac.</p><p class="live-error" role="status" data-canvas-list-error ${state.error?'':'hidden'}>${esc(state.error)}</p><button class="text-button" data-action="live-canvas-refresh">Vernieuwen</button><div data-canvas-rows>${state.items.map(item=>`<button class="file-row" data-action="live-canvas-open" data-id="${attr(item.id,esc)}"><span class="live-canvas-file-mark" aria-hidden="true">TSX</span><span>${esc(item.title)}<small>Versie ${item.revision}</small></span></button>`).join('')||`<p class="context-hint">${state.loading?'Canvassen laden…':'Nog geen canvassen in dit gesprek.'}</p>`}</div></div>`;
}
export function canvasStageMarkup(state,{esc,tab='source',theme='light'}={}){
 const editor=state.editor;if(!editor)return '';
 const url=editor.id?canvasPreviewUrl(state.scope,editor.id,editor.revision,theme):null;
 return `<section class="live-canvas-stage" data-live-canvas-stage data-canvas-key="${attr(state.scope+':'+(editor.id??'new'),esc)}"><div class="live-canvas-heading"><button class="text-button" data-action="live-canvas-back">Canvassen</button><button class="primary-button" data-action="live-canvas-save" ${editor.busy||editor.conflict?'disabled':''}>${editor.pending?'Ontvangst controleren':'Opslaan'}</button></div><label class="sr-only" for="live-canvas-title">Canvastitel</label><input class="field-input live-canvas-title" id="live-canvas-title" data-canvas-field="title" maxlength="200" value="${attr(editor.title,esc)}"><div class="live-canvas-tabs" role="tablist" aria-label="Canvasweergave"><button role="tab" aria-selected="${tab==='preview'}" data-action="live-canvas-tab" data-id="preview">Voorbeeld</button><button role="tab" aria-selected="${tab==='source'}" data-action="live-canvas-tab" data-id="source">Broncode</button></div><p class="small muted live-canvas-status" role="status" data-canvas-status>${esc(canvasStatus(editor))}</p><p class="live-error" role="status" data-canvas-journal-error ${state.error?'':'hidden'}>${esc(state.error)}</p><button class="text-button" data-action="live-canvas-reload" ${editor.busy||editor.pending?'disabled':''} ${editor.conflict||editor.remoteRevision>editor.revision?'':'hidden'}>Opgeslagen versie laden</button><div data-canvas-source-panel ${tab==='source'?'':'hidden'}><label class="sr-only" for="live-canvas-source">Canvasbroncode</label><textarea id="live-canvas-source" class="live-canvas-source" data-canvas-field="source" spellcheck="false" maxlength="65536">${esc(editor.source)}</textarea></div><div data-canvas-design-controls></div><div class="live-canvas-preview" data-canvas-preview-panel ${tab==='preview'?'':'hidden'}>${url?`<iframe title="Canvasvoorbeeld" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${attr(url,esc)}"></iframe>`:'<p class="context-hint">Sla dit canvas op om het voorbeeld te openen.</p>'}</div></section>`;
}
export function canvasLibraryMarkup(state,options){return `<section class="live-canvas-library" data-live-canvas-root>${state.editor?canvasStageMarkup(state,options):canvasListMarkup(state,options.esc)}</section>`;}

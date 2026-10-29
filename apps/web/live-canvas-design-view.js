export function canvasDesignMarkup(state,esc){
 if(!state.capable)return '';
 const label=state.active?'Ontwerpmodus verlaten':'Een deel van de pagina selecteren';
 const toggle=`<button class="outline-button" data-action="live-canvas-design-toggle" aria-pressed="${state.active}" ${state.capable?'':'disabled'}>${label}</button>`;
 if(!state.active)return toggle;
 if(!state.selection)return toggle+'<p class="context-hint">Klik op een deel van de pagina om het te selecteren.</p>';
 const crumbs=state.selection.stack.map((entry,depth)=>`<button class="text-button" data-action="live-canvas-design-depth" data-id="${depth}" ${depth===0?'aria-current="true"':''} title="${esc(state.sourceFile+':'+entry.anchor.line+':'+entry.anchor.column)}">${esc(entry.name)}</button>`).join('<span aria-hidden="true"> › </span>');
 return toggle+`<div class="live-canvas-selection-toolbar" role="toolbar" aria-label="Geselecteerd deel van de pagina"><span class="small muted">Geselecteerd deel van de pagina</span><div class="live-canvas-selection-crumbs">${crumbs}</div><span class="small muted">${esc(state.sourceFile+':'+state.selection.stack[0].anchor.line+':'+state.selection.stack[0].anchor.column)}</span><div class="row"><button class="primary-button" data-action="live-canvas-design-ask">Vraag hierover</button><button class="text-button" data-action="live-canvas-design-clear">Selectie wissen</button></div></div>`;
}

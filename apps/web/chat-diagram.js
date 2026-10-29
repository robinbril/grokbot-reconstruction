import { iconSvg, iconsReady } from './icon-library.js';
// Real Mermaid rendering is serialized because its initialize configuration is global.
let library, queue = Promise.resolve(), serial = 0;
const MAX_CODE = 20000;
const svgTags = new Set('svg g defs marker clipPath path rect circle ellipse polygon polyline line text tspan title desc style linearGradient radialGradient stop'.split(' '));
const svgAttributes = new Set('id class xmlns viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline dx dy marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits clip-path clipPathUnits preserveAspectRatio role aria-label aria-labelledby aria-describedby focusable tabindex style gradientUnits gradientTransform offset stop-color stop-opacity'.split(' '));
const cssProperties = new Set('font-family font-size font-weight font-style fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray opacity color text-anchor dominant-baseline alignment-baseline marker-start marker-mid marker-end clip-path background background-color max-width height width display overflow white-space line-height text-align padding margin border border-radius rx ry'.split(' '));
function safeDeclaration(name,value) {
  return cssProperties.has(name) && value.length < 300 && !/expression|@import|javascript:|https?:|data:|var\(|\\|[<>]/i.test(value) && (!/url\s*\(/i.test(value) || /^url\(["']?#[\w:.-]+["']?\)$/.test(value));
}
function sanitizeSVG(source,prefix) {
  const documentSVG = new DOMParser().parseFromString(source,'image/svg+xml');
  if (documentSVG.querySelector('parsererror')) throw new Error('Invalid SVG');
  const svg = documentSVG.documentElement;
  if (svg.localName !== 'svg') throw new Error('No SVG');
  if (svg.querySelector('foreignObject')) throw new Error('Unsupported HTML labels');
  for (const node of [...svg.querySelectorAll('*')]) if (!svgTags.has(node.localName)) node.remove();
  const ids = new Map(); for (const node of [svg,...svg.querySelectorAll('[id]')]) if (node.id) { ids.set(node.id,`${prefix}-${node.id.replace(/[^\w.-]/g,'_')}`); node.id = ids.get(node.id); }
  const rewrite = value => value.replace(/url\(["']?#([\w:.-]+)["']?\)/g,(_,id) => ids.has(id) ? `url(#${ids.get(id)})` : 'none');
  for (const node of [svg,...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name, value = attribute.value;
      if (!svgAttributes.has(name) || /^on/i.test(name) || /(?:href|src)/i.test(name) || /(?:javascript:|https?:|data:|@import|expression)/i.test(value) && name !== 'xmlns') { node.removeAttribute(name); continue; }
      if (name === 'aria-labelledby' || name === 'aria-describedby') node.setAttribute(name,value.split(/\s+/).map(id => ids.get(id)).filter(Boolean).join(' '));
      else if (name === 'style') { for (let index = node.style.length - 1; index >= 0; index--) { const property = node.style[index]; if (!safeDeclaration(property,node.style.getPropertyValue(property))) node.style.removeProperty(property); else node.style.setProperty(property,rewrite(node.style.getPropertyValue(property))); } }
      else if (/url\s*\(/i.test(value)) { if (!/^url\(["']?#[\w:.-]+["']?\)$/.test(value)) node.removeAttribute(name); else node.setAttribute(name,rewrite(value)); }
    }
    if (node.localName === 'style') {
      const sheet = new CSSStyleSheet(); let css = '';
      try { sheet.replaceSync(node.textContent); for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule) || !rule.selectorText || /[<>@\\]/.test(rule.selectorText)) continue;
        let selector = rule.selectorText;
        for (const [old,id] of ids) selector = selector.replaceAll(`#${old}`,`#${id}`);
        if (!selector.split(',').every(s => s.trim().startsWith(`#${svg.id}`))) continue;
        const declarations = []; for (const property of rule.style) { const value = rule.style.getPropertyValue(property); if (safeDeclaration(property,value)) declarations.push(`${property}:${rewrite(value)}`); }
        if (declarations.length) css += `${selector}{${declarations.join(';')}}`;
      } } catch { /* unusable generated CSS is omitted */ }
      node.textContent = css;
    }
  }
  const box = svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0 || box[2] > 1000000 || box[3] > 1000000 || !svg.querySelector('path,rect,line,polygon,circle,ellipse,text')) throw new Error('Invalid geometry');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg'); svg.setAttribute('width',String(box[2])); svg.setAttribute('height',String(box[3])); svg.style.removeProperty('max-width');
  return {svg:document.importNode(svg,true),width:box[2],height:box[3]};
}
const sameOwner = (a,b) => a?.conversationId === b?.conversationId && a?.entryId === b?.entryId && a?.blockKey === b?.blockKey && a?.revision === b?.revision;
function themeColors(theme,element) {
  const root = getComputedStyle(element?.isConnected ? element : document.documentElement), dark = String(theme).includes('dark');
  const color = (name,fallback) => root.getPropertyValue(name).trim() || fallback;
  return {background:color('--chat-bg-elevated',color('--elevated',dark ? '#1f1f1f' : '#fff')),text:color('--chat-text-primary',color('--ink',dark ? '#f5f5f5' : '#1c1c1c')),line:color('--chat-text-quaternary',dark ? '#f5f5f561' : '#1c1c1c66'),border:color('--chat-border-primary',dark ? '#f5f5f538' : '#1c1c1c3d'),node:color('--chat-bg-tertiary',dark ? '#f5f5f50a' : '#1c1c1c0f'),chrome:color('--chat-bg-chrome',color('--chrome',dark ? '#121212' : '#fcfcfc')),font:root.fontFamily};
}
export function createChatDiagramService({icon,getTheme} = {}) {
  const figures = new Set(); let disposed = false, viewer = null, viewerOwner = null;
  const closeViewer = () => { viewer?.destroy(); viewer = null; viewerOwner = null; };
  function button(label,name,action) { const node = document.createElement('button'); node.type = 'button'; node.setAttribute('aria-label',label); node.className = 'chat-diagram-control'; const exactName = {expand:'corners-out',x:'close'}[name] ?? name;
    const glyph = iconsReady() ? iconSvg(exactName === 'download' ? 'cloud-arrow-down' : exactName) : icon?.({'zoom-in':'plus','zoom-out':'down','corners-in':'panel',expand:'panel',x:'close'}[name] ?? name); if (typeof glyph === 'string') node.innerHTML = glyph; else if (glyph instanceof Node) node.append(glyph); else node.textContent = label; node.addEventListener('click',event => { event.stopPropagation(); action(event); }); return node; }
  function openViewer(result,invoker,ownerLive,figure) {
    if (disposed || !ownerLive()) return; closeViewer();
    const dialog = document.createElement('dialog'); dialog.className = 'chat-diagram-dialog'; dialog.setAttribute('aria-label','Diagram');
    const stage = document.createElement('div'); stage.className = 'chat-diagram-stage'; stage.dataset.chatDiagramStage = '';
    const canvas = document.createElement('div'); canvas.className = 'chat-diagram-viewport'; canvas.dataset.chatDiagramViewport = '';
    const colors = themeColors(getTheme?.(),invoker); canvas.style.setProperty('--chat-bg-elevated',colors.background);
    const clone = sanitizeSVG(new XMLSerializer().serializeToString(result.svg),`chat-view-${++serial}`).svg;
    canvas.append(clone); stage.append(canvas); dialog.append(stage); document.body.append(dialog);
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const abort = new AbortController(), {signal} = abort;
    const D = {width:Math.round(result.width + 48),height:Math.round(result.height + 48)};
    let explicitPose = null, pose, pointer = null, moved = false, startedOnBackdrop = false, closed = false, exporting = false, exportGeneration = 0, warningTimer = null, cancelExport = null;
    const viewport = () => ({width:stage.clientWidth,height:stage.clientHeight});
    const fit = () => { const V = viewport(); if (D.width <= 0 || D.height <= 0 || V.width <= 0 || V.height <= 0) return 1; const ratio = Math.min(V.width / D.width,V.height / D.height); return !Number.isFinite(ratio) || ratio <= 0 ? .1 : Math.min(ratio,1); };
    const clampPose = p => { const V = viewport(), min = Math.min(.1,fit()), scale = Number.isFinite(p.scale) ? Math.min(8,Math.max(min,p.scale)) : min; const rx = Math.max(0,(D.width * scale - V.width) / 2), ry = Math.max(0,(D.height * scale - V.height) / 2); return {scale,x:Math.max(-rx,Math.min(rx,p.x)),y:Math.max(-ry,Math.min(ry,p.y))}; };
    const paint = () => { pose = explicitPose ? clampPose(explicitPose) : {scale:fit(),x:0,y:0}; if (explicitPose) explicitPose = pose; clone.style.transform = `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`; canvas.style.width = `${D.width}px`; canvas.style.height = `${D.height}px`; clone.style.width = `${D.width}px`; clone.style.height = `${D.height}px`; stage.dataset.chatScale = String(pose.scale); const V = viewport(); stage.style.cursor = D.width * pose.scale - V.width > 1 || D.height * pose.scale - V.height > 1 ? pointer ? 'grabbing' : 'grab' : 'default'; };
    const zoom = (scale,point) => { const V = viewport(), s = clampPose({scale,x:0,y:0}).scale; if (s === pose.scale) return; const factor = 1 - s / pose.scale, p = point ?? {x:V.width / 2,y:V.height / 2}; explicitPose = clampPose({scale:s,x:pose.x + (p.x - V.width / 2 - pose.x) * factor,y:pose.y + (p.y - V.height / 2 - pose.y) * factor}); paint(); };
    const reset = () => { explicitPose = null; paint(); };
    const point = event => { const rect = stage.getBoundingClientRect(); return {x:event.clientX - rect.left,y:event.clientY - rect.top}; };
    const warning = document.createElement('div'); warning.className = 'chat-diagram-warning'; warning.setAttribute('role','status');
    const exportPNG = async () => {
      if (exporting || closed || !ownerLive()) return;
      exporting = true; const generation = ++exportGeneration; let image, url, pixelCanvas, timeout;
      try {
        const scale = Math.min(2,8192 / Math.max(result.width,result.height));
        const width = Math.max(1,Math.round(result.width * scale)), height = Math.max(1,Math.round(result.height * scale));
        const svg = sanitizeSVG(new XMLSerializer().serializeToString(result.svg),`chat-export-${++serial}`).svg;
        svg.setAttribute('width',String(width)); svg.setAttribute('height',String(height)); svg.style.removeProperty('max-width'); svg.style.fontFamily = colors.font;
        url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'})); image = new Image();
        await new Promise((resolve,reject) => { cancelExport = () => reject(new Error('Export disposed')); image.onload = resolve; image.onerror = () => reject(new Error('Decode failed')); timeout = setTimeout(() => reject(new Error('Decode timed out')),5000); image.src = url; });
        clearTimeout(timeout); if (closed || generation !== exportGeneration || !ownerLive()) return;
        pixelCanvas = document.createElement('canvas'); pixelCanvas.width = width; pixelCanvas.height = height; const ctx = pixelCanvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = colors.background; ctx.fillRect(0,0,width,height); ctx.drawImage(image,0,0,width,height); const data = pixelCanvas.toDataURL('image/png');
        const anchor = document.createElement('a'); anchor.href = data; anchor.download = 'mermaid-diagram.png'; document.body.append(anchor); anchor.click(); anchor.remove(); warning.textContent = '';
      } catch { if (!closed && generation === exportGeneration) { warning.textContent = 'Downloaden mislukt. Probeer opnieuw.'; clearTimeout(warningTimer); warningTimer = setTimeout(() => { warning.textContent = ''; },3000); } }
      finally { cancelExport = null; clearTimeout(timeout); if (image) { image.onload = image.onerror = null; image.removeAttribute('src'); } if (url) URL.revokeObjectURL(url); if (pixelCanvas) pixelCanvas.width = pixelCanvas.height = 0; exporting = false; }
    };
    const controls = document.createElement('div'); controls.className = 'chat-diagram-controls';
    controls.append(button('Uitzoomen','zoom-out',() => zoom(pose.scale / 1.4)),button('Inzoomen','zoom-in',() => zoom(pose.scale * 1.4)),button('Passend maken','corners-in',reset),button('Diagram downloaden','download',exportPNG));
    stage.append(button('Sluiten','x',closeViewer),controls,warning); stage.firstElementChild === canvas && stage.children[1].classList.add('chat-diagram-close');
    stage.addEventListener('wheel',event => { event.preventDefault(); const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1; zoom(pose.scale * Math.exp(-event.deltaY * multiplier * (event.ctrlKey || event.metaKey ? .01 : .002)),point(event)); },{passive:false,signal});
    stage.addEventListener('pointerdown',event => { if (event.button !== 0 || event.isPrimary === false || event.target.closest('button')) return; moved = false; startedOnBackdrop = event.target === stage; pointer = {id:event.pointerId,x:event.clientX,y:event.clientY,pose:{...pose}}; stage.setPointerCapture(event.pointerId); paint(); },{signal});
    stage.addEventListener('pointermove',event => { if (!pointer || pointer.id !== event.pointerId) return; const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; if (Math.hypot(dx,dy) > 4) moved = true; if (moved) { explicitPose = clampPose({...pointer.pose,x:pointer.pose.x + dx,y:pointer.pose.y + dy}); paint(); } },{signal});
    const release = event => { if (!pointer || pointer.id !== event.pointerId) return; if (stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id); pointer = null; paint(); };
    stage.addEventListener('pointerup',release,{signal}); stage.addEventListener('pointercancel',release,{signal});
    stage.addEventListener('click',event => { if (moved) { moved = false; event.preventDefault(); return; } if (event.target === stage && startedOnBackdrop) closeViewer(); },{signal});
    stage.addEventListener('dblclick',event => { event.preventDefault(); if (event.target.closest('button')) return; if (pose.scale > fit()) reset(); else zoom(pose.scale * 1.96,point(event)); },{signal});
    document.addEventListener('keydown',event => { if (closed) return; if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeViewer(); } else if (['+','=','-','_','0','f','F'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); if (['0','f','F'].includes(event.key)) reset(); else zoom(pose.scale * (['+','='].includes(event.key) ? 1.4 : 1 / 1.4)); } },{capture:true,signal});
    dialog.addEventListener('cancel',event => { event.preventDefault(); closeViewer(); },{signal});
    window.addEventListener('resize',paint,{signal}); const observer = new ResizeObserver(paint); observer.observe(stage);
    viewerOwner = figure; viewer = {destroy() { if (closed) return; closed = true; ++exportGeneration; cancelExport?.(); clearTimeout(warningTimer); abort.abort(); observer.disconnect(); if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id); pointer = null; dialog.close(); dialog.remove(); document.body.style.overflow = previousOverflow; if (invoker.isConnected) invoker.focus({preventScroll:true}); }};
    dialog.showModal(); paint(); controls.querySelector('button')?.focus();
  }
  function create(initial) {
    const element = document.createElement('div'); element.dataset.chatFrame = 'diagram'; element.className = 'chat-diagram';
    let current, renderSignature, rendered, generation = 0, dead = false;
    const live = (owner,token) => !disposed && !dead && generation === token && sameOwner(current?.owner,owner);
    function update(next) {
      if (disposed || dead) return;
      const old = current; current = next;
      if (old && old.code !== next.code && viewerOwner === record) closeViewer();
      const theme = getTheme?.(), signature = `${theme}\0${next.code}`;
      if (renderSignature === signature && rendered) return;
      if (old && !sameOwner(old.owner,next.owner)) ++generation;
      if (!next.isStable) { ++generation; return; }
      if (renderSignature === signature && old && sameOwner(old.owner,next.owner)) return;
      renderSignature = signature; const token = ++generation, owner = {...next.owner};
      element.replaceChildren(); delete element.dataset.chatDiagramReady;
      const fail = () => { if (!live(owner,token)) return; const note = document.createElement('p'); note.dataset.chatDiagramError = ''; note.setAttribute('role','status'); note.textContent = 'Diagram kon niet worden weergegeven. De broncode blijft beschikbaar.'; element.replaceChildren(note); };
      if (!next.code || next.code.length > MAX_CODE || /^\s*---(?:\s|$)|%%\s*\{|^\s*click\s|<\s*(?:script|iframe|img|image|foreignObject)|(?:https?|data|file):|!\[|\b(?:img|image)\s*:/im.test(next.code)) { fail(); return; }
      const job = async () => {
        if (!live(owner,token)) return;
        try {
          const mermaid = await (library ??= import('./assets/vendor/mermaid/mermaid.js').then(module => module.default));
          if (!live(owner,token)) return;
          const colors = themeColors(theme,element);
          mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'inherit',htmlLabels:false,flowchart:{htmlLabels:false},maxTextSize:MAX_CODE,maxEdges:500,themeVariables:{darkMode:String(theme).includes('dark'),fontFamily:'inherit',textColor:colors.text,primaryColor:colors.node,primaryTextColor:colors.text,primaryBorderColor:colors.border,lineColor:colors.line,arrowheadColor:colors.line,secondaryColor:colors.chrome,secondaryTextColor:colors.text,secondaryBorderColor:colors.border,tertiaryColor:colors.chrome,tertiaryTextColor:colors.text,tertiaryBorderColor:colors.border,background:colors.background,titleColor:colors.text,edgeLabelBackground:colors.background,noteBkgColor:colors.chrome,noteTextColor:colors.text,noteBorderColor:colors.border,labelTextColor:colors.text,actorTextColor:colors.text,signalTextColor:colors.text,labelBackgroundColor:colors.background}});
          if (await mermaid.parse(next.code,{suppressErrors:true}) === false) { fail(); return; }
          if (!live(owner,token)) return;
          const id = `chat-mermaid-${++serial}`;
          const result = await mermaid.render(id,next.code);
          if (!live(owner,token)) return;
          rendered = sanitizeSVG(result.svg,`chat-figure-${serial}`);
          const open = button('Diagram openen','expand',() => { const openedOwner = {...current.owner}; openViewer(rendered,open,() => !disposed && !dead && sameOwner(current?.owner,openedOwner),record); });
          open.dataset.chatDiagramOpen = ''; open.classList.add('chat-diagram-open');
          const figure = document.createElement('div'); figure.className = 'chat-diagram-figure'; figure.append(rendered.svg,open);
          figure.addEventListener('click',event => { if (!event.target.closest('button')) open.click(); });
          element.replaceChildren(figure); element.dataset.chatDiagramReady = 'true';
        } catch { fail(); }
      };
      queue = queue.then(job,job);
    }
    const record = {element,update,destroy() { if (dead) return; dead = true; ++generation; if (viewerOwner === record) closeViewer(); element.remove(); figures.delete(record); current = null; rendered = null; }};
    figures.add(record); update(initial); return record;
  }
  return {create,destroy() { if (disposed) return; disposed = true; closeViewer(); for (const figure of [...figures]) figure.destroy(); figures.clear(); }};
}

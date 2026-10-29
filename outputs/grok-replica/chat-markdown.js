import {classifyPRLink} from './pr-reference.js';
import {decoratePRLinks} from './pr-reference-surface.js';
import { Marked } from './assets/vendor/marked/marked.js';
import DOMPurify from './assets/vendor/dompurify/dompurify.js';
import katex from './assets/vendor/katex/katex.js';
import markedFootnote from './assets/vendor/marked-footnote/marked-footnote.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeURL = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const mathExtensions = [{
  name:'chatDisplayMath',level:'block',start:source => source.indexOf('$$'),
  tokenizer(source) { const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(source); if (m) return {type:'chatDisplayMath',raw:m[0],text:m[1].trim(),display:true}; },
}, {
  name:'chatInlineMath',level:'inline',start:source => source.indexOf('$'),
  tokenizer(source) { const m = /^\$(?!\$)([^\n$]+?)\$(?!\$)/.exec(source); if (m) return {type:'chatInlineMath',raw:m[0],text:m[1],display:false}; },
}];
const footnoteOptions = prefixId => ({prefixId,description:'Footnotes',backRefLabel:'Terug naar verwijzing',headingClass:'',sectionClass:'chat-footnotes'});
const scopedPrefix = context => 'chat-fn-' + Array.from(`${context.conversationId ?? ''}\0${context.entryId ?? ''}`).map(char => char.codePointAt(0).toString(16)).join('-') + '-';
export function parseChatMarkdown(text,{isStreaming = false} = {}) {
  const source = String(text ?? ''), blocks = [];
  const plugin = markedFootnote(footnoteOptions('chat-parse-'));
  const lexer = new Marked({gfm:true,breaks:true,extensions:mathExtensions.map(e => ({...e,renderer:() => ''}))}); lexer.use(plugin);
  const tokens = lexer.lexer(source); lexer.walkTokens(tokens,plugin.walkTokens); let offset = 0;
  for (const token of tokens) {
    const start = token.type === 'footnotes' ? source.length : offset; if (token.type !== 'footnotes') offset += token.raw?.length ?? 0;
    if (token.type === 'space' || (token.type === 'footnote' && !isStreaming) || (token.type === 'footnotes' && (isStreaming || !token.items.length))) continue;
    const kind = token.type === 'code' ? 'code' : token.type === 'table' ? 'table' : token.type;
    let closed = true;
    if (kind === 'code') {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(token.raw);
      if (open) { const lines = token.raw.trimEnd().split('\n'); const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines.at(-1)); closed = lines.length > 1 && !!close && close[1][0] === open[1][0] && close[1].length >= open[1].length; }
    }
    blocks.push({key:`${start}:${kind}`,kind,start,end:offset,token,closed:closed && !(isStreaming && kind === 'chatDisplayMath' && !token.raw.includes('$$',2))});
  }
  return {source,blocks};
}

const metricProperties = new Set('background-color border-bottom-width border-color border-right-style border-right-width border-top-width border-style border-width bottom color height left margin margin-left margin-right margin-top min-width padding-left position text-shadow top width vertical-align'.split(' '));
function cleanMathStyle(style) {
  for (let index = style.length - 1; index >= 0; index--) {
    const name = style[index], value = style.getPropertyValue(name).trim();
    const color = /color$/.test(name);
    const safe = metricProperties.has(name) && value.length < 180 && !/url\s*\(|expression|@|var\(|[<>]/i.test(value) && (color ? /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i.test(value) : name === 'position' ? value === 'relative' : name.endsWith('style') ? /^(solid|none)$/.test(value) : name === 'text-shadow' ? /^[-\d.empx\s,#a-f]+$/i.test(value) : /^(?:-?(?:\d*\.)?\d+(?:em|ex|px|pt|%)?|auto|baseline|middle|top|bottom)(?:\s+-?(?:\d*\.)?\d+(?:em|ex|px|pt|%)?){0,3}$/.test(value));
    if (!safe || [...value.matchAll(/-?(?:\d*\.)?\d+/g)].some(m => Math.abs(Number(m[0])) > 10000)) style.removeProperty(name);
  }
}
function mathNode(text,display) {
  const holder = document.createElement(display ? 'div' : 'span'); holder.className = display ? 'chat-math-display' : 'chat-math-inline';
  try {
    const html = katex.renderToString(text,{displayMode:display,output:'htmlAndMathml',trust:false,strict:'error',throwOnError:true,macros:{},maxExpand:200,maxSize:10});
    holder.innerHTML = DOMPurify.sanitize(html,{USE_PROFILES:{html:true,mathMl:true,svg:true},FORBID_TAGS:['a','img','foreignObject','script','style','iframe','object','embed','use','image','animate','set'],FORBID_ATTR:['href','xlink:href','src','id','name'],ALLOW_DATA_ATTR:false});
    for (const node of holder.querySelectorAll('[style]')) cleanMathStyle(node.style);
    for (const node of holder.querySelectorAll('*')) for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
  } catch { const code = document.createElement('code'); code.textContent = text; holder.append(code); }
  return holder;
}
function richFragment(token,context = {}) {
  const maths = [], nestedCodes = [], tableVariant = context.tableVariant, prefix = scopedPrefix(context);
  const renderer = new Marked({gfm:true,breaks:true,renderer:{
    html({text}) { return escape(text); },
    code(token) { const index = nestedCodes.push(token) - 1; return `<div data-chat-nested-code="${index}"></div>`; },
    checkbox({checked}) { return `<span data-chat-task="${checked ? 'true' : 'false'}"></span>`; },
    image({text}) { return escape(text || 'Afbeelding weggelaten'); },
    link({href,title,tokens,raw}) { const label = this.parser.parseInline(tokens), url = safeURL(href),prClass=url&&classifyPRLink(url)?` class="pr-reference-source${raw?.startsWith('[')?' pr-reference-authored':''}"`:''; return url ? `<a href="${escape(url)}"${prClass}${title ? ` title="${escape(title)}"` : ''}>${label}</a>` : label; },
  },extensions:mathExtensions.map(extension => ({...extension,renderer:math => { const id = maths.push(math) - 1; return `<span data-chat-math="${id}"></span>`; }}))});
  renderer.use(markedFootnote(footnoteOptions(prefix)));
  renderer.use({extensions:[{name:'footnoteRef',renderer(token) { return context.isStreaming ? escape(token.raw) : false; }},{name:'footnote',renderer(token) { return context.isStreaming ? `<p>${escape(token.raw)}</p>` : ''; }},{name:'footnotes',renderer() { return context.isStreaming ? '' : false; }}]});
  const template = document.createElement('template');
  template.innerHTML = DOMPurify.sanitize(renderer.parser([token]),{USE_PROFILES:{html:true},FORBID_TAGS:['img','iframe','script','style','object','embed','svg','form','input','button','video','audio','source'],FORBID_ATTR:['style','name','src','srcset','formaction'],ALLOW_DATA_ATTR:false,ADD_ATTR:['data-chat-math','data-chat-task','data-footnotes','data-chat-nested-code']});
  // Only the maintained extension produces IDs; raw HTML was escaped above.
  for (const node of template.content.querySelectorAll('[id]')) if (!node.id.startsWith(prefix)) node.removeAttribute('id');
  for (const anchor of template.content.querySelectorAll('a')) { const fragment = anchor.getAttribute('href'); if (fragment?.startsWith('#' + prefix)) { anchor.dataset.chatFootnoteLink = ''; continue; } const url = safeURL(anchor.getAttribute('href')); if (!url) anchor.replaceWith(...anchor.childNodes); else { anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; } }
  for (const placeholder of template.content.querySelectorAll('[data-chat-math]')) { const math = maths[Number(placeholder.dataset.chatMath)]; if (math) placeholder.replaceWith(mathNode(math.text,math.display)); else placeholder.remove(); }
  for (const placeholder of template.content.querySelectorAll('[data-chat-task]')) { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = placeholder.dataset.chatTask === 'true'; input.disabled = true; input.className = 'chat-task-checkbox'; input.setAttribute('aria-label',placeholder.closest('li')?.textContent.trim() || (input.checked ? 'Voltooid' : 'Niet voltooid')); placeholder.replaceWith(input); }
  for (const table of template.content.querySelectorAll('table')) {
    for (const th of table.querySelectorAll('thead th')) th.scope = 'col';
    if (tableVariant) {
      table.style.minWidth = `${table.querySelectorAll('thead th').length * 120}px`;
      table.dataset.rowHeaders = String(tableVariant.hasRowHeaders); table.dataset.columnRules = String(tableVariant.hasColumnRules);
      if (tableVariant.hasRowHeaders) for (const row of table.querySelectorAll('tbody tr')) { const cell = row.firstElementChild; if (!cell) continue; const th = document.createElement('th'); for (const attr of cell.attributes) th.setAttribute(attr.name,attr.value); th.scope = 'row'; th.append(...cell.childNodes); cell.replaceWith(th); }
    } else { const scroll = document.createElement('div'); scroll.className = 'chat-inline-table'; table.replaceWith(scroll); scroll.append(table); }
  }
  return {fragment:template.content,nestedCodes};
}
// Reconcile compatible leaves instead of replacing streamed prose. Capture local
// selection offsets only around a necessary content mutation, preserving direction.
function reconcile(parent,incoming) {
  const selection = document.getSelection(); let saved;
  if (selection?.anchorNode && parent.contains(selection.anchorNode) && parent.contains(selection.focusNode)) {
    const offset = (node,n) => { const r = document.createRange(); r.selectNodeContents(parent); r.setEnd(node,n); return r.toString().length; };
    saved = [offset(selection.anchorNode,selection.anchorOffset),offset(selection.focusNode,selection.focusOffset)];
  }
  const morph = (target,next) => {
    const wanted = [...next.childNodes];
    wanted.forEach((node,index) => {
      const old = target.childNodes[index];
      if (!old) { target.append(node); return; }
      if (old.nodeType !== node.nodeType || old.nodeName !== node.nodeName) { old.replaceWith(node); return; }
      if (old.nodeType === 3) { if (old.data !== node.data) old.data = node.data; return; }
      if (old.nodeType === 1) {
        for (const attr of [...old.attributes]) if (!node.hasAttribute(attr.name)) old.removeAttribute(attr.name);
        for (const attr of node.attributes) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name,attr.value);
        if (!(old.hasAttribute('data-chat-nested-code') && node.hasAttribute('data-chat-nested-code') && old.dataset.chatNestedCode === node.dataset.chatNestedCode)) morph(old,node);
      }
    });
    while (target.childNodes.length > wanted.length) target.lastChild.remove();
  };
  morph(parent,incoming);decoratePRLinks(parent);
  if (saved && selection) {
    const locate = offset => { const walker = document.createTreeWalker(parent,NodeFilter.SHOW_TEXT); let node, last; while ((node = walker.nextNode())) { last = node; if (offset <= node.length) return [node,offset]; offset -= node.length; } return last ? [last,last.length] : [parent,0]; };
    selection.setBaseAndExtent(...locate(saved[0]),...locate(saved[1]));
  }
}
let highlighter;
const highlight = () => highlighter ??= import('./assets/vendor/shiki/shiki.js').then(module => module.createChatHighlighter());
export function createChatMarkdownBlock(initial) {
  const element = document.createElement('div'); element.className = 'chat-markdown-block';
  const footnoteClick = event => { const anchor = event.target.closest?.('a[data-chat-footnote-link]'); if (!anchor || !element.contains(anchor)) return; event.preventDefault(); event.stopPropagation(); const id = anchor.getAttribute('href')?.slice(1); const target = id && document.getElementById(id); if (target && target.closest('[data-chat-entry-id]') === element.closest('[data-chat-entry-id]')) { target.tabIndex = -1; target.focus({preventScroll:true}); target.scrollIntoView({block:'nearest',behavior:'instant'}); } };
  element.addEventListener('click',footnoteClick);
  const nestedViews = new Map();
  let current, signature, destroyed = false, generation = 0, diagramView = null, copyButton, codeElement, highlightedSignature = null;
  const owns = (context,blockKey) => current?.context?.conversationId === context?.conversationId && current?.context?.entryId === context?.entryId && current?.context?.revision === context?.revision && current?.block?.key === blockKey;
  const copy = async event => {
    event.preventDefault(); event.stopPropagation();
    const token = generation, owner = {...current?.context}, blockKey = current?.block.key; const raw = current?.block.token.text ?? '';
    let ok = false; try { ok = await owner?.copyText?.(raw) === true; } catch { /* explicit retry remains available */ }
    if (!destroyed && token === generation && owns(owner,blockKey)) copyButton.textContent = ok ? 'Gekopieerd' : 'Kopiëren mislukt';
  };
  function update(next) {
    if (destroyed) return;
    const {block,source,context = {}} = next;
    const raw = source.slice(block.start,block.end);
    const nextSignature = JSON.stringify([raw,block.token,context.theme,context.isStable,context.isStreaming,context.tableVariant,block.kind === 'code' && context.isStable ? context.revision : null]);
    // Revision ownership still advances on an unchanged source span.
    current = next;
    if (signature === nextSignature) {
      diagramView?.update({code:block.token.text,owner:{conversationId:context.conversationId,entryId:context.entryId,blockKey:block.key,revision:context.revision},isStable:context.isStable && block.closed});
      for (const nested of nestedViews.values()) { nested.props = {...nested.props,context}; nested.view.update(nested.props); }
      return;
    }
    signature = nextSignature; const token = ++generation;
    element.dataset.chatBlockKey = block.key; element.dataset.chatBlockKind = block.kind;
    if (block.kind === 'code') {
      const language = (block.token.lang ?? '').split(/\s/)[0].toLowerCase();
      if (!copyButton) {
        const wrapper = document.createElement('div'); wrapper.className = 'code-block chat-code-block';
        const pre = document.createElement('pre'); pre.dir = 'ltr'; codeElement = document.createElement('code'); pre.append(codeElement);
        copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.className = 'code-copy'; copyButton.textContent = 'Code kopiëren'; copyButton.setAttribute('aria-label','Code kopiëren'); copyButton.addEventListener('click',copy);
        wrapper.append(pre,copyButton); element.append(wrapper);
      }
      if (codeElement.textContent !== block.token.text) { codeElement.textContent = block.token.text; highlightedSignature = null; }
      if (language === 'mermaid' && context.diagram) {
        const props = {code:block.token.text,owner:{conversationId:context.conversationId,entryId:context.entryId,blockKey:block.key,revision:context.revision},isStable:context.isStable === true && block.closed};
        if (!diagramView) { diagramView = context.diagram.create(props); element.append(diagramView.element); } else diagramView.update(props);
        element.dataset.chatMermaid = 'true';
      } else {
        diagramView?.destroy(); diagramView = null; delete element.dataset.chatMermaid;
        const syntaxSignature = JSON.stringify([block.token.text,language,context.theme]);
        if (context.isStable === true && block.closed && language && block.token.text.length <= 50000 && highlightedSignature !== syntaxSignature) {
          highlight().then(engine => {
            if (destroyed || token !== generation || !owns(context,block.key)) return;
            const supported = engine.getLoadedLanguages().includes(language);
            if (!supported) return;
            const result = engine.codeToTokens(block.token.text,{lang:language,theme:String(context.theme).includes('dark') ? 'github-dark' : 'github-light'});
            const fragment = document.createDocumentFragment(); result.tokens.forEach((line,index) => { if (index) fragment.append('\n'); for (const part of line) { const span = document.createElement('span'); span.textContent = part.content; if (/^#[\da-f]{3,8}$/i.test(part.color ?? '')) span.style.color = part.color; fragment.append(span); } });
            codeElement.replaceChildren(fragment); highlightedSignature = syntaxSignature;
          }).catch(() => {});
        }
      }
    } else {
      const rich = richFragment(block.token,context); reconcile(element,rich.fragment);
      const keep = new Set();
      for (const placeholder of element.querySelectorAll('[data-chat-nested-code]')) {
        const index = Number(placeholder.dataset.chatNestedCode), code = rich.nestedCodes[index]; if (!code) continue;
        const key = `${block.key}/nested-code:${index}`, rawCode = code.raw ?? '', open = /^ {0,3}(`{3,}|~{3,})/.exec(rawCode), lines = rawCode.trimEnd().split('\n'), close = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines.at(-1));
        const closed = !open || (lines.length > 1 && !!close && close[1][0] === open[1][0] && close[1].length >= open[1].length);
        const props = {source:rawCode,block:{key,kind:'code',start:0,end:rawCode.length,token:code,closed},context};
        keep.add(key); let nested = nestedViews.get(key);
        if (!nested) { nested = {view:createChatMarkdownBlock(props),props}; nestedViews.set(key,nested); placeholder.append(nested.view.element); }
        else { nested.props = props; nested.view.update(props); if (nested.view.element.parentNode !== placeholder) placeholder.append(nested.view.element); }
      }
      for (const [key,nested] of nestedViews) if (!keep.has(key)) { nested.view.destroy(); nestedViews.delete(key); }
    }
  }
  update(initial);
  return {element,update,destroy() { if (destroyed) return; destroyed = true; ++generation; diagramView?.destroy(); for (const nested of nestedViews.values()) nested.view.destroy(); nestedViews.clear(); copyButton?.removeEventListener('click',copy); element.removeEventListener('click',footnoteClick); element.remove(); current = null; }};
}

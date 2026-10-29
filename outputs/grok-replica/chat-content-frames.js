import { parseChatMarkdown, createChatMarkdownBlock } from './chat-markdown.js';

// Readable port of S13's bounded table scanner. Offsets address this derived
// normalized view, never the persisted outer entry text used by answer actions.
const blank = /^[ \t]*$/;
const fence = /^ {0,3}(`{3,}|~{3,})/;
const closingFence = /^ {0,3}(`+|~+)[ \t]*$/;
const contextStart = /^ {0,3}(?:>|<[A-Za-z/!?]|(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$))/;
const indented = /^(?: {2,}|\t)/;
const blockStart = /^(?: {4}|\t)|^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|>|(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|<[A-Za-z/!?])/;
const excluded = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*\[(?:[^\]\\\n]|\\.)+\]:|^ {0,3}<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--|\?|![A-Za-z]|!\[CDATA\[)/im;
const cells = line => line.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/);
const columns = line => blockStart.test(line) ? 0 : cells(line).some(x => x.trim()) ? cells(line).length : 0;
function normalizeView(source) {
  let inside = false;
  const bullet = source.replace(/\r\n/g, '\n').split('\n').map(line => {
    if (fence.test(line)) { inside = !inside; return line; }
    return inside ? line : line.replace(/^( {0,3})[\u2022\u25E6\u25AA](?=[ \t])/, '$1-');
  });
  const output = []; inside = false; let inList = false, boundary = true;
  for (const line of bullet) {
    if (fence.test(line)) { inside = !inside; if (!indented.test(line)) inList = false; boundary = !inside; output.push(line); continue; }
    if (inside) { boundary = false; output.push(line); continue; }
    if (!line.trim()) { boundary = true; output.push(line); continue; }
    if (!/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: |\t|$)/.test(line)) {
      if (boundary && !indented.test(line)) inList = false;
      boundary = false; output.push(line); continue;
    }
    const ordered = /^ {0,3}(\d{1,9})[.)](?: |\t|$)/.exec(line);
    if (ordered && Number(ordered[1]) >= 2 && !inList && !boundary) output.push('');
    inList = true; boundary = false; output.push(line);
  }
  return output.join('\n');
}
function scanTables(input, streaming) {
  if (!input.includes('|') || excluded.test(input)) return null;
  const source = normalizeView(input), lines = source.split('\n'), starts = [];
  let offset = 0; for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  const runs = [], candidates = new Set(); let from = 0, activeFence = null, guarded = false, boundary = true, cursor = 0;
  const prose = (a, b) => {
    while (a < b && blank.test(lines[a])) a++;
    while (b > a && blank.test(lines[b - 1])) b--;
    if (a < b) runs.push({kind:'prose',start:starts[a],end:starts[b - 1] + lines[b - 1].length});
  };
  while (cursor < lines.length) {
    const line = lines[cursor++] ?? '';
    if (activeFence) { const close = closingFence.exec(line)?.[1]; if (close && close[0] === activeFence[0] && close.length >= activeFence.length) activeFence = null; continue; }
    if (blank.test(line)) { boundary = true; continue; }
    if (contextStart.test(line)) guarded = true;
    else if (boundary && !indented.test(line)) guarded = false;
    boundary = false; activeFence = fence.exec(line)?.[1] ?? null;
    const count = columns(line), eligible = !guarded && activeFence == null;
    if (eligible && count > 0 && line.includes('|')) candidates.add(cursor - 1);
    const next = lines[cursor];
    if (!eligible || !count || next === undefined || blockStart.test(next) || cells(next).length !== count || !cells(next).every(x => /^[ \t]*:?-+:?[ \t]*$/.test(x)) || !(line.includes('|') || next.includes('|'))) continue;
    const start = cursor - 1; let end = cursor + 1;
    while (end < lines.length && !blank.test(lines[end]) && !blockStart.test(lines[end])) end++;
    prose(from, start);
    const header = cells(line), delimiter = cells(next);
    runs.push({kind:'table',start:starts[start],end:starts[end - 1] + lines[end - 1].length,
      tableVariant:{hasRowHeaders:header[0].trim().length === 0 && header.slice(1).some(x => x.trim()),hasColumnRules:!delimiter.every(x => /^[ \t]*:?-:?[ \t]*$/.test(x))}});
    from = end; cursor = end;
  }
  let tail = null;
  if (streaming) {
    let last = lines.length - 1; while (last >= 0 && blank.test(lines[last])) last--;
    if (last >= from) {
      const atEnd = last === lines.length - 1;
      if (atEnd && /^[ \t]*[|:-][ \t|:-]*$/.test(lines[last]) && last > from && candidates.has(last - 1)) tail = last - 1;
      else if ((atEnd || (last === lines.length - 2 && lines[last + 1] === '')) && candidates.has(last)) tail = last;
    }
  }
  if (!runs.length && tail == null) return null;
  prose(from, tail ?? lines.length);
  if (!runs.length) runs.push({kind:'prose',start:0,end:0});
  return {source,runs};
}
export function projectChatContent(entry, context = {}) {
  const source = typeof entry?.text === 'string' ? entry.text : '';
  const streaming = context.work?.isStreaming === true;
  const adjacency = context.adjacency || {};
  const finish = (mode, source, runs) => ({mode,source,runs:runs.map((run,index) => ({...run,key:`${run.start}:${run.kind}`,isStreaming:streaming && index === runs.length - 1,...(run.kind === 'prose' ? {adjacency:{isGroupStart:index === 0 && adjacency.isGroupStart === true,isContinuedFromPrev:index === 0 && adjacency.isContinuedFromPrev === true,isContinuedToNext:index === runs.length - 1 && adjacency.isContinuedToNext === true}} : {})}))});
  if (entry?.unsupported || context.role === 'user' || entry?.role === 'user') return finish('plain', source,[{kind:'prose',start:0,end:source.length}]);
  if (['canvas','document','agent','link','voice','link-list'].includes(context.specialized)) return {mode:'delegate',source,runs:[]};
  const kind = entry?.kind ?? entry?.transcript?.kind;
  if (!['message','send-message'].includes(kind)) return finish('plain',source,[{kind:'prose',start:0,end:source.length}]);
  const layout = entry?.payload?.layoutMode ?? entry?.transcript?.payload?.layoutMode;
  const eligible = kind === 'send-message' && layout === 'elevated' && context.channel == null && !context.images?.length && !context.attachments?.length;
  const split = eligible ? scanTables(source, streaming) : null;
  return split ? finish('split',split.source,split.runs) : finish('whole',source,[{kind:'prose',start:0,end:source.length}]);
}

function place(parent, node, index) {
  const before = parent.children[index] ?? null;
  if (before === node) return;
  if (node.parentNode === parent && typeof parent.moveBefore === 'function') parent.moveBefore(node,before);
  else parent.insertBefore(node,before);
}
export function createChatContentView({conversationId,entryId,copyText,diagram}) {
  const element = document.createElement('div'); element.className = 'message-body chat-content'; element.dataset.chatEntryId = entryId;
  const records = new Map(); let destroyed = false, lastRevision = -1, acceptedEntry = null;
  function dispose(record) { for (const view of record.blocks.values()) view.destroy(); record.cleanup?.(); record.element.remove(); }
  function update({entry,context = {},adjacency,theme}) {
    if (destroyed) return;
    const revision = entry?.revision ?? entry?.transcript?.revision ?? 0;
    if (revision < lastRevision) return;
    if (revision === lastRevision && acceptedEntry) entry = acceptedEntry;
    else { lastRevision = revision; acceptedEntry = entry; }
    const plan = projectChatContent(entry,{...context,adjacency:adjacency ?? context.adjacency});
    element.dataset.chatKind = entry?.kind ?? 'message'; element.dataset.chatMode = plan.mode;
    const keep = new Set();
    plan.runs.forEach((run,index) => {
      keep.add(run.key); let record = records.get(run.key);
      if (!record) {
        const frame = document.createElement('div'); frame.dataset.chatFrame = run.kind; frame.dataset.chatRunKey = run.key; frame.dir = 'auto';
        record = {element:frame,blocks:new Map()}; records.set(run.key,record);
        if (run.kind === 'table') {
          const scroll = document.createElement('div'); scroll.dataset.chatTableScroll = ''; scroll.tabIndex = 0; scroll.setAttribute('role','region'); scroll.setAttribute('aria-label','Tabel horizontaal scrollen'); frame.append(scroll); record.body = scroll;
          const measure = () => scroll.toggleAttribute('data-clipped-end',scroll.scrollWidth - scroll.clientWidth - Math.abs(scroll.scrollLeft) > 1);
          scroll.addEventListener('scroll',measure,{passive:true});
          const key = event => { const rtl = getComputedStyle(scroll).direction === 'rtl'; if (!['Home','End','ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); if (event.key === 'Home') scroll.scrollLeft = 0; else if (event.key === 'End') scroll.scrollLeft = (rtl ? -1 : 1) * scroll.scrollWidth; else scroll.scrollLeft += event.key === 'ArrowLeft' ? -80 : 80; measure(); };
          scroll.addEventListener('keydown',key); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null; observer?.observe(scroll);
          record.cleanup = () => { observer?.disconnect(); scroll.removeEventListener('scroll',measure); scroll.removeEventListener('keydown',key); }; record.measure = measure;
        } else record.body = frame;
      }
      record.element.dataset.chatStreaming = String(run.isStreaming);
      for (const [name,value] of Object.entries(run.adjacency ?? {})) record.element.dataset[name] = String(value);
      place(element,record.element,index);
      const text = plan.source.slice(run.start,run.end);
      if (plan.mode === 'plain') {
        for (const view of record.blocks.values()) view.destroy(); record.blocks.clear();
        if (!record.plainText) { record.body.replaceChildren(); record.plainText = document.createTextNode(text); record.body.append(record.plainText); }
        else if (record.plainText.data !== text) record.plainText.data = text;
        if (entry?.unsupported && !record.note) { record.note = document.createElement('span'); record.note.className = 'chat-unsupported'; record.note.textContent = 'Dit berichttype wordt nog niet ondersteund'; record.body.append(record.note); }
        return;
      }
      if (record.plainText) { record.body.replaceChildren(); record.plainText = null; record.note = null; }
      const parsed = parseChatMarkdown(text,{isStreaming:run.isStreaming}), blockKeep = new Set();
      parsed.blocks.forEach((block,blockIndex) => {
        blockKeep.add(block.key);
        const blockContext = {conversationId,entryId,revision,isStreaming:run.isStreaming,isStable:context.work?.isStable === true,theme,copyText,diagram,tableVariant:run.tableVariant};
        let view = record.blocks.get(block.key);
        if (!view) { view = createChatMarkdownBlock({block,source:parsed.source,context:blockContext}); record.blocks.set(block.key,view); }
        else view.update({block,source:parsed.source,context:blockContext});
        place(record.body,view.element,blockIndex);
      });
      for (const [key,view] of record.blocks) if (!blockKeep.has(key)) { view.destroy(); record.blocks.delete(key); }
      record.measure?.();
    });
    for (const [key,record] of records) if (!keep.has(key)) { dispose(record); records.delete(key); }
  }
  return {element,update,destroy() { if (destroyed) return; destroyed = true; for (const record of records.values()) dispose(record); records.clear(); element.remove(); }};
}

import {classifyPRLink} from './pr-reference.js';
import { Marked } from './assets/vendor/marked/marked.js';
import DOMPurify from './assets/vendor/dompurify/dompurify.js';
import katex from './assets/vendor/katex/katex.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeURL = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
function formula(text, displayMode) {
  try {
    return katex.renderToString(text, { displayMode, output: 'mathml', trust: false, strict: 'error', throwOnError: true, macros: {}, maxExpand: 200, maxSize: 10 });
  } catch { return `<code>${escape(text)}</code>`; }
}
// Marked owns GFM parsing; raw HTML is visible inert text, images never load.
const markdown = new Marked({ gfm: true, breaks: true, renderer: {
  html({ text }) { return escape(text); },
  image({ text }) { return escape(text || 'Afbeelding weggelaten'); },
  link({ href, title, tokens, raw }) {
    const label = this.parser.parseInline(tokens), url = safeURL(href);
    const prClass=url&&classifyPRLink(url)?` class="pr-reference-source${raw?.startsWith('[')?' pr-reference-authored':''}"`:'';
    return url ? `<a href="${escape(url)}"${prClass}${title ? ` title="${escape(title)}"` : ''}>${label}</a>` : label;
  },
}, extensions: [{
  name: 'displayFormula', level: 'block', start: source => source.indexOf('$$'),
  tokenizer(source) {
    const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(source);
    if (match) return { type: 'displayFormula', raw: match[0], text: match[1].trim() };
  },
  renderer: token => formula(token.text, true),
}, {
  name: 'inlineFormula', level: 'inline', start: source => source.indexOf('$'),
  tokenizer(source) {
    const match = /^\$(?!\$)([^\n$]+?)\$(?!\$)/.exec(source);
    if (match) return { type: 'inlineFormula', raw: match[0], text: match[1] };
  },
  renderer: token => formula(token.text, false),
}] });

export function renderRichText(text) {
  // Sanitization is mandatory even with restricted renderer methods.
  const clean = DOMPurify.sanitize(markdown.parse(String(text ?? '')), {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['img', 'iframe', 'script', 'style', 'object', 'embed', 'svg', 'form', 'input', 'button', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'id', 'name', 'src', 'srcset', 'formaction'],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const anchor of template.content.querySelectorAll('a')) {
    const href = safeURL(anchor.getAttribute('href'));
    if (!href) anchor.replaceWith(...anchor.childNodes);
    else { anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
  }
  for (const pre of template.content.querySelectorAll('pre')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'code-copy'; copy.dataset.action = 'copy-code';
    copy.textContent = 'Code kopiëren'; copy.setAttribute('aria-label', 'Code kopiëren');
    pre.replaceWith(wrapper); wrapper.append(copy, pre);
  }
  return template.innerHTML;
}

function validQuote(quote) { return quote && typeof quote.text === 'string' && typeof quote.title === 'string' && typeof quote.messageId === 'string'; }
export function normalizeReplyState(state) {
  if (!state.replyDrafts || typeof state.replyDrafts !== 'object' || Array.isArray(state.replyDrafts)) state.replyDrafts = {};
  for (const [id, quote] of Object.entries(state.replyDrafts)) if (!validQuote(quote)) delete state.replyDrafts[id];
}
export function renderQuote(quote, draft = false) {
  if (!validQuote(quote)) return '';
  const title = escape(quote.title), text = escape(quote.text.replace(/^#+\s*/gm, '').slice(0, 200));
  const content = draft
    ? `<div><strong>${title}</strong><p>${text}</p></div><button type="button" class="icon-button" data-action="remove-reply" aria-label="Antwoordcontext verwijderen">×</button>`
    : `<button type="button" class="product-quote-jump" data-action="${quote.replyToId?'live-reply-jump':'product-quote-jump'}" data-quote-message-id="${escape(quote.messageId)}"${typeof quote.agentId==='string'?` data-quote-agent-id="${escape(quote.agentId)}"`:''}${quote.replyToId?` data-reply-message-id="${escape(quote.replyToId)}" data-reply-entry-id="${escape(quote.entryId||'')}"`:''} aria-label="Naar oorspronkelijk bericht"><strong>${title}</strong><span class="product-quote-preview">${text}</span></button>`;
  return `<${draft ? 'section' : 'div'} class="reply-context ${draft ? 'reply-draft' : 'reply-quote'}" role="${draft ? 'region' : 'group'}" aria-label="${draft ? 'Antwoordcontext' : escape('Antwoord op ' + quote.title)}">${content}</${draft ? 'section' : 'div'}>`;
}
export function takeReplyQuote(state, id) {
  const quote = state.replyDrafts[id];
  delete state.replyDrafts[id];
  return validQuote(quote) ? structuredClone(quote) : undefined;
}
export function renderQuestion(message) {
  const question = message.question;
  if (!question || !Array.isArray(question.options)) return '';
  const title = `<h3>${escape(question.prompt)}</h3>`;
  if (question.status === 'confirmed') return `<section class="transcript-card question-card">${title}<p role="status">Gekozen: ${escape(question.selected)}</p></section>`;
  if (question.status === 'skipped') return `<section class="transcript-card question-card">${title}<p role="status">Vraag overgeslagen</p></section>`;
  return `<section class="transcript-card question-card" data-message-id="${escape(message.id)}">${title}<fieldset><legend class="sr-only">${escape(question.prompt)}</legend>${question.options.map((option, index) => `<label class="question-option"><input type="radio" name="question-${escape(message.id)}" value="${escape(option)}" data-question-id="${escape(message.id)}" ${question.selected === option ? 'checked' : ''}>${escape(option)}</label>`).join('')}</fieldset><div class="card-actions"><button class="primary-button" data-action="confirm-question" data-id="${escape(message.id)}" ${question.options.includes(question.selected) ? '' : 'disabled'}>Antwoord bevestigen</button><button class="outline-button" data-action="skip-question" data-id="${escape(message.id)}">Overslaan</button></div></section>`;
}
export function selectQuestion(state, input, persist) {
  const message = (state.messages[state.selected] || []).find(item => item.id === input.dataset.questionId);
  const question = message?.question;
  if (!question || question.status !== 'open' || !question.options.includes(input.value)) return;
  question.selected = input.value; persist();
  input.closest('.question-card').querySelector('[data-action="confirm-question"]').disabled = false;
}
export async function richAction(action, target, state, persist, render, copy) {
  if (action === 'copy-code') {
    const ok = await copy(target.closest('.code-block')?.querySelector('code')?.textContent || '');
    target.textContent = ok ? 'Gekopieerd' : 'Kopiëren mislukt'; return;
  }
  if (action === 'remove-reply') { delete state.replyDrafts[state.selected]; persist(); render(); return; }
  const message = (state.messages[state.selected] || []).find(item => item.id === target.dataset.id);
  if (action === 'reply-message' && ['bot', 'user'].includes(message?.role)) {
    state.replyDrafts[state.selected] = { messageId: message.id, text: message.text, title: message.text.match(/^#{1,6}\s+(.+)$/m)?.[1] || message.text.split('\n')[0].slice(0, 80) || 'Bericht' };
    persist(); render(); document.querySelector('#message-input')?.focus();
  }
  if (['confirm-question', 'skip-question'].includes(action) && message?.question?.status === 'open') {
    const question = message.question;
    if (action === 'confirm-question' && !question.options.includes(question.selected)) return;
    question.status = action === 'confirm-question' ? 'confirmed' : 'skipped'; persist(); render();
  }
}

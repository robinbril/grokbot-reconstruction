import {normalizeComposerDocument,projectComposerDocument} from './composer-document.js';
import {quoteLabel,quoteDescription} from './composer-quote.js';
import {mentionDisplayLabel,mentionGlyphName} from './composer-mentions.js';
import {iconsReady,iconSvg} from './icon-library.js';
import {renderTodoReference} from './composer-todo-view.js';
import {renderMcpReference} from './composer-mcp-view.js';

// Presentation only: never load icon URLs or interpret instructions and HTML.
export function renderComposerDocument(message,esc,{resolveMentionMember=()=>undefined,renderMentionAvatar=()=>''}={}){
 if(message?.richText===undefined)return null;
 const references=Array.isArray(message.skillReferences)?message.skillReferences:[];
 try{normalizeComposerDocument(message.richText,{text:message.text,references});}catch{return null;}
 const document=JSON.parse(message.richText),byId=new Map(references.map(reference=>[reference.id,reference]));
 const marked=(node,value)=>{
  const href=node.marks?.find(mark=>mark.type==='link')?.attrs.href;
  return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${value}</a>`:value;
 };
 const inline=node=>{
  if(node.type==='text')return marked(node,esc(node.text).replace(/\n/g,'<br>'));
  if(node.type==='hardBreak')return marked(node,'<br>');
  if(node.type==='canvasReference')return '';
  if(node.type==='canvasSelection'){const {label,sourceFile}=node.attrs;if(typeof label!=='string'||!label.length)return '';const title=typeof sourceFile==='string'?`${label} (${sourceFile})`:label;return `<span class="inline-canvas-selection" data-type="canvas-selection" title="${esc(title)}"><span class="canvas-selection-icon" aria-hidden="true">${iconsReady()?iconSvg('pointer-arrow',{size:12}):''}</span><span class="canvas-selection-label">${esc(label)}</span></span>`;}
  if(node.type==='mention'){
   const {id}=node.attrs,member=resolveMentionMember(id),label=mentionDisplayLabel(node.attrs,member),tag=member?'button':'span';
   const behavior=member?` type="button" data-action="select-agent" data-id="${esc(member.id)}"`:'';
   const glyphName=mentionGlyphName(node.attrs,member),glyph=glyphName?`<span class="mention-glyph" aria-hidden="true">${iconsReady()?iconSvg(glyphName,{size:14}):''}</span>`:renderMentionAvatar(member);
   const rendered=`<${tag} class="inline-mention-reference" data-inline-mention="${esc(id??'')}" title="${esc(label)}"${behavior}>${glyph}<span class="mention-label">${esc(label)}</span></${tag}>`;
   return member?rendered:marked(node,rendered);
  }
  if(node.type==='todoReference')return renderTodoReference(node.attrs,esc);
  if(node.type==='quoteReference'){
   const label=quoteDescription(node.attrs.quote);
   return marked(node,`<span class="inline-quote-reference" data-inline-quote title="${esc(label)}" aria-label="${esc(label)}">${esc(quoteLabel(node.attrs.quote))}</span>`);
  }
  const mcp=renderMcpReference(node.attrs,esc);if(mcp)return mcp;
  const {id,label}=node.attrs,reference=byId.get(id);
  const name=label+(Number.isSafeInteger(reference.revision)&&reference.revision>0?` · Versie ${reference.revision}`:'');
  return marked(node,`<span class="inline-skill-reference" role="img" data-inline-skill-id="${esc(id)}" title="${esc(name)}" aria-label="${esc(name)}">@${esc(label)}</span>`);
 };
 const block=node=>{
  if(node.type==='paragraph')return `<p>${(node.content??[]).map(inline).join('')}</p>`;
  const tag=node.type==='orderedList'?'ol':'ul',start=tag==='ol'?` start="${node.attrs?.start??1}"`:'';
  const type=tag==='ol'&&node.attrs?.type?` type="${esc(node.attrs.type)}"`:'';
  return `<${tag}${start}${type}>${node.content.map(item=>`<li>${item.content.map(block).join('')}</li>`).join('')}</${tag}>`;
 };
 if(document.content.some(node=>node.type!=='paragraph'))return `<div class="composer-document" data-composer-document>${document.content.map(block).join('')}</div>`;
 const separator=projectComposerDocument(document)===message.text?'<br><br>':'<br>';
 const content=document.content.map(paragraph=>(paragraph.content||[]).map(inline).join('')).join(separator);
 return `<span class="composer-document" data-composer-document>${content}</span>`;
}

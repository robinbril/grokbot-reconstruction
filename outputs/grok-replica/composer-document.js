import {validCanvasSourceFile,parseCanvasSelection,canvasSelectionProjection} from './composer-canvas-selection.js';
// Presentation metadata only. Skill authority remains the immutable registry reference.
import {normalizeCanvasReferenceAttrs} from './composer-canvas-reference.js';
import {todoProjection} from './composer-todo.js';
import {quoteProjection} from './composer-quote.js';
import {mcpReferenceServerId} from './composer-mcp-reference.js';
const invalid=()=>new Error('Invalid composer document or text/reference binding');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const closed=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!value.includes('\0');
const linkHref=node=>node.marks?.find(mark=>mark.type==='link')?.attrs.href;

// Native Tiptap URI policy, including relative references. Strip invisible
// whitespace before checking the scheme so obfuscation cannot create script URLs.
export function composerLinkAllowed(href){
 if(!bounded(href,8192))return false;
 const clean=href.replace(/[\s\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060\ufeff]/gu,'');
 return /^(?:(?:https?|ftps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z0-9+.-]+(?:[^a-z+.-:]|$))/iu.test(clean);
}
function validateMarks(marks){
 if(marks===undefined)return;
 if(!Array.isArray(marks)||marks.length>1)throw invalid();
 for(const mark of marks){
  if(!closed(mark,['type','attrs'])||mark.type!=='link'||!closed(mark.attrs,['href','target','rel','class'])||!composerLinkAllowed(mark.attrs.href))throw invalid();
  for(const key of ['target','rel','class'])if(mark.attrs[key]!==undefined&&mark.attrs[key]!==null&&(!bounded(mark.attrs[key],2048)&&mark.attrs[key]!==''))throw invalid();
 }
}
function validateInline(node,identities,budget){
 if(++budget.nodes>4096||!object(node))throw invalid();
 if(node.type==='text'){
  if(!closed(node,['type','text','marks'])||!bounded(node.text,262144))throw invalid();
  validateMarks(node.marks);return;
 }
 if(node.type==='hardBreak'){
  if(!closed(node,['type','marks']))throw invalid();validateMarks(node.marks);return;
 }
 if(node.type==='mention'){
  if(!closed(node,['type','attrs','marks'])||!closed(node.attrs,['id','label','mentionSuggestionChar']))throw invalid();
  for(const key of ['id','label'])if(node.attrs[key]!==undefined&&node.attrs[key]!==null&&(typeof node.attrs[key]!=='string'||node.attrs[key].length>256||node.attrs[key].includes('\0')))throw invalid();
  if(node.attrs.mentionSuggestionChar!==undefined&&node.attrs.mentionSuggestionChar!=='@')throw invalid();
  validateMarks(node.marks);return;
 }
 if(node.type==='canvasSelection'){
  if(!closed(node,['type','attrs','marks'])||!closed(node.attrs,['canvasId','sourceFile','label','selection']))throw invalid();
  for(const key of ['canvasId','sourceFile','label','selection'])if(node.attrs[key]!=null&&(typeof node.attrs[key]!=='string'||node.attrs[key].length>(key==='selection'?196608:key==='label'?2048:256)))throw invalid();
  if(node.attrs.canvasId!=null&&!normalizeCanvasReferenceAttrs({canvasId:node.attrs.canvasId})||node.attrs.sourceFile!=null&&!validCanvasSourceFile(node.attrs.sourceFile)||node.attrs.selection!=null&&!parseCanvasSelection(node.attrs.selection))throw invalid();
  validateMarks(node.marks);return;
 }
 if(node.type==='canvasReference'){
  if(!closed(node,['type','attrs','marks'])||!closed(node.attrs,['canvasId','storeId','title']))throw invalid();
  for(const key of ['canvasId','storeId','title'])if(node.attrs[key]!=null&&(typeof node.attrs[key]!=='string'||node.attrs[key].length>(key==='title'?2048:256)||key!=='title'&&node.attrs[key].includes('\0')))throw invalid();
  if(node.attrs.canvasId!=null&&!normalizeCanvasReferenceAttrs(node.attrs))throw invalid();
  validateMarks(node.marks);return;
 }
 if(node.type==='todoReference'){
  if(!closed(node,['type','attrs','marks'])||!closed(node.attrs,['id','label','status']))throw invalid();
  for(const key of ['id','label','status'])if(node.attrs[key]!=null&&(typeof node.attrs[key]!=='string'||node.attrs[key].length>(key==='label'?2048:256)||node.attrs[key].includes('\0')))throw invalid();
  validateMarks(node.marks);return;
 }
 if(node.type==='quoteReference'){
  if(!closed(node,['type','attrs','marks'])||!closed(node.attrs,['quote'])||node.attrs.quote!==undefined&&node.attrs.quote!==null&&(typeof node.attrs.quote!=='string'||node.attrs.quote.length>20400||node.attrs.quote.includes('\0')))throw invalid();
  validateMarks(node.marks);return;
 }
 if(node.type!=='workflowReference'||!closed(node,['type','attrs','marks']))throw invalid();
 validateMarks(node.marks);
 const attrs=node.attrs;
 if(!closed(attrs,['id','label','iconId','iconUrl'])||!bounded(attrs.id,256))throw invalid();
 if(attrs.id.startsWith('mcp:')){
  if(mcpReferenceServerId(attrs.id)===null||attrs.label!=null&&(typeof attrs.label!=='string'||attrs.label.length>256||/[\0\r\n]/u.test(attrs.label)))throw invalid();
 }else {
  if(!bounded(attrs.label,256)||/[\r\n]/u.test(attrs.label))throw invalid();identities.add(attrs.id);
 }
 for(const key of ['iconId','iconUrl'])if(attrs[key]!==undefined&&attrs[key]!==null&&!bounded(attrs[key],2048))throw invalid();
}
function validateBlock(node,identities,budget,depth=0){
 if(depth>32||++budget.nodes>4096||!object(node))throw invalid();
 if(node.type==='paragraph'){
  if(!closed(node,['type','content'])||node.content!==undefined&&!Array.isArray(node.content))throw invalid();
  for(const child of node.content??[])validateInline(child,identities,budget);return;
 }
 if(!['bulletList','orderedList'].includes(node.type)||!closed(node,['type','content',...(node.type==='orderedList'?['attrs']:[])])||!Array.isArray(node.content)||!node.content.length)throw invalid();
 if(node.attrs!==undefined){
  if(!closed(node.attrs,['start','type'])||node.attrs.start!==undefined&&!Number.isSafeInteger(node.attrs.start)||node.attrs.type!==undefined&&node.attrs.type!==null&&!bounded(node.attrs.type,32))throw invalid();
 }
 for(const item of node.content){
  if(++budget.nodes>4096||!closed(item,['type','content'])||item.type!=='listItem'||!Array.isArray(item.content)||item.content[0]?.type!=='paragraph')throw invalid();
  for(const child of item.content)validateBlock(child,identities,budget,depth+1);
 }
}
function inlineProjection(nodes){
 return nodes.map((node,index)=>{
  if(node.type==='hardBreak')return '\n';
  if(node.type==='canvasReference')return '';
  if(node.type==='canvasSelection')return canvasSelectionProjection(node.attrs.label);
  if(node.type==='workflowReference')return `@${node.attrs.label??''}`;
  if(node.type==='mention')return `@${node.attrs.label??node.attrs.id??''}`;
  if(node.type==='quoteReference')return quoteProjection(node.attrs.quote);
  if(node.type==='todoReference')return todoProjection(node.attrs.label);
  const href=linkHref(node),value=node.text;
  if(!href||href===value.trim()||['https://','http://','mailto:'].some(prefix=>href===prefix+value.trim())||linkHref(nodes[index+1]??{})===href)return value;
  return `${value} (${href})`;
 }).join('');
}
function blockProjection(node,separator){
 if(node.type==='paragraph')return inlineProjection(node.content??[]);
 const start=node.attrs?.start??1;
 return node.content.map((item,index)=>{
  const marker=node.type==='orderedList'?`${start+index}. `:'- ';
  const content=item.content.map(child=>blockProjection(child,'\n')).join('\n');
  return marker+content.replaceAll('\n','\n'+' '.repeat(marker.length));
 }).join('\n');
}
/** Native submit/onUpdate projection. Call on a validated schema-shaped doc. */
export function projectComposerDocument(document,{blockSeparator='\n\n'}={}){
 return document.content.map(node=>blockProjection(node,blockSeparator)).join(blockSeparator);
}
const legacyShape=document=>document.content.every(node=>node.type==='paragraph'&&(node.content??[]).every(child=>['text','hardBreak','workflowReference'].includes(child.type)&&child.marks===undefined));

/** Validate schema and text binding while retaining original durable intent bytes. */
export function normalizeComposerDocument(richText,{text,references=[]}={}){
 if(richText===undefined)return undefined;
 if(typeof richText!=='string'||richText.length>262144||typeof text!=='string'||text.length>262144||!Array.isArray(references)||references.length>50)throw invalid();
 let document;try{document=JSON.parse(richText);}catch{throw invalid();}
 if(!closed(document,['type','content'])||document.type!=='doc'||!Array.isArray(document.content)||document.content.length<1||document.content.length>4096)throw invalid();
 const identities=new Set(),budget={nodes:1};
 for(const node of document.content)validateBlock(node,identities,budget);
 const projected=projectComposerDocument(document);
 const legacy=legacyShape(document)&&projectComposerDocument(document,{blockSeparator:'\n'})===text;
 const selected=new Set();
 for(const reference of references){
  if(!object(reference)||!bounded(reference.id,256)||reference.id.startsWith('mcp:')||selected.has(reference.id))throw invalid();
  selected.add(reference.id);
 }
 if(projected!==text&&!legacy||selected.size!==identities.size||[...selected].some(id=>!identities.has(id)))throw invalid();
 // Keep bytes stable: changing serializer whitespace must not alter a durable intent.
 return richText;
}

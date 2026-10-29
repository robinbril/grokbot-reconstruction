import {canvasSelectionAttrs,canvasSelectionProjection} from './composer-canvas-selection.js';
import {Editor,Node,Link,Extension,wrappingInputRule,PasteRule,EditorState,TextSelection,Slice,ProseMirrorDOMParser,history,undo,redo,closeHistory,splitListItem,sinkListItem,liftListItem} from './assets/vendor/composer/tiptap.js';
import {normalizeComposerDocument,projectComposerDocument,composerLinkAllowed} from './composer-document.js';
import {quoteProjection,quoteLabel,quoteDescription} from './composer-quote.js';
import {todoProjection,todoLabel,todoStatus} from './composer-todo.js';
import {todoGlyph} from './composer-todo-view.js';
import {iconsReady,fetchIconData,iconSvg} from './icon-library.js';
import {avatarMarkup} from './avatar-motion.js';
import {mentionDisplayLabel,mentionGlyphName} from './composer-mentions.js';
import {mcpReferenceServerId} from './composer-mcp-reference.js';
import {populateMcpChip} from './composer-mcp-view.js';
import {canvasReferenceNode,canvasSelectionNode,hasCanvasReference,canvasReferenceOnlyParagraph} from './composer-canvas-node.js';
const MIME='application/x-grok-composer-fragment+json';
const clone=value=>structuredClone(value);
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const referenceKey=ref=>JSON.stringify([ref.id,ref.revision??null]);
const plainDocument=text=>({type:'doc',content:[{type:'paragraph',content:String(text).split('\n').flatMap((line,index)=>[...(index?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])}]});
const linkHref=node=>node.marks.find(mark=>mark.type.name==='link')?.attrs.href;
const equivalentLink=(text,href)=>[text.trim(),`https://${text.trim()}`,`http://${text.trim()}`,`mailto:${text.trim()}`].includes(href);
const safeHref=composerLinkAllowed;

// Each projected character carries its actual ProseMirror boundary. List markers
// and link suffixes are virtual prompt text and map to the adjoining real caret.
function documentIndex(doc){
 const atoms=[];
 const literal=(value,position)=>Array.from({length:value.length},(_,index)=>({char:value[index],position}));
 function inline(node,from,parent,index){
  if(node.isText){
   const result=Array.from({length:node.text.length},(_,i)=>({char:node.text[i],position:from+i+1})),href=linkHref(node);
   if(href&&!equivalentLink(node.text,href)&&linkHref(parent.maybeChild(index+1)??{marks:[]})!==href)result.push(...literal(` (${href})`,from+node.nodeSize));
   return result;
  }
  if(node.type.name==='hardBreak')return [{char:'\n',position:from+1}];
  if(node.type.name==='canvasReference')return [];
  const atom={node,from,to:from+node.nodeSize},value=node.type.name==='quoteReference'?quoteProjection(node.attrs.quote):node.type.name==='todoReference'?todoProjection(node.attrs.label):node.type.name==='canvasSelection'?canvasSelectionProjection(node.attrs.label):`@${node.attrs.label??(node.type.name==='mention'?node.attrs.id:'')??''}`;atoms.push(atom);
  return Array.from({length:value.length},(_,index)=>({char:value[index],position:index===value.length-1?atom.to:null,atom}));
 }
 const contentStart=(node,from)=>node.isTextblock?from+1:node.firstChild?contentStart(node.firstChild,from+1):from;
 const join=(parts,separator,positions)=>parts.flatMap((part,index)=>[...(index?literal(separator,positions[index]):[]),...part]);
 function block(node,from,separator='\n\n'){
  if(node.isTextblock){const result=[];node.forEach((child,offset,index)=>result.push(...inline(child,from+1+offset,node,index)));return result;}
  const children=[];node.forEach((child,offset)=>children.push({node:child,from:from+1+offset}));
  if(node.type.name==='bulletList'||node.type.name==='orderedList'){
   return join(children.map((item,index)=>{
    const marker=node.type.name==='orderedList'?`${node.attrs.start+index}. `:'- ',content=block(item.node,item.from,'\n');
    const result=literal(marker,item.from+2);
    for(const token of content){result.push(token);if(token.char==='\n')result.push(...literal(' '.repeat(marker.length),token.position));}
    return result;
   }),'\n',children.map(item=>contentStart(item.node,item.from)));
  }
  return join(children.map(child=>block(child.node,child.from)),separator,children.map(child=>contentStart(child.node,child.from)));
 }
 const tokens=[];doc.forEach((node,offset,index)=>{if(index)tokens.push(...literal('\n\n',contentStart(node,offset)));tokens.push(...block(node,offset));});
 const first=doc.firstChild;let beginning=first?1:0;while(doc.nodeAt(beginning)&&!doc.nodeAt(beginning).isInline&&beginning<doc.content.size)beginning++;
 const text=tokens.map(token=>token.char).join(''),boundaries=[beginning,...tokens.map(token=>token.position)];
 for(const atom of atoms){atom.start=tokens.findIndex(token=>token.atom===atom);atom.end=tokens.findLastIndex(token=>token.atom===atom)+1;}
 const offsetAt=position=>{let result=0;for(let i=0;i<boundaries.length;i++){if(boundaries[i]===null)continue;if(boundaries[i]>position)break;result=i;}return result;};
 const positionAt=(offset,bias=1)=>{
  const index=Math.min(text.length,Math.max(0,Math.trunc(offset)||0));
  if(boundaries[index]!==null)return boundaries[index];
  const atom=atoms.find(item=>item.start<index&&item.end>index);return bias<0?atom.from:atom.to;
 };
 return {text,atoms,boundaries,offsetAt,positionAt};
}

// Native macOS Emacs motion uses logical hard-break lines, not visual wraps.
function macLineMotion(view,event){
 if(!/mac/i.test(navigator.platform)||!event.ctrlKey||event.metaKey||event.altKey)return false;
 const key=event.key.toLowerCase();if(key!=='a'&&key!=='e')return false;
 const {selection}=view.state,head=selection.$head;if(!head.parent.isTextblock)return false;
 let offset=key==='a'?0:head.parent.content.size,found=false;
 head.parent.forEach((node,start)=>{
  if(node.type.name!=='hardBreak')return;
  if(key==='a'&&start+node.nodeSize<=head.parentOffset)offset=start+node.nodeSize;
  else if(key==='e'&&!found&&start>=head.parentOffset){offset=start;found=true;}
 });
 const destination=head.start()+offset,anchor=event.shiftKey?selection.anchor:destination;
 view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,anchor,destination)).scrollIntoView());return true;
}
function plainPasteShortcut(event){
 return !event.isComposing&&event.keyCode!==229&&(event.metaKey||event.ctrlKey)&&event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='v';
}

// Native image data URLs become ordinary staged Files, never editor nodes.
function imageClipboardFile(value){
 const match=/^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]*)$/i.exec(value.trim());
 if(!match)return null;
 const subtype=match[1].toLowerCase(),encoded=match[2].replace(/\s+/gu,'');
 if(!encoded.length||encoded.length%4!==0)return null;
 const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
 if(!/^[A-Za-z0-9+/]*$/u.test(encoded.slice(0,encoded.length-padding)))return null;
 const decoded=atob(encoded),bytes=Uint8Array.from(decoded,character=>character.charCodeAt(0));
 const extensions=new Map([['jpeg','jpg'],['svg+xml','svg'],['x-icon','ico'],['vnd.microsoft.icon','ico']]);
 const extension=extensions.get(subtype)??subtype.replace(/\+.*$/u,'');
 return new File([bytes],`pasted-image.${extension}`,{type:`image/${subtype}`});
}
function stageClipboardImage(view,value){
 const file=imageClipboardFile(value);if(!file)return false;
 const data=new DataTransfer();data.items.add(file);
 view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));return true;
}

function listNodes(){
 const bullet=Node.create({name:'bulletList',group:'block list',content:'listItem+',parseHTML:()=>[{tag:'ul'}],renderHTML:()=>['ul',0],
  addInputRules(){return [wrappingInputRule({find:/^\s*([-+*])\s$/,type:this.type})];}});
 const ordered=Node.create({name:'orderedList',group:'block list',content:'listItem+',
  addAttributes:()=>({start:{default:1,parseHTML:element=>element.hasAttribute('start')?parseInt(element.getAttribute('start')||'',10):1},type:{default:null}}),
  parseHTML:()=>[{tag:'ol'}],renderHTML:({node})=>['ol',{...(node.attrs.start!==1?{start:node.attrs.start}:{}),...(node.attrs.type?{type:node.attrs.type}:{})},0],
  addInputRules(){return [wrappingInputRule({find:/^(\d+)\.\s$/,type:this.type,getAttributes:match=>({start:Number(match[1])}),joinPredicate:(match,node)=>node.childCount+node.attrs.start===Number(match[1])})];}});
 const item=Node.create({name:'listItem',content:'paragraph block*',defining:true,parseHTML:()=>[{tag:'li'}],renderHTML:()=>['li',0]});
 return [bullet,ordered,item];
}

function linkMark(){
 const eligible=/\.\p{L}|\w:\S|localhost/iu;
 return Link.extend({inclusive:()=>false,addAttributes(){const attributes=this.parent?.()??{};delete attributes.title;return attributes;},addPasteRules(){
  return (this.parent?.()??[]).map(rule=>typeof rule.find==='function'?new PasteRule({find:(text,event)=>eligible.test(text)?rule.find(text,event):[],handler:rule.handler}):rule);
 }}).configure({openOnClick:false,defaultProtocol:'https',shouldAutoLink:()=>true,isAllowedUri:href=>safeHref(href)});
}

function quoteNode(){
 return Node.create({name:'quoteReference',group:'inline',inline:true,atom:true,selectable:true,
  addAttributes:()=>({quote:{default:null,parseHTML:element=>element.getAttribute('data-quote')}}),
  parseHTML:()=>[{tag:'span[data-type="quote-reference"][data-quote]'}],
  renderHTML:({node})=>['span',{'data-type':'quote-reference','data-quote':node.attrs.quote,class:'composer-inline-quote',contenteditable:'false'},quoteLabel(node.attrs.quote)],
  renderText:({node})=>quoteProjection(node.attrs.quote),
  addNodeView:()=>({node})=>{
   const dom=document.createElement('span');dom.className='composer-inline-quote';dom.dataset.type='quote-reference';if(typeof node.attrs.quote==='string')dom.dataset.quote=node.attrs.quote;
   dom.contentEditable='false';dom.title=quoteDescription(node.attrs.quote);
   const glyph=document.createElement('span'),label=document.createElement('span');glyph.className='composer-quote-icon';glyph.setAttribute('aria-hidden','true');label.className='composer-quote-label';label.textContent=quoteLabel(node.attrs.quote);dom.append(glyph,label);
   let alive=true;const draw=()=>{if(alive)glyph.innerHTML=iconSvg('chat-bubble-ellipsis',{size:14});};
   if(iconsReady())draw();else void fetchIconData().then(draw,()=>{});
   dom.setAttribute('aria-label',dom.title);dom.setAttribute('role','img');return {dom,destroy(){alive=false;}};
  }
 });
}

function todoNode(){
 return Node.create({name:'todoReference',group:'inline',inline:true,atom:true,selectable:true,
  addAttributes:()=>Object.fromEntries(['id','label','status'].map(key=>[key,{default:null,parseHTML:element=>element.getAttribute('data-'+key),renderHTML:attrs=>typeof attrs[key]==='string'?{['data-'+key]:attrs[key]}:{}}])),
  parseHTML:()=>[{tag:'span[data-type="todo-reference"][data-label]'}],
  renderHTML:({node,HTMLAttributes})=>['span',{'data-type':'todo-reference',...HTMLAttributes},todoProjection(node.attrs.label)],
  renderText:({node})=>todoProjection(node.attrs.label),
  addNodeView:()=>({node})=>{
   const dom=document.createElement('span');dom.contentEditable='false';
   if(typeof node.attrs.label!=='string'||!node.attrs.label.length)return {dom};
   dom.className='composer-inline-todo';dom.dataset.type='todo-reference';dom.title=node.attrs.label;
   const status=todoStatus(node.attrs.status);if(status)dom.dataset.todoStatus=status;
   const glyph=document.createElement('span'),label=document.createElement('span');glyph.className='todo-reference-glyph';glyph.setAttribute('aria-hidden','true');label.className='todo-reference-label';label.textContent=todoLabel(node.attrs.label);dom.append(glyph,label);
   let alive=true;const draw=()=>{if(alive)glyph.innerHTML=todoGlyph(status);};
   if(iconsReady())draw();else void fetchIconData().then(draw,()=>{});
   return {dom,destroy(){alive=false;}};
  }
 });
}

function mentionNode(resolveMember){
 return Node.create({name:'mention',priority:101,group:'inline',inline:true,atom:true,selectable:true,
  addAttributes:()=>({id:{default:null},label:{default:null},mentionSuggestionChar:{default:'@'}}),
  parseHTML:()=>[{tag:'span[data-type="mention"][data-id]'}],
  renderHTML:({node})=>['span',{'data-type':'mention','data-id':node.attrs.id,'data-label':node.attrs.label,class:'composer-inline-mention',contenteditable:'false'},`@${node.attrs.label??node.attrs.id??''}`],
  renderText:({node})=>`@${node.attrs.label??node.attrs.id??''}`,
  addNodeView:()=>({node})=>{
   const dom=document.createElement('span'),glyph=document.createElement('span'),label=document.createElement('span'),member=resolveMember(node.attrs.id);
   dom.className='composer-inline-mention';dom.dataset.type='mention';dom.dataset.id=node.attrs.id??'';dom.dataset.label=node.attrs.label??'';dom.contentEditable='false';
   glyph.className='mention-glyph';glyph.setAttribute('aria-hidden','true');const glyphName=mentionGlyphName(node.attrs,member);let alive=true;
   const draw=()=>{if(alive)glyph.innerHTML=glyphName?iconSvg(glyphName,{size:14}):avatarMarkup(member,'static');};
   if(!glyphName||iconsReady())draw();else void fetchIconData().then(draw,()=>{});
   label.className='mention-label';label.textContent=mentionDisplayLabel(node.attrs,member,{prompt:true});dom.append(glyph,label);
   dom.title=`@${node.attrs.label??node.attrs.id??''}`;dom.setAttribute('aria-label',dom.title);return {dom,destroy(){alive=false;}};
  },
  addKeyboardShortcuts(){return {Backspace:()=>this.editor.commands.command(({state,tr,dispatch})=>{
   if(!state.selection.empty)return false;
   const before=state.selection.$from.nodeBefore;if(before?.type.name!=='mention')return false;
   if(dispatch)tr.insertText(before.attrs.mentionSuggestionChar??'@',state.selection.from-before.nodeSize,state.selection.from);return true;
  })};}
 });
}

function schemaExtensions(nodeReferences,referenceCache,resolveMentionMember){
 const doc=Node.create({name:'doc',topNode:true,content:'block+'});
 const paragraph=Node.create({name:'paragraph',group:'block',content:'inline*',parseHTML:()=>[{tag:'p'}],renderHTML:()=>['p',0]});
 const text=Node.create({name:'text',group:'inline'});
 const hardBreak=Node.create({name:'hardBreak',group:'inline',inline:true,selectable:false,parseHTML:()=>[{tag:'br'}],renderHTML:()=>['br'],renderText:()=> '\n'});
 const workflow=Node.create({name:'workflowReference',group:'inline',inline:true,atom:true,selectable:true,
  addAttributes:()=>Object.fromEntries(['id','label','iconId','iconUrl'].map(name=>[name,{default:null,parseHTML:element=>element.getAttribute(`data-${name.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())}`)}])),
  parseHTML:()=>[{tag:'span[data-type="skill-reference"][data-id]'},{tag:'span[data-type="workflow-reference"][data-id]'}],
  renderHTML:({node})=>['span',{'data-type':'skill-reference','data-id':node.attrs.id,'data-label':node.attrs.label,class:'composer-inline-skill',contenteditable:'false'},`@${node.attrs.label??''}`],
  renderText:({node})=>`@${node.attrs.label??''}`,
  addNodeView:()=>({node})=>{
   const dom=document.createElement('span');if(mcpReferenceServerId(node.attrs.id))return {dom:populateMcpChip(dom,node.attrs)};
   const ref=nodeReferences.get(node)??[...referenceCache.values()].find(item=>item.id===node.attrs.id);
   dom.className='composer-inline-skill';dom.dataset.type='skill-reference';dom.dataset.id=node.attrs.id;dom.dataset.label=node.attrs.label;
   dom.contentEditable='false';dom.textContent=`@${node.attrs.label??''}`;
   dom.title=node.attrs.label+(ref?.revision?` · Versie ${ref.revision}`:'');dom.setAttribute('aria-label',dom.title);dom.setAttribute('role','img');
   return {dom};
  }
 });
 const editing=Extension.create({name:'composerEditing',addProseMirrorPlugins:()=>[history({newGroupDelay:100})],addKeyboardShortcuts(){
  const first=names=>this.editor.commands.first(({commands})=>names.map(name=>()=>commands[name]()));
  return {'Mod-z':()=>undo(this.editor.state,this.editor.view.dispatch),'Mod-Shift-z':()=>redo(this.editor.state,this.editor.view.dispatch),'Mod-y':()=>redo(this.editor.state,this.editor.view.dispatch),
   Backspace:()=>first(['deleteSelection','joinBackward','selectNodeBackward']),Delete:()=>first(['deleteSelection','joinForward','selectNodeForward']),'Mod-a':()=>this.editor.commands.selectAll()};
 }});
 return [doc,paragraph,text,hardBreak,workflow,quoteNode(),todoNode(),canvasReferenceNode(),canvasSelectionNode(),mentionNode(resolveMentionMember),...listNodes(),linkMark(),editing];
}

/** One owner for selection, inline identity, IME, clipboard and persisted edits. */
export function mountComposerEditor(host,{snapshot={text:'',references:[]},onChange=()=>true,onUnsaved=()=>false,queueOnShiftEnter=()=>false,resolveMentionMember=()=>undefined}={}){
 if(!host?.ownerDocument)throw Error('Composer editor needs a DOM host');
 const nodeReferences=new WeakMap(),referenceCache=new Map();let editor,acceptedState,acceptedSnapshot,applying=false,destroyed=false,lastError='',emojiHandlers=null,mentionHandlers=null,atomicEditing=false;
 const referencesIn=doc=>{
  const selected=new Map();
  for(const {node} of documentIndex(doc).atoms){
   if(node.type.name!=='workflowReference'||mcpReferenceServerId(node.attrs.id))continue;
   const ref=nodeReferences.get(node);if(!ref)throw Error('Unknown skill reference');
   const old=selected.get(ref.id);if(old&&referenceKey(old)!==referenceKey(ref))throw Error('Conflicting skill revisions');
   selected.set(ref.id,ref);
  }
  return [...selected.values()].map(clone);
 };
 const serialize=doc=>{
  const index=documentIndex(doc),references=referencesIn(doc),richText=index.text||hasCanvasReference(doc)?JSON.stringify(doc.toJSON()):undefined;
  if(projectComposerDocument(doc.toJSON())!==index.text)throw Error('Composer projection mismatch');
  normalizeComposerDocument(richText,{text:index.text,references});
  return {text:index.text,...(richText!==undefined?{richText}:{}),references};
 };
 function prepare(input){
  const text=typeof input.text==='string'?input.text:'',references=clone(input.references||[]);
  normalizeComposerDocument(input.richText,{text,references});
  let document=input.richText!==undefined?JSON.parse(input.richText):plainDocument(text);
  const migrated=input.richText===undefined&&references.length>0;
  if(migrated){
   const content=document.content.at(-1).content??=[];
   for(const ref of references){if(content.length)content.push({type:'text',text:' '});content.push({type:'workflowReference',attrs:{id:ref.id,label:ref.label,iconId:null,iconUrl:null}});}
  }
  const node=editor.schema.nodeFromJSON(document),byId=new Map(references.map(ref=>[ref.id,ref]));
  node.descendants(child=>{if(child.type.name==='workflowReference'&&!mcpReferenceServerId(child.attrs.id)){const ref=byId.get(child.attrs.id);if(!ref)throw Error('Missing skill metadata');nodeReferences.set(child,ref);referenceCache.set(referenceKey(ref),ref);}});
  const proposed=serialize(node);
  return {node,snapshot:migrated?proposed:{text,...(input.richText!==undefined?{richText:input.richText}:{}),references},migrated};
 }
 function commitTransaction({transaction}){
  if(applying||destroyed||!acceptedState)return;
  if(!transaction.docChanged){acceptedState=editor.state;emojiHandlers?.transaction?.(transactionContext(transaction));mentionHandlers?.transaction?.();return;}
  let candidate,persisted=true;
  try{candidate=serialize(editor.state.doc);if(onChange(clone(candidate))!==true)throw Error('Concept niet opgeslagen.');}
  catch(error){
   lastError=error.message;editor.view.dom.dataset.composerPersistenceError='';
   if(!candidate||atomicEditing||onUnsaved(clone(candidate))!==true){applying=true;editor.view.updateState(acceptedState);applying=false;return;}
   persisted=false;
  }
  acceptedState=editor.state;acceptedSnapshot=candidate;emojiHandlers?.transaction?.(transactionContext(transaction));mentionHandlers?.transaction?.();editor.view.dom.dataset.composerEmpty=String(!candidate.text);
  if(persisted){lastError='';delete editor.view.dom.dataset.composerPersistenceError;}
  editor.view.dom.dispatchEvent(new Event('input',{bubbles:true}));
 }
 // Public commands promise durable, all-or-none edits. Native typing, clipboard
 // and undo transactions may instead retain an explicitly warned volatile draft.
 const atomic=command=>(...args)=>{const previous=atomicEditing;atomicEditing=true;try{return command(...args);}finally{atomicEditing=previous;}};
 function transactionContext(transaction){
  const before=documentIndex(transaction.before),after=documentIndex(editor.state.doc);
  return {docChanged:transaction.docChanged,selection:getSelection(),mapRange(range){
   let from=before.positionAt(range.start,-1),to=before.positionAt(range.end,1),valid=true;
   for(const map of transaction.mapping.maps){
    map.forEach((start,end)=>{if(start<to&&end>from||start===end&&start>from&&start<to)valid=false;});
    from=map.map(from,1);to=map.map(to,-1);
   }
   return valid?{...range,start:after.offsetAt(from),end:after.offsetAt(to)}:null;
  },mapCaret(offset){return after.offsetAt(transaction.mapping.map(before.positionAt(offset,1),1));}};
 }
 function insertPlain(value){
  const normalized=String(value).replace(/\r\n?/g,'\n').replace(/\n$/u,'');
  const paragraphs=plainDocument(normalized).content,selection=editor.state.selection;
  const content=selection.empty&&canvasReferenceOnlyParagraph(selection.$from.parent)?paragraphs[0].content??[]:paragraphs;
  return editor.commands.insertContent(content,{parseOptions:{preserveWhitespace:'full'}});
 }
 function clipboard(event,cut=false){
  if(editor.state.selection.empty||!event.clipboardData)return false;
  const slice=editor.state.selection.content(),index=documentIndex(editor.state.doc),selection=getSelection();
  event.clipboardData.setData('text/plain',index.text.slice(selection.start,selection.end));
  const refs=[];
  slice.content.descendants(node=>{if(node.type.name==='workflowReference'&&!mcpReferenceServerId(node.attrs.id)){const ref=nodeReferences.get(node);if(ref&&!refs.some(item=>referenceKey(item)===referenceKey(ref)))refs.push({id:ref.id,...(ref.revision?{revision:ref.revision}:{})});}});
  event.clipboardData.setData(MIME,JSON.stringify({schema:1,slice:slice.toJSON(),references:refs}));event.preventDefault();
  if(cut)editor.commands.deleteSelection();return true;
 }
 function paste(event){
  if(!event.clipboardData||event.clipboardData.files?.length)return false;
  const plain=event.clipboardData.getData('text/plain'),html=event.clipboardData.getData('text/html');
  if(stageClipboardImage(editor.view,plain)){event.preventDefault();return true;}
  const encoded=event.clipboardData.getData(MIME);
  if(encoded&&encoded.length<=262144){
   try{
    const value=JSON.parse(encoded);if(value.schema!==1||!value.slice||!Array.isArray(value.slice.content)||!Array.isArray(value.references)||value.references.length>50)throw Error('Invalid clipboard');
    for(const depth of [value.slice.openStart??0,value.slice.openEnd??0])if(!Number.isSafeInteger(depth)||depth<0||depth>32)throw Error('Invalid clipboard depth');
    const refs=value.references.map(identity=>{const ref=referenceCache.get(referenceKey(identity));if(!ref)throw Error('Unknown clipboard skill');return ref;});
    const slice=Slice.fromJSON(editor.schema,value.slice),byId=new Map(refs.map(ref=>[ref.id,ref])),identities=new Set();
    slice.content.descendants(node=>{if(node.type.name==='workflowReference'&&!mcpReferenceServerId(node.attrs.id)){const ref=byId.get(node.attrs.id);if(!ref)throw Error('Unknown clipboard skill');identities.add(ref.id);nodeReferences.set(node,ref);}});
    if(identities.size!==refs.length)throw Error('Clipboard reference binding mismatch');
    const current=referencesIn(editor.state.doc);if(refs.some(ref=>current.some(item=>item.id===ref.id&&referenceKey(item)!==referenceKey(ref))))throw Error('Conflicting clipboard revision');
    // Open ancestors need not be valid standalone blocks. Fit the slice into the
    // actual selection first, then validate the complete resulting document.
    const transaction=editor.state.tr.replaceSelection(slice).scrollIntoView();serialize(transaction.doc);
    event.preventDefault();editor.view.dispatch(transaction);return true;
   }catch{/* Foreign/invalid clipboard content is literal text, never a skill. */}
  }
  if(/\.\p{L}|\w:\S|localhost/iu.test(plain)&&safeHref(plain.trim())&&!/\s/u.test(plain.trim())){
   if(!html)return false;
   const data=new DataTransfer();data.setData('text/plain',plain);event.preventDefault();
   editor.view.pasteText(plain,new ClipboardEvent('paste',{clipboardData:data}));return true;
  }
  if(html&&html.length<=262144){
   const parsed=new DOMParser().parseFromString(html,'text/html');
   for(const element of parsed.querySelectorAll('script,style,img,iframe,object,embed'))element.remove();
   for(const element of parsed.querySelectorAll('*'))for(const attribute of [...element.attributes])if(!['href','start','type'].includes(attribute.name))element.removeAttribute(attribute.name);
   const projectedHTML=parsed.body.cloneNode(true);for(const br of projectedHTML.querySelectorAll('br'))br.replaceWith('\n');
   const list=parsed.querySelector('li')&&!parsed.querySelector('pre'),linked=parsed.querySelector('a[href]')&&projectedHTML.textContent===plain;
   if(list||linked){event.preventDefault();const slice=ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(parsed.body,{preserveWhitespace:'full'});editor.view.dispatch(editor.state.tr.replaceSelection(slice).scrollIntoView());return true;}
  }
  event.preventDefault();insertPlain(plain);return true;
 }
 async function pastePlainFromClipboard(view){
  const clipboard=navigator.clipboard;if(!clipboard)return;
  let value;try{value=await clipboard.readText();}catch{return;}
  if(destroyed||!view.dom.isConnected||editor.view!==view||!value.length)return;
  if(stageClipboardImage(view,value))return;
  const data=new DataTransfer();data.setData('text/plain',value);
  const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
  if(view.dom.dispatchEvent(event))view.pasteText(value,event);
 }
 editor=new Editor({element:host,extensions:schemaExtensions(nodeReferences,referenceCache,resolveMentionMember),enableCoreExtensions:{keymap:false},content:plainDocument(''),injectCSS:false,
  editorProps:{attributes:{id:'message-input',class:'composer-editor',role:'textbox','aria-multiline':'true','aria-label':'Bericht sturen naar Bot','data-rich-composer':''},
   handleKeyDown:(view,event)=>{
    if(mentionHandlers?.keyDown?.(event))return true;
    if(emojiHandlers?.keyDown?.(event))return true;
    if(plainPasteShortcut(event)){if(!event.repeat)void pastePlainFromClipboard(view);return true;}
    if(macLineMotion(view,event))return true;
    if(event.key==='Tab'&&!event.isComposing){
     if(view.dom.getAttribute('aria-expanded')==='true')return false;
     const item=editor.schema.nodes.listItem,inList=Array.from({length:view.state.selection.$from.depth},(_,i)=>view.state.selection.$from.node(i+1)).some(node=>node.type===item);
     if(inList){(event.shiftKey?liftListItem(item):sinkListItem(item))(view.state,view.dispatch);return true;}
     if(!event.shiftKey){view.dispatch(view.state.tr.insertText('\t').scrollIntoView());return true;}
    }
    if(event.key!=='Enter'||!event.shiftKey||event.metaKey||event.ctrlKey||event.altKey||event.isComposing||event.keyCode===229||queueOnShiftEnter())return false;
    const item=editor.schema.nodes.listItem;
    if(splitListItem(item)(view.state,view.dispatch)||liftListItem(item)(view.state,view.dispatch))return true;
    view.dispatch(view.state.tr.replaceSelectionWith(editor.schema.nodes.hardBreak.create()).scrollIntoView());return true;
   },handleTextInput:(view,from,to,text)=>text===':'&&!view.composing&&emojiHandlers?.textInput?.(text,getEmojiQueryContext(from,to))===true,handlePaste:(_view,event)=>paste(event),handleDOMEvents:{blur:()=>{mentionHandlers?.blur?.();emojiHandlers?.blur?.();return false;},copy:(_view,event)=>clipboard(event),cut:(_view,event)=>clipboard(event,true)}},onTransaction:commitTransaction});
 function getSelection(){const index=documentIndex(editor.state.doc),selection=editor.state.selection;return {start:index.offsetAt(selection.from),end:index.offsetAt(selection.to),direction:selection.anchor>selection.head?'backward':'forward'};}
 function setSelection(start,end=start,direction='forward'){
  const index=documentIndex(editor.state.doc),from=index.positionAt(start,-1),to=index.positionAt(end,1);
  const selection=direction==='backward'?TextSelection.create(editor.state.doc,to,from):TextSelection.create(editor.state.doc,from,to);
  editor.view.dispatch(editor.state.tr.setSelection(selection));return true;
 }
 function restore(input,{resetHistory=false}={}){
  const candidate=prepare(input),same=acceptedSnapshot&&equal(candidate.snapshot,acceptedSnapshot);
  if(same&&!resetHistory)return true;
  if(candidate.migrated&&onChange(clone(candidate.snapshot))!==true)return false;
  applying=true;
  const doc=candidate.node,selection=TextSelection.atEnd(doc);
  // External restores never become undoable drafts. Accepted sends explicitly
  // reset all history; unchanged rerenders return above and keep it intact.
  if(resetHistory||!acceptedState||!equal(candidate.snapshot.references,acceptedSnapshot?.references))editor.view.updateState(EditorState.create({schema:editor.schema,doc,selection,plugins:editor.state.plugins}));
  else {const tr=editor.state.tr.replaceWith(0,editor.state.doc.content.size,doc.content);editor.view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)).setMeta('addToHistory',false));}
  acceptedState=editor.state;acceptedSnapshot=clone(candidate.snapshot);editor.view.dom.dataset.composerEmpty=String(!acceptedSnapshot.text);applying=false;lastError='';return true;
 }
 function replaceSuggestion(range,reference){
  const index=documentIndex(editor.state.doc);
  if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start||range.end>index.text.length||hasRangeAtoms(range.start,range.end))return false;
  const from=index.positionAt(range.start,-1),to=index.positionAt(range.end,1);let nodes=[];
  if(reference){
   const ref=clone(reference),current=referencesIn(editor.state.doc);
   if(current.some(item=>item.id===ref.id&&referenceKey(item)!==referenceKey(ref))){lastError='Verwijder eerst de andere versie van deze vaardigheid.';return false;}
   referenceCache.set(referenceKey(ref),ref);
   const atom=editor.schema.nodes.workflowReference.create({id:ref.id,label:ref.label,iconId:null,iconUrl:null});nodeReferences.set(atom,ref);nodes=[atom,editor.schema.text(' ')];
  }
  const old=acceptedSnapshot,tr=closeHistory(editor.state.tr).replaceWith(from,to,nodes);
  const cursor=from+nodes.reduce((size,node)=>size+node.nodeSize,0);editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc,cursor)).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));return acceptedSnapshot!==old;
 }
 function replaceMcpReference(range,attrs){
  const index=documentIndex(editor.state.doc);if(!mcpReferenceServerId(attrs?.id)||typeof attrs.label!=='string'||!attrs.label.length||attrs.label.length>256||/[\r\n\0]/u.test(attrs.label)||!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start||range.end>index.text.length||hasRangeAtoms(range.start,range.end))return false;
  const from=index.positionAt(range.start,-1),to=index.positionAt(range.end,1),old=acceptedSnapshot;
  const atom=editor.schema.nodes.workflowReference.create({id:attrs.id,label:attrs.label,iconId:null,iconUrl:null}),tr=closeHistory(editor.state.tr).replaceWith(from,to,[atom,editor.schema.text(' ',[])]);
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc,from+2)).scrollIntoView());editor.view.dispatch(closeHistory(editor.state.tr));if(acceptedSnapshot!==old)editor.view.focus();return acceptedSnapshot!==old;
 }
 function insertQuote(quote){
  if(typeof quote!=='string'||!quote.length||quote.length>20400||quote.includes('\0'))return false;
  const old=acceptedSnapshot,atom=editor.schema.nodes.quoteReference.create({quote}),tr=closeHistory(editor.state.tr).replaceSelectionWith(atom,false),cursor=tr.selection.to;
  tr.insert(cursor,editor.schema.text(' ',[]));editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc,cursor+1)).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));if(acceptedSnapshot!==old)editor.view.focus();return acceptedSnapshot!==old;
 }
 function insertCanvasSelection(input){
  const attrs=canvasSelectionAttrs(input);if(!attrs)return false;
  const old=acceptedSnapshot,atom=editor.schema.nodes.canvasSelection.create(attrs),tr=closeHistory(editor.state.tr).replaceSelectionWith(atom,false),cursor=tr.selection.to;
  tr.insert(cursor,editor.schema.text(' ',[]));editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc,cursor+1)).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));if(acceptedSnapshot!==old)editor.view.focus();return acceptedSnapshot!==old;
 }
 function replaceMention(range,attrs){
  const index=documentIndex(editor.state.doc);
  if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start||range.end>index.text.length||hasRangeAtoms(range.start,range.end))return false;
  const from=index.positionAt(range.start,-1),to=index.positionAt(range.end,1),old=acceptedSnapshot;
  const node=editor.schema.nodes.mention.create({id:attrs.id,label:attrs.label,mentionSuggestionChar:'@'}),space=editor.schema.text(' ',[]);
  const tr=closeHistory(editor.state.tr).replaceWith(from,to,[node,space]);editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc,from+2)).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));if(acceptedSnapshot!==old)editor.view.focus();return acceptedSnapshot!==old;
 }
 function getEmojiQueryContext(from=editor.state.selection.from,to=editor.state.selection.to){
  const doc=editor.state.doc,$from=doc.resolve(from),$to=doc.resolve(to),index=documentIndex(doc);
  const before=$from.nodeBefore?.isText?$from.nodeBefore.text:'',after=$to.nodeAfter?.isText?$to.nodeAfter.text:'';
  return {text:before+editor.state.doc.textBetween(from,to,'\n')+after,start:before.length,end:before.length+to-from,
   toRange(range){return {...range,start:index.offsetAt(from-before.length+range.start),end:index.offsetAt(from-before.length+range.end)};}};
 }
 let rangeGeometry=null;
 function getRangeRect(range){
  if(editor.isDestroyed||!range)return null;
  const doc=editor.state.doc,root=editor.view.dom;
  if(!rangeGeometry||rangeGeometry.doc!==doc||rangeGeometry.start!==range.start||rangeGeometry.end!==range.end||!root.contains(rangeGeometry.dom.startContainer)||!root.contains(rangeGeometry.dom.endContainer)){
   const index=documentIndex(doc);if(range.start<0||range.end>index.text.length||range.start>range.end)return null;
   const from=index.positionAt(range.start,-1),to=index.positionAt(range.end,1),start=editor.view.domAtPos(from),end=editor.view.domAtPos(to),dom=root.ownerDocument.createRange();
   dom.setStart(start.node,start.offset);dom.setEnd(end.node,end.offset);rangeGeometry={doc,start:range.start,end:range.end,dom};
  }
  const rect=rangeGeometry.dom.getBoundingClientRect();
  if(rect.width||rect.height)return rect;
  const caret=editor.view.coordsAtPos(editor.state.selection.anchor);return new DOMRect(caret.left,caret.top,caret.right-caret.left,caret.bottom-caret.top);
 }
 function hasRangeAtoms(start,end){return documentIndex(editor.state.doc).atoms.some(atom=>start<atom.end&&end>atom.start||start===end&&start>atom.start&&start<atom.end);}
 function replaceRangeText(range,text,{preserveSelection=false,allowSelectedAtoms=false}={}){
  const index=documentIndex(editor.state.doc);
  if(typeof text!=='string'||!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start||range.end>index.text.length)return false;
  if(index.atoms.some(atom=>(range.start<atom.end&&range.end>atom.start||range.start===range.end&&range.start>atom.start&&range.start<atom.end)&&(!allowSelectedAtoms||range.start>atom.start||range.end<atom.end)))return false;
  const from=index.positionAt(range.start,-1),to=index.positionAt(range.end,1),old=acceptedSnapshot,tr=closeHistory(editor.state.tr).insertText(text,from,to);
  editor.view.dispatch((preserveSelection?tr:tr.setSelection(TextSelection.create(tr.doc,from+text.length))).scrollIntoView());editor.view.dispatch(closeHistory(editor.state.tr));return acceptedSnapshot!==old||!tr.docChanged;
 }
 function replaceText(text){
  const old=acceptedSnapshot,candidate=prepare({text,references:[]});
  const tr=closeHistory(editor.state.tr).replaceWith(0,editor.state.doc.content.size,candidate.node.content);editor.view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));return acceptedSnapshot!==old||acceptedSnapshot.text===text;
 }
 function removeReference(id){
  const atoms=documentIndex(editor.state.doc).atoms.filter(atom=>atom.node.attrs.id===id);if(!atoms.length)return true;
  const old=acceptedSnapshot,tr=closeHistory(editor.state.tr);for(const atom of atoms.reverse())tr.delete(atom.from,atom.to);editor.view.dispatch(tr);editor.view.dispatch(closeHistory(editor.state.tr));return acceptedSnapshot!==old;
 }
 try{if(!restore(snapshot,{resetHistory:true}))throw Object.assign(Error('Concept kon niet worden opgeslagen.'),{code:'COMPOSER_PERSISTENCE_FAILED'});}catch(error){editor.destroy();throw error;}
 return {element:editor.view.dom,getSnapshot:()=>clone(acceptedSnapshot),getSelection,setSelection,hasRangeAtoms,
  getQueryContext(){const index=documentIndex(editor.state.doc),selection=getSelection();let text=index.text;for(const atom of [...index.atoms].reverse())text=text.slice(0,atom.start)+' '.repeat(atom.end-atom.start)+text.slice(atom.end);return {text,...selection};},
  getRangeRect,getEmojiQueryContext,setMentionHandlers(handlers){mentionHandlers=handlers;},setEmojiHandlers(handlers){emojiHandlers=handlers;},replaceMention:atomic(replaceMention),replaceMcpReference:atomic(replaceMcpReference),replaceSuggestion:atomic(replaceSuggestion),replaceText:atomic(replaceText),replaceRangeText:atomic(replaceRangeText),insertQuote:atomic(insertQuote),insertCanvasSelection:atomic(insertCanvasSelection),removeReference:atomic(removeReference),restore,focus:options=>editor.view.dom.focus(options),error:()=>lastError,
  destroy(){if(destroyed)return;destroyed=true;editor.destroy();}};
}

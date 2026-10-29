import {canvasSelectionProjection} from './composer-canvas-selection.js';
import {iconsReady,fetchIconData,iconSvg} from './icon-library.js';
import {Node} from './assets/vendor/composer/tiptap.js';

// Native canvasReference is an empty inline atom, not a selectable context chip.
export function canvasReferenceNode(){
 return Node.create({name:'canvasReference',group:'inline',inline:true,atom:true,selectable:false,
  addAttributes:()=>Object.fromEntries([['canvasId','data-canvas-id'],['storeId','data-store-id'],['title','data-title']].map(([key,attribute])=>[key,{default:null,parseHTML:element=>element.getAttribute(attribute),renderHTML:attrs=>typeof attrs[key]==='string'?{[attribute]:attrs[key]}:{}}])),
  parseHTML:()=>[{tag:'span[data-type="canvas-reference"][data-canvas-id]'}],
  renderHTML:({HTMLAttributes})=>['span',{'data-type':'canvas-reference',...HTMLAttributes}],
  renderText:()=>''
 });
}
export function hasCanvasReference(doc){
 let present=false;doc.descendants(node=>{if(node.type.name==='canvasReference')present=true;});return present;
}
export function canvasReferenceOnlyParagraph(node){
 if(node.type.name!=='paragraph'||!node.childCount)return false;
 let only=true;node.forEach(child=>{if(child.type.name!=='canvasReference')only=false;});return only;
}

export function canvasSelectionNode(){
 return Node.create({name:'canvasSelection',group:'inline',inline:true,atom:true,selectable:true,
  addAttributes:()=>Object.fromEntries([['canvasId','data-canvas-id'],['sourceFile','data-source-file'],['label','data-label'],['selection','data-selection']].map(([key,attribute])=>[key,{default:null,parseHTML:element=>element.getAttribute(attribute),renderHTML:attrs=>typeof attrs[key]==='string'?{[attribute]:attrs[key]}:{}}])),
  parseHTML:()=>[{tag:'span[data-type="canvas-selection"][data-selection]'}],
  renderHTML:({node,HTMLAttributes})=>['span',{'data-type':'canvas-selection',...HTMLAttributes},canvasSelectionProjection(node.attrs.label)],
  renderText:({node})=>canvasSelectionProjection(node.attrs.label),
  addNodeView:()=>({node})=>{
   const dom=document.createElement('span');dom.contentEditable='false';
   if(typeof node.attrs.label!=='string'||!node.attrs.label.length)return {dom};
   dom.className='composer-inline-canvas-selection';dom.dataset.type='canvas-selection';dom.title=typeof node.attrs.sourceFile==='string'?`${node.attrs.label} (${node.attrs.sourceFile})`:node.attrs.label;
   const glyph=document.createElement('span'),label=document.createElement('span');glyph.className='canvas-selection-icon';glyph.setAttribute('aria-hidden','true');label.className='canvas-selection-label';label.textContent=node.attrs.label;dom.append(glyph,label);
   let alive=true;const draw=()=>{if(alive)glyph.innerHTML=iconSvg('pointer-arrow',{size:12});};
   if(iconsReady())draw();else void fetchIconData().then(draw,()=>{});
   return {dom,destroy(){alive=false;}};
  }
 });
}

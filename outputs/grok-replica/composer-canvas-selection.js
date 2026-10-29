import {normalizeCanvasReferenceAttrs} from './composer-canvas-reference.js';
// Source-shaped passive selection metadata. Source access is resolved separately.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const name=/^[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/;
const propName=/^[A-Za-z_$][\w$-]*$/;
export const validCanvasSourceFile=value=>typeof value==='string'&&value.length>0&&value.length<=128&&/^[\w./-]+$/.test(value);
function normalizeProps(value){
 if(!object(value))return null;const entries=Object.entries(value);if(entries.length>16)return null;const copied=[];
 for(const [key,input]of entries){
  if(key.length>64||!propName.test(key))return null;
  const scalar=typeof input==='boolean'||finite(input)?input:typeof input==='string'?input.slice(0,120):undefined;
  if(scalar===undefined)return null;
  // The native {} assignment ignores primitive __proto__ values. Preserve that
  // observable result without invoking its inherited setter.
  if(key!=='__proto__')copied.push([key,scalar]);
 }
 return Object.fromEntries(copied);
}
function normalizeStackEntry(value){
 if(!object(value)||!['component','element'].includes(value.kind)||typeof value.name!=='string'||value.name.length>64||!name.test(value.name)||!object(value.anchor)||!positive(value.anchor.line)||!positive(value.anchor.column))return null;
 const props=normalizeProps(value.props);return props?{kind:value.kind,name:value.name,anchor:{line:value.anchor.line,column:value.anchor.column},props}:null;
}
export function normalizeCanvasSelection(value){
 if(!object(value)||!Array.isArray(value.stack))return null;const stack=[];
 for(const input of value.stack.slice(0,12)){const entry=normalizeStackEntry(input);if(!entry)return null;stack.push(entry);}
 const rect=value.rect;
 if(!stack.length||typeof value.tag!=='string'||value.tag.length>32||!/^[a-z][a-z0-9-]*$/.test(value.tag)||typeof value.text!=='string'||!object(rect)||!['x','y','width','height'].every(key=>finite(rect[key])))return null;
 return {stack,tag:value.tag,text:value.text.slice(0,200),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
}
export function canvasSelectionLabel(value){
 const selection=normalizeCanvasSelection(value);if(!selection)return '';
 const label=selection.stack.map(item=>{const heading=typeof item.props.heading==='string'?item.props.heading:typeof item.props.title==='string'?item.props.title:undefined;return heading===undefined?item.name:`${item.name} "${heading}"`;}).join(' › ');
 return label.length>80?label.slice(0,79)+'…':label;
}
export const canvasSelectionProjection=label=>`[selected ${typeof label==='string'?label:''}]`;
export function parseCanvasSelection(value){
 if(typeof value!=='string'||value.length>196608)return null;
 try{const parsed=JSON.parse(value);if(object(parsed)&&Object.hasOwn(parsed,'__localSourceRevision')&&!positive(parsed.__localSourceRevision))return null;return normalizeCanvasSelection(parsed);}catch{return null;}
}
export function canvasSelectionAttrs(input){
 const canvas=normalizeCanvasReferenceAttrs({canvasId:input?.canvasId}),selection=normalizeCanvasSelection(input?.selection);
 if(!canvas||!validCanvasSourceFile(input?.sourceFile)||!selection||input.sourceRevision!==undefined&&!positive(input.sourceRevision))return null;
 const supplied=typeof input.label==='string'?input.label:canvasSelectionLabel(selection),label=supplied.length>80?supplied.slice(0,79)+'…':supplied;
 return {canvasId:canvas.canvasId,sourceFile:input.sourceFile,label,selection:JSON.stringify({...selection,...(input.sourceRevision!==undefined?{__localSourceRevision:input.sourceRevision}:{})})};
}
export function composerCanvasSelections(richText){
 if(richText===undefined)return [];let document;try{document=JSON.parse(richText);}catch{return [];}
 const selected=[];
 const visit=node=>{
  if(!object(node))return;
  if(node.type==='canvasSelection'){
   const attrs=node.attrs,canvas=normalizeCanvasReferenceAttrs({canvasId:attrs?.canvasId}),selection=parseCanvasSelection(attrs?.selection);
   if(canvas&&validCanvasSourceFile(attrs.sourceFile)&&selection){const revision=JSON.parse(attrs.selection).__localSourceRevision;selected.push({canvasId:canvas.canvasId,sourceFile:attrs.sourceFile,label:typeof attrs.label==='string'?attrs.label:'',selection,...(revision!==undefined?{sourceRevision:revision}:{})});}
  }
  if(Array.isArray(node.content))for(const child of node.content)visit(child);
 };
 visit(document);return selected;
}

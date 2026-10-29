import {appendHeldCanvasReference,normalizeCanvasReferenceAttrs} from './composer-canvas-reference.js';
// Mirrors the native pane's identity-checked hold. It never edits the composer.
export function createCanvasReferenceHold(){
 let held=null;
 return {
  hold(reference){const attrs=normalizeCanvasReferenceAttrs(reference);if(!attrs)throw Error('Invalid held canvas');const token={attrs};held=token;return ()=>{if(held===token)held=null;};},
  current(){return held?structuredClone(held.attrs):null;},
  clear(){held=null;},
 };
}
// The maintained textarea seam has no rich document. Preserve its exact newline
// projection with the same one-paragraph/hardBreak representation as the editor.
export function appendCanvasSubmissionReference(richText,reference,{text=''}={}){
 const document=richText??JSON.stringify({type:'doc',content:[{type:'paragraph',content:text.split('\n').flatMap((line,index)=>[...(index?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])}]});
 return appendHeldCanvasReference(document,reference,{text});
}
export function canvasPayloadMatchesDraft(draft,payload,text){
 if(draft===payload)return true;
 if(typeof payload!=='string')return false;
 try{
  const doc=JSON.parse(payload),last=doc.content?.at(-1),node=last?.type==='paragraph'?last.content?.at(-1):null;
  if(node?.type!=='canvasReference'||!normalizeCanvasReferenceAttrs(node.attrs))return false;
  return appendCanvasSubmissionReference(draft,node.attrs,{text})===payload;
 }catch{return false;}
}

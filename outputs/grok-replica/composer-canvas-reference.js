// Native-shaped presentation identities. Access to actual canvas source is
// resolved separately by the owner-scoped harness, never by these client attrs.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const store=/^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeCanvasReferenceAttrs(attrs){
 if(!attrs||typeof attrs!=='object'||typeof attrs.canvasId!=='string')return null;
 const canvasId=attrs.canvasId.trim().toLowerCase();if(!uuid.test(canvasId))return null;
 let storeId=null;
 if(typeof attrs.storeId==='string'&&attrs.storeId.length){storeId=attrs.storeId.trim();if(!store.test(storeId))return null;}
 const title=(typeof attrs.title==='string'?attrs.title:'').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu,' ').trim().slice(0,200);
 return {canvasId,storeId,title};
}
export function composerCanvasReferences(richText){
 if(richText===undefined)return [];
 let document;try{document=JSON.parse(richText);}catch{return [];}
 const references=[],seen=new Set();
 const visit=node=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='canvasReference'){
   const reference=normalizeCanvasReferenceAttrs(node.attrs);
   if(reference&&!seen.has(reference.canvasId)){seen.add(reference.canvasId);references.push(reference);}
  }
  if(Array.isArray(node.content))for(const child of node.content)visit(child);
 };
 visit(document);return references;
}
export function appendHeldCanvasReference(richText,reference,{text=''}={}){
 const attrs=normalizeCanvasReferenceAttrs(reference);if(!attrs)throw new Error('Invalid canvas reference');
 let document;if(richText!==undefined)document=JSON.parse(richText);
 const object=document!==null&&typeof document==='object'&&!Array.isArray(document);
 const content=object&&Array.isArray(document.content)?[...document.content]:text.split('\n').map(value=>({type:'paragraph',...(value?{content:[{type:'text',text:value}]}:{})}));
 const node={type:'canvasReference',attrs},last=content.at(-1);
 if(last&&last.type==='paragraph')content[content.length-1]={...last,content:[...(Array.isArray(last.content)?last.content:[]),node]};
 else content.push({type:'paragraph',content:[node]});
 return JSON.stringify({...object?document:{type:'doc'},content});
}

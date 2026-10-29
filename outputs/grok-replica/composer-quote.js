// Native selection-quote presentation. This carries text, not reply/tool authority.
const fold=value=>value.replace(/\s+/gu,' ').trim();
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function truncate(value,limit){
 if(value.length<=limit)return value;
 let end=0;
 for(const part of segmenter.segment(value)){
  if(part.index+part.segment.length>limit-1)break;
  end=part.index+part.segment.length;
 }
 return value.slice(0,end).trimEnd()+'…';
}
export function normalizeSelectionQuote(text,source){
 if(typeof text!=='string')return null;
 let quote=text.replace(/\r\n?/gu,'\n').trim();
 if(!quote.length)return null;
 if(quote.length>20000)quote=truncate(quote,20000)+'\n[quote truncated]';
 if(typeof source==='string'){
  const label=truncate(fold(source),120);
  if(label)quote+='\n\n— '+label;
 }
 return quote;
}
export function quoteProjection(value){
 const quote=typeof value==='string'?value:'';
 return '\n'+quote.split('\n').map(line=>line.trim().length?'> '+line:'>').join('\n')+'\n\n';
}
export function quoteLabel(value){
 const text=fold(typeof value==='string'?value:'');
 return '“'+(text.length>20?text.slice(0,20).trimEnd()+'…':text)+'”';
}
export const quoteDescription=value=>truncate(fold(typeof value==='string'?value:''),400);

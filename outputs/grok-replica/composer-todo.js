// Passive native-shaped todo context. IDs/status are presentation metadata only.
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export const todoStatus=value=>['pending','in_progress','completed','cancelled'].includes(value)?value:null;
export const todoProjection=value=>`Over de taak "${typeof value==='string'?value:''}":`;
export function todoLabel(value){
 const label=typeof value==='string'?value:'';if(label.length<=56)return label;
 let end=0;for(const part of segmenter.segment(label)){const next=part.index+part.segment.length;if(next>55)break;end=next;}
 return label.slice(0,end).trimEnd()+'…';
}

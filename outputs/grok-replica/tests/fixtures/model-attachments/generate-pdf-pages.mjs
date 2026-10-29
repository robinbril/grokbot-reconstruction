import {createCanvas} from '@napi-rs/canvas';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const pixelNonce='PDF_PIXEL_NONCE_VIOLET_6281';
export const textNonce='MIXED_TEXT_NONCE_AMBER_7392';
export function makePdfPages({mixed=false,imagePages=1,width=800,height=300,declaredWidth=width,declaredHeight=height,samePageText=false,corruptImage=false}={}){
 const canvas=createCanvas(width,height),context=canvas.getContext('2d');
 context.fillStyle='#ffffff';context.fillRect(0,0,width,height);
 context.fillStyle='#6b21a8';context.font='bold 32px Arial';context.fillText(pixelNonce,30,90);
 context.fillStyle='#008080';context.fillRect(30,150,120,80);
 const image=corruptImage?Buffer.from('broken JPEG data'):canvas.toBuffer('image/jpeg'),objects=[null,null],kids=[];
 const add=value=>(objects.push(Buffer.isBuffer(value)?value:Buffer.from(value)),objects.length);
 const stream=(head,bytes)=>Buffer.concat([Buffer.from(head+' /Length '+bytes.length+' >>\nstream\n'),bytes,Buffer.from('\nendstream')]);
 const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 if(mixed){
  const content=add(stream('<<',Buffer.from('BT /F1 18 Tf 30 210 Td ('+textNonce+') Tj ET')));
  kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
 }
 const imageId=add(stream(`<< /Type /XObject /Subtype /Image /Width ${declaredWidth} /Height ${declaredHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,image));
 for(let index=0;index<imagePages;index++){
  const content=add(stream('<<',Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Scan Do Q`+(samePageText?' BT /F1 18 Tf 30 260 Td ('+textNonce+') Tj ET':''))));
  kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Scan ${imageId} 0 R >> >> /Contents ${content} 0 R >>`));
 }
 objects[0]=Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');objects[1]=Buffer.from(`<< /Type /Pages /Kids [${kids.map(id=>id+' 0 R').join(' ')}] /Count ${kids.length} >>`);
 const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let offset=chunks[0].length;
 objects.forEach((object,index)=>{offsets.push(offset);const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);offset+=chunk.length;});
 const xref=offset;chunks.push(Buffer.from('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF\n`));
 return Buffer.concat(chunks);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await writeFile(new URL('./scanned-page.pdf',import.meta.url),makePdfPages());
 await writeFile(new URL('./mixed-pages.pdf',import.meta.url),makePdfPages({mixed:true}));
 await writeFile(new URL('./mixed-same-page.pdf',import.meta.url),makePdfPages({samePageText:true}));
}

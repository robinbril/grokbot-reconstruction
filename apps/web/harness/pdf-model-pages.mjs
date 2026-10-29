import {auditPdfOperatorStreams} from './pdf-operator-stream.mjs';
import {createRequire} from 'node:module';
import path from 'node:path';
export const pdfPageLimits=Object.freeze({pdfRasterPages:20,pdfRasterDimension:1600,pdfRasterPixels:2560000,pdfRasterBytes:5*1024*1024,pdfDecodedImagePixels:25000000});
const failure=message=>Object.assign(new Error(message),{code:'ATTACHMENT_CONTENT_INVALID'});
function checkText(text,limits){if(Buffer.byteLength(text)>limits.textBytes)throw failure('Document text exceeds the 1 MiB extraction limit');}
function checkDecodedImage(image,limits){
 if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>limits.pdfDecodedImagePixels)throw failure('PDF contains an undecodable or oversized image; no partial page was accepted');
}
async function pageHasImages(page,OPS,limits,audit){
 const operators=await page.getOperatorList();await audit.assertHealthy();const imageNames=['paintImageMaskXObject','paintImageMaskXObjectGroup','paintImageXObject','paintInlineImageXObject','paintInlineImageXObjectGroup','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintSolidColorImageMask'];
 const images=new Set(imageNames.map(name=>OPS[name]));let found=false;
 for(let index=0;index<operators.fnArray.length;index++){
  const operation=operators.fnArray[index];if(!images.has(operation))continue;found=true;
  if(operation===OPS.paintImageXObject||operation===OPS.paintImageXObjectRepeat){
   const id=operators.argsArray[index][0],objects=id.startsWith('g_')?page.commonObjs:page.objs;
   const image=await new Promise(resolve=>objects.get(id,resolve));
   checkDecodedImage(image,limits);
  }else if(operation===OPS.paintInlineImageXObject||operation===OPS.paintInlineImageXObjectGroup){
   checkDecodedImage(operators.argsArray[index][0],limits);
  }else if(operation===OPS.paintImageMaskXObject||operation===OPS.paintImageMaskXObjectRepeat){
   const mask=operators.argsArray[index][0];
   if(typeof mask.data==='string'){const objects=mask.data.startsWith('g_')?page.commonObjs:page.objs;checkDecodedImage(await new Promise(resolve=>objects.get(mask.data,resolve)),limits);}
   else checkDecodedImage(mask,limits);
  }else if(operation===OPS.paintImageMaskXObjectGroup){
   for(const image of operators.argsArray[index][0])checkDecodedImage(image,limits);
  }
 }
 return found;
}
async function rasterPage(document,page,limits){
 const original=page.getViewport({scale:1});
 if(!Number.isFinite(original.width)||!Number.isFinite(original.height)||original.width<=0||original.height<=0)throw failure('PDF page dimensions are invalid');
 const scale=Math.min(2,limits.pdfRasterDimension/Math.max(original.width,original.height));
 const viewport=page.getViewport({scale}),width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
 if(width<1||height<1||width>limits.pdfRasterDimension||height>limits.pdfRasterDimension||width*height>limits.pdfRasterPixels)throw failure('PDF page exceeds the bounded raster surface limit');
 const surface=document.canvasFactory.create(width,height);
 try{
  await page.render({canvasContext:surface.context,viewport,background:'rgb(255,255,255)'}).promise;
  const bytes=surface.canvas.toBuffer('image/png');
  if(bytes.length>limits.pdfRasterBytes)throw failure('PDF rendered page exceeds the 5 MiB image limit');
  return {mediaType:'image/png',bytes};
 }finally{document.canvasFactory.destroy(surface);}
}
// Called inside the bounded document worker. No URLs, scripts or external files.
export async function extractPdfModelPages(bytes,inputLimits){
 const limits={...pdfPageLimits,...inputLimits};
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw failure('PDF signature is invalid');
 const {getDocument,OPS,version}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const standardFontDataUrl=path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),'standard_fonts')+path.sep;
 let audit;
 const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,maxImageSize:limits.pdfDecodedImagePixels});
 try{
  const document=await task.promise;audit=auditPdfOperatorStreams(document,version);
  if(document.numPages>limits.pages)throw failure('PDF exceeds the 200-page model extraction limit');
  const pages=[];let text='',rasterPages=0,imageBytes=0;
  for(let number=1;number<=document.numPages;number++){
   const page=await document.getPage(number);
   try{
    const content=await page.getTextContent(),body=content.items.map(item=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'').join('');
    const item={number,text:`\n[Page ${number}]\n`+body};text+=item.text;checkText(text,limits);
    const hasImages=await pageHasImages(page,OPS,limits,audit);
    if(!body.trim()||hasImages){
     if(++rasterPages>limits.pdfRasterPages)throw failure('PDF exceeds the 20 image-page model input limit; split the document');
     item.image=await rasterPage(document,page,limits);await audit.assertHealthy();imageBytes+=item.image.bytes.length;
     if(imageBytes>limits.imageBytes)throw failure('PDF rendered pages exceed the combined model image limit');
    }
    pages.push(item);
   }finally{page.cleanup();}
  }
  return {text,pages};
 }finally{audit?.restore();await task.destroy();}
}

// PDF bytes have already passed the attachment reader's size/digest boundary.
const assetRoot=new URL('./assets/vendor/file-preview/',import.meta.url);
const abortError=()=>new DOMException('Preview closed','AbortError');
const limits=Object.freeze({pages:200,pagePixels:4_000_000,totalPixels:32_000_000});
export function createPdfRenderer(engine){
 return async function render({bytes,container,signal,isCurrent=()=>true}){
  const check=()=>{signal?.throwIfAborted();if(!isCurrent())throw abortError();};check();
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>5*1024*1024||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('Invalid PDF attachment');
  engine.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.js',assetRoot).href;
  const task=engine.getDocument({data:bytes.slice(),isEvalSupported:false,disableAutoFetch:true,disableStream:true,enableXfa:false,stopAtErrors:true,useSystemFonts:false,
   cMapUrl:new URL('cmaps/',assetRoot).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',assetRoot).href,wasmUrl:new URL('wasm/',assetRoot).href});
  const canvases=[],texts=[];let active=null,closed=false;
  const cleanup=async()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',onAbort);active?.cancel();for(const text of texts)text.cancel();for(const canvas of canvases){canvas.width=0;canvas.height=0;}await task.destroy();};
  const onAbort=()=>{void cleanup().catch(()=>{});};signal?.addEventListener('abort',onAbort,{once:true});
  try{
   const pdf=await task.promise;check();if(pdf.numPages>limits.pages)throw new Error('PDF exceeds the 200-page preview limit');
   let pixels=0,renderedPages=0;
   for(let number=1;number<=pdf.numPages;number++){
    check();const page=await pdf.getPage(number);check();
    const base=page.getViewport({scale:1}),available=container.getBoundingClientRect().width||800;
    const scale=Math.min(2,Math.max(0.1,(available-32)/base.width),Math.sqrt(limits.pagePixels/(base.width*base.height)));
    const viewport=page.getViewport({scale}),width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
    if(!Number.isFinite(width*height)||width<1||height<1)throw new Error('PDF has invalid page dimensions');
    if(pixels+width*height>limits.totalPixels){const note=container.ownerDocument.createElement('p');note.textContent='Preview limited to '+renderedPages+' of '+pdf.numPages+' pages by the canvas memory limit. Download the original to view all pages.';container.append(note);page.cleanup();break;}
    pixels+=width*height;
    const section=container.ownerDocument.createElement('section'),canvas=container.ownerDocument.createElement('canvas');
    section.className='attachment-pdf-page';section.style.position='relative';section.style.width=width+'px';section.style.height=height+'px';section.style.margin='16px auto';section.style.background='white';
    canvas.width=width;canvas.height=height;canvas.setAttribute('aria-label','Page '+number+' of '+pdf.numPages);canvases.push(canvas);section.append(canvas);container.append(section);
    active=page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:0});await active.promise;active=null;check();
    if(engine.TextLayer){const layer=container.ownerDocument.createElement('div');layer.className='textLayer';layer.style.setProperty('--total-scale-factor',String(scale));section.append(layer);
     const text=new engine.TextLayer({textContentSource:await page.getTextContent(),container:layer,viewport});texts.push(text);await text.render();check();}
    page.cleanup();renderedPages++;
   }
   return {cleanup,pageCount:pdf.numPages,renderedPages};
  }catch(error){await cleanup();throw signal?.aborted?signal.reason:error;}
 };
}
let renderer;
export async function renderPdfPreview(options){
 options.signal?.throwIfAborted();
 const doc=options.container.ownerDocument;
 if(!doc.querySelector('link[data-pdf-text-layer]')){const link=doc.createElement('link');link.rel='stylesheet';link.href=new URL('text-layer.css',assetRoot).href;link.dataset.pdfTextLayer='true';doc.head.append(link);}
 renderer??=import('./assets/vendor/file-preview/pdf.js').then(createPdfRenderer);
 return (await renderer)(options);
}

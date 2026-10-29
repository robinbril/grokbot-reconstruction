import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {HarnessStore} from '../harness/store.mjs';
import {AttachmentStore} from '../harness/attachments.mjs';
import {extractPdfModelPages} from '../harness/pdf-model-pages.mjs';
import {modelAttachmentLimits,prepareModelAttachments} from '../harness/model-attachment-input.mjs';
import {pixelNonce,textNonce,makePdfPages} from './fixtures/model-attachments/generate-pdf-pages.mjs';
const owner='pdf-fixture-owner',id='pdf-pages';
async function prepare(t,name){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-pdf-page-test-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const store=await new HarnessStore({dataDir}).init(),attachments=await new AttachmentStore({dataDir,store}).init(),bytes=await readFile(new URL('./fixtures/model-attachments/'+name,import.meta.url));
 const sha256=createHash('sha256').update(bytes).digest('hex'),reserved=await attachments.reserve(owner,id,{requestId:randomUUID(),name,type:'application/pdf',size:bytes.length,sha256});await attachments.put(owner,id,reserved.attachmentId,[bytes]);
 const ref={attachmentId:reserved.attachmentId,size:bytes.length,sha256};return {result:await prepareModelAttachments(attachments,owner,id,[ref]),attachments,ref,bytes,store};
}
test('actual scanned PDF bytes become bounded native PNG pixels, never fabricated extracted text',async t=>{
 const h=await prepare(t,'scanned-page.pdf'),parts=h.result.contentParts;
 assert.deepEqual(parts.map(part=>part.type),['text','image_url']);assert.match(parts[0].text,/Page 1/);assert.equal(parts[0].text.includes(pixelNonce),false);
 assert.equal(h.bytes.includes(Buffer.from(pixelNonce)),false,'nonce exists only as rasterized glyphs');
 const png=Buffer.from(parts[1].image_url.url.split(',')[1],'base64');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1600);assert.equal(png.readUInt32BE(20),600);
 const image=await loadImage(png),canvas=createCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);
 const teal=Array.from(context.getImageData(100,400,1,1).data);assert.ok(teal[0]<15&&teal[1]>110&&teal[1]<145&&teal[2]>110&&teal[2]<145,'actual colored image region survives rendering');
 assert.deepEqual((await h.attachments.download(owner,id,h.ref.attachmentId)).bytes,h.bytes);assert.equal(JSON.stringify(h.store.snapshot(h.store.get(owner,id))).includes('data:image/'),false);
});
test('mixed PDF preserves selectable first-page text and second-page native image in original order',async t=>{
 const h=await prepare(t,'mixed-pages.pdf'),parts=h.result.contentParts;
 assert.deepEqual(parts.map(part=>part.type),['text','text','image_url']);assert.match(parts[0].text,new RegExp(textNonce));assert.match(parts[0].text,/Page 1/);assert.match(parts[1].text,/Page 2/);assert.equal(parts[1].text.includes(pixelNonce),false);
});


test('oversized embedded image rejects instead of silently dropping its pixels',async()=>{
 const bytes=makePdfPages();
 // Lower the same decoder resource boundary to exercise a real image without allocating a giant fixture.
 assert.equal(modelAttachmentLimits.pdfDecodedImagePixels,25000000);
 await assert.rejects(extractPdfModelPages(bytes,{...modelAttachmentLimits,pdfDecodedImagePixels:100}),/maximum allowed size/);
});

test('same-page selectable header cannot hide the scanned body image',async t=>{
 const h=await prepare(t,'mixed-same-page.pdf'),parts=h.result.contentParts;
 assert.deepEqual(parts.map(part=>part.type),['text','image_url']);assert.match(parts[0].text,new RegExp(textNonce));assert.equal(parts[0].text.includes(pixelNonce),false);
});
test('undecodable embedded image rejects instead of returning a misleading blank rendered page',async()=>{
 await assert.rejects(extractPdfModelPages(makePdfPages({corruptImage:true}),modelAttachmentLimits));
});

test('raster and text resource limits reject the complete document without partial pages',async()=>{
 const bytes=makePdfPages({mixed:true});
 for(const [limit,value,message]of [['pages',1,/200-page/],['pdfRasterPixels',100,/raster surface/],['pdfRasterBytes',1,/5 MiB/],['imageBytes',1,/combined model image/],['textBytes',10,/text exceeds/],['pdfRasterPages',0,/20 image-page/]]){
  await assert.rejects(extractPdfModelPages(bytes,{...modelAttachmentLimits,[limit]:value}),message,limit);
 }
});
test('twenty-one raster pages reject instead of silently truncating to twenty',async()=>{
 await assert.rejects(extractPdfModelPages(makePdfPages({imagePages:21}),modelAttachmentLimits),/20 image-page/);
});

test('oversized declared image rejects at the normal 25-million-pixel boundary',async()=>{
 await assert.rejects(extractPdfModelPages(makePdfPages({declaredWidth:6000,declaredHeight:6000}),modelAttachmentLimits),/maximum allowed size/);
});
test('understated JPEG metadata is genuinely resampled by the renderer to bounded decoded output',async()=>{
 const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const bytes=makePdfPages({declaredWidth:1,declaredHeight:1}),task=getDocument({data:new Uint8Array(bytes),maxImageSize:100,stopAtErrors:true});
 try{
  const document=await task.promise,page=await document.getPage(1),operators=await page.getOperatorList(),index=operators.fnArray.indexOf(OPS.paintImageXObject);
  const image=await new Promise(resolve=>page.objs.get(operators.argsArray[index][0],resolve));
  assert.equal(image.width,1);assert.equal(image.height,1);assert.equal(image.data.length,3);
 }finally{await task.destroy();}
 const result=await extractPdfModelPages(bytes,{...modelAttachmentLimits,pdfDecodedImagePixels:100});
 const png=Buffer.from(result.pages[0].image.bytes);assert.equal(png.readUInt32BE(16),1600);assert.equal(png.readUInt32BE(20),600);
 // This is decoded-output policy, not a bound on the encoded JPEG decoder's peak native memory.
});

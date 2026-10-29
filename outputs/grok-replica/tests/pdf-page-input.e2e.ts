// Scripted inference verifies real browser/upload/HTTP/raster/model transport.
// Genuine pixel-reading inference is a separate computer-use proof.
import {test,beforeEach,afterEach} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
let received={images:0,textPage:false,inlineRasterWords:false};
beforeEach(async({browser})=>{
 received={images:0,textPage:false,inlineRasterWords:false};
 protocol=await startWorkflowProtocolServer({port:18884,model:{status:()=>({state:'ready',provider:'synthetic-pdf-transport',model:'synthetic-pdf-transport'}),async complete({messages}){
  const content=messages.findLast(message=>message.role==='user')?.content;
  const parts=Array.isArray(content)?content:[],text=parts.filter(part=>part.type==='text').map(part=>part.text).join('\n');
  received={images:parts.filter(part=>part.type==='image_url'&&part.image_url.url.startsWith('data:image/png;base64,')).length,textPage:text.includes('MIXED_TEXT_NONCE_AMBER_7392'),inlineRasterWords:text.includes('PDF_PIXEL_NONCE_VIOLET_6281')};
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:`PDF-transport: ${received.images} paginabeeld, tekstpagina ${received.textPage?'ontvangen':'ontbreekt'}.`}}}]};
 }}});await browser.goto(protocol.baseUrl);
});
afterEach(async()=>{await protocol?.close();});
test('mixed scanned PDF sends real page pixels and selectable text and retains original across reload',async({browser,screen,agent,app})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/model-attachments/mixed-pages.pdf']);
 await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 await screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true}).fill('Lees beide pagina’s van deze PDF.');
 await agent.act('Verstuur het klaargezette bericht met mixed-pages.pdf eenmaal via Bericht sturen. Voer geen andere taak uit.');
 await expect(browser.locator('.transcript')).toContainText('PDF-transport: 1 paginabeeld, tekstpagina ontvangen.');
 expect(received).toEqual({images:1,textPage:true,inlineRasterWords:false});
 await expect(browser.locator('[data-live-attachment-download]')).toHaveCount(1);
 await browser.reload();await expect(browser.locator('.transcript')).toContainText('PDF-transport: 1 paginabeeld, tekstpagina ontvangen.');
 const hash=await browser.evaluate(async()=>{
  const link=document.querySelector<HTMLAnchorElement>('[data-live-attachment-download]')!;
  const response=await fetch(link.href);if(!response.ok)throw Error('Original unavailable');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
 });
 expect(hash).toBe(createHash('sha256').update(await readFile(new URL('./fixtures/model-attachments/mixed-pages.pdf',import.meta.url))).digest('hex'));
 for(const theme of ['light','dark']){
  await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Instellingen',{exact:true}).click();
  const settings=screen.getByRole('dialog','Instellingen');await settings.getByLabel('Thema').selectOption({value:theme});await settings.getByRole('button','Sluiten',{exact:true}).click();
  await expect(browser.locator('html')).toHaveAttribute('data-theme',theme);
  const geometry=await browser.evaluate(()=>{
   const card=document.querySelector<HTMLElement>('.message.user .live-file-card')!,name=card.querySelector('strong')!;
   const luminance=(color:string)=>{
    const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
   };
   const front=luminance(getComputedStyle(name).color),back=luminance(getComputedStyle(card).backgroundColor);
   const controls=Array.from(card.querySelectorAll<HTMLElement>('[data-live-attachment-open],[data-live-attachment-download]'));
   const boxes=controls.map(control=>control.getBoundingClientRect());
   const textFits=controls.every((control,index)=>{
    if(!control.textContent?.trim())return true;
    const range=document.createRange();range.selectNodeContents(control);const text=range.getBoundingClientRect();
    return text.left>=boxes[index].left-1&&text.right<=boxes[index].right+1;
   });
   return {contrast:(Math.max(front,back)+0.05)/(Math.min(front,back)+0.05),textFits,separate:boxes.length===2&&boxes[0].right<=boxes[1].left};
  });
  expect(geometry.contrast).toBeGreaterThanOrEqual(4.5);expect(geometry.textFits).toBe(true);expect(geometry.separate).toBe(true);
  await app.screenshot('mixed-pdf-model-transport-'+theme);
 }
 await app.screenshot('mixed-pdf-model-transport-after-reload');
});

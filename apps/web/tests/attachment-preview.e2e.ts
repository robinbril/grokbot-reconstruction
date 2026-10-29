// All records, original bytes and deliveries use the real owner-scoped HTTP/runtime path.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>,selectedUrl='';
const mimeDocx='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const model={status:()=>({state:'ready',provider:'synthetic-preview-fixture',model:'synthetic-preview-fixture',modelExecution:'synthetic'}),async complete(){return {text:'',toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:selectedUrl?{attachment:{url:selectedUrl}}:{text:{content:'Synthetic preview ready.'}}}]};}};
beforeEach(async({browser,screen})=>{selectedUrl='';protocol=await startWorkflowProtocolServer({port:18880,model});await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Initialize synthetic preview.');await screen.getByRole('button','Bericht sturen',{exact:true}).click();await expect(browser.locator('[data-live-run-label]')).toHaveText('Voltooid',{timeout:60_000});});
afterEach(async()=>{await protocol?.close();});
async function stage(browser:Browser,name:string,type:string,bytes:Buffer){
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const ref=await browser.evaluate(async({name,type,bytes,sha256})=>{
  const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness.serverIds[saved.selected];
  const {createLiveHarnessClient}=await import('/live-harness-client.js'),client=createLiveHarnessClient();
  const reserved=await client.reserveAttachment(id,{requestId:crypto.randomUUID(),name,type,size:bytes.length,sha256});
  const ready=await client.uploadAttachment(id,reserved.attachmentId,new Blob([new Uint8Array(bytes)]));
  return {id,...ready};
 },{name,type,bytes:[...bytes],sha256});
 expect(ref.sha256).toBe(sha256);expect(ref.size).toBe(bytes.length);selectedUrl=`${protocol.baseUrl}/api/harness/conversations/${ref.id}/attachments/${ref.attachmentId}/download`;return ref;
}
async function deliver(browser:Browser,screen:Screen,name:string,type:string,bytes:Buffer){
 const ref=await stage(browser,name,type,bytes);await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Deliver '+name);await screen.getByRole('button','Bericht sturen',{exact:true}).click();await expect(screen.getByRole('button','Bijlage openen: '+name,{exact:true})).toBeVisible();await expect(browser.locator('[data-live-run-label]').last()).toHaveText('Voltooid',{timeout:60_000});return ref;
}

async function downloadHash(browser:Browser,id:string,attachmentId:string){return browser.evaluate(async({id,attachmentId})=>{
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id)+'/attachments/'+encodeURIComponent(attachmentId)+'/download');if(!response.ok)throw new Error('Download failed');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
},{id,attachmentId});}

test('actual PDF canvas and DOCX semantic content preserve original downloads',async({browser,screen,agent,app})=>{
 const pdf=await readFile(new URL('./fixtures/model-attachments/facts.pdf',import.meta.url));const pdfRef=await deliver(browser,screen,'facts.pdf','application/pdf',pdf);
 await agent.act('Open the attached facts.pdf using Bijlage openen: facts.pdf.');
 await expect(screen.getByRole('dialog','facts.pdf',{exact:true})).toBeVisible();await expect(browser.locator('.attachment-pdf-page canvas')).toBeVisible();await expect(browser.locator('.textLayer')).toContainText('PDF_VERIFIED_NONCE_ORANGE_8294');
 expect(await browser.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('.attachment-pdf-page canvas');if(!canvas)return false;const data=canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;return !!data&&data.some((v,i)=>i%4!==3&&v<200);})).toBe(true);
 await app.screenshot('real-pdf-canvas');await screen.getByRole('button','Sluiten',{exact:true}).click();
 const downloaded=await browser.waitForDownload(()=>screen.getByRole('link','Bijlage bewaren: facts.pdf',{exact:true}).click());expect(downloaded.suggestedFilename).toBe('facts.pdf');expect(await downloadHash(browser,pdfRef.id,pdfRef.attachmentId)).toBe(createHash('sha256').update(pdf).digest('hex'));
 const docx=await readFile(new URL('./fixtures/model-attachments/facts.docx',import.meta.url));const docxRef=await deliver(browser,screen,'facts.docx',mimeDocx,docx);await screen.getByRole('button','Bijlage openen: facts.docx',{exact:true}).click();
 await expect(browser.frameLocator('.live-file-document').getByText('DOCX_VERIFIED_NONCE_COBALT_7319')).toBeVisible();await expect(browser.frameLocator('.live-file-document').getByText('Amount: 42')).toBeVisible();
 expect(await browser.evaluate(()=>document.querySelector<HTMLIFrameElement>('.live-file-document')?.srcdoc.includes('<p>'))).toBe(true);await app.screenshot('real-docx-content');await screen.getByRole('button','Sluiten',{exact:true}).click();
 const word=await browser.waitForDownload(()=>screen.getByRole('link','Bijlage bewaren: facts.docx',{exact:true}).click());expect(word.suggestedFilename).toBe('facts.docx');expect(await downloadHash(browser,docxRef.id,docxRef.attachmentId)).toBe(createHash('sha256').update(docx).digest('hex'));
});

test('text JSON table markdown HTML and unsupported bytes dispatch safely',async({browser,screen,agent})=>{
 await deliver(browser,screen,'rea-proof.txt','text/plain',Buffer.from('REA_FILE_2046'));await agent.act('Open rea-proof.txt with Bijlage openen: rea-proof.txt.');await expect(browser.locator('.live-file-lines')).toContainText('REA_FILE_2046');await expect(browser.locator('.live-file-line-number')).toHaveText('1');await screen.getByRole('button','Sluiten',{exact:true}).click();
 await deliver(browser,screen,'facts.json','application/json',Buffer.from('{"exact":"<script>inert</script>","value":42}'));await screen.getByRole('button','Bijlage openen: facts.json',{exact:true}).click();await expect(browser.locator('.live-file-lines')).toContainText('"value": 42');await expect(browser.locator('.live-file-lines script')).toHaveCount(0);await screen.getByRole('button','Sluiten',{exact:true}).click();
 await deliver(browser,screen,'facts.csv','text/csv',Buffer.from('Name,Value\n"Exact, quoted",42'));await screen.getByRole('button','Bijlage openen: facts.csv',{exact:true}).click();await expect(screen.getByRole('cell','Exact, quoted',{exact:true})).toBeVisible();await screen.getByRole('button','Sluiten',{exact:true}).click();
 await deliver(browser,screen,'facts.md','text/markdown',Buffer.from('# MARKDOWN_VERIFIED_2046\n\n**Actual bold**'));await screen.getByRole('button','Bijlage openen: facts.md',{exact:true}).click();await expect(browser.frameLocator('.live-file-document').getByRole('heading','MARKDOWN_VERIFIED_2046',{exact:true})).toBeVisible();await screen.getByRole('button','Sluiten',{exact:true}).click();
 const external:string[]=[];await browser.route('https://preview-probe.invalid/**',async route=>{external.push(route.request.url);await route.abort();});
 await deliver(browser,screen,'facts.html','text/html',Buffer.from('<h1>HTML_VERIFIED_2046</h1><script>parent.previewExecuted=true</script><img src="https://preview-probe.invalid/steal"><meta http-equiv="refresh" content="0;url=https://preview-probe.invalid/nav"><a href="https://preview-probe.invalid/link">Safe explicit link</a><a href="javascript:parent.bad=1">Unsafe link</a><img alt="Inline raster" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><img alt="Unsafe SVG" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">'));await screen.getByRole('button','Bijlage openen: facts.html',{exact:true}).click();await expect(browser.frameLocator('.live-file-document').getByRole('heading','HTML_VERIFIED_2046',{exact:true})).toBeVisible();await expect(browser.locator('.live-file-document')).toHaveAttribute('sandbox','');await expect(browser.frameLocator('.live-file-document').getByRole('link','Safe explicit link',{exact:true})).toHaveAttribute('rel','noopener noreferrer');await expect(browser.frameLocator('.live-file-document').getByRole('img','Inline raster',{exact:true})).toHaveAttribute('src',/^data:image\/gif;base64,/);await expect(browser.frameLocator('.live-file-document').getByRole('img','Unsafe SVG',{exact:true})).not.toHaveAttribute('src');expect(external).toEqual([]);expect(await browser.evaluate(()=>Object.hasOwn(window,'previewExecuted'))).toBe(false);await screen.getByRole('button','Sluiten',{exact:true}).click();
 await deliver(browser,screen,'archive.zip','application/zip',Buffer.from('PK synthetic unsupported'));await screen.getByRole('button','Bijlage openen: archive.zip',{exact:true}).click();await expect(browser.locator('.live-file-body')).toHaveText('Voor dit bestand is geen voorbeeld beschikbaar. Download het bestand om het te openen.');await screen.getByRole('button','Sluiten',{exact:true}).click();
});

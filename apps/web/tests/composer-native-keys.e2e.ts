import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {setComposerText,expectComposerText} from './fixtures/composer-assertions';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser){protocol=await startWorkflowProtocolServer({port:18896});await browser.goto(protocol.baseUrl);}
async function selection(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerSelection(document.querySelector('#message-input'));});}
async function select(browser:Browser,start:number,end=start,direction='forward'){await browser.evaluate(async({start,end,direction})=>{const path='/composer-input.js',module=await import(path);module.setComposerSelection(document.querySelector('#message-input'),start,end,direction);},{start,end,direction});}

test('mac Ctrl-A/E uses hard-break boundaries and Shift extends from the original anchor',async({browser,screen})=>{
 await open(browser);expect(await browser.evaluate(()=>navigator.platform)).toMatch(/Mac/i);
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await setComposerText(browser,'first\nsecond\nlast');await input.focus();
 await select(browser,9);await input.press('Control+a');expect((await selection(browser)).start).toBe(6);
 await input.press('Control+e');expect((await selection(browser)).start).toBe(12);
 await input.press('Control+Shift+a');expect(await selection(browser)).toEqual({start:6,end:12,direction:'backward'});
 await input.press('Control+Shift+e');expect(await selection(browser)).toEqual({start:12,end:12,direction:'forward'});
 await select(browser,9);await input.press('Control+Shift+e');expect(await selection(browser)).toEqual({start:9,end:12,direction:'forward'});
 await input.press('Control+a');await input.pressSequentially('X');await expectComposerText(browser,'first\nXsecond\nlast');
 await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('mac line motion respects a list textblock and an inline skill atom',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await browser.evaluate(async()=>{
  const path='/composer-input.js',projectionPath='/composer-document.js',module=await import(path),projection=await import(projectionPath),controller=module.composerController(document.querySelector('#message-input'));
  const documentValue={type:'doc',content:[{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'before '},{type:'workflowReference',attrs:{id:'synthetic-motion',label:'Atom',iconId:null,iconUrl:null}},{type:'text',text:' after'},{type:'hardBreak'},{type:'text',text:'second'}]}]}]}]};
  controller.restore({text:projection.projectComposerDocument(documentValue),richText:JSON.stringify(documentValue),references:[{id:'synthetic-motion',label:'Atom',revision:1,description:'Synthetic motion identity.'}]},{resetHistory:true});
 });
 await input.focus();await select(browser,12);await input.press('Control+a');expect((await selection(browser)).start).toBe(2);
 await input.press('Control+e');expect((await selection(browser)).start).toBe(20);
 await input.press('ArrowRight');await input.press('Control+e');expect((await selection(browser)).start).toBe(29);
 await input.press('Control+Shift+a');expect(await selection(browser)).toEqual({start:23,end:29,direction:'backward'});
 await expect(browser.locator('#message-input [data-type="skill-reference"]')).toHaveCount(1);
 await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('real browser clipboard permission either supplies plain text or preserves the draft on denial',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.focus();
 const value='REA plain <b>literal</b>\nsecond';
 await setComposerText(browser,value);await input.press('ControlOrMeta+a');await input.press('ControlOrMeta+c');await setComposerText(browser,'');
 await browser.evaluate(()=>{
  const state=window as Window&{__realRead?:{kind:string;name?:string}},read=navigator.clipboard.readText.bind(navigator.clipboard);
  Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:async()=>{try{const text=await read();state.__realRead={kind:'text'};return text;}catch(error){state.__realRead={kind:'error',name:error instanceof DOMException?error.name:'Error'};throw error;}}});
 });
 await input.press('ControlOrMeta+Shift+v');
 await expect.poll(()=>browser.evaluate(()=>(window as Window&{__realRead?:{kind:string;name?:string}}).__realRead?.kind)).toBeDefined();
 const result=await browser.evaluate(()=>(window as Window&{__realRead?:{kind:string;name?:string}}).__realRead);
 if(!result)throw Error('Missing actual clipboard outcome');
 if(result.kind==='error'){expect(result.name).toBe('NotAllowedError');await expectComposerText(browser,'');}
 else await expectComposerText(browser,value);
 await expect(browser.locator('#message-input b')).toHaveCount(0);await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('synthetic async clipboard text passes through the real shortcut and native plain paste',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.focus();
 const value='REA boundary <b>literal</b>\r\nsecond\n';
 await browser.evaluate(value=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>value}});},value);
 await input.press('ControlOrMeta+Shift+v');await expectComposerText(browser,'REA boundary <b>literal</b>\nsecond');
 await expect(browser.locator('#message-input b')).toHaveCount(0);await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('plain clipboard boundary handles repeated keys failure and a disconnected editor without stale edits',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await setComposerText(browser,'keep');await input.focus();
 await browser.evaluate(()=>{
  const state=window as Window&{__plainReads:number;__plainResolve?:(value:string)=>void};state.__plainReads=0;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>{state.__plainReads++;return new Promise<string>(resolve=>{state.__plainResolve=resolve;});}}});
 });
 await input.press('ControlOrMeta+Shift+v');
 expect(await browser.evaluate(()=>(window as Window&{__plainReads:number}).__plainReads)).toBe(1);
 const guard=await browser.evaluate(()=>{
  const input=document.querySelector('#message-input');if(!input)throw Error('Missing editor');
  const event=new KeyboardEvent('keydown',{key:'v',metaKey:true,shiftKey:true,repeat:true,bubbles:true,cancelable:true});input.dispatchEvent(event);
  return {prevented:event.defaultPrevented,reads:(window as Window&{__plainReads:number}).__plainReads};
 });expect(guard).toEqual({prevented:true,reads:1});
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await browser.evaluate(()=>{(window as Window&{__plainResolve?:(value:string)=>void}).__plainResolve?.('STALE_CLIPBOARD');});
 await expectComposerText(browser,'');expect(await browser.evaluate(()=>document.activeElement?.id)).not.toBe('message-input');
 await input.focus();await browser.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{throw new DOMException('Synthetic denied','NotAllowedError');}}});});
 await input.press('ControlOrMeta+Shift+v');await expectComposerText(browser,'');
 await expect(browser.locator('.message.user')).toHaveCount(0);
});

test('synthetic image data URL stages exact file bytes through the existing paste boundary',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await setComposerText(browser,'keep image draft');
 const encoded=await browser.evaluate(async()=>{
  const response=await fetch('/tests/fixtures/profile.png');if(!response.ok)throw Error('Synthetic image fixture missing');
  const bytes=new Uint8Array(await response.arrayBuffer());return btoa(String.fromCharCode(...bytes));
 });
 await browser.evaluate(encoded=>{
  const data=new DataTransfer();data.setData('text/plain','data:image/png;base64,'+encoded);document.querySelector('#message-input')?.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },encoded);
 await expect(screen.getByRole('button','Bijlage verwijderen: pasted-image.png',{exact:true})).toBeVisible();
 await expectComposerText(browser,'keep image draft');
 await browser.evaluate(encoded=>{const data=new DataTransfer();data.setData('text/plain','data:image/constructor;base64,'+encoded);document.querySelector('#message-input')?.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},encoded);
 await expect(screen.getByRole('button','Bijlage verwijderen: pasted-image.constructor',{exact:true})).toBeVisible();
 const stored=await browser.evaluate(async()=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('grok-local-attachments-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{const records=await new Promise<{name:string;blob:Blob}[]>((resolve,reject)=>{const request=database.transaction('files','readonly').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const record=records.find(record=>record.name==='pasted-image.png');if(!record)throw Error('Missing staged file');return {name:record.name,type:record.blob.type,encoded:btoa(String.fromCharCode(...new Uint8Array(await record.blob.arrayBuffer())))};}finally{database.close();}
 });
 expect(stored).toEqual({name:'pasted-image.png',type:'image/png',encoded});
 await expect(browser.locator('.message.user')).toHaveCount(0);
 await browser.reload();await expect(screen.getByRole('button','Bijlage verwijderen: pasted-image.png',{exact:true})).toBeVisible();
});

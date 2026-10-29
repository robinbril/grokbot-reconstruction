// Production editor and storage boundaries with synthetic, owned clipboard data.
// Composition events prove application guards, not an operating-system IME session.
import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
type Composer={text:string;richText?:string;references:{id:string;label:string;revision?:number}[]};
async function composer(browser:Browser):Promise<Composer>{return browser.evaluate(async()=>{
 const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));
});}
async function durable(browser:Browser):Promise<Composer>{return browser.evaluate(()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),key=state.selected||'new';
 return {text:state.drafts[key]||'',...(state.draftRichTexts?.[key]!==undefined?{richText:state.draftRichTexts[key]}:{}),references:state.composerSkillReferences?.[key]||[]};
});}
async function assertBinding(browser:Browser){
 const current=await composer(browser);expect(await durable(browser)).toEqual(current);
 expect(await browser.evaluate(async()=>{
  const inputPath='/composer-input.js',documentPath='/composer-document.js',input=await import(inputPath),validation=await import(documentPath);
  const value=input.readComposerInput(document.querySelector('#message-input'));
  return validation.normalizeComposerDocument(value.richText,{text:value.text,references:value.references})===value.richText;
 })).toBe(true);return current;
}
async function startFixture(){return startWorkflowProtocolServer({port:18892,model:{status:()=>({state:'ready',provider:'synthetic-composer-reliability'}),async complete({messages}){
 const context=messages.findLast(message=>message.role==='system'&&message.content.startsWith('Local delivery context:\n'));
 if(!context)throw Error('Missing delivery context');const delivery=JSON.parse(context.content.slice('Local delivery context:\n'.length));
 return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'REA_RELIABILITY_WARMUP_DONE'},reply_to:delivery.current_input_message_id}}]};
}}});}
async function canonical(browser:Browser):Promise<{runs:{status:string}[];queue:unknown[]}>{return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw Error('Snapshot '+response.status);return response.json();
});}
async function paste(browser:Browser,text:string,html=''){
 await browser.evaluate(({text,html})=>{
  const input=document.querySelector('#message-input');if(!input)throw Error('Missing editor');
  const data=new DataTransfer();data.setData('text/plain',text);if(html)data.setData('text/html',html);
  input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },{text,html});
}

test('local Shift+Enter inserts a hard break and sends the exact multiline document',async({browser,screen})=>{
 await browser.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});});
 protocol=await startFixture();await browser.goto(protocol.baseUrl);
 expect(await browser.evaluate(()=>navigator.onLine)).toBe(true);
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill('one');await input.press('Shift+Enter');await input.pressSequentially('two');
 expect((await assertBinding(browser)).text).toBe('one\ntwo');
 await expect(browser.locator('#message-input p br')).toHaveCount(1);
 await input.press('Enter');await expect(input).toHaveText('');
 await expect(browser.locator('.message.user [data-composer-document]')).toHaveText('one two');
 const saved=await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');return state.messages[state.selected].find((message:{role:string})=>message.role==='user');});
 expect(saved.text).toBe('one\ntwo');expect(saved.richText).toContain('hardBreak');
 await input.press('ControlOrMeta+z');await expect(input).toHaveText('');
});

test('failed typing keeps the latest inline draft visible and warns until storage recovers',async({browser,screen,agent,app})=>{
 protocol=await startFixture();await browser.goto(protocol.baseUrl);
 await agent.act('Open Marketing Agent en kies Echte harness. Verzend niets.');
 await expect(screen.getByRole('radio','Echte harness',{exact:true})).toBeChecked();
 const name='REA Opslagproef';await browser.evaluate(async name=>{
  const path='/live-harness-client.js',module=await import(path),client=module.createLiveHarnessClient();
  await client.createSkill({requestId:crypto.randomUUID(),name,description:'Synthetische opslagproef.',content:'REA_STORAGE_PRIVATE_BODY_8142'});
 },name);await browser.reload();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill('Bewaar @'+name);await screen.getByRole('option',name,{exact:true}).click();await input.pressSequentially('einde');
 await expect(browser.locator('.composer [data-type="skill-reference"]')).toHaveAccessibleName(name+' · Versie 1');
 const accepted=await assertBinding(browser);expect(accepted.references).toHaveLength(1);
 await browser.evaluate(()=>{
  const control=window as Window&{__reaComposerStorageBlocked:boolean};control.__reaComposerStorageBlocked=true;
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){
   if(this===localStorage&&key==='grok-local-replica-v1'&&control.__reaComposerStorageBlocked)throw new DOMException('Synthetic editor quota failure','QuotaExceededError');
   return original.call(this,key,value);
  };
 });
 await input.pressSequentially('X');
 await expect(browser.locator('[data-composer-save-status][role="status"]')).toContainText('Je nieuwste tekst blijft zichtbaar');
 await expect(input).toHaveText(accepted.text+'X');const unsaved=await composer(browser);expect(unsaved.text).toBe(accepted.text+'X');expect(unsaved.references).toEqual(accepted.references);expect(await durable(browser)).toEqual(accepted);
 await app.screenshot('composer-persistence-retained-feedback');
 await browser.evaluate(()=>{(window as Window&{__reaComposerStorageBlocked:boolean}).__reaComposerStorageBlocked=false;});
 await input.press('End');await input.pressSequentially('Y');await expect(input).toHaveText(accepted.text+'XY');
 await expect(browser.locator('[data-composer-save-status][role="status"]')).toBeHidden();
 const recovered=await assertBinding(browser);expect(recovered.text).toBe(accepted.text+'XY');expect(recovered.references).toEqual(accepted.references);
 await browser.reload();await expect(input).toHaveText(recovered.text);expect(await assertBinding(browser)).toEqual(recovered);
 await app.screenshot('composer-persistence-recovered-after-reload');
});

test('clipboard text stays literal, file paste takes priority, and composition guards do not submit work',async({browser,screen,app})=>{
 protocol=await startFixture();await browser.goto(protocol.baseUrl);
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REA_RELIABILITY_WARMUP');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');
 const multiline='alpha  beta\n\ngamma\tend';await input.fill('');await paste(browser,multiline);
 await expect(input).toHaveText('alpha beta gamma end');expect((await assertBinding(browser)).text).toBe(multiline);
 const literal='@REA Foreign\n<script>literal</script>';
 await input.fill('');await paste(browser,literal,'<p><span data-type="skill-reference" data-id="foreign-skill" data-label="REA Foreign">@REA Foreign</span><img src="https://example.test/never-load.png"></p>');
 await expect(input).toHaveText('@REA Foreign <script>literal</script>');
 const pasted=await assertBinding(browser);expect(pasted.text).toBe(literal);expect(pasted.references).toEqual([]);
 await expect(browser.locator('#message-input [data-type="skill-reference"]')).toHaveCount(0);await expect(browser.locator('#message-input img, #message-input script')).toHaveCount(0);
 const guarded=await browser.evaluate(()=>{
  const input=document.querySelector('#message-input');if(!input)throw Error('Missing editor');
  input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  const events=[new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true}),new KeyboardEvent('keydown',{key:'Enter',code:'Enter',shiftKey:true,isComposing:true,bubbles:true,cancelable:true}),new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,bubbles:true,cancelable:true}),new KeyboardEvent('keydown',{key:'Enter',code:'Enter',shiftKey:true,keyCode:229,bubbles:true,cancelable:true})];
  for(const event of events)input.dispatchEvent(event);
  input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));
  return events.map(event=>({composing:event.isComposing,keyCode:event.keyCode,shift:event.shiftKey}));
 });
 expect(guarded).toEqual([{composing:true,keyCode:0,shift:false},{composing:true,keyCode:0,shift:true},{composing:false,keyCode:229,shift:false},{composing:false,keyCode:229,shift:true}]);
 const afterGuard=await canonical(browser);expect(afterGuard.runs).toHaveLength(1);expect(afterGuard.queue).toHaveLength(0);expect(await assertBinding(browser)).toEqual(pasted);
 await screen.getByRole('radio','Lokale voorbeelden',{exact:true}).check();
 const fileBody='REA_CLIPBOARD_FILE_BYTES_6391\nExact synthetic bytes.\n',fileName='rea-paste.txt';
 await browser.evaluate(({fileBody,fileName})=>{
  const input=document.querySelector('#message-input');if(!input)throw Error('Missing editor');
  const data=new DataTransfer();data.items.add(new File([fileBody],fileName,{type:'text/plain'}));data.setData('text/plain','IGNORED_FILE_CLIPBOARD_TEXT');data.setData('text/html','<b>IGNORED_FILE_HTML</b>');
  input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },{fileBody,fileName});
 await expect(screen.getByRole('button','Bijlage verwijderen: '+fileName,{exact:true})).toBeVisible();
 await expect(browser.locator('.composer-wrap .attachment-limit')).not.toContainText('worden lokaal opgeslagen');expect(await assertBinding(browser)).toEqual(pasted);
 await input.press('Enter');await expect(screen.getByRole('button','Bijlage verwijderen: '+fileName,{exact:true})).toHaveCount(0);await expect(input).toHaveText('');
 const accepted=await browser.evaluate(fileName=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
  const entry=(state.messages[state.selected]||[]).find((entry:{role:string;attachments?:{id:string;name:string}[]})=>entry.role==='user'&&entry.attachments?.some(ref=>ref.name===fileName));
  if(!entry)throw Error('Accepted file entry missing');return {text:entry.text,richText:entry.richText,id:entry.attachments.find((ref:{name:string})=>ref.name===fileName).id,namespace:state.attachmentNamespace};
 },fileName);
 expect(accepted.text).toBe(pasted.text);expect(accepted.richText).toBe(pasted.richText);
 const stored=await browser.evaluate(async({id,namespace})=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('grok-local-attachments-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{const record=await new Promise<{blob:Blob}>((resolve,reject)=>{const request=database.transaction('files','readonly').objectStore('files').get(namespace+':'+id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return {text:await record.blob.text(),type:record.blob.type,size:record.blob.size};}finally{database.close();}
 },{id:accepted.id,namespace:accepted.namespace});
 expect(stored).toEqual({text:fileBody,type:'text/plain',size:new TextEncoder().encode(fileBody).length});
 expect((await canonical(browser)).runs).toHaveLength(1);expect((await canonical(browser)).queue).toHaveLength(0);
 await browser.reload();await screen.getByRole('button','Bijlage openen: '+fileName,{exact:true}).click();await expect(screen.getByRole('dialog',fileName,{exact:true})).toContainText(fileBody.trim());
 await app.screenshot('composer-file-priority-and-retained-bytes');
});

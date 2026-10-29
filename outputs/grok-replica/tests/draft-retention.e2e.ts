import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function composer(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));});}
async function blockStorage(browser:Browser){await browser.evaluate(()=>{const original=Storage.prototype.setItem;const control=window as Window&{__draftStorageBlocked:boolean};control.__draftStorageBlocked=true;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1'&&control.__draftStorageBlocked)throw new DOMException('Synthetic retained draft failure','QuotaExceededError');return original.call(this,key,value);};});}
async function recoverStorage(browser:Browser){await browser.evaluate(()=>{(window as Window&{__draftStorageBlocked:boolean}).__draftStorageBlocked=false;});}

test('unsaved typing survives Bot switching, rich paste and undo while atomic selection still rejects',async({app,browser,screen,agent})=>{
 await app.open('/');await agent.act('Open Marketing Agent. Do not send any message.');await expect(screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true})).toBeVisible();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('Durable original');
 const durable=await composer(browser);await blockStorage(browser);await input.press('End');await input.pressSequentially(' latest');
 await expect(input).toHaveText('Durable original latest');await expect(browser.locator('[data-composer-save-status]')).toContainText('Je nieuwste tekst blijft zichtbaar');
 const retained=await composer(browser);expect(retained.text).toBe('Durable original latest');
 await screen.getByRole('button','Find Customers',{exact:true}).click();await expect(input).toHaveText('');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await expect(input).toHaveText(retained.text);expect(await composer(browser)).toEqual(retained);
 await expect(browser.locator('[data-composer-save-status]')).toContainText('Je nieuwste tekst blijft zichtbaar');
 const selection={canvasId:'13ef3a12-60b7-4216-b4df-7b8fd3dd34ae',sourceFile:'source.canvas.tsx',selection:{stack:[{kind:'element',name:'h1',anchor:{line:3,column:7}}],tag:'h1',text:'No accidental insertion',rect:{x:1,y:2,width:30,height:40}}};
 expect(await browser.evaluate(async(selection)=>{const path='/composer-input.js',module=await import(path);return module.composerController(document.querySelector('#message-input')).insertCanvasSelection(selection);},selection)).toBe(false);expect(await composer(browser)).toEqual(retained);
 await input.press('End');await browser.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain',' link');data.setData('text/html','<a href="https://example.com"> link</a>');document.querySelector('#message-input')!.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 expect((await composer(browser)).richText).toContain('https://example.com');
 await input.press('ControlOrMeta+z');expect((await composer(browser)).text).toBe(retained.text);
 await input.press('ControlOrMeta+a');await browser.evaluate(()=>{const data=new DataTransfer();document.querySelector('#message-input')!.dispatchEvent(new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true}));});expect((await composer(browser)).text).toBe('');
 await input.press('ControlOrMeta+z');expect((await composer(browser)).text).toBe(retained.text);
 await input.press('ControlOrMeta+a');await browser.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain','pasted literally');document.querySelector('#message-input')!.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});expect((await composer(browser)).text).toBe('pasted literally');
 await input.press('ControlOrMeta+z');expect((await composer(browser)).text).toBe(retained.text);
 expect(await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');return state.drafts[state.selected];})).toBe(durable.text);
 await recoverStorage(browser);await input.press('End');await input.pressSequentially(' recovered');
 await expect(browser.locator('[data-composer-save-status]')).toBeHidden();const recovered=await composer(browser);
 await browser.reload();expect(await composer(browser)).toEqual(recovered);await app.screenshot('latest-draft-retained-and-recovered');
});

test('send after storage recovery consumes the exact retained draft without another keystroke',async({app,browser,screen,agent})=>{
 await app.open('/');await agent.act('Open Marketing Agent. Keep Lokale voorbeelden selected and do not send yet.');await expect(screen.getByRole('radio','Lokale voorbeelden',{exact:true})).toBeChecked();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('Previously saved');await blockStorage(browser);await input.fill('  Latest retained exact  ');
 expect((await composer(browser)).text).toBe('  Latest retained exact  ');await expect(browser.locator('[data-composer-save-status]')).toContainText('Je nieuwste tekst blijft zichtbaar');
 await recoverStorage(browser);await screen.getByRole('button','Bericht sturen',{exact:true}).click();
 await expect(input).toHaveText('');await expect(browser.locator('.message.user')).toHaveCount(1);
 expect(await browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');return state.messages[state.selected].find((entry:{role:string})=>entry.role==='user').text;})).toBe('  Latest retained exact  ');
 await browser.reload();expect((await composer(browser)).text).toBe('');await expect(browser.locator('.message.user')).toHaveCount(1);
});

for(const warm of [true,false])test(`${warm?'warm':'cold'} emoji autoreplacement cannot swallow a typed colon when persistence rejects`,async({app,browser,screen})=>{
 await app.open('/');await screen.getByRole('button','Marketing Agent',{exact:true}).click();let release:()=>void=()=>{};
 if(!warm){const held=new Promise<void>(resolve=>{release=resolve;});await browser.route('**/assets/vendor/emoji/index.json',async route=>{await held;await route.continue();});}
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially(':smile');
 if(warm)await expect(browser.locator('#composer-emoji-list [role="option"]')).not.toHaveCount(0);
 await blockStorage(browser);await input.pressSequentially(':');
 expect((await composer(browser)).text).toBe(':smile:');await expect(browser.locator('[data-composer-save-status]')).toContainText('Je nieuwste tekst blijft zichtbaar');
 release();await recoverStorage(browser);await input.pressSequentially(' x');expect((await composer(browser)).text).toBe(':smile: x');
});

test('queue after storage recovery accepts the exact visible volatile document once',async({app,browser,screen})=>{
 let held=false,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 protocol=await startWorkflowProtocolServer({port:19044,model:{status:()=>({state:'ready',provider:'synthetic-draft-retention'}),async complete({messages,signal}){
  const content=messages.findLast(message=>message.role==='user')?.content;
  if(content==='REA_HOLD_VOLATILE_QUEUE'){held=true;await Promise.race([gate,new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);}
  const context=messages.findLast(message=>message.role==='system'&&message.content.startsWith('Local delivery context:\n'));
  const delivery=JSON.parse(context.content.slice('Local delivery context:\n'.length));
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'REA_RETENTION_QUEUE_DONE'},reply_to:delivery.current_input_message_id}}]};
 }}});
 try{
  await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
  const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REA_HOLD_VOLATILE_QUEUE');await input.press('Enter');await expect.poll(()=>held).toBe(true);
  await blockStorage(browser);await input.fill('  Queued latest exact  ');const retained=await composer(browser);expect(retained.text).toBe('  Queued latest exact  ');
  await recoverStorage(browser);await screen.getByRole('button','In wachtrij',{exact:true}).click();
  const current=()=>browser.evaluate(async()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));return response.json();});
  await expect.poll(async()=>(await current()).queue[0]?.status).toBe('queued');const accepted=await current();expect(accepted.queue).toHaveLength(1);expect(accepted.queue[0].payload.text).toBe(retained.text);expect(accepted.queue[0].payload.richText).toBe(retained.richText);await expect(input).toHaveText('');expect((await composer(browser)).text).toBe('');
  release();await expect.poll(async()=>(await current()).queue[0]?.status).toBe('completed');await browser.reload();expect((await composer(browser)).text).toBe('');expect((await current()).queue).toHaveLength(1);await app.screenshot('volatile-draft-queued-once-after-recovery');
 }finally{release();}
});

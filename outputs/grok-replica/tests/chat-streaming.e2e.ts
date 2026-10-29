// Adopted frozen cooperative Markdown scheduler contract.
// These hold REAL parser/work callbacks; no injected output or simulated model/tool events.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {expectComposerText,setComposerText} from './fixtures/composer-assertions';
const input='Vooraf\n\n```\n  const unchanged = 1;\n```\n\nFormule $x^2$. Een [bron](https://example.test/info).\n\n| Naam | Aantal |\n| --- | ---: |\n| A | 4 |\n\nDaarna\n'+Array.from({length:100},(_,i)=>`regel ${i} ${'werk '.repeat(85)}\n`).join('');
async function heldBoot(app:any,browser:any,screen:any,text=input){
 await browser.addInitScript(()=>{const w=window as any,raf=requestAnimationFrame.bind(window);w.__chatHeld=[];w.__chatAuto=false;
  window.requestAnimationFrame=(callback:FrameRequestCallback)=>!w.__chatAuto&&/chat-local-adapter|chat-run-controller|chat-markdown/.test(new Error().stack||'')?(w.__chatHeld.push(callback),-w.__chatHeld.length):raf(callback);
 });await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});await screen.getByRole('button','Marketing Agent').click();
 await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Gespreksbewerking').click();const settings=screen.getByRole('dialog','Gespreksbewerking');await settings.getByLabel('Lokale bewerking').selectOption({value:'markdown'});await settings.getByLabel('Uitvoervorm').selectOption({value:'short'});await settings.getByLabel('Antwoordweergave').selectOption({value:'elevated'});await settings.getByRole('button','Gebruiken').click();await expect(settings).toHaveCount(0);if(text.includes('\n'))await setComposerText(browser,text);else await screen.getByRole('textbox','Bericht sturen naar Bot').fill(text);await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);
}
async function release(browser:any){await browser.evaluate(()=>{const cb=(window as any).__chatHeld.shift();if(!cb)throw Error('No actual work callback held');cb(performance.now());});}
async function finishRealWork(browser:any){await browser.evaluate(()=>{const w=window as any;w.__chatAuto=true;for(const cb of w.__chatHeld.splice(0))cb(performance.now());});}
async function receipt(browser:any){return browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns||{})[0] as any;return r?.delivery??null;});}
// Read actual presentation semantics, ignoring generated IDs/highlighter wrappers.
async function semanticFrames(browser:any,id:string){return browser.evaluate((id:string)=>{
 const root=document.querySelector(`[data-chat-entry-id="${id}"]`)!;
 const mathTree=(node:Element):any=>({tag:node.localName,attrs:['display','encoding','mathvariant'].map(k=>[k,node.getAttribute(k)]).filter(([,v])=>v!==null),children:Array.from(node.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE||n.nodeType===Node.ELEMENT_NODE).map(n=>n.nodeType===Node.TEXT_NODE?n.textContent:mathTree(n as Element))});
 return Array.from(root.children).filter(n=>n.hasAttribute('data-chat-frame')).map(frame=>({kind:frame.getAttribute('data-chat-frame'),
  prose:Array.from(frame.querySelectorAll('p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol')).map(n=>({tag:n.localName,text:n.textContent})),
  code:Array.from(frame.querySelectorAll('pre code')).map(n=>n.textContent),math:Array.from(frame.querySelectorAll('math')).map(mathTree),
  tables:Array.from(frame.querySelectorAll('table')).map(t=>Array.from(t.querySelectorAll('tr')).map(tr=>Array.from(tr.children).map(c=>({tag:c.localName,scope:c.getAttribute('scope'),align:getComputedStyle(c).textAlign,text:c.textContent})))),
  links:Array.from(frame.querySelectorAll('a')).map(a=>({text:a.textContent,href:a.getAttribute('href'),target:a.getAttribute('target'),rel:a.getAttribute('rel')}))}));
 },id);}

// E09/E17/E18: send-message kind remains stable; only final current split run is live.
test('actual Markdown stream exposes one last live split run and ends at identical saved bytes',async({app,screen,browser})=>{
 await heldBoot(app,browser,screen);await expect(browser.locator('.message.bot table')).toHaveCount(1);await expect(screen.getByText('Lokale Markdown-weergave')).toBeVisible();
 const first=await browser.evaluate(()=>{const root=document.querySelector('.message.bot [data-chat-entry-id]')!;return {id:root.getAttribute('data-chat-entry-id'),kind:root.getAttribute('data-chat-kind'),frames:Array.from(root.children).filter(n=>n.hasAttribute('data-chat-frame')).map(n=>({kind:n.getAttribute('data-chat-frame'),live:n.getAttribute('data-chat-streaming')})),length:root.textContent!.length,tableOutside:!root.querySelector('table')!.closest('[data-chat-frame="prose"]')};});
 expect(first.kind).toBe('send-message');expect(first.frames).toEqual([{kind:'prose',live:'false'},{kind:'table',live:'false'},{kind:'prose',live:'true'}]);expect(first.tableOutside).toBe(true);expect(await receipt(browser)).toBeNull();
 await release(browser);await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);expect(await browser.evaluate(()=>document.querySelector('.message.bot [data-chat-entry-id]')!.textContent!.length)).toBeGreaterThan(first.length);
 await finishRealWork(browser);await expect.poll(()=>receipt(browser)).not.toBeNull();
 const final=await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any,m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId),root=document.querySelector('.message.bot [data-chat-entry-id]')!;return {id:m.id,text:m.text,kind:m.transcript.kind,status:m.transcript.status,scope:r.delivery.scope,live:Array.from(root.children).filter(n=>n.hasAttribute('data-chat-frame')).map(n=>n.getAttribute('data-chat-streaming')),entryCount:s.messages[r.conversationId].filter((m:any)=>m.id===r.outputEntryId).length};});
 expect(final).toEqual({id:first.id,text:input,kind:'send-message',status:'stable',scope:'browser-local',live:['false','false','false'],entryCount:1});
 await expect(browser.locator(`[data-chat-entry-id="${first.id}"] math`)).toHaveCount(1);const liveSemantics=await semanticFrames(browser,first.id!);
 expect(liveSemantics.map((f:any)=>f.kind)).toEqual(['prose','table','prose']);expect(liveSemantics[0].code).toEqual(['  const unchanged = 1;']);expect(liveSemantics[0].math.length).toBe(1);expect(liveSemantics[0].links).toEqual([{text:'bron',href:'https://example.test/info',target:'_blank',rel:'noopener noreferrer'}]);expect(liveSemantics[1].tables[0][1].map((c:any)=>c.text)).toEqual(['A','4']);
 await browser.reload();await expect(browser.locator(`[data-chat-entry-id="${first.id}"] math`)).toHaveCount(1);await expect(browser.locator(`[data-chat-entry-id="${first.id}"] table`)).toHaveCount(1);expect(await semanticFrames(browser,first.id!)).toEqual(liveSemantics);
 expect(await browser.evaluate((id:string)=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any;return s.messages[r.conversationId].find((m:any)=>m.id===id).text;},first.id)).toBe(input);
});

test('real Markdown updates retain code control composer backward selection and reader anchor',async({app,screen,browser})=>{
 await heldBoot(app,browser,screen);await expect(browser.locator('.message.bot [data-chat-entry-id] .code-copy')).toHaveCount(1);await screen.getByRole('textbox','Bericht sturen naar Bot').fill('selecteer deze tekst');
 // Let this entry's source insertion transform finish before measuring a later streamed update.
 await browser.evaluate(async()=>{const body=document.querySelector('.message.bot [data-chat-entry-id]')!;await Promise.all(body.getAnimations().filter((a:any)=>a.animationName==='sand-1rqlz9z-B').map(a=>a.finished));});
 await browser.evaluate(async()=>{const modulePath='/composer-input.js';const {setComposerSelection}=await import(modulePath);const w=window as any,i=document.querySelector('#message-input') as HTMLElement;i.focus();setComposerSelection(i,2,12,'backward');w.__input=i;w.__code=document.querySelector('.message.bot [data-chat-entry-id] .code-copy');w.__frame=document.querySelector('.message.bot [data-chat-entry-id] [data-chat-frame="prose"]');const t=document.querySelector('.transcript')!;t.scrollTop=0;w.__anchor=w.__frame.getBoundingClientRect().top;});
 await release(browser);await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);
 expect(await browser.evaluate(async()=>{const modulePath='/composer-input.js';const {composerSelection}=await import(modulePath);const w=window as any,i=document.querySelector('#message-input') as HTMLElement,s=composerSelection(i);return {sameInput:i===w.__input,focus:document.activeElement===i,selection:[s.start,s.end,s.direction],sameCode:document.querySelector('.message.bot [data-chat-entry-id] .code-copy')===w.__code,connected:w.__code.isConnected};})).toEqual({sameInput:true,focus:true,selection:[2,12,'backward'],sameCode:true,connected:true});expect(await browser.evaluate(()=>Math.abs((window as any).__frame.getBoundingClientRect().top-(window as any).__anchor))).toBeLessThanOrEqual(1);
 await browser.evaluate(()=>{const w=window as any;w.__clipboard=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(t:string)=>w.__clipboard.push(t)}});});await browser.locator('.message.bot [data-chat-entry-id] .code-copy').click();expect(await browser.evaluate(()=>(window as any).__clipboard)).toEqual(['  const unchanged = 1;']);
 await screen.getByRole('button','Bijvoegen').click();await screen.getByRole('menuitem','Gespreksbewerking').click();const settings=screen.getByRole('dialog','Gespreksbewerking');await settings.getByLabel('Antwoordweergave').selectOption({value:'bubble'});await settings.getByRole('button','Gebruiken').click();await expect(settings).toHaveCount(0);
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any,m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);return {future:s.chatPreferences.marketing.layoutMode,accepted:m.transcript.payload.layoutMode,frames:Array.from(document.querySelector('.message.bot [data-chat-entry-id]')!.children).filter(n=>n.hasAttribute('data-chat-frame')).map(n=>n.getAttribute('data-chat-frame')),sameCode:document.querySelector('.message.bot [data-chat-entry-id] .code-copy')===(window as any).__code};})).toEqual({future:'bubble',accepted:'elevated',frames:['prose','table','prose'],sameCode:true});
 await finishRealWork(browser);await expect.poll(()=>receipt(browser)).not.toBeNull();expect(await browser.evaluate(()=>Array.from(document.querySelector('.message.bot [data-chat-entry-id]')!.children).filter(n=>n.hasAttribute('data-chat-frame')).map(n=>n.getAttribute('data-chat-frame')))).toEqual(['prose','table','prose']);
});

test('failed cancellation write still revokes held parser callbacks and final delivery',async({app,screen,browser})=>{
 await heldBoot(app,browser,screen);const before=await browser.evaluate(()=>({text:Array.from(document.querySelectorAll('.message.bot [data-chat-entry-id] [data-chat-frame]')).map(n=>n.textContent),held:(window as any).__chatHeld.length}));
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&Object.values(JSON.parse(v).chatRuns||{}).some((r:any)=>r.phase==='cancelled'))throw new DOMException('Denied cancel','QuotaExceededError');return write.call(this,k,v);};});await screen.getByRole('button','Stoppen').click();await expect(screen.getByText('Gestopt; status nog niet opgeslagen')).toBeVisible();
 await finishRealWork(browser);await expect(screen.getByText('Gestopt; status nog niet opgeslagen')).toBeVisible();expect(await receipt(browser)).toBeNull();
 expect(await browser.evaluate(()=>Array.from(document.querySelectorAll('.message.bot [data-chat-entry-id] [data-chat-frame]')).map(n=>n.textContent))).toEqual(before.text);expect(before.held).toBeGreaterThan(0);await expect(screen.getByRole('button','Resultaat opslaan')).toHaveCount(0);
 await browser.reload();await expect(screen.getByText('Onderbroken')).toBeVisible();await expect(screen.getByRole('button','Lokaal hervatten')).toBeVisible();
});

test('incidental Markdown checkpoint reload preserves text but never fabricates a receipt',async({app,screen,browser})=>{
 await heldBoot(app,browser,screen);await screen.getByRole('textbox','Bericht sturen naar Bot').fill('checkpoint door bestaande composer');
 const saved=await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any,m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);return {id:r.id,entryId:r.outputEntryId,generation:r.generation,delivery:r.delivery,text:m.text,kind:m.transcript.kind};});expect(saved.delivery).toBeNull();expect(saved.text.length).toBeGreaterThan(0);expect(saved.kind).toBe('send-message');
 await browser.reload();await expect(screen.getByText('Onderbroken')).toBeVisible();expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any,m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);return {id:r.id,entryId:r.outputEntryId,generation:r.generation,delivery:r.delivery,text:m.text,kind:m.transcript.kind};})).toEqual(saved);await expectComposerText(browser,'checkpoint door bestaande composer');
});

test('failed reload checkpoint has same-page status retry without recomputing or claiming final delivery',async({app,screen,browser})=>{
 await heldBoot(app,browser,screen);await screen.getByRole('textbox','Bericht sturen naar Bot').fill('bewaar dit nieuwe concept');
 const before=await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any,m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);return {id:r.id,outputId:m.id,text:m.text,generation:r.generation};});
 await browser.addInitScript(()=>{const w=window as any,write=Storage.prototype.setItem;w.__denyReloadCheckpoint=true;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&w.__denyReloadCheckpoint&&Object.values(JSON.parse(v).chatRuns||{}).some((r:any)=>r.phase==='interrupted'))throw new DOMException('Denied reload checkpoint','QuotaExceededError');return write.call(this,k,v);};});
 await browser.reload();await expect(screen.getByText('Onderbroken; status nog niet opgeslagen',{exact:true})).toBeVisible();await expect(screen.getByRole('button','Lokaal hervatten')).toHaveCount(0);await expect(screen.getByRole('button','Status opslaan',{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>(window as any).__chatHeld.length)).toBe(0);
 await browser.evaluate(()=>{(window as any).__denyReloadCheckpoint=false;});await screen.getByRole('button','Status opslaan',{exact:true}).click();await expect(screen.getByRole('button','Lokaal hervatten')).toBeVisible();
 expect(await browser.evaluate(()=>{const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),r=Object.values(s.chatRuns)[0] as any,m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);return {id:r.id,outputId:m.id,text:m.text,generation:r.generation,phase:r.phase,delivery:r.delivery,held:(window as any).__chatHeld.length,draft:s.drafts.marketing};})).toEqual({...before,phase:'interrupted',delivery:null,held:0,draft:'bewaar dit nieuwe concept'});
});

// Independent renderer review: unchanged nested code still advances async ownership.
test('nested code ignores stale clipboard completion after a real streamed revision',async({app,screen,browser})=>{
 const text='- outer\n\n  ```js\n  const x=1\n  ```\n\n'+Array.from({length:100},(_,i)=>`tail ${i} ${'work '.repeat(85)}\n`).join('');
 await heldBoot(app,browser,screen,text);const copy=browser.locator('.message.bot [data-chat-entry-id] li .chat-code-block button');await expect(copy).toHaveText('Code kopiëren');
 await browser.evaluate(()=>{const w=window as any;w.__nestedCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(text:string)=>new Promise<void>(resolve=>{w.__nestedCopies.push(text);w.__resolveNestedCopy=resolve;})}});w.__nestedButton=document.querySelector('.message.bot li .chat-code-block button');});
 await copy.click();expect(await browser.evaluate(()=>(window as any).__nestedCopies)).toEqual(['const x=1']);await release(browser);await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);
 expect(await browser.evaluate(()=>document.querySelector('.message.bot li .chat-code-block button')===(window as any).__nestedButton)).toBe(true);
 await browser.evaluate(async()=>{(window as any).__resolveNestedCopy();await Promise.resolve();await Promise.resolve();});await expect(copy).toHaveText('Code kopiëren');
 await finishRealWork(browser);await expect.poll(()=>receipt(browser)).not.toBeNull();
});

// PROPOSAL ONLY: append to tests/chat-streaming.e2e.ts after source freeze ends.
// Reuses that file's heldBoot, release, finishRealWork, and receipt helpers.
// All writes below come from real composer input or actual adapter completion.
test('running progress warning tracks successful actual composer checkpoints without claiming delivery',async({app,screen,browser})=>{
 const text='abcdefghijklmnopqrstuvwxyz'.repeat(600); // 15,600 bytes: more than three real work chunks.
 await heldBoot(app,browser,screen,text);
 const entry=browser.locator('.message.bot [data-chat-entry-id]');
 const status=browser.locator('.chat-run-status [role="status"]');
 const composer=screen.getByRole('textbox','Bericht sturen naar Bot');
 const stored=()=>browser.evaluate(()=>{
  const bytes=localStorage.getItem('grok-local-replica-v1')!,s=JSON.parse(bytes),r=Object.values(s.chatRuns||{})[0] as any;
  const m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);
  return {bytes,runId:r.id,entryId:m.id,generation:r.generation,revision:m.transcript.revision,phase:r.phase,delivery:r.delivery,text:m.text,status:m.transcript.status,draft:s.drafts[r.conversationId]};
 });
 await expect(entry).toHaveText(text.slice(0,4096));
 await expect(status.getByText('Bezig',{exact:true})).toBeVisible();
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toBeVisible();
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);
 const initial=await stored();expect(initial.text).toBe('');expect(initial.delivery).toBeNull();expect(initial.phase).toBe('running');

 // Deny the real composer autosave; don't invoke the host writer or synthesize progress.
 await browser.evaluate(()=>{
  const w=window as any,write=Storage.prototype.setItem;w.__progressSaveDenied=true;w.__progressSaveAttempts=0;
  Storage.prototype.setItem=function(k,v){
   if(k==='grok-local-replica-v1'){w.__progressSaveAttempts++;if(w.__progressSaveDenied)throw new DOMException('Denied actual composer checkpoint','QuotaExceededError');}
   return write.call(this,k,v);
  };
 });
 await composer.fill('concept met geweigerde opslag');
 expect(await browser.evaluate(()=>(window as any).__progressSaveAttempts)).toBeGreaterThan(0);
 expect((await stored()).bytes).toBe(initial.bytes);
 await expect(entry).toHaveText(text.slice(0,4096));
 await expect(status.getByText('Bezig',{exact:true})).toBeVisible();
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toBeVisible();
 expect(await receipt(browser)).toBeNull();

 // A distinct actual composer edit retries the existing autosave path at exactly this live revision.
 await browser.evaluate(()=>{(window as any).__progressSaveDenied=false;});
 await composer.fill('concept met geslaagde opslag');
 const checkpoint=await stored();
 expect(checkpoint).toMatchObject({runId:initial.runId,entryId:initial.entryId,generation:initial.generation,phase:'running',delivery:null,text:text.slice(0,4096),status:'streaming',draft:'concept met geslaagde opslag'});
 expect(checkpoint.revision).toBeGreaterThan(initial.revision);
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toHaveCount(0);
 await expect(status.getByText('Bezig',{exact:true})).toBeVisible();
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);
 expect(await receipt(browser)).toBeNull();

 // Releasing one genuine held work callback publishes the next revision without saving it.
 await release(browser);
 await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);
 await expect(entry).toHaveText(text.slice(0,8192));
 expect((await stored()).bytes).toBe(checkpoint.bytes);
 await expect(status.getByText('Bezig',{exact:true})).toBeVisible();
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toBeVisible();
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);
 expect(await receipt(browser)).toBeNull();

 await finishRealWork(browser);await expect.poll(()=>receipt(browser)).not.toBeNull();
 const final=await stored();
 expect(final).toMatchObject({runId:initial.runId,entryId:initial.entryId,generation:initial.generation,phase:'delivered',text,status:'stable',draft:'concept met geslaagde opslag'});
 expect(final.delivery).toMatchObject({entryId:initial.entryId,generation:initial.generation,revision:final.revision,scope:'browser-local'});
 await expect(entry).toHaveText(text);
 await expect(status.getByText('Voltooid',{exact:true})).toBeVisible();
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toHaveCount(0);
 await browser.reload();await expect(entry).toHaveText(text);
 await expect(status.getByText('Voltooid',{exact:true})).toBeVisible();
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toHaveCount(0);
 expect(await stored()).toEqual(final);
});

// Append to tests/chat-streaming.e2e.ts only after root ends the source freeze.
// Reuses heldBoot/release/finishRealWork/receipt. Actual work and actual UI input only.
test('focused stop control survives real progress and composer checkpoints then cancels with keyboard Enter',async({app,screen,browser})=>{
 const text='abcdefghijklmnopqrstuvwxyz0123456789'.repeat(800); // Exactly 28,800 characters.
 await heldBoot(app,browser,screen,text);
 const entry=browser.locator('.message.bot [data-chat-entry-id]');
 const status=browser.locator('.chat-run-status [role="status"]');
 const stop=screen.getByRole('button','Stoppen',{exact:true});
 const composer=screen.getByRole('textbox','Bericht sturen naar Bot');
 const stored=()=>browser.evaluate(()=>{
  const bytes=localStorage.getItem('grok-local-replica-v1')!,s=JSON.parse(bytes),r=Object.values(s.chatRuns||{})[0] as any;
  const m=s.messages[r.conversationId].find((m:any)=>m.id===r.outputEntryId);
  return {bytes,runId:r.id,entryId:m.id,generation:r.generation,revision:m.transcript.revision,phase:r.phase,delivery:r.delivery,progress:r.progress,text:m.text,status:m.transcript.status,kind:m.transcript.kind,draft:s.drafts[r.conversationId]};
 });
 const originalControl=()=>browser.evaluate(()=>{
  const w=window as any,b=w.__observedStop;
  return {same:document.querySelector('.chat-run-status [data-action="chat-stop"]')===b,connected:b.isConnected,focused:document.activeElement===b,removals:w.__observedStopRemovals};
 });
 await expect(entry).toHaveText(text.slice(0,4096));
 await expect(status).toContainText('4096 / 28800');
 const initial=await stored();expect(initial.text).toBe('');expect(initial.delivery).toBeNull();
 await stop.focus();await expect(stop).toBeFocused();
 await browser.evaluate(()=>{
  const w=window as any,b=document.querySelector('.chat-run-status [data-action="chat-stop"]')!;
  w.__observedStop=b;w.__observedStopRemovals=0;
  w.__observedStopObserver=new MutationObserver(records=>{
   for(const record of records)for(const removed of record.removedNodes)if(removed===b||removed.contains(b))w.__observedStopRemovals++;
  });
  w.__observedStopObserver.observe(b.closest('.chat-run-status'),{childList:true,subtree:true});
 });
 expect(await originalControl()).toEqual({same:true,connected:true,focused:true,removals:0});

 // No refocus after release: the exact original control must retain native focus.
 await release(browser);
 await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);
 await expect(entry).toHaveText(text.slice(0,8192));
 await expect(status).toContainText('8192 / 28800');
 expect(await originalControl()).toEqual({same:true,connected:true,focused:true,removals:0});
 await expect(stop).toBeFocused();
 expect((await stored()).bytes).toBe(initial.bytes);expect(await receipt(browser)).toBeNull();

 // Real input intentionally moves focus to the composer and invokes the existing autosave.
 await composer.fill('bewaar concept naast lopende bewerking');
 await expect(composer).toBeFocused();
 const checkpoint=await stored();
 expect(checkpoint).toMatchObject({runId:initial.runId,entryId:initial.entryId,generation:initial.generation,phase:'running',delivery:null,text:text.slice(0,8192),status:'streaming',kind:'send-message',draft:'bewaar concept naast lopende bewerking',progress:{processed:8192,total:28800}});
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toHaveCount(0);
 expect(await originalControl()).toEqual({same:true,connected:true,focused:false,removals:0});
 await stop.focus();await expect(stop).toBeFocused();

 // A later real work chunk changes progress and restores the warning without replacing Stop.
 await release(browser);
 await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBeGreaterThan(0);
 await expect(entry).toHaveText(text.slice(0,12288));
 await expect(status).toContainText('12288 / 28800');
 await expect(status.getByText('Voortgang nog niet opgeslagen',{exact:true})).toBeVisible();
 expect(await originalControl()).toEqual({same:true,connected:true,focused:true,removals:0});
 await expect(stop).toBeFocused();expect((await stored()).bytes).toBe(checkpoint.bytes);
 await browser.evaluate(()=>{(window as any).__observedStopObserver.disconnect();});

 // Viewport keyboard input uses the existing focus; a locator press would refocus a replacement.
 await browser.keyboard.press('Enter');
 await expect(status.getByText('Gestopt',{exact:true})).toBeVisible();
 const cancelled=await stored();
 expect(cancelled).toMatchObject({runId:initial.runId,entryId:initial.entryId,generation:initial.generation+1,phase:'cancelled',delivery:null,text:text.slice(0,12288),status:'cancelled',kind:'send-message',draft:'bewaar concept naast lopende bewerking',progress:{processed:12288,total:28800}});
 expect(cancelled.revision).toBeGreaterThan(checkpoint.revision);
 await expect(entry).toHaveText(text.slice(0,12288));await expect(stop).toHaveCount(0);
 await expect(screen.getByRole('button','Resultaat opslaan',{exact:true})).toHaveCount(0);
 await expect(screen.getByRole('button','Lokaal hervatten',{exact:true})).toHaveCount(0);
 expect(await receipt(browser)).toBeNull();

 // These are actual previously captured callbacks, including the already-aborted work owner.
 await finishRealWork(browser);
 await expect.poll(()=>browser.evaluate(()=>(window as any).__chatHeld.length)).toBe(0);
 await expect(entry).toHaveText(text.slice(0,12288));
 await expect(status.getByText('Gestopt',{exact:true})).toBeVisible();
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);
 expect(await stored()).toEqual(cancelled);expect(await receipt(browser)).toBeNull();

 await browser.reload();await expect(entry).toHaveText(text.slice(0,12288));
 await expect(status.getByText('Gestopt',{exact:true})).toBeVisible();
 await expect(status.getByText('Voltooid',{exact:true})).toHaveCount(0);
 await expect(screen.getByRole('button','Lokaal hervatten',{exact:true})).toHaveCount(0);
 expect(await stored()).toEqual(cancelled);expect(await receipt(browser)).toBeNull();
 expect(await browser.evaluate(()=>(window as any).__chatHeld.length)).toBe(0);
});

import {expectComposerText} from './fixtures/composer-assertions';
// Adopted frozen actual legacy task failure/durability acceptance cases.
// Existing selectors are from product-task.js. Proposed new selectors/actions:
// card-scoped Resultaat opslaan, Status opslaan, and the exact unsaved feedback below.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

async function boot(app:any,browser:any,screen:any){
 await app.open('/?reset=1');await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
}
async function task(screen:any,input:string,operation='count',approval=false){
 await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();
 await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();
 await screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true}).fill(input);
 await screen.getByRole('combobox',{name:'Bewerking',exact:true}).selectOption({value:operation});
 if(approval)await screen.getByRole('checkbox',{name:'Eerst lokaal beoordelen',exact:true}).check();
 await screen.getByRole('button',{name:'Taak starten',exact:true}).click();
}
async function saved(browser:any,input:string){return browser.evaluate((text:string)=>{
 const s=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);
 const matches=s.messages.marketing.filter((m:any)=>m.localRun?.input===text);
 return {count:matches.length,message:matches.at(-1)??null,draft:s.drafts.marketing??''};
},input);}
async function arm(browser:any,input:string,stage:'output'|'complete'|'cancelled'){
 await browser.evaluate(({input,stage}:{input:string,stage:string})=>{
  const w=window as any,write=Storage.prototype.setItem,match=String.prototype.match;
  w.__legacyFault={input,stage,deny:true,denied:[],work:0};
  String.prototype.match=function(pattern:any){
   if(String(this)===input&&pattern instanceof RegExp&&pattern.source==='\\S+\\s*')w.__legacyFault.work++;
   return match.call(this,pattern);
  };
  Storage.prototype.setItem=function(k,v){
   if(k==='grok-local-replica-v1'){
    const candidate=JSON.parse(v),m=candidate.messages?.marketing?.find((m:any)=>m.localRun?.input===input),r=m?.localRun;
    const denies=r&&(stage==='output'?(r.committedOutput===true||r.status==='complete'):r.status===stage);
    if(w.__legacyFault.deny&&denies){w.__legacyFault.denied.push({messageId:m.id,run:structuredClone(r)});throw new DOMException('Denied legacy task stage','QuotaExceededError');}
   }
   return write.call(this,k,v);
  };
  w.__restoreLegacyFault=()=>{Storage.prototype.setItem=write;String.prototype.match=match;};
 },{input,stage});
}

// Four declarations; the first tests both independent unchecked output and terminal windows.
test('legacy real result survives denied output and final writes; retry saves exact result without recomputing',async({app,screen,browser})=>{
 for(const c of [
  {stage:'output' as const,operation:'count',input:'een twee drie',output:'3 woorden · 13 tekens · 1 regel'},
  {stage:'complete' as const,operation:'upper',input:'één Straße\n😀',output:'ÉÉN STRASSE\n😀'},
 ]){
  await boot(app,browser,screen);await arm(browser,c.input,c.stage);
  try{
   await task(screen,c.input,c.operation);
   await expect.poll(()=>browser.evaluate(()=>(window as any).__legacyFault.denied.length)).toBeGreaterThan(0);
   const denied=await browser.evaluate(()=>(window as any).__legacyFault.denied.at(-1));
   const card=browser.locator(`[data-local-run="${denied.run.id}"]`);
   // These proposed feedback strings distinguish denied output from denied final status.
   await expect(browser.locator(`[data-local-run="${denied.run.id}"] [data-run-feedback]`)).toContainText(c.stage==='output'?'Resultaat nog niet opgeslagen':'Afronding nog niet opgeslagen');
   await expect(browser.locator(`[data-local-run="${denied.run.id}"] [data-run-status]`)).not.toHaveText('Voltooid');
   await expect(browser.locator(`[data-local-run="${denied.run.id}"] [data-run-output]`)).toHaveText(c.output);await browser.evaluate(()=>{const w=window as any;w.__pendingMenuCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>w.__pendingMenuCopies.push(text)}});});await browser.locator(`[data-local-run="${denied.run.id}"] [data-run-output]`).secondaryTap();await screen.getByRole('menu','Berichtacties').getByRole('menuitem','Kopiëren',{exact:true}).click();expect(await browser.evaluate(()=>(window as any).__pendingMenuCopies)).toEqual([c.output]);
   const before=await saved(browser,c.input);expect(before.count).toBe(1);expect(before.message.id).toBe(denied.messageId);
   expect(before.message.localRun.status).not.toBe('complete');
   if(c.stage==='output')expect(before.message.localRun.committedOutput===true).toBe(false);
   else{expect(before.message.localRun.committedOutput).toBe(true);expect(before.message.localRun.output).toBe(c.output);}
   const work=await browser.evaluate(()=>(window as any).__legacyFault.work);expect(work).toBeGreaterThan(0);
   // Another legitimate writer must preserve unrelated state while a result is pending.
   await screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).fill('ander concept behouden');
   await screen.getByRole('button',{name:'Find Customers',exact:true}).click();
   await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
   await expect(browser.locator(`[data-local-run="${denied.run.id}"] [data-run-output]`)).toHaveText(c.output);
   await browser.evaluate(()=>{(window as any).__legacyFault.deny=false;});
   await card.getByRole('button',{name:'Resultaat opslaan',exact:true}).click();
   await expect.poll(async()=>(await saved(browser,c.input)).message.localRun.status).toBe('complete');
   await expect(browser.locator(`[data-local-run="${denied.run.id}"] [data-run-status]`)).toHaveText('Voltooid');
   const after=await saved(browser,c.input);expect(after.count).toBe(1);expect(after.message.id).toBe(denied.messageId);
   expect(after.message.localRun.id).toBe(denied.run.id);expect(after.message.localRun.output).toBe(c.output);
   expect(after.message.localRun.committedOutput).toBe(true);expect(after.draft).toBe('ander concept behouden');
   expect(await browser.evaluate(()=>(window as any).__legacyFault.work)).toBe(work);
   await app.open('/');const reloaded=await saved(browser,c.input);expect(reloaded.count).toBe(1);
   expect(reloaded.message.localRun.status).toBe('complete');expect(reloaded.message.localRun.output).toBe(c.output);
  }finally{await browser.evaluate(()=>(window as any).__restoreLegacyFault?.());}
 }
});

test('denied cancellation stops real owned work and late callbacks; explicit status retry cannot deliver a result',async({app,screen,browser})=>{
 await boot(app,browser,screen);const input=Array.from({length:1200},(_,i)=>`woord${i}`).join(' ');
 await task(screen,input,'upper',true);const accepted=await saved(browser,input),id=accepted.message.localRun.id;
 await arm(browser,input,'cancelled');
 // Gate only the existing product-task frame() yield; do not freeze UI animation clocks.
 // Scope must be reviewed if the function is renamed/refactored before test adoption.
 await browser.evaluate(()=>{
  const w=window as any,raf=requestAnimationFrame,cancel=cancelAnimationFrame;w.__legacyFrames=[];
  window.requestAnimationFrame=(callback:FrameRequestCallback)=>{
   const stack=new Error().stack||'';
   if(stack.includes('product-task.js')&&/\bat frame\b/.test(stack)){
    const record={id:0,callback,cancelled:false};record.id=raf(()=>{});w.__legacyFrames.push(record);return record.id;
   }return raf(callback);
  };
  window.cancelAnimationFrame=(id:number)=>{const held=w.__legacyFrames.find((r:any)=>r.id===id);if(held)held.cancelled=true;cancel(id);};
  w.__releaseLegacyFrames=async()=>{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;
   // Invoke already captured callbacks even if cancelled to exercise the stale-owner guard.
   for(const record of w.__legacyFrames)await new Promise<void>(resolve=>raf(t=>{record.callback(t);resolve();}));
   await new Promise<void>(resolve=>raf(()=>resolve()));};
 });
 try{
  const card=browser.locator(`[data-local-run="${id}"]`);await card.getByRole('button',{name:'Goedkeuren',exact:true}).click();
  await expect.poll(()=>browser.evaluate(()=>(window as any).__legacyFrames.length)).toBeGreaterThan(0);
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-counter]`)).toHaveText('512 woorden');
  const partial=await browser.locator(`[data-local-run="${id}"] [data-run-output]`).textContent();expect(partial).not.toBe(input.toLocaleUpperCase());
  await card.getByRole('button',{name:'Stoppen',exact:true}).click();
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-feedback]`)).toContainText('Gestopt; status nog niet opgeslagen');
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-status]`)).not.toHaveText('Voltooid');
  expect((await saved(browser,input)).message.localRun.status).toBe('running');expect(await browser.evaluate(()=>({pill:document.querySelectorAll('[data-product-run-status]:not([data-exiting])').length,roster:document.querySelectorAll('[data-local-working="true"]').length}))).toEqual({pill:0,roster:0});
  const work=await browser.evaluate(()=>(window as any).__legacyFault.work);
  await browser.evaluate(async()=>await (window as any).__releaseLegacyFrames());
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-output]`)).toHaveText(partial||'');
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-counter]`)).toHaveText('512 woorden');
  expect(await browser.evaluate(()=>(window as any).__legacyFault.work)).toBe(work);
  expect((await saved(browser,input)).message.localRun.status).toBe('running');expect(await browser.evaluate(()=>({pill:document.querySelectorAll('[data-product-run-status]:not([data-exiting])').length,roster:document.querySelectorAll('[data-local-working="true"]').length}))).toEqual({pill:0,roster:0});
  await browser.evaluate(()=>{(window as any).__legacyFault.deny=false;});
  await card.getByRole('button',{name:'Status opslaan',exact:true}).click();
  await expect.poll(async()=>(await saved(browser,input)).message.localRun.status).toBe('cancelled');
  expect((await saved(browser,input)).message.localRun.committedOutput===true).toBe(false);
  expect(await browser.evaluate(()=>(window as any).__legacyFault.work)).toBe(work);
 }finally{await browser.evaluate(async()=>{await (window as any).__releaseLegacyFrames?.();(window as any).__restoreLegacyFault?.();});}
});

test('reload after denied real result never fabricates completion or recomputes; denied interruption checkpoint is explicit',async({app,screen,browser})=>{
 await boot(app,browser,screen);const input='een twee drie';await arm(browser,input,'output');await task(screen,input);
 await expect.poll(()=>browser.evaluate(()=>(window as any).__legacyFault.denied.length)).toBeGreaterThan(0);
 const accepted=await saved(browser,input),id=accepted.message.localRun.id;
 // Runs only on the next document; exact run ID, namespace and interrupted status scope the failure.
 await browser.addInitScript(({input,id}:{input:string,id:string})=>{
  const w=window as any,write=Storage.prototype.setItem,match=String.prototype.match;w.__reloadLegacyWork=0;w.__reloadLegacyDenied=0;
  String.prototype.match=function(pattern:any){if(String(this)===input&&pattern instanceof RegExp&&pattern.source==='\\S+\\s*')w.__reloadLegacyWork++;return match.call(this,pattern);};
  Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'){
   const s=JSON.parse(v),run=s.messages?.marketing?.find((m:any)=>m.localRun?.id===id)?.localRun;
   if(run?.status==='interrupted'){w.__reloadLegacyDenied++;throw new DOMException('Denied interruption checkpoint','QuotaExceededError');}
  }return write.call(this,k,v);};
  w.__restoreReloadLegacy=()=>{Storage.prototype.setItem=write;String.prototype.match=match;};
 },{input,id});
 await app.open('/');await browser.evaluate(async()=>await (window as any).productSurfaces.ready);
 try{
  const card=browser.locator(`[data-local-run="${id}"]`);
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-feedback]`)).toContainText('Onderbroken; status nog niet opgeslagen');
  await expect(browser.locator(`[data-local-run="${id}"] [data-run-status]`)).not.toHaveText('Voltooid');
  expect((await saved(browser,input)).message.localRun.status).toBe('running');expect(await browser.evaluate(()=>({pill:document.querySelectorAll('[data-product-run-status]:not([data-exiting])').length,roster:document.querySelectorAll('[data-local-working="true"]').length}))).toEqual({pill:0,roster:0});
  expect((await saved(browser,input)).message.localRun.output??'').toBe('');
  expect(await browser.evaluate(()=>(window as any).__reloadLegacyWork)).toBe(0);
  expect(await browser.evaluate(()=>(window as any).__reloadLegacyDenied)).toBeGreaterThan(0);
  await browser.evaluate(()=>(window as any).__restoreReloadLegacy());
  await card.getByRole('button',{name:'Status opslaan',exact:true}).click();
  await expect.poll(async()=>(await saved(browser,input)).message.localRun.status).toBe('interrupted');
  const after=await saved(browser,input);expect(after.count).toBe(1);expect(after.message.id).toBe(accepted.message.id);
  expect(after.message.localRun.input).toBe(input);expect(after.message.localRun.output??'').toBe('');
  expect(after.message.localRun.committedOutput===true).toBe(false);
  expect(await browser.evaluate(()=>(window as any).__reloadLegacyWork)).toBe(0);
 }finally{await browser.evaluate(()=>(window as any).__restoreReloadLegacy?.());}
});

test('denied second-task acceptance preserves an already running real task owner and the rejected input',async({app,screen,browser})=>{
 await boot(app,browser,screen);const inputA='een twee drie',inputB='tweede taak blijft in het venster';
 await screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).fill('ongewijzigd concept');
 await browser.evaluate(({inputA,inputB}:{inputA:string,inputB:string})=>{
  const w=window as any,write=Storage.prototype.setItem,match=String.prototype.match,raf=requestAnimationFrame,cancel=cancelAnimationFrame;
  w.__acceptanceIdentity={aRunId:null,workA:0,deniedB:[],frames:[]};
  String.prototype.match=function(pattern:any){
   if(String(this)===inputA&&pattern instanceof RegExp&&pattern.source==='\\S+\\s*')w.__acceptanceIdentity.workA++;
   return match.call(this,pattern);
  };
  window.requestAnimationFrame=(callback:FrameRequestCallback)=>{
   const stack=new Error().stack||'';
   if(stack.includes('product-task.js')&&/\bat frame\b/.test(stack)){
    const record={id:raf(()=>{}),callback};w.__acceptanceIdentity.frames.push(record);return record.id;
   }return raf(callback);
  };
  Storage.prototype.setItem=function(k,v){
   if(k==='grok-local-replica-v1'&&w.__acceptanceIdentity.aRunId){
    const candidate=JSON.parse(v),messages=candidate.messages?.marketing||[];
    const b=messages.find((m:any)=>m.localRun?.input===inputB&&m.localRun.id!==w.__acceptanceIdentity.aRunId&&m.localRun.status==='running');
    const previous=JSON.parse(localStorage.getItem(k)||'{}'),previousIds=new Set((previous.messages?.marketing||[]).filter((m:any)=>m.localRun).map((m:any)=>m.localRun.id));
    // Only the actual attempted new B acceptance fails; A updates and unrelated writes still work.
    if(b&&!previousIds.has(b.localRun.id)){w.__acceptanceIdentity.deniedB.push({messageId:b.id,runId:b.localRun.id});throw new DOMException('Denied second task acceptance','QuotaExceededError');}
   }return write.call(this,k,v);
  };
  w.__releaseAcceptanceFrames=async()=>{
   window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;
   for(const record of w.__acceptanceIdentity.frames)await new Promise<void>(resolve=>raf(t=>{record.callback(t);resolve();}));
   await new Promise<void>(resolve=>raf(()=>resolve()));
  };
  w.__restoreAcceptanceIdentity=()=>{Storage.prototype.setItem=write;String.prototype.match=match;window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;};
 },{inputA,inputB});
 try{
  await task(screen,inputA);await expect.poll(()=>browser.evaluate(()=>(window as any).__acceptanceIdentity.frames.length)).toBeGreaterThan(0);
  const aBefore=await saved(browser,inputA),aRunId=aBefore.message.localRun.id,aMessageId=aBefore.message.id;
  await browser.evaluate((id:string)=>{(window as any).__acceptanceIdentity.aRunId=id;},aRunId);
  const cardA=browser.locator(`[data-local-run="${aRunId}"]`);await expect(browser.locator(`[data-local-run="${aRunId}"] [data-run-output]`)).toHaveText('3 woorden');
  expect(await browser.evaluate(()=>(window as any).__acceptanceIdentity.workA)).toBe(1);
  await task(screen,inputB,'upper');
  await expect(screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true})).toHaveValue(inputB);
  await expect(browser.locator('[data-task-create-status]')).toContainText('Taak niet bewaard');
  const bDenied=await browser.evaluate(()=>(window as any).__acceptanceIdentity.deniedB);
  expect(bDenied.length).toBe(1);expect((await saved(browser,inputB)).count).toBe(0);
  await expect(browser.locator(`[data-local-run="${bDenied[0].runId}"]`)).toHaveCount(0);
  expect((await saved(browser,inputA)).message.id).toBe(aMessageId);
  // Dismiss only the still-open rejected B form, then release A's real captured work continuation.
  await screen.getByRole('button',{name:'Annuleren',exact:true}).click();
  await expectComposerText(browser,'ongewijzigd concept');
  await browser.evaluate(async()=>await (window as any).__releaseAcceptanceFrames());
  await expect.poll(async()=>(await saved(browser,inputA)).message.localRun.status).toBe('complete');
  const aAfter=await saved(browser,inputA);expect(aAfter.count).toBe(1);expect(aAfter.message.id).toBe(aMessageId);
  expect(aAfter.message.localRun.id).toBe(aRunId);expect(aAfter.message.localRun.output).toBe('3 woorden · 13 tekens · 1 regel');
  await expect(browser.locator(`[data-local-run="${aRunId}"] [data-run-output]`)).toHaveText('3 woorden · 13 tekens · 1 regel');
  await expect(browser.locator(`[data-local-run="${aRunId}"] [data-run-status]`)).toHaveText('Voltooid');
  expect(await browser.evaluate(()=>(window as any).__acceptanceIdentity.workA)).toBe(1);
  expect((await saved(browser,inputB)).count).toBe(0);expect(aAfter.draft).toBe('ongewijzigd concept');
 }finally{await browser.evaluate(async()=>{await (window as any).__releaseAcceptanceFrames?.();(window as any).__restoreAcceptanceIdentity?.();});}
});


// F56: actual ordinary/ensure rejection must preserve active legacy task ownership.
// Test-served read-only state observer: no ownership logic, output, or status is altered.
async function observeOrdinaryLegacyOwner(app:any,browser:any){
 const response=await fetch(new URL('/app.js',app.baseUrl));if(!response.ok)throw Error('Cannot read actual app.js');
 const source=await response.text();
 await browser.route('**/app.js',async(route:any)=>route.fulfill({contentType:'text/javascript',body:source+'\nwindow.__ordinaryLegacyState = () => state;\n'}));
}
async function holdOrdinaryLegacyTask(browser:any,input:string){
 await browser.evaluate((input:string)=>{
  const w=window as any,write=Storage.prototype.setItem,match=String.prototype.match,raf=requestAnimationFrame,cancel=cancelAnimationFrame;
  const fault=w.__ordinaryLegacyFault={input,mode:'none',ordinary:'deny unrelated ordinary send',frames:[],denied:[],work:0,message:null,run:null,agentIds:[]};
  String.prototype.match=function(pattern:any){if(String(this)===input&&pattern instanceof RegExp&&pattern.source==='\\S+\\s*')fault.work++;return match.call(this,pattern);};
  window.requestAnimationFrame=(callback:FrameRequestCallback)=>{
   const stack=new Error().stack||'';
   if(stack.includes('product-task.js')&&/\bat frame\b/.test(stack)){const record={id:raf(()=>{}),callback};fault.frames.push(record);return record.id;}
   return raf(callback);
  };
  Storage.prototype.setItem=function(k,v){
   if(k==='grok-local-replica-v1'){
    const candidate=JSON.parse(v),ordinary=fault.mode==='ordinary'&&Object.values(candidate.messages||{}).some((list:any)=>Array.isArray(list)&&list.some((m:any)=>m.role==='user'&&m.text===fault.ordinary));
    const created=fault.mode==='ensure'&&(candidate.agents||[]).find((a:any)=>!fault.agentIds.includes(a.id)&&candidate.selected===a.id);
    if(ordinary||created){fault.denied.push({kind:ordinary?'ordinary':'ensure',selected:candidate.selected});throw new DOMException('Denied unrelated acceptance only','QuotaExceededError');}
   }
   return write.call(this,k,v);
  };
  w.__releaseOrdinaryLegacyFrames=async()=>{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;for(const record of fault.frames.splice(0))await new Promise<void>(resolve=>raf(t=>{record.callback(t);resolve();}));};
  w.__restoreOrdinaryLegacyFault=()=>{Storage.prototype.setItem=write;String.prototype.match=match;window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;};
 },input);
}
async function captureOrdinaryLegacyOwner(browser:any){
 await expect.poll(()=>browser.evaluate(()=>(window as any).__ordinaryLegacyFault.frames.length)).toBeGreaterThan(0);
 return browser.evaluate(()=>{
  const w=window as any,h=w.__ordinaryLegacyFault,s=w.__ordinaryLegacyState();
  const message=s.messages.marketing.find((m:any)=>m.localRun?.input===h.input);if(!message)throw Error('No actual accepted legacy task');
  h.message=message;h.run=message.localRun;
  return {messageId:message.id,runId:message.localRun.id,inputId:s.messages.marketing.find((m:any)=>m.role==='user'&&m.text===h.input).id};
 });
}
async function ordinaryLegacyIdentity(browser:any){return browser.evaluate(()=>{
 const w=window as any,h=w.__ordinaryLegacyFault,m=w.__ordinaryLegacyState().messages.marketing.find((m:any)=>m.id===h.message.id);
 return {message:m===h.message,run:m?.localRun===h.run};
});}
async function assertOrdinaryLegacyComplete(browser:any,screen:any,input:string,owner:any){
 await expect.poll(async()=>(await saved(browser,input)).message.localRun.status,{timeout:5000}).toBe('complete');
 const result=await saved(browser,input);expect(result.count).toBe(1);expect(result.message.id).toBe(owner.messageId);
 expect(result.message.localRun).toMatchObject({id:owner.runId,status:'complete',progress:1,wordCount:3,output:'3 woorden · 13 tekens · 1 regel',committedOutput:true});
 expect(await ordinaryLegacyIdentity(browser)).toEqual({message:true,run:true});
 expect(await browser.evaluate(()=>(window as any).__ordinaryLegacyFault.work)).toBe(1);
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await expect(browser.locator(`[data-local-run="${owner.runId}"] [data-run-output]`)).toHaveText('3 woorden · 13 tekens · 1 regel');
 await expect(browser.locator(`[data-local-run="${owner.runId}"] [data-run-status]`)).toHaveText('Voltooid');
}

test('denied ordinary send preserves active legacy owner and rejected draft reply attachments until real durable completion',async({app,screen,browser})=>{
 const input='een twee drie';await observeOrdinaryLegacyOwner(app,browser);await boot(app,browser,screen);await holdOrdinaryLegacyTask(browser,input);
 try{
  await task(screen,input);const owner=await captureOrdinaryLegacyOwner(browser);
  await expect(browser.locator(`[data-local-run="${owner.runId}"] [data-run-output]`)).toHaveText('3 woorden');
  const inputRow=browser.locator(`.message[data-message-id="${owner.messageId}"]`);await inputRow.click();await inputRow.getByRole('button',{name:'Beantwoorden',exact:true}).click();
  await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toContainText('Marketing Agent');
  await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);
  await expect(screen.getByRole('button',{name:'Bijlage verwijderen: pipeline.txt',exact:true})).toBeVisible();
  await screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).fill('deny unrelated ordinary send');
  const before=await browser.evaluate(()=>{const w=window as any,s=w.__ordinaryLegacyState();w.__ordinaryLegacyFault.mode='ordinary';return {quote:s.replyDrafts.marketing,consumed:s.attachmentConsumedIds,namespace:s.attachmentNamespace};});
  await screen.getByRole('button',{name:'Bericht sturen',exact:true}).click();
  await expect.poll(()=>browser.evaluate(()=>(window as any).__ordinaryLegacyFault.denied.length)).toBe(1);
  await expect(browser.locator('.attachment-error')).toContainText('Bericht niet opgeslagen. Je concept en bijlagen blijven behouden.');
  // Soft identity diagnostics preserve the mandatory real-continuation proof below.
  expect.soft(await ordinaryLegacyIdentity(browser)).toEqual({message:true,run:true});
  await expectComposerText(browser,'deny unrelated ordinary send');
  await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toContainText('Marketing Agent');
  await expect(screen.getByRole('button',{name:'Bijlage verwijderen: pipeline.txt',exact:true})).toBeVisible();
  expect(await browser.evaluate(()=>{const s=(window as any).__ordinaryLegacyState();return {quote:s.replyDrafts.marketing,consumed:s.attachmentConsumedIds,namespace:s.attachmentNamespace};})).toEqual(before);
  expect(await browser.evaluate(()=>Object.values((window as any).__ordinaryLegacyState().messages).flat().filter((m:any)=>m.role==='user'&&m.text==='deny unrelated ordinary send').length)).toBe(0);
  await browser.evaluate(async()=>await (window as any).__releaseOrdinaryLegacyFrames());
  await assertOrdinaryLegacyComplete(browser,screen,input,owner);
  await expectComposerText(browser,'deny unrelated ordinary send');
  await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toContainText('Marketing Agent');
  await expect(screen.getByRole('button',{name:'Bijlage verwijderen: pipeline.txt',exact:true})).toBeVisible();
  await app.open('/');const reloaded=await saved(browser,input);expect(reloaded.count).toBe(1);expect(reloaded.message.id).toBe(owner.messageId);expect(reloaded.message.localRun.status).toBe('complete');expect(reloaded.message.localRun.output).toBe('3 woorden · 13 tekens · 1 regel');
  await expectComposerText(browser,'deny unrelated ordinary send');
  await expect(screen.getByRole('region',{name:'Antwoordcontext',exact:true})).toContainText('Marketing Agent');
  await expect(screen.getByRole('button',{name:'Bijlage verwijderen: pipeline.txt',exact:true})).toBeVisible();
 }finally{await browser.evaluate(async()=>{const w=window as any;await w.__releaseOrdinaryLegacyFrames?.();w.__restoreOrdinaryLegacyFault?.();});}
});

test('denied new conversation ensure preserves background legacy owner and landing draft without an empty agent',async({app,screen,browser})=>{
 const input='een twee drie',draft='concept voor nieuw gesprek blijft behouden';await observeOrdinaryLegacyOwner(app,browser);await boot(app,browser,screen);await holdOrdinaryLegacyTask(browser,input);
 try{
  await task(screen,input);const owner=await captureOrdinaryLegacyOwner(browser);
  await screen.getByRole('button',{name:'Nieuwe chat',exact:true}).click();await screen.getByRole('menuitem',{name:'Nieuwe chat',exact:true}).click();
  await screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true}).fill(draft);
  const before=await browser.evaluate(()=>{const w=window as any,s=w.__ordinaryLegacyState(),h=w.__ordinaryLegacyFault;h.mode='ensure';h.agentIds=s.agents.map((a:any)=>a.id);return {ids:h.agentIds,landing:s.landingAttachmentKey,aliases:s.attachmentDraftKeys};});
  await screen.getByRole('button',{name:'Bijvoegen',exact:true}).click();await screen.getByRole('menuitem',{name:'Lokale taak',exact:true}).click();
  await expect.poll(()=>browser.evaluate(()=>(window as any).__ordinaryLegacyFault.denied.length)).toBe(1);
  await expect(browser.locator('.attachment-error')).toContainText('Gesprek niet opgeslagen. Je concept, ontvangers en bijlagen blijven behouden.');
  expect.soft(await ordinaryLegacyIdentity(browser)).toEqual({message:true,run:true});
  await expect(screen.getByRole('textbox',{name:'Tekst voor lokale taak',exact:true})).toHaveCount(0);
  await expectComposerText(browser,draft);
  expect(await browser.evaluate(()=>{const s=(window as any).__ordinaryLegacyState();return {ids:s.agents.map((a:any)=>a.id),landing:s.landingAttachmentKey,aliases:s.attachmentDraftKeys};})).toEqual(before);
  expect(await browser.evaluate(()=>{const s=(window as any).__ordinaryLegacyState(),d=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return {selected:s.selected,draft:s.drafts.new,durableIds:d.agents.map((a:any)=>a.id),durableSelected:d.selected,durableDraft:d.drafts.new};})).toEqual({selected:null,draft,durableIds:before.ids,durableSelected:null,durableDraft:draft});
  await browser.evaluate(async()=>await (window as any).__releaseOrdinaryLegacyFrames());
  await assertOrdinaryLegacyComplete(browser,screen,input,owner);
  expect(await browser.evaluate(()=>(window as any).__ordinaryLegacyState().drafts.new)).toBe(draft);
  expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).agents.map((a:any)=>a.id))).toEqual(before.ids);
  await app.open('/');const reloaded=await saved(browser,input);expect(reloaded.count).toBe(1);expect(reloaded.message.id).toBe(owner.messageId);expect(reloaded.message.localRun.status).toBe('complete');expect(reloaded.message.localRun.output).toBe('3 woorden · 13 tekens · 1 regel');
  expect(await browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!).drafts.new)).toBe(draft);
 }finally{await browser.evaluate(async()=>{const w=window as any;await w.__releaseOrdinaryLegacyFrames?.();w.__restoreOrdinaryLegacyFault?.();});}
});

import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>|undefined;
afterEach(async()=>{await protocol?.close();protocol=undefined;});

for(const reduced of [false,true])test(`jump is an immediate native bottom navigation after reload with ${reduced?'reduced':'normal'} motion`,async({app,browser,screen})=>{
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as Window&{productSurfaces:{ready:Promise<void>}}).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
  state.messages.marketing=Array.from({length:45},(_,i)=>({id:'reading-'+i,role:'bot',text:i===44?'FINAL_RELOADED_READER_1847':`Old message ${i}\n\n`+'Synthetic paragraph for a long transcript. '.repeat(35)}));
  localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
 });
 await browser.reload();
 await expect(browser.locator('.message.bot')).toHaveCount(45);
 await browser.evaluate(async(reduced)=>{const surfaces=(window as Window&{productSurfaces:{ready:Promise<void>;setReducedMotion(value:boolean):void}}).productSurfaces;await surfaces.ready;surfaces.setReducedMotion(reduced);},reduced);
 await browser.evaluate(()=>{const transcript=document.querySelector('.transcript');if(!transcript)throw Error('Missing transcript');transcript.scrollTop=1500;transcript.dispatchEvent(new Event('scroll'));});
 await expect(screen.getByRole('button',{name:'Naar laatste bericht',exact:true})).toBeVisible();
 const before=await browser.evaluate(()=>{const transcript=document.querySelector('.transcript')!;return transcript.scrollHeight-transcript.clientHeight-transcript.scrollTop;});
 expect(before).toBeGreaterThan(1000);
 await browser.evaluate(()=>{
  const transcript=document.querySelector('.transcript')!,original=transcript.scrollTo.bind(transcript);
  const calls:{behavior:ScrollBehavior|undefined;remaining:number;lastInside:boolean}[]=[];
  (window as Window&{jumpCalls:typeof calls}).jumpCalls=calls;
  Object.defineProperty(transcript,'scrollTo',{value:(options:ScrollToOptions)=>{
   original(options);
   const viewport=transcript.getBoundingClientRect(),last=transcript.querySelector('.message:last-child')!.getBoundingClientRect();
   calls.push({behavior:options.behavior,remaining:transcript.scrollHeight-transcript.clientHeight-transcript.scrollTop,lastInside:last.top>=viewport.top-1&&last.bottom<=viewport.bottom+1});
  }});
 });
 await screen.getByRole('button',{name:'Naar laatste bericht',exact:true}).click();
 const navigation=await browser.evaluate(()=>(window as Window&{jumpCalls:{behavior:string;remaining:number;lastInside:boolean}[]}).jumpCalls);
 expect(navigation).toHaveLength(1);expect(navigation[0].behavior).toBe('instant');expect(Math.abs(navigation[0].remaining)).toBeLessThanOrEqual(1);expect(navigation[0].lastInside).toBe(true);
 await expect.poll(()=>browser.evaluate(()=>{const transcript=document.querySelector('.transcript')!;return transcript.scrollHeight-transcript.clientHeight-transcript.scrollTop;})).toBeLessThanOrEqual(1);
 const geometry=await browser.evaluate(()=>{
  const transcript=document.querySelector('.transcript')!.getBoundingClientRect(),last=document.querySelector('.message:last-child')!.getBoundingClientRect();
  return {bottom:last.bottom<=transcript.bottom+1,inside:last.top>=transcript.top-1};
 });
 expect(geometry).toEqual({bottom:true,inside:true});
 await expect(browser.locator('.product-jump-latest')).toHaveCount(0);
 await app.screenshot('last-message-after-reload-and-jump');
});

async function remaining(browser:Browser){return browser.evaluate(()=>{const transcript=document.querySelector('.transcript')!;return transcript.scrollHeight-transcript.clientHeight-transcript.scrollTop;});}
async function draftSnapshot(browser:Browser){return browser.evaluate(async()=>{
 const path='/composer-input.js',composer=await import(path),state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
 return {document:composer.readComposerInput(document.querySelector('#message-input')),storedText:state.drafts[state.selected]};
});}
async function backgroundInput(browser:Browser,text:string){return browser.evaluate(async(text)=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 const status=await fetch('/api/harness/status').then(response=>response.json());
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id)+'/runs',{method:'POST',headers:{'Content-Type':'application/json','x-harness-csrf':status.csrfToken},body:JSON.stringify({requestId:crypto.randomUUID(),text})});
 if(response.status!==202)throw Error('Actual background acceptance '+response.status);
 return response.json();
},text);}

test('actual canonical arrivals follow a latest jump and preserve a reader who subsequently scrolls away',async({browser,screen,app})=>{
 protocol=await startWorkflowProtocolServer({port:19046,model:{status:()=>({state:'ready',provider:'synthetic-jump-follow'}),async complete({messages}:{messages:{role:string;content:unknown}[]}){
  const input=messages.findLast(message=>message.role==='user')?.content;
  const context=messages.findLast(message=>message.role==='system'&&typeof message.content==='string'&&message.content.startsWith('Local delivery context:\n'));
  if(typeof context?.content!=='string')throw Error('Missing actual delivery context');
  const delivery=JSON.parse(context.content.slice('Local delivery context:\n'.length));
  const content=input==='MAKE_LONG_HISTORY'?Array.from({length:100},(_,i)=>`History line ${i}: ${'synthetic words '.repeat(10)}`).join('\n')+'\nINITIAL_END_9573':input==='TAIL_ONE'?'RECEIVED_TAIL_ONE_9573':'RECEIVED_TAIL_TWO_9573';
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content},reply_to:delivery.current_input_message_id}}]};
 }}});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();await screen.getByRole('radio',{name:'Echte harness',exact:true}).check();
 const input=screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true});await input.fill('MAKE_LONG_HISTORY');await input.press('Enter');
 await expect(browser.locator('.transcript')).toContainText('INITIAL_END_9573');
 await expect.poll(()=>browser.evaluate(()=>document.querySelector('.transcript')!.scrollHeight)).toBeGreaterThan(4000);
 await input.fill('  KEEP_UNSENT_READER_DRAFT  ');const draft=await draftSnapshot(browser);expect(draft.storedText).toBe('  KEEP_UNSENT_READER_DRAFT  ');await browser.reload();
 await expect(input).toHaveText('  KEEP_UNSENT_READER_DRAFT  ');await expect(browser.locator('.transcript')).toContainText('INITIAL_END_9573');
 expect(await draftSnapshot(browser)).toEqual(draft);
 await browser.evaluate(()=>{const transcript=document.querySelector('.transcript')!;transcript.scrollTop=1200;transcript.dispatchEvent(new Event('scroll'));});
 await expect(screen.getByRole('button',{name:'Naar laatste bericht',exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Naar laatste bericht',exact:true}).click();
 await expect.poll(()=>remaining(browser)).toBeLessThanOrEqual(1);
 await backgroundInput(browser,'TAIL_ONE');await expect(browser.locator('.transcript')).toContainText('RECEIVED_TAIL_ONE_9573');
 await expect.poll(()=>remaining(browser)).toBeLessThanOrEqual(1);await expect(input).toHaveText('  KEEP_UNSENT_READER_DRAFT  ');expect(await draftSnapshot(browser)).toEqual(draft);
 const box=await browser.locator('.transcript').boundingBox();if(!box)throw Error('Missing transcript viewport');
 await browser.mouse.move(box.x+box.width/2,box.y+box.height/2);await browser.mouse.wheel(0,-850);
 await expect.poll(()=>remaining(browser)).toBeGreaterThan(300);
 const before=await browser.evaluate(()=>{const transcript=document.querySelector('.transcript')!,viewport=transcript.getBoundingClientRect(),anchor=Array.from(transcript.querySelectorAll('.message')).find(node=>node.getBoundingClientRect().bottom>=viewport.top)!;return {scrollTop:transcript.scrollTop,id:anchor.getAttribute('data-message-id'),top:anchor.getBoundingClientRect().top};});
 await backgroundInput(browser,'TAIL_TWO');await expect(browser.locator('.transcript')).toContainText('RECEIVED_TAIL_TWO_9573');
 const after=await browser.evaluate((id)=>{const transcript=document.querySelector('.transcript')!,anchor=Array.from(transcript.querySelectorAll('.message')).find(node=>node.getAttribute('data-message-id')===id)!;return {scrollTop:transcript.scrollTop,top:anchor.getBoundingClientRect().top};},before.id);
 expect(Math.abs(after.scrollTop-before.scrollTop)).toBeLessThanOrEqual(1);expect(Math.abs(after.top-before.top)).toBeLessThanOrEqual(1);
 await expect(input).toHaveText('  KEEP_UNSENT_READER_DRAFT  ');expect(await draftSnapshot(browser)).toEqual(draft);await expect(screen.getByRole('button',{name:'Naar laatste bericht',exact:true})).toBeVisible();
 await app.screenshot('far-reader-preserved-during-actual-canonical-arrival');
});

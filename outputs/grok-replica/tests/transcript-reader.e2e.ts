import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {expectComposerText} from './fixtures/composer-assertions';

let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>|undefined;
afterEach(async()=>{await protocol?.close();protocol=undefined;});

async function geometry(browser:Browser){return browser.evaluate(()=>{
 const node=document.querySelector('.transcript')!;
 return {top:node.scrollTop,remaining:node.scrollHeight-node.clientHeight-node.scrollTop};
});}
async function arrive(browser:Browser,text:string){return browser.evaluate(async(text)=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
 const id=state.liveHarness.serverIds.marketing;
 const status=await fetch('/api/harness/status').then(response=>response.json());
 const response=await fetch('/api/harness/conversations/'+id+'/runs',{
  method:'POST',headers:{'Content-Type':'application/json','x-harness-csrf':status.csrfToken},
  body:JSON.stringify({requestId:crypto.randomUUID(),text}),
 });
 if(response.status!==202)throw Error('Background acceptance '+response.status);
},text);}

for(const pixels of [1,60])test(`actual ${pixels}px upward reader input survives canonical arrival inside the old80px zone`,async({browser,screen,agent,app})=>{
 protocol=await startWorkflowProtocolServer({port:19047,model:{
  status:()=>({state:'ready',provider:'synthetic-reader-follow'}),
  async complete({messages}:{messages:{role:string;content:unknown}[]}){
   const input=messages.findLast(message=>message.role==='user')?.content;
   const content=input==='READER_HISTORY'
    ?Array.from({length:80},(_,i)=>`Synthetic reader line ${i}. ${'Reader text '.repeat(12)}`).join('\n')+'\nREADER_INITIAL_END_7619'
    :input==='READER_AFTER_LATEST'?'READER_REPINNED_ARRIVAL_7619':'READER_CANONICAL_ARRIVAL_7619';
   return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content}}}]};
  },
 }});
 await browser.goto(protocol.baseUrl);
 await agent.act('Open Marketing Agent. Verzend nog geen bericht.');
 await expect(screen.getByRole('button',{name:'Gespreksopties',exact:true})).toBeVisible();
 await screen.getByRole('radio',{name:'Echte harness',exact:true}).check();
 const input=screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true});
 await input.fill('READER_HISTORY');await input.press('Enter');
 await expect(browser.locator('.transcript')).toContainText('READER_INITIAL_END_7619');
 await expect.poll(async()=>(await geometry(browser)).remaining).toBeLessThanOrEqual(1);
 await input.fill('  KEEP_EXACT_READER_DRAFT  ');
 const atBottom=await geometry(browser);
 const box=await browser.locator('.transcript').boundingBox();if(!box)throw Error('Missing reader viewport');
 await browser.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await browser.mouse.wheel(0,-pixels);
 await expect.poll(async()=>(await geometry(browser)).remaining).toBeGreaterThanOrEqual(pixels-0.6);
 const before=await geometry(browser);
 expect(atBottom.top-before.top).toBeGreaterThan(0.4);
 expect(Math.abs(atBottom.top-before.top-pixels)).toBeLessThanOrEqual(1);
 expect(before.remaining).toBeLessThan(80);
 expect(before.remaining).toBeGreaterThan(0.4);
 await arrive(browser,'READER_ARRIVAL');
 await expect(browser.locator('.transcript')).toContainText('READER_CANONICAL_ARRIVAL_7619');
 await expect.poll(async()=>Math.abs((await geometry(browser)).top-before.top)).toBeLessThanOrEqual(1);
 await expect(screen.getByRole('button',{name:'Naar laatste bericht',exact:true})).toBeVisible();
 await expectComposerText(browser,'  KEEP_EXACT_READER_DRAFT  ');
 await screen.getByRole('button',{name:'Naar laatste bericht',exact:true}).click();
 await expect.poll(async()=>(await geometry(browser)).remaining).toBeLessThanOrEqual(1);
 await expect(browser.locator('.product-jump-latest')).toHaveCount(0);
 await arrive(browser,'READER_AFTER_LATEST');
 await expect(browser.locator('.transcript')).toContainText('READER_REPINNED_ARRIVAL_7619');
 await expect.poll(async()=>(await geometry(browser)).remaining).toBeLessThanOrEqual(1);
 await expectComposerText(browser,'  KEEP_EXACT_READER_DRAFT  ');
 await app.screenshot(`reader-${pixels}px-preserved-and-explicitly-repinned`);
});

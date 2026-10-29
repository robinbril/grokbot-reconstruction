import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';

const dossier='.e2e/artifacts/navigation';
type Receipt={api:string;target:string;behavior:string;before:number;requestedTop:number;viewport:number;distance:number};
type Position={top:number;centerError:number;inside:boolean};
type Probe={initial:Position&{destination:number;viewport:number};frames:Position[];complete:boolean};
type ProbeWindow=Window&{navigationReceipts:Receipt[];navigationProbe?:Probe};
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>|undefined;
afterEach(async()=>{await protocol?.close();protocol=undefined;});

async function bootQuote(app:App,browser:Browser,screen:Screen,targetIndex:number){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as Window&{productSurfaces:{ready:Promise<void>}}).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.evaluate(targetIndex=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);
  state.messages.marketing=Array.from({length:30},(_,index)=>({id:'navigation-'+index,role:'bot',text:`SYNTHETIC_NAVIGATION_${index}\n\n`+'Read synthetic source. '.repeat(10)}));
  state.messages.marketing.push({id:'navigation-quote',role:'user',text:'SYNTHETIC_QUOTE_JUMP',quote:{messageId:'navigation-'+targetIndex,title:'Synthetic source',text:'SYNTHETIC_NAVIGATION_'+targetIndex}});
  localStorage.setItem('grok-local-replica-v1',JSON.stringify(state));
 },targetIndex);
 await browser.reload();await expect(browser.locator('.message')).toHaveCount(31);
 await expect(screen.getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true})).toBeVisible();
}

async function instrument(browser:Browser,target:string){
 await browser.evaluate(target=>{
  const viewport=document.querySelector('.transcript')!,scroll=viewport.scrollTo.bind(viewport),into=Element.prototype.scrollIntoView;
  const receipts:Receipt[]=[];(window as ProbeWindow).navigationReceipts=receipts;
  const measure=(node:Element)=>{
   const box=viewport.getBoundingClientRect(),target=node.getBoundingClientRect();
   const requestedTop=Math.max(0,Math.min(viewport.scrollHeight-viewport.clientHeight,viewport.scrollTop+target.top+target.height/2-box.top-viewport.clientHeight/2));
   return {before:viewport.scrollTop,requestedTop,viewport:viewport.clientHeight,distance:Math.abs(requestedTop-viewport.scrollTop)};
  };
  document.addEventListener('click',event=>{
   if(!(event.target instanceof Element)||!event.target.closest('[aria-label="Naar oorspronkelijk bericht"]'))return;
   const current=document.querySelector('.transcript')!,node=document.querySelector(target)!,box=current.getBoundingClientRect(),row=node.getBoundingClientRect(),start=performance.now();
   const destination=Math.max(0,Math.min(current.scrollHeight-current.clientHeight,current.scrollTop+row.top+row.height/2-box.top-current.clientHeight/2));
   const position=()=>{const current=document.querySelector('.transcript')!,box=current.getBoundingClientRect(),row=document.querySelector(target)!.getBoundingClientRect();return {top:current.scrollTop,centerError:Math.abs(row.top+row.height/2-box.top-current.clientHeight/2),inside:row.top>=box.top-1&&row.bottom<=box.bottom+1};};
   const probe:Probe={initial:{...position(),destination,viewport:current.clientHeight},frames:[],complete:false};
   (window as ProbeWindow).navigationProbe=probe;
   const sample=()=>{const frame=position();probe.frames.push(frame);if(frame.centerError<=1||performance.now()-start>2200)probe.complete=true;else requestAnimationFrame(sample);};
   requestAnimationFrame(sample);
  },{capture:true});
  Element.prototype.scrollIntoView=function(options?:boolean|ScrollIntoViewOptions){
   if(viewport.contains(this))receipts.push({api:'scrollIntoView',target:(this as HTMLElement).dataset.liveMessageId||(this as HTMLElement).dataset.messageId||'',behavior:typeof options==='object'?options.behavior||'auto':'auto',...measure(this)});
   return into.call(this,options);
  };
  Object.defineProperty(viewport,'scrollTo',{value:(options:ScrollToOptions)=>{
   receipts.push({api:'scrollTo',target:'transcript',behavior:options.behavior||'auto',before:viewport.scrollTop,requestedTop:options.top??viewport.scrollTop,viewport:viewport.clientHeight,distance:Math.abs((options.top??viewport.scrollTop)-viewport.scrollTop)});
   scroll(options);
  }});
 },target);
}

async function geometry(browser:Browser,target:string){return browser.evaluate(target=>{
 const viewport=document.querySelector('.transcript')!,node=document.querySelector(target)!;
 const box=viewport.getBoundingClientRect(),row=node.getBoundingClientRect();
 return {top:viewport.scrollTop,centerError:Math.abs(row.top+row.height/2-box.top-viewport.clientHeight/2),inside:row.top>=box.top-1&&row.bottom<=box.bottom+1,receipts:(window as ProbeWindow).navigationReceipts,probe:(window as ProbeWindow).navigationProbe};
},target);}

async function expectNavigation(browser:Browser,target:string,distance:string,reduced=false){
 await expect.poll(async()=>Boolean((await geometry(browser,target)).probe?.complete)).toBe(true);
 const probe=(await geometry(browser,target)).probe!,delta=Math.abs(probe.initial.destination-probe.initial.top);
 expect(delta).toBeGreaterThan(1);
 if(distance==='near')expect(delta).toBeLessThanOrEqual(probe.initial.viewport);
 else expect(delta).toBeGreaterThan(probe.initial.viewport);
 await expect.poll(async()=>(await geometry(browser,target)).centerError,{timeout:5000}).toBeLessThanOrEqual(1);
 expect((await geometry(browser,target)).inside).toBe(true);
 const intermediate=probe.frames.filter(frame=>Math.abs(frame.top-probe.initial.top)>1&&Math.abs(frame.top-probe.initial.destination)>1);
 if(distance==='near'&&!reduced)expect(intermediate.length).toBeGreaterThan(1);
 else expect(intermediate).toHaveLength(0);
}

for(const [distance,reduced] of [['near',false],['far',false],['far',true]] as const)test(`quoted ${distance} original actually reaches its centered viewport target${reduced?' with reduced motion':''}`,async({app,browser,screen})=>{
 const target=`[data-message-id="navigation-${distance==='near'?28:4}"]`;
 await bootQuote(app,browser,screen,distance==='near'?28:4);await instrument(browser,target);
 await browser.evaluate(reduced=>(window as Window&{productSurfaces:{setReducedMotion(value:boolean):void}}).productSurfaces.setReducedMotion(reduced),reduced);
 try{
  await screen.getByRole('region',{name:'Gesprek',exact:true}).getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true}).click();
  await expect(browser.locator(target)).toBeVisible();
  await expectNavigation(browser,target,distance,reduced);
 }finally{
  await mkdir(dossier,{recursive:true});await writeFile(`${dossier}/quote-${distance}${reduced?'-reduced':''}.json`,JSON.stringify(await geometry(browser,target),null,2)+'\n');
  await app.screenshot('quote-'+distance+'-actual-viewport');
 }
});

async function canonicalRuns(browser:Browser){return browser.evaluate(async()=>{
 const id=JSON.parse(localStorage.getItem('grok-local-replica-v1')!).liveHarness.serverIds.marketing;
 const response=await fetch('/api/harness/conversations/'+id);if(!response.ok)throw Error('Canonical navigation fixture unavailable');
 const snapshot=await response.json();return snapshot.runs.map((run:{status:string})=>run.status);
});}

async function bootReply(browser:Browser,screen:Screen,distance:string){
 protocol=await startWorkflowProtocolServer({port:19053,model:{
  status:()=>({state:'ready',provider:'synthetic-navigation'}),
  async complete({messages}:{messages:{role:string;content:unknown}[]}){
   const text=messages.findLast(message=>message.role==='user')?.content;
   const contents=text==='NAVIGATION_HISTORY'?['Synthetic leading context.\n\n'.repeat(20),'SYNTHETIC_FAR_REPLY_SOURCE',Array.from({length:60},(_,index)=>`Synthetic navigation filler ${index}.`).join('\n\n'),'SYNTHETIC_NEAR_REPLY_SOURCE']:['SYNTHETIC_REPLY_ACK'];
   return {toolCalls:contents.map(content=>({id:randomUUID(),name:'SendMessage',arguments:{text:{content}}}))};
  },
 }});
 if(distance==='near')await browser.setViewport({width:1033,height:1400});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 const execution=screen.getByRole('radio',{name:'Echte harness',exact:true});
 await execution.click();await expect(execution).toBeChecked();
 const input=screen.getByRole('textbox',{name:'Bericht sturen naar Bot',exact:true});await input.fill('NAVIGATION_HISTORY');await input.press('Enter');
 await expect.poll(()=>canonicalRuns(browser)).toEqual(['completed']);
 const source=screen.getByRole('group',{name:distance==='near'?'Botbericht 4':'Botbericht 2',exact:true}),id=await source.getAttribute('data-live-message-id');
 await source.click();await screen.getByRole('toolbar',{name:'Berichtknoppen',exact:true}).getByRole('button',{name:'Beantwoorden',exact:true}).click();
 await input.fill('NAVIGATION_REPLY');await input.press('Enter');await expect.poll(()=>canonicalRuns(browser)).toEqual(['completed','completed']);
 await expect(screen.getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true})).toBeVisible();
 return `[data-live-message-id="${id}"]`;
}

for(const distance of ['near','far'])test(`canonical reply ${distance} original uses native motion and centers its exact delivery`,async({browser,screen,app})=>{
 const target=await bootReply(browser,screen,distance);await instrument(browser,target);
 try{
  await screen.getByRole('region',{name:'Gesprek',exact:true}).getByRole('button',{name:'Naar oorspronkelijk bericht',exact:true}).click();
  await expect(browser.locator(target)).toBeVisible();
  await expectNavigation(browser,target,distance);
 }finally{
  await mkdir(dossier,{recursive:true});await writeFile(`${dossier}/reply-${distance}.json`,JSON.stringify(await geometry(browser,target),null,2)+'\n');
  await app.screenshot('reply-'+distance+'-actual-viewport');
 }
});

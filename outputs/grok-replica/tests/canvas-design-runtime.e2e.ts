import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
const source=`import {useState,useRef,useCallback,useEffect} from 'react';
export default function Canvas(){
 const [count,setCount]=useState(0),[visible,setVisible]=useState(true),object=useRef(null);
 const [pointerUps,setPointerUps]=useState(0),[mouseUps,setMouseUps]=useState(0);
 const callback=useCallback(node=>{if(node){window.__canvasRefs??=[];window.__canvasRefs.push('mount');return()=>window.__canvasRefs.push('cleanup')}},[]);
 window.__canvasObject=object;
 useEffect(()=>{const root=object.current;if(!root)return;root.setAttribute('data-probe-refs',JSON.stringify({events:window.__canvasRefs,objectMatches:object.current===document.querySelector('main')}));const second=document.querySelector('button[title="Second"]');if(second){const r=second.getBoundingClientRect();root.setAttribute('data-probe-second-rect',JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height}));}},[count,visible]);
 return <main ref={object} title="Root" data-pointer-ups={pointerUps} data-mouse-ups={mouseUps}><h1>Exact instances</h1>
  {['First','Second'].map(label=><button key={label} title={label} onPointerUp={()=>setPointerUps(value=>value+1)} onMouseUp={()=>setMouseUps(value=>value+1)} onClick={()=>setCount(count+1)}>{label} {count}</button>)}
  {visible&&<span ref={callback}>Reference</span>}<button onClick={()=>setVisible(!visible)}>Toggle ref</button><button onClick={()=>window.postMessage({type:"cursor-canvas-design-mode",enabled:true},"*")}>Self mode</button>
 </main>;
}`;
async function boot(browser:Browser,screen:Screen){
 await browser.addInitScript(()=>{const w=window as unknown as {__canvasMessages:unknown[]};w.__canvasMessages=[];window.addEventListener('message',event=>{if(event.source===document.querySelector('iframe[title="Canvasvoorbeeld"]')?.contentWindow)w.__canvasMessages.push(event.data);});});
 protocol=await startWorkflowProtocolServer({port:19014});await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();await screen.getByRole('button','Gespreksdetails',{exact:true}).last().click();await screen.getByRole('tab','Bibliotheek',{exact:true}).click();await screen.getByRole('button','Nieuw canvas',{exact:true}).click();await screen.getByRole('textbox','Canvastitel',{exact:true}).fill('Actual design runtime');await screen.getByRole('textbox','Canvasbroncode',{exact:true}).fill(source);await screen.getByRole('button','Opslaan',{exact:true}).click();await expect(screen.getByText('Opgeslagen · versie 1',{exact:true})).toBeVisible();await screen.getByRole('tab','Voorbeeld',{exact:true}).click();return browser.frameLocator('iframe[title="Canvasvoorbeeld"]');
}
async function mode(browser:Browser,enabled:boolean){await browser.evaluate(enabled=>document.querySelector<HTMLIFrameElement>('iframe[title="Canvasvoorbeeld"]')!.contentWindow!.postMessage({type:'cursor-canvas-design-mode',enabled},'*'),enabled);}
async function picked(browser:Browser){return browser.evaluate(()=>{const messages=(window as unknown as {__canvasMessages:{type:string,selection:unknown}[]}).__canvasMessages;return messages.findLast(value=>value.type==='cursor-canvas-design-picked')?.selection;});}

test('actual same-source repeated instance selection has true opening anchor and actual clicked text rect while design mode blocks effects',async({browser,screen,agent})=>{
 const frame=await boot(browser,screen);await agent.act('Controleer dat het canvas de kop Exact instances toont. Klik niet op de tellerknoppen en verzend geen bericht.');await expect(frame.getByRole('heading','Exact instances')).toBeVisible();
 await expect.poll(()=>browser.evaluate(()=>(window as unknown as {__canvasMessages:{type:string,sourceFile?:string}[]}).__canvasMessages.find(m=>m.type==='cursor-canvas-design-capable')?.sourceFile)).toBe('source.canvas.tsx');
 await mode(browser,true);await frame.getByRole('button','Second 0',{exact:true}).click();await expect(frame.getByRole('button','Second 0',{exact:true})).toBeVisible();await expect.poll(()=>picked(browser)).toMatchObject({tag:'button',text:'Second 0',stack:[{kind:'element',name:'button',anchor:{line:source.split('\n').findIndex(line=>line.includes('.map(label=>'))+1,column:source.split('\n').find(line=>line.includes('.map(label=>'))!.indexOf('<button')+1},props:{title:'Second'}},{kind:'element',name:'main',anchor:{line:source.split('\n').findIndex(line=>line.includes('return <main'))+1,column:9},props:{title:'Root'}}]});
 const actual=await frame.getByRole('button','Second 0',{exact:true}).boundingBox();expect(actual).not.toBeNull();expect((await picked(browser) as {rect:object}).rect).toEqual(actual);await expect(frame.locator('[data-canvas-design-highlight]')).toBeVisible();
 await browser.evaluate(()=>document.querySelector<HTMLIFrameElement>('iframe[title="Canvasvoorbeeld"]')!.contentWindow!.postMessage({type:'cursor-canvas-design-select',depth:1},'*'));await expect.poll(()=>picked(browser)).toMatchObject({tag:'main',stack:[{name:'main',anchor:{line:source.split('\n').findIndex(line=>line.includes('return <main'))+1,column:9}}]});
 await browser.evaluate(()=>document.querySelector<HTMLIFrameElement>('iframe[title="Canvasvoorbeeld"]')!.contentWindow!.postMessage({type:'cursor-canvas-design-select',depth:0},'*'));await expect.poll(()=>picked(browser)).toMatchObject({tag:'main'});
 await browser.evaluate(()=>document.querySelector<HTMLIFrameElement>('iframe[title="Canvasvoorbeeld"]')!.contentWindow!.postMessage({type:'cursor-canvas-design-clear'},'*'));await expect.poll(()=>picked(browser)).toBeNull();await mode(browser,false);await frame.getByRole('button','Second 0',{exact:true}).click();await expect(frame.getByRole('button','Second 1',{exact:true})).toBeVisible();
});

test('production React callback and object ref lifetimes are unchanged by source instrumentation',async({browser,screen})=>{
 const frame=await boot(browser,screen);await expect(frame.getByText('Reference',{exact:true})).toBeVisible();const refs=async()=>JSON.parse((await frame.locator('main').getAttribute('data-probe-refs'))!);
 expect(await refs()).toEqual({events:['mount'],objectMatches:true});await frame.getByRole('button','First 0',{exact:true}).click();await expect(frame.getByRole('button','First 1',{exact:true})).toBeVisible();expect(await refs()).toEqual({events:['mount'],objectMatches:true});
 await frame.getByRole('button','Toggle ref',{exact:true}).click();await expect(frame.getByText('Reference',{exact:true})).toHaveCount(0);expect(await refs()).toEqual({events:['mount','cleanup'],objectMatches:true});
 await frame.getByRole('button','Self mode',{exact:true}).click();await frame.getByRole('button','First 1',{exact:true}).click();await expect(frame.getByRole('button','First 2',{exact:true})).toBeVisible();
});


test('design picking suppresses actual pointer-up and mouse-up actions while normal mode keeps those handlers',async({browser,screen})=>{
 const frame=await boot(browser,screen);await expect(frame.getByRole('button','Second 0',{exact:true})).toBeVisible();await mode(browser,true);await frame.getByRole('button','Second 0',{exact:true}).click();
 await expect(frame.locator('main')).toHaveAttribute('data-pointer-ups','0');await expect(frame.locator('main')).toHaveAttribute('data-mouse-ups','0');await expect(frame.getByRole('button','Second 0',{exact:true})).toBeVisible();
 await mode(browser,false);await frame.getByRole('button','Second 0',{exact:true}).click();await expect(frame.locator('main')).toHaveAttribute('data-pointer-ups','1');await expect(frame.locator('main')).toHaveAttribute('data-mouse-ups','1');await expect(frame.getByRole('button','Second 1',{exact:true})).toBeVisible();
});

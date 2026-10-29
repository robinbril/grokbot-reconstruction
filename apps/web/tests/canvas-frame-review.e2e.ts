import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function boot(browser:Browser,screen:Screen){
 protocol=await startWorkflowProtocolServer({port:19004});await browser.setViewport({width:1033,height:480});await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();await screen.getByRole('button','Gespreksdetails',{exact:true}).last().click();await screen.getByRole('tab','Bibliotheek',{exact:true}).click();await screen.getByRole('button','Nieuw canvas',{exact:true}).click();await screen.getByRole('textbox','Canvastitel',{exact:true}).fill('Review frame');await screen.getByRole('textbox','Canvasbroncode',{exact:true}).fill('import {useState} from "react";export default function Canvas(){const[n,setN]=useState(0);return <main><button onClick={()=>setN(n+1)}>Teller {n}</button></main>}');await screen.getByRole('button','Opslaan',{exact:true}).click();await expect(screen.getByText('Opgeslagen · versie 1',{exact:true})).toBeVisible();await screen.getByRole('tab','Voorbeeld',{exact:true}).click();await expect(browser.locator('iframe[title="Canvasvoorbeeld"]')).toBeVisible();
}
async function geometry(browser:Browser){return browser.evaluate(()=>{
 const body=document.querySelector('.context-body')!,preview=document.querySelector('.live-canvas-preview')!,frame=document.querySelector('iframe[title="Canvasvoorbeeld"]')!,b=body.getBoundingClientRect(),p=preview.getBoundingClientRect(),f=frame.getBoundingClientRect();
 const rect=(r:DOMRect)=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
 const x=(Math.max(f.left,b.left)+Math.min(f.right,b.right))/2,y=(Math.max(f.top,b.top)+Math.min(f.bottom,b.bottom))/2;
 return {body:rect(b),preview:rect(p),frame:rect(f),top:body.scrollTop,client:body.clientHeight,full:body.scrollHeight,contained:body.contains(frame),hit:document.elementFromPoint(x,y)===frame};
});}

test('review actual iframe wheel chaining can scroll overflowing context pane',async({browser,screen,app})=>{
 await boot(browser,screen);const before=await geometry(browser);expect(before.full).toBeGreaterThan(before.client);const x=(before.frame.left+before.frame.right)/2,y=(Math.max(before.frame.top,before.body.top)+Math.min(before.frame.bottom,before.body.bottom))/2;await browser.mouse.move(x,y);await browser.mouse.wheel(0,250);
 await expect.poll(async()=>(await geometry(browser)).top).toBeGreaterThan(before.top);await app.screenshot('canvas-frame-wheel');
});

test('review actual in-pane canvas tracks pane scroll resize and preserves interactive state across app render',async({browser,screen,app})=>{
 await boot(browser,screen);const frame=browser.frameLocator('iframe[title="Canvasvoorbeeld"]');await frame.getByRole('button','Teller 0',{exact:true}).click();await expect(frame.getByRole('button','Teller 1',{exact:true})).toBeVisible();const before=await geometry(browser);
 await browser.mouse.move(before.body.left+3,(before.body.top+before.body.bottom)/2);await browser.mouse.wheel(0,200);await expect.poll(async()=>(await geometry(browser)).top).toBeGreaterThan(before.top);const scrolled=await geometry(browser);expect(scrolled.contained).toBe(true);expect(Math.abs(scrolled.frame.top-scrolled.preview.top)).toBeLessThan(2);expect(Math.abs(scrolled.frame.left-scrolled.preview.left)).toBeLessThan(2);expect(scrolled.hit).toBe(true);
 await browser.setViewport({width:900,height:420});await expect.poll(async()=>{const g=await geometry(browser);return Math.abs(g.preview.left-g.frame.left)+Math.abs(g.preview.width-g.frame.width);}).toBeLessThan(4);const resized=await geometry(browser);expect(resized.contained).toBe(true);expect(resized.hit).toBe(true);
 await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Zijbalk inklappen',{exact:true}).click();await expect(frame.getByRole('button','Teller 1',{exact:true})).toBeVisible();await expect.poll(async()=>(await geometry(browser)).hit).toBe(true);await app.screenshot('canvas-frame-scroll-resize');
});

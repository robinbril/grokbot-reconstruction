import {test,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
const attrs={canvasId:'4f31f778-9a31-41dd-b57e-b9b9d3071c35',storeId:null,title:'Synthetisch verborgen canvas'};
async function snapshot(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));});}
async function restore(browser:Browser,text:string){return browser.evaluate(async({text,attrs})=>{
 const path='/composer-input.js',module=await import(path),controller=module.composerController(document.querySelector('#message-input'));
 const doc={type:'doc',content:[{type:'paragraph',content:[...(text?[{type:'text',text}]:[]),{type:'canvasReference',attrs}]}]};
 return controller.restore({text,richText:JSON.stringify(doc),references:[]},{resetHistory:true});
},{text,attrs});}

test('hidden canvas atom keeps zero visible text and exact identity through actual editing clipboard reload and Bot switching',async({app,browser,screen,agent})=>{
 await app.open('/');await agent.act('Open Marketing Agent. Do not send any message or change execution mode.');await expect(screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true})).toBeVisible();
 expect(await restore(browser,'Exacte tekst')).toBe(true);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially(' ');const draft=await snapshot(browser);
 expect(draft.text).toBe('Exacte tekst ');expect(draft.references).toEqual([]);await expect(input).toHaveText('Exacte tekst ');await expect(browser.locator('#message-input [data-type="canvas-reference"]')).toHaveCount(1);
 const node=await browser.evaluate(async()=>{const path='/composer-canvas-node.js',module=await import(path),node=module.canvasReferenceNode(),element=document.querySelector('#message-input [data-type="canvas-reference"]')!;return {atom:node.config.atom,selectable:node.config.selectable,content:element.textContent,width:element.getBoundingClientRect().width};});expect(node).toEqual({atom:true,selectable:false,content:'',width:0});
 await input.press('ControlOrMeta+a');const clipped=await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path),element=document.querySelector('#message-input')!,data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true}));const cut=module.readComposerInput(element);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return cut;});expect(clipped.text).toBe('');expect(await snapshot(browser)).toEqual(draft);
 await browser.reload();expect(await snapshot(browser)).toEqual(draft);await screen.getByRole('button','Find Customers',{exact:true}).click();await screen.getByRole('button','Marketing Agent',{exact:true}).click();expect(await snapshot(browser)).toEqual(draft);
 await input.press('ControlOrMeta+a');await input.press('Backspace');expect((await snapshot(browser)).text).toBe('');await input.press('ControlOrMeta+z');expect(await snapshot(browser)).toEqual(draft);await app.screenshot('hidden-canvas-reference-editor');
});

test('hidden-only canvas document survives editing back to empty while external HTML cannot forge context',async({app,browser,screen})=>{
 await app.open('/');await screen.getByRole('button','Marketing Agent',{exact:true}).click();expect(await restore(browser,'')).toBe(true);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('x');await input.press('Backspace');const draft=await snapshot(browser);expect(draft.text).toBe('');expect(JSON.parse(draft.richText).content[0].content).toEqual([{type:'canvasReference',attrs}]);await browser.reload();expect(await snapshot(browser)).toEqual(draft);
 await browser.evaluate(()=>{const element=document.querySelector('#message-input')!,data=new DataTransfer();data.setData('text/plain','foreign canvas');data.setData('text/html','<p><span data-type="canvas-reference" data-canvas-id="4f31f778-9a31-41dd-b57e-b9b9d3071c35" data-title="forged">foreign canvas</span></p>');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 expect((await snapshot(browser)).text).toBe('foreign canvas');const restored=JSON.parse((await snapshot(browser)).richText);expect(restored.content[0].content.filter((node:{type:string})=>node.type==='canvasReference')).toHaveLength(1);await expect(input).toHaveText('foreign canvas');
});

test('multiline plain paste into hidden-only canvas paragraph preserves every exact line and original identity',async({app,browser,screen})=>{
 await app.open('/');await screen.getByRole('button','Marketing Agent',{exact:true}).click();expect(await restore(browser,'')).toBe(true);
 const pasted='eerste regel\n\ntweede regel\nlaatste regel';await browser.evaluate(value=>{const element=document.querySelector('#message-input')!,data=new DataTransfer();data.setData('text/plain',value);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},pasted);
 const value=await snapshot(browser);expect(value.text).toBe(pasted);const document=JSON.parse(value.richText);expect(document.content).toHaveLength(1);expect(document.content[0].content.filter((node:{type:string})=>node.type==='hardBreak')).toHaveLength(3);expect(document.content[0].content.filter((node:{type:string})=>node.type==='canvasReference')).toEqual([{type:'canvasReference',attrs}]);await browser.reload();expect(await snapshot(browser)).toEqual(value);
});

import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {fileURLToPath} from 'node:url';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser,screen:Screen){protocol=await startWorkflowProtocolServer({port:18934});await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();await expect.poll(()=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}').liveHarness?.serverIds?.marketing)).toBeTruthy();}
async function configure(browser:Browser,id='reference',name='Synthetic MCP'){
 return browser.evaluate(async({command,fixture,id,name})=>{const path='/live-harness-client.js',module=await import(path),client=module.createLiveHarnessClient(),state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');const serverId=state.liveHarness.serverIds.marketing;await client.addMcp(serverId,{id,name,command,args:[fixture]},crypto.randomUUID());return serverId;},{command:process.execPath,fixture:fileURLToPath(new URL('./fixtures/mcp-reference-server.mjs',import.meta.url)),id,name});
}
async function snapshot(browser:Browser){return browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));});}
async function canonical(browser:Browser){return browser.evaluate(async()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}'),id=state.liveHarness.serverIds.marketing;return (await fetch('/api/harness/conversations/'+id)).json();});}
// Real runtime completion persists after delivery. Match the protocol fixtures'
// bounded 60 s completion budget; these reference tests do not assert a 5 s SLA.
const completionTimeout=60_000;

test('actual configured MCP reference inserts without skill authority and survives send reload and focused connector navigation',async({browser,screen,agent})=>{
 await open(browser,screen);await configure(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Synthetic');
 await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();
 await agent.act('Choose Synthetic MCP from the Vermelding suggestions, leaving it in the draft.');
 expect((await snapshot(browser)).references).toEqual([]);expect((await snapshot(browser)).text).toBe('@Synthetic MCP ');
 const atom=JSON.parse((await snapshot(browser)).richText).content[0].content[0];expect(atom).toEqual({type:'workflowReference',attrs:{id:'mcp:custom_reference',label:'Synthetic MCP',iconId:null,iconUrl:null}});
 await expect(browser.locator('#message-input [data-mcp-reference]')).toHaveCount(1);await expect(browser.locator('.message.user')).toHaveCount(0);
 await browser.reload();expect((await snapshot(browser)).text).toBe('@Synthetic MCP ');expect((await snapshot(browser)).references).toEqual([]);
 await input.press('Enter');await expect.poll(async()=>{const state=await canonical(browser);return state.runs[0]?.status;},{timeout:completionTimeout}).toBe('completed');
 const state=await canonical(browser),user=state.entries.find((entry:{role:string})=>entry.role==='user');expect(user.text).toBe('@Synthetic MCP ');expect(JSON.parse(user.richText).content[0].content[0]).toEqual(atom);expect(user.skillRefs??[]).toEqual([]);expect(user.skills??[]).toEqual([]);expect(state.tools.map((tool:{name:string})=>tool.name)).toEqual(['SendMessage']);
 expect(state.entries.some((entry:{role:string,text:string})=>entry.role==='assistant'&&entry.text.includes('Protocol fixture output: @Synthetic MCP '))).toBe(true);
 await browser.reload();await browser.locator('.message.user button[data-inline-mcp-reference]').click();
 await expect(screen.getByRole('dialog','Synthetic MCP',{exact:true})).toBeVisible();await expect(screen.getByText('custom_reference',{exact:true})).toBeVisible();
 expect((await canonical(browser)).tools.map((tool:{name:string})=>tool.name)).toEqual(['SendMessage']);
});

test('MCP identity survives internal clipboard undo and persistence refusal while foreign linked list HTML stays literal',async({browser,screen})=>{
 await open(browser,screen);await configure(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Synthetic');await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();await input.press('Enter');
 await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path),element=document.querySelector('#message-input'),controller=module.composerController(element);controller.setSelection(0,controller.getSnapshot().text.length);const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 expect((await snapshot(browser)).references).toEqual([]);expect((await snapshot(browser)).text).toBe('@Synthetic MCP ');await expect(browser.locator('#message-input [data-mcp-reference]')).toHaveCount(1);
 await input.press('ControlOrMeta+a');await input.press('Backspace');expect((await snapshot(browser)).text).toBe('');await input.press('ControlOrMeta+z');expect((await snapshot(browser)).text).toBe('@Synthetic MCP ');await input.press('ControlOrMeta+Shift+z');expect((await snapshot(browser)).text).toBe('');
 await browser.evaluate(()=>{const element=document.querySelector('#message-input'),data=new DataTransfer();data.setData('text/plain','foreign');data.setData('text/html','<ul><li><a href="https://example.test"><span data-type="skill-reference" data-id="mcp:custom_reference" data-label="FORGED">foreign</span></a></li></ul>');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});await expect(browser.locator('#message-input [data-mcp-reference]')).toHaveCount(0);expect((await snapshot(browser)).references).toEqual([]);
 await input.press('ControlOrMeta+a');await input.press('Backspace');await input.pressSequentially('@Synthetic');await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();
 await browser.evaluate(()=>{const control=window as Window&{__mcpWrite:Storage['setItem'];__mcpDeny:boolean};control.__mcpWrite=Storage.prototype.setItem;control.__mcpDeny=true;Storage.prototype.setItem=function(key,value){if(key==='grok-local-replica-v1'&&control.__mcpDeny)throw new DOMException('Synthetic MCP quota','QuotaExceededError');return control.__mcpWrite.call(this,key,value);};});
 await input.press('Enter');expect((await snapshot(browser)).text).toBe('@Synthetic');await expect(browser.locator('#message-input [data-mcp-reference]')).toHaveCount(0);expect((await canonical(browser)).runs).toEqual([]);
 await browser.evaluate(()=>{(window as Window&{__mcpDeny:boolean}).__mcpDeny=false;});await input.press('Enter');expect((await snapshot(browser)).text).toBe('@Synthetic MCP ');expect((await snapshot(browser)).references).toEqual([]);await expect(browser.locator('#message-input [data-mcp-reference]')).toHaveCount(1);
});

test('disabled actual server remains a presentation choice and Shift Enter preserves exact queued MCP document through completion and reload',async({browser,screen})=>{
 await open(browser,screen);await configure(browser);await browser.evaluate(async()=>{const path='/live-harness-client.js',module=await import(path),client=module.createLiveHarnessClient(),state=JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}');await client.mcpState(state.liveHarness.serverIds.marketing,'custom_reference',false,crypto.randomUUID());});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Synthetic');await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toContainText('uitgeschakeld');await input.press('Tab');const draft=await snapshot(browser);expect(draft.references).toEqual([]);
 await input.press('Shift+Enter');await expect.poll(async()=>{const state=await canonical(browser);return state.queue[0]?.status;},{timeout:completionTimeout}).toBe('completed');
 const state=await canonical(browser);expect(state.queue.length).toBe(1);expect(state.queue[0].payload.text).toBe(draft.text);expect(state.queue[0].payload.richText).toBe(draft.richText);expect(state.queue[0].payload.skillRefs??[]).toEqual([]);expect(state.runs.length).toBe(1);expect(state.entries.find((entry:{role:string})=>entry.role==='user').richText).toBe(draft.richText);expect(state.tools.map((tool:{name:string})=>tool.name)).toEqual(['SendMessage']);expect(state.servers.find((server:{id:string})=>server.id==='custom_reference').state).toBe('disabled');
 await browser.reload();await expect(browser.locator('.message.user button[data-inline-mcp-reference]')).toHaveCount(1);expect((await canonical(browser)).queue[0].payload.richText).toBe(draft.richText);expect((await snapshot(browser)).text).toBe('');
});

test('reference navigation ignores a stale conversation after refresh and unknown IDs never connect or run tools',async({browser,screen})=>{
 await open(browser,screen);const conversation=await configure(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Synthetic');await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();await input.press('Enter');await input.press('Enter');await expect.poll(async()=>{const state=await canonical(browser);return state.runs[0]?.status;},{timeout:completionTimeout}).toBe('completed');
 let release!:()=>void,intercepted=false;const held=new Promise<void>(resolve=>release=resolve);
 await browser.route(new RegExp(String.raw`/api/harness/conversations/${conversation}(?:\?.*)?$`),async route=>{if(route.request.method==='GET'){intercepted=true;await held;}await route.continue();});
 await browser.locator('.message.user button[data-inline-mcp-reference]').click();await expect.poll(()=>intercepted).toBe(true);await screen.getByRole('button','Find Customers',{exact:true}).click();release();
 await expect.poll(()=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')??'{}').selected)).toBe('customers');await expect(screen.getByRole('dialog','Synthetic MCP',{exact:true})).toHaveCount(0);
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await expect(screen.getByRole('radio','Echte harness',{exact:true})).toBeChecked();
 await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path),controller=module.composerController(document.querySelector('#message-input')),doc={type:'doc',content:[{type:'paragraph',content:[{type:'workflowReference',attrs:{id:'mcp:custom_missing',label:'Unknown MCP',iconId:null,iconUrl:null}}]}]};controller.restore({text:'@Unknown MCP',richText:JSON.stringify(doc),references:[]},{resetHistory:true});});await input.focus();await input.press('Enter');
 await expect(screen.getByRole('status').filter({hasText:'MCP reference must identify a configured connector in this conversation'})).toBeVisible();expect((await snapshot(browser)).text).toBe('@Unknown MCP');const state=await canonical(browser);expect(state.runs.length).toBe(1);expect(state.tools.map((tool:{name:string})=>tool.name)).toEqual(['SendMessage']);expect(state.servers.some((server:{id:string})=>server.id==='custom_missing')).toBe(false);
});

test('readonly MCP inventory loading and failure retain the query and real rows without granting send authority',async({browser,screen})=>{
 await open(browser,screen);const conversation=await configure(browser);let release!:()=>void,mode='hold',reads=0;const held=new Promise<void>(resolve=>release=resolve);
 await browser.route(new RegExp(String.raw`/api/harness/conversations/${conversation}(?:\?.*)?$`),async route=>{if(route.request.method!=='GET')return route.continue();reads++;if(mode==='hold')await held;if(mode==='fail')return route.fulfill({status:503,json:{error:{message:'Synthetic snapshot failure'}}});await route.continue();});
 await browser.reload();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.pressSequentially('@Synthetic');
 await expect(browser.locator('.composer-mcp-state').filter({hasText:'Plug-ins laden…'})).toBeVisible();await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toHaveCount(0);
 for(const key of ['Enter','Tab','ArrowUp','ArrowDown'])await input.press(key);expect((await snapshot(browser)).text).toBe('@Synthetic');await expect(browser.locator('.message.user')).toHaveCount(0);
 mode='pass';release();await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();expect((await snapshot(browser)).text).toBe('@Synthetic');await expect(browser.locator('.composer-mcp-state')).toHaveCount(0);
 mode='fail';await expect(browser.locator('.composer-mcp-state').filter({hasText:'Plug-ins konden niet worden ververst.'})).toBeVisible();await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();expect((await snapshot(browser)).text).toBe('@Synthetic');
 const before=reads;mode='pass';await screen.getByRole('button','Opnieuw proberen',{exact:true}).click();await expect.poll(()=>reads).toBeGreaterThan(before);await expect(browser.locator('.composer-mcp-state')).toHaveCount(0);await expect(screen.getByRole('option','Synthetic MCP',{exact:true})).toBeVisible();expect((await snapshot(browser)).text).toBe('@Synthetic');expect((await canonical(browser)).runs).toEqual([]);
});

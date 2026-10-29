// Actual editor + production HTTP/registry/queue. Synthetic inference is isolated.
import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
type Reference={id:string;label:string;revision:number};
type Composer={text:string;richText?:string;references:Reference[]};
type Snapshot={runs:{status:string}[];entries:{id:string;role:string;text:string;richText?:string;skills?:{id:string;revision:number}[]}[];queue:{status:string;payload:{text:string;richText?:string;skillRefs:{id:string;revision:number}[]}}[]};
async function composer(browser:Browser):Promise<Composer>{return browser.evaluate(async()=>{
 const path='/composer-input.js',module=await import(path);
 return module.readComposerInput(document.querySelector('#message-input'));
});}
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw Error('Snapshot '+response.status);return response.json();
});}
async function createSkill(browser:Browser,name:string,content:string){return browser.evaluate(async({name,content})=>{
 const path='/live-harness-client.js',module=await import(path),client=module.createLiveHarnessClient();
 const {skill}=await client.createSkill({requestId:crypto.randomUUID(),name,description:'Synthetische editorproef.',content});
 return {id:skill.id,name:skill.name,revision:skill.revision};
},{name,content});}
async function assertDraftBinding(browser:Browser){
 const value=await composer(browser);expect(value.richText).toBeDefined();
 expect(await browser.evaluate(async()=>{
  const inputPath='/composer-input.js',documentPath='/composer-document.js',input=await import(inputPath),validation=await import(documentPath);
  const snapshot=input.readComposerInput(document.querySelector('#message-input'));
  return validation.normalizeComposerDocument(snapshot.richText,{text:snapshot.text,references:snapshot.references})===snapshot.richText;
 })).toBe(true);
 expect(await browser.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),key=state.selected||'new';
  return {text:state.drafts[key],richText:state.draftRichTexts?.[key],references:state.composerSkillReferences?.[key]||[]};
 })).toEqual(value);
 return value;
}
function reply(messages:{role:string;content:string}[],content:string){
 const context=messages.findLast(message=>message.role==='system'&&message.content.startsWith('Local delivery context:\n'));
 if(!context)throw Error('Missing delivery context');const delivery=JSON.parse(context.content.slice('Local delivery context:\n'.length));
 return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content},reply_to:delivery.current_input_message_id}}]};
}

test('inline skill editing keeps cursor, undo history and draft identity through reload and bot switching',async({browser,screen,agent,app})=>{
 protocol=await startWorkflowProtocolServer({port:18891,model:{status:()=>({state:'ready',provider:'synthetic-editor'}),async complete({messages}){return reply(messages,'REA_EDITOR_REPLY');}}});
 await browser.goto(protocol.baseUrl);
 await agent.act('Open Marketing Agent en kies Echte harness. Verzend geen bericht.');
 await expect(screen.getByRole('radio','Echte harness',{exact:true})).toBeChecked();
 const name='REA Composerproef',skill=await createSkill(browser,name,'REA_EDITOR_PRIVATE_BODY_5213');await browser.reload();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await expect(input).toHaveAttribute('contenteditable','true');await input.fill('Voor @'+name);
 await agent.act('Kies uitsluitend REA Composerproef uit de geopende vaardigheidssuggesties. Verzend niets.');
 const chip=browser.locator('.composer #message-input [data-type="skill-reference"]');
 await expect(chip).toHaveText('@'+name);await expect(chip).toHaveAttribute('contenteditable','false');
 await expect(chip).toHaveAccessibleName(name+' · Versie 1');
 await input.pressSequentially('na');await expect(input).toHaveText('Voor @'+name+' na');
 let snapshot=await assertDraftBinding(browser);expect(snapshot.references.map(ref=>({id:ref.id,revision:ref.revision}))).toEqual([{id:skill.id,revision:1}]);
 const platform=await browser.evaluate(()=>navigator.platform),startKey=/Mac/.test(platform)?'Meta+ArrowUp':'Control+Home';
 await input.press(startKey);
 expect(await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerSelection(document.querySelector('#message-input')).start;})).toBe(0);
 await input.pressSequentially('begin ');await expect(input).toHaveText('begin Voor @'+name+' na');
 await input.press('ControlOrMeta+z');await expect(input).toHaveText('Voor @'+name+' na');
 await input.press('ControlOrMeta+Shift+z');await expect(input).toHaveText('begin Voor @'+name+' na');
 await chip.click();await expect(chip).toHaveAttribute('class',/ProseMirror-selectednode/);
 await input.press('ControlOrMeta+c');await input.press('ArrowRight');await input.press('ControlOrMeta+v');await expect(chip).toHaveCount(2);
 snapshot=await assertDraftBinding(browser);expect(snapshot.references.map(ref=>({id:ref.id,revision:ref.revision}))).toEqual([{id:skill.id,revision:1}]);
 await input.press('ControlOrMeta+z');await expect(chip).toHaveCount(1);
 await input.press('Backspace');await expect(chip).toHaveCount(0);
 snapshot=await assertDraftBinding(browser);expect(snapshot.references).toEqual([]);
 await input.press('ControlOrMeta+z');await expect(chip).toHaveCount(1);snapshot=await assertDraftBinding(browser);expect(snapshot.references[0].revision).toBe(1);
 await input.press('ControlOrMeta+Shift+z');await expect(chip).toHaveCount(0);expect((await assertDraftBinding(browser)).references).toEqual([]);
 await input.press('ControlOrMeta+z');await expect(chip).toHaveCount(1);snapshot=await assertDraftBinding(browser);
 await input.press(startKey);await input.press('ArrowRight');await input.press('ArrowRight');
 const selection=await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerSelection(document.querySelector('#message-input'));});
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 expect(await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);return module.composerSelection(document.querySelector('#message-input'));})).toEqual(selection);
 await browser.reload();await expect(chip).toHaveCount(1);expect(await assertDraftBinding(browser)).toEqual(snapshot);
 await screen.getByRole('button','Find Customers',{exact:true}).click();await expect(input).toHaveText('');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await expect(chip).toHaveCount(1);expect(await assertDraftBinding(browser)).toEqual(snapshot);
 await app.screenshot('inline-editor-draft-history-reload');
});

test('active-run queue keeps inline v1 document while skill advances to v2 and clears accepted editor history',async({browser,screen,app})=>{
 let release:()=>void=()=>{},held=false;const gate=new Promise<void>(resolve=>{release=resolve;}),seen:number[]=[];
 protocol=await startWorkflowProtocolServer({port:18891,model:{status:()=>({state:'ready',provider:'synthetic-editor-queue'}),async complete({messages,signal}){
  const text=messages.findLast(message=>message.role==='user')?.content;
  if(text==='REA_EDITOR_HOLD'){held=true;await Promise.race([gate,new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})]);}
  const encoded=typeof text==='string'?text.split('\n\nExplicitly selected private skills (user instructions):\n')[1]:null,selected=encoded?JSON.parse(encoded):[];
  if(selected.length)seen.push(selected[0].revision);return reply(messages,selected[0]?.content||'REA_EDITOR_PREDECESSOR_DONE');
 }}});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const name='REA Wachtrijproef',skill=await createSkill(browser,name,'REA_EDITOR_QUEUE_V1_6813');await browser.reload();
 await expect.poll(()=>browser.evaluate(id=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').privateSkills.some((item:{id:string;revision:number})=>item.id===id&&item.revision===1),skill.id)).toBe(true);
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REA_EDITOR_HOLD');await input.press('Enter');await expect.poll(()=>held).toBe(true);
 // Model entry precedes the accepted-send render, which retains text but closes transient menus.
 await expect(browser.locator('[data-action="live-retry"]')).toBeEnabled();
 await input.fill('@'+name);await screen.getByRole('option',name,{exact:true}).click();
 await expect(browser.locator('.composer #message-input [data-type="skill-reference"]')).toHaveText('@'+name);
 const queued=await assertDraftBinding(browser);await input.press('Shift+Enter');
 await expect.poll(async()=>(await canonical(browser)).queue[0]?.status).toBe('queued');
 expect((await canonical(browser)).queue[0].payload).toMatchObject({text:queued.text,richText:queued.richText,skillRefs:[{id:skill.id,revision:1}]});
 await expect(input).toHaveText('');await input.press('ControlOrMeta+z');await expect(input).toHaveText('');expect((await composer(browser)).references).toEqual([]);
 await browser.evaluate(async({id,name})=>{const path='/live-harness-client.js',module=await import(path),client=module.createLiveHarnessClient();await client.updateSkill(id,{requestId:crypto.randomUUID(),expectedRevision:1,name,description:'Synthetische editorproef.',content:'REA_EDITOR_QUEUE_V2_7924'});},{id:skill.id,name});
 await browser.reload();expect((await canonical(browser)).queue[0].payload.richText).toBe(queued.richText);release();
 await expect.poll(async()=>(await canonical(browser)).queue[0]?.status).toBe('completed');await expect(browser.locator('.transcript')).toContainText('REA_EDITOR_QUEUE_V1_6813');
 expect(seen).toEqual([1]);const state=await canonical(browser),entry=state.entries.find(item=>item.role==='user'&&item.text===queued.text);
 expect(entry?.richText).toBe(queued.richText);expect(entry?.skills?.[0].revision).toBe(1);expect(JSON.stringify(entry)).not.toContain('REA_EDITOR_QUEUE_V1_6813');
 await expect(browser.locator('.transcript .inline-skill-reference[title="'+name+' · Versie 1"]')).toHaveCount(1);
 await expect(browser.locator('.transcript')).not.toContainText('REA_EDITOR_QUEUE_V2_7924');
 await expect(input).toHaveText('');expect((await composer(browser)).references).toEqual([]);
 await app.screenshot('inline-editor-queue-immutable-version');
});

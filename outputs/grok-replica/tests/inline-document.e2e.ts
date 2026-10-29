// Actual production registry/HTTP/runtime and persisted document projection.
// Inference is scripted synthetic output, not native Grok or real-model proof.
import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
type Snapshot={runs:{status:string}[];entries:{id:string;role:string;text:string;richText?:string;skills?:{id:string;revision:number}[]}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));
 if(!response.ok)throw Error('Snapshot '+response.status);return response.json();
});}
async function seedDocument(browser:Browser){return browser.evaluate(async()=>{
 const modulePath='/live-harness-client.js',module=await import(modulePath),client=module.createLiveHarnessClient();
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 const saved=await client.createSkill({requestId:crypto.randomUUID(),name:'REA Inlineproef',description:'Synthetische inline referentie.',content:'REA_PRIVATE_INLINE_BODY_6217'});
 const {skill}=saved,text='Start @REA Inlineproef einde.\nTweede regel.';
 const richText=JSON.stringify({type:'doc',content:[
  {type:'paragraph',content:[{type:'text',text:'Start '},{type:'workflowReference',attrs:{id:skill.id,label:skill.name,iconId:null,iconUrl:'https://example.test/never-load.png'}},{type:'text',text:' einde.'}]},
  {type:'paragraph',content:[{type:'text',text:'Tweede regel.'}]},
 ]});
 const receipt=await client.start(id,{requestId:crypto.randomUUID(),text,richText,skillRefs:[{id:skill.id,revision:skill.revision}]});
 return {inputEntryId:receipt.inputEntryId,richText,text,skillId:skill.id};
});}
async function assertDocument(browser:Browser,entryId:string){
 const row=`[data-message-id="${entryId}"]`,document=browser.locator(`${row} [data-composer-document]`);
 await expect(document).toHaveText('Start @REA Inlineproef einde. Tweede regel.');
 await expect(browser.locator(`${row} .inline-skill-reference`)).toHaveCount(1);
 await expect(browser.locator(`${row} .inline-skill-reference`)).toHaveAttribute('title','REA Inlineproef · Versie 1');
 await expect(browser.locator(`${row} .inline-skill-reference`)).toHaveAccessibleName('REA Inlineproef · Versie 1');
 await expect(browser.locator(`${row} .message-skill-references`)).toHaveCount(0);
 await expect(browser.locator(`${row} img`)).toHaveCount(0);
 await expect(browser.locator('.transcript')).not.toContainText('REA_PRIVATE_INLINE_BODY_6217');
}
async function requestTheme(screen:Screen,theme:'light'|'dark'){
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill(theme==='light'?'/licht':'/donker');
 await expect(screen.getByRole('listbox','Vaardigheden en acties',{exact:true})).toBeVisible();
}
test('persisted inline skill stays in its sentence after reload in light and dark themes',async({browser,screen,agent,app})=>{
 protocol=await startWorkflowProtocolServer({port:18889,model:{status:()=>({state:'ready',provider:'synthetic-inline'}),async complete({messages}){
  const context=messages.findLast(message=>message.role==='system'&&message.content.startsWith('Local delivery context:\n'));
  const delivery=JSON.parse(context.content.slice('Local delivery context:\n'.length));
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'REA_INLINE_SYNTHETIC_REPLY'},reply_to:delivery.current_input_message_id}}]};
 }}});
 let iconRequests=0;await browser.route('https://example.test/never-load.png',async route=>{iconRequests++;await route.fulfill({status:404,body:''});});
 await browser.goto(protocol.baseUrl);
 await agent.act('Open het gesprek Marketing Agent en kies Echte harness als uitvoering. Verzend nog niets.');
 await expect(screen.getByRole('radio','Echte harness',{exact:true})).toBeChecked();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REA_INLINE_WARMUP');await input.press('Enter');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');
 const seeded=await seedDocument(browser);await expect.poll(async()=>(await canonical(browser)).runs[1]?.status).toBe('completed');
 expect((await canonical(browser)).entries.find(entry=>entry.id===seeded.inputEntryId)?.richText).toBe(seeded.richText);
 await browser.reload();await assertDocument(browser,seeded.inputEntryId);
 await requestTheme(screen,'light');await agent.act('Kies Licht thema uit de slashsuggesties boven het berichtveld.');
 await expect(browser.locator('html')).toHaveAttribute('data-theme','light');await assertDocument(browser,seeded.inputEntryId);
 await app.screenshot('inline-skill-persisted-light');
 await requestTheme(screen,'dark');await agent.act('Kies Donker thema uit de slashsuggesties boven het berichtveld.');
 await expect(browser.locator('html')).toHaveAttribute('data-theme','dark');await assertDocument(browser,seeded.inputEntryId);
 await browser.reload();await expect(browser.locator('html')).toHaveAttribute('data-theme','dark');await assertDocument(browser,seeded.inputEntryId);
 expect(iconRequests).toBe(0);expect((await canonical(browser)).runs).toHaveLength(2);
 await app.screenshot('inline-skill-persisted-dark');
});
test('ordinary draft and send still work after resetting isolated demo state',async({browser,screen,agent})=>{
 protocol=await startWorkflowProtocolServer({port:18889});
 await browser.goto(protocol.baseUrl);
 await agent.act('Herstel de voorbeeldgegevens via Accountmenu, Help en feedback, Voorbeeldgegevens herstellen.');
 await expect(screen.getByRole('button','Start a chat with...',{exact:true})).toBeVisible();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill('REA_RESET_DOCUMENT_REGRESSION');
 await expect.poll(()=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}').drafts.new)).toBe('REA_RESET_DOCUMENT_REGRESSION');
 await input.press('Enter');
 await expect(browser.locator('.message.user .bubble')).toHaveText('REA_RESET_DOCUMENT_REGRESSION');
 await expect(input).toHaveText('');
});

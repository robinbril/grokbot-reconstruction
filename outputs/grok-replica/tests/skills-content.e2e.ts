// Real registry/HTTP/queue/persistence with synthetic inference in the first case.
// Second case uses genuine isolated Claude-seat inference and no external tools.
import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
import {createModelProvider} from '../harness/model-provider.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function manager(screen:Screen){
 await screen.getByRole('button','Accountmenu',{exact:true}).click();
 await screen.getByRole('menuitem','Apps en vaardigheden beheren',{exact:true}).click();
 await screen.getByRole('button','Privéskills beheren',{exact:true}).click();
 await expect(screen.getByRole('heading','Privéskills',{exact:true})).toBeVisible();
}
async function fillSkill(screen:Screen,name:string,content:string){
 await screen.getByRole('textbox','Naam',{exact:true}).fill(name);
 await screen.getByRole('textbox','Beschrijving',{exact:true}).fill('Een korte synthetische beschrijving zonder uitvoeringscode.');
 await screen.getByRole('textbox','Instructies',{exact:true}).fill(content);
}
async function selectSkill(screen:Screen,name:string,trigger='@'){
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill(trigger+name);await screen.getByRole('option',name,{exact:true}).click();
 await expect(input).toHaveText('@'+name);return input;
}
type Snapshot={runs:{status:string}[];entries:{role:string;text:string;richText?:string;skills?:{id:string;revision:number;name:string;description:string}[]}[];queue:{status:string;payload:{text:string;richText?:string;skillRefs:{id:string;revision:number}[]}}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=state.liveHarness.serverIds[state.selected];
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw Error('Snapshot '+response.status);return response.json();
});}
test('skill-only queue retains selected v1 through editing to v2, model context and reload',async({browser,screen,app})=>{
 let release:()=>void=()=>{},held=false;const gate=new Promise<void>(resolve=>{release=resolve;}),seen:number[]=[];
 protocol=await startWorkflowProtocolServer({port:18888,model:{status:()=>({state:'ready',provider:'synthetic-skills'}),async complete({messages,signal}){
  const text=messages.findLast(message=>message.role==='user')?.content;
  if(text==='REA_SKILL_HOLD'){held=true;await Promise.race([gate,new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})]);}
  const encoded=typeof text==='string'?text.split('\n\nExplicitly selected private skills (user instructions):\n')[1]:null;
  const selected=encoded?JSON.parse(encoded):[];if(selected.length)seen.push(selected[0].revision);
  const context=messages.findLast(message=>message.role==='system'&&message.content.startsWith('Local delivery context:\n'));
  const delivery=JSON.parse(context.content.slice('Local delivery context:\n'.length));
  return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:selected[0]?.content||'Synthetische voorganger afgerond.'},reply_to:delivery.current_input_message_id}}]};
 }}});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const name='REA Versieproef';await manager(screen);await screen.getByRole('button','Nieuwe privéskill',{exact:true}).click();
 await fillSkill(screen,name,'REA_SKILL_BODY_V1_4791');await screen.getByRole('dialog','Privéskills',{exact:true}).getByRole('button','Skill opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-skills-root]')).toContainText('Versie 1');
 await screen.getByRole('button','Sluiten',{exact:true}).click();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('REA_SKILL_HOLD');await input.press('Enter');
 await expect.poll(()=>held).toBe(true);
 // Model entry precedes the accepted-send render, which retains text but closes transient menus.
 await expect(browser.locator('[data-action="live-retry"]')).toBeEnabled();
 await selectSkill(screen,name);await screen.getByRole('button','In wachtrij',{exact:true}).click();
 await expect.poll(async()=>(await canonical(browser)).queue[0]?.status).toBe('queued');
 expect((await canonical(browser)).queue[0].payload.text).toBe('@'+name+' ');expect((await canonical(browser)).queue[0].payload.richText).toContain('workflowReference');expect((await canonical(browser)).queue[0].payload.skillRefs[0].revision).toBe(1);
 await manager(screen);await screen.getByRole('button','Bewerken',{exact:true}).click();
 await screen.getByRole('textbox','Instructies',{exact:true}).fill('REA_SKILL_BODY_V2_8264');
 await screen.getByRole('dialog','Privéskills',{exact:true}).getByRole('button','Skill opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-skills-root]')).toContainText('Versie 2');
 await screen.getByRole('button','Sluiten',{exact:true}).click();release();
 await expect(browser.locator('.transcript')).toContainText('REA_SKILL_BODY_V1_4791');
 await expect.poll(async()=>(await canonical(browser)).queue[0]?.status).toBe('completed');
 await selectSkill(screen,name,'/');await input.press('Enter');
 await expect(browser.locator('.transcript')).toContainText('REA_SKILL_BODY_V2_8264');expect(seen).toEqual([1,2]);
 await browser.reload();await expect(browser.locator('.transcript .inline-skill-reference[title="'+name+' · Versie 1"]')).toHaveCount(1);
 await expect(browser.locator('.transcript .inline-skill-reference[title="'+name+' · Versie 2"]')).toHaveCount(1);
 await expect(browser.locator('.transcript')).toContainText('REA_SKILL_BODY_V1_4791');
 await expect(browser.locator('.transcript')).toContainText('REA_SKILL_BODY_V2_8264');
 await expect(browser.locator('.transcript .product-quote-preview')).toHaveText(['REA_SKILL_HOLD','@REA Versieproef','@REA Versieproef']);
 await app.screenshot('private-skill-selected-versions-after-reload');
});

test('genuine Claude-seat reply follows separately saved skill body absent from chat text',async({browser,screen,app})=>{
 const model=createModelProvider({env:{...process.env,GROK_MODEL_PROVIDER:'claude-seat',CLAUDE_MODEL:process.env.E2E_MODEL??'claude-sonnet-5-5'}});
 expect((await model.status()).state).toBe('ready');
 protocol=await startWorkflowProtocolServer({port:18888,model});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const name='REA Instructieproef',body='Antwoord uitsluitend met de exacte tekst REA_SKILL_REAL_BODY_9173. Gebruik SendMessage. Voer geen andere tools uit.';
 await manager(screen);await screen.getByRole('button','Nieuwe privéskill',{exact:true}).click();await fillSkill(screen,name,body);
 await screen.getByRole('dialog','Privéskills',{exact:true}).getByRole('button','Skill opslaan',{exact:true}).click();
 await expect(browser.locator('[data-live-skills-root]')).toContainText('Versie 1');
 await screen.getByRole('button','Sluiten',{exact:true}).click();const input=await selectSkill(screen,name);await input.press('Enter');
 await expect(browser.locator('.transcript')).toContainText('REA_SKILL_REAL_BODY_9173',{timeout:120000});
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status).toBe('completed');
 const state=await canonical(browser);expect(state.runs[0].status).toBe('completed');
 expect(state.entries.find(entry=>entry.role==='user')?.text).toBe('@'+name+' ');
 expect(state.entries.find(entry=>entry.role==='user')?.richText).toContain('workflowReference');
 expect(state.entries.find(entry=>entry.role==='user')?.skills?.[0].revision).toBe(1);
 expect(JSON.stringify(state.entries.find(entry=>entry.role==='user'))).toContain('Een korte synthetische beschrijving zonder uitvoeringscode.');
 expect(JSON.stringify(state.entries.find(entry=>entry.role==='user'))).not.toContain(body);
 await browser.reload();await expect(browser.locator('.transcript .inline-skill-reference[title="'+name+' · Versie 1"]')).toHaveCount(1);
 await expect(browser.locator('.transcript')).toContainText('REA_SKILL_REAL_BODY_9173');
 await app.screenshot('genuine-seat-skill-body-after-reload');
});

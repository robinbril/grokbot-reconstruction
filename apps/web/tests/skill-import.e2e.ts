import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>,directory:string;
afterEach(async()=>{await protocol?.close();if(directory)await rm(directory,{recursive:true,force:true});directory='';});
async function boot(browser:Browser,screen:Screen,contexts:string[]=[]){
 protocol=await startWorkflowProtocolServer({port:19042,model:{status:()=>({state:'ready',provider:'synthetic-skill-import'}),async complete({messages}){
  contexts.push(JSON.stringify(messages));return {toolCalls:[{id:randomUUID(),name:'SendMessage',arguments:{text:{content:'IMPORTED_SKILL_CONTEXT_CONFIRMED'}}}]};
 }}});
 await browser.goto(protocol.baseUrl);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();await manager(screen);
 directory=await mkdtemp(path.join(tmpdir(),'grok-skill-import-ui-'));
}
async function manager(screen:Screen){await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Apps en vaardigheden beheren',{exact:true}).click();await screen.getByRole('button','Privéskills beheren',{exact:true}).click();await expect(screen.getByRole('heading','Privéskills',{exact:true})).toBeVisible();}
async function files(input:Record<string,string|Uint8Array>){const paths=[];for(const [name,body]of Object.entries(input)){const target=path.join(directory,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);paths.push(target);}return paths;}
async function canonical(browser:Browser){return browser.evaluate(async()=>{const response=await fetch('/api/harness/skills');if(!response.ok)throw Error('List '+response.status);return response.json();});}

test('multiple-file review preserves manual draft, imports exact source and carries skill body into real chat transport',async({browser,screen,agent,app})=>{
 const contexts:string[]=[];await boot(browser,screen,contexts);
 await screen.getByRole('button','Nieuwe privéskill',{exact:true}).click();
 await browser.evaluate(()=>{for(const input of document.querySelectorAll('[data-skill-import-files],[data-skill-import-folder]'))input.setAttribute('data-native-chooser-proof','original');});
 await screen.getByRole('textbox','Naam',{exact:true}).fill('Unsaved manual draft');await screen.getByRole('textbox','Instructies',{exact:true}).fill('Keep manual body 5719');
 // The actual theme observer also drives background harness sync. A same-value
 // mutation forces that lifecycle boundary without changing the rendered theme.
 await browser.evaluate(async()=>{document.documentElement.setAttribute('data-theme',document.documentElement.getAttribute('data-theme')??'light');await Promise.resolve();});
 await expect(browser.locator('[data-skill-import-files]')).toHaveAttribute('data-native-chooser-proof','original');
 await expect(browser.locator('[data-skill-import-folder]')).toHaveAttribute('data-native-chooser-proof','original');
 const selected=await files({'bundle.md':'---\nname: Import Proof\ndescription: Source-backed description\n---\n\nIMPORTED_BODY_ONLY_75931','empty.txt':'   ','bad.png':'Not a text extension'});
 await browser.locator('[data-skill-import-files]').setInputFiles(selected);
 await expect(screen.getByRole('region','Import controleren',{exact:true})).toContainText('import-proof');await expect(screen.getByText('2 bestanden overgeslagen',{exact:true})).toBeVisible();
 expect((await canonical(browser)).skills).toHaveLength(0);await expect(screen.getByRole('textbox','Naam',{exact:true})).toHaveValue('Unsaved manual draft');
 await agent.act('Bevestig uitsluitend de voorbereide bestandsimport met de knop Importeren.');
 await expect(screen.getByRole('region','Skillbestanden importeren',{exact:true})).toContainText('1 skill geïmporteerd.');
 await expect(screen.getByRole('textbox','Instructies',{exact:true})).toHaveValue('Keep manual body 5719');
 const saved=await canonical(browser);expect(saved.skills).toHaveLength(1);expect(saved.skills[0].name).toBe('import-proof');expect(saved.skills[0].content).toContain('origin: upload');expect(saved.skills[0].content).toContain('IMPORTED_BODY_ONLY_75931');expect(saved.skills[0].revision).toBe(1);
 expect(saved.skills[0].content).toBe('---\nname: Import Proof\ndescription: Source-backed description\norigin: upload\nupload-extension: .md\n---\n\nIMPORTED_BODY_ONLY_75931');
 await screen.getByRole('button','Sluiten',{exact:true}).click();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill('/import-proof');await screen.getByRole('option','import-proof',{exact:true}).click();await input.press('Enter');
 await expect(browser.locator('.transcript')).toContainText('IMPORTED_SKILL_CONTEXT_CONFIRMED');expect(contexts.join('\n')).toContain('IMPORTED_BODY_ONLY_75931');
 await browser.reload();await manager(screen);await expect(browser.locator('[data-live-skills-root]')).toContainText('import-proof');await expect(browser.locator('[data-live-skills-root]')).toContainText('Versie 1');await app.screenshot('imported-source-and-retained-skill');
});

test('folder import exact-name update and duplicate suffix retry the same accepted request after a lost ACK',async({browser,screen,agent})=>{
 await boot(browser,screen);
 await browser.locator('[data-skill-import-files]').setInputFiles(await files({'initial.md':'---\nname: Exact\n---\n\nVersion one'}));await screen.getByRole('button','Importeren',{exact:true}).click();await expect(screen.getByText('1 skill geïmporteerd.',{exact:true})).toBeVisible();
 const first=(await canonical(browser)).skills[0];
 await files({'folder/one/SKILL.md':'---\nname: Exact\n---\n\nVersion two frozen','folder/two/SKILL.md':'---\nname: Exact\n---\n\nSecond exact body'});
 await browser.locator('[data-skill-import-folder]').setInputFiles([path.join(directory,'folder')]);
 await expect(screen.getByRole('region','Import controleren',{exact:true})).toContainText('Bijwerken van versie 1');await expect(screen.getByRole('region','Import controleren',{exact:true})).toContainText('exact-2');
 const requests:string[]=[];let lost=true;
 await browser.route('**/api/harness/skills/import',async route=>{
  requests.push(route.request.postData??'');
  if(lost){lost=false;const response=await fetch(route.request.url,{method:'POST',headers:route.request.headers,body:route.request.postData});expect(response.status).toBe(201);await response.json();await route.abort();}else await route.continue();
 });
 await screen.getByRole('button','Importeren',{exact:true}).click();await expect(screen.getByRole('alert')).toBeVisible();
 const accepted=await canonical(browser);expect(accepted.skills).toHaveLength(2);expect(accepted.skills.find(skill=>skill.id===first.id)?.revision).toBe(2);
 await agent.act('Probeer uitsluitend de voorbereide import opnieuw via Import opnieuw proberen.');
 await expect(screen.getByText('2 skills geïmporteerd.',{exact:true})).toBeVisible();expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);
 const final=await canonical(browser);expect(final.skills).toHaveLength(2);expect(final.skills.find(skill=>skill.id===first.id)?.revision).toBe(2);expect(final.skills.find(skill=>skill.name==='exact-2')?.revision).toBe(1);
 await browser.reload();await manager(screen);await expect(browser.locator('[data-live-skills-root]')).toContainText('exact-2');
});

test('actual file drop rejects invalid UTF-8 and local storage overflow without changing existing or manual instructions',async({browser,screen,app})=>{
 await boot(browser,screen);await screen.getByRole('button','Nieuwe privéskill',{exact:true}).click();await screen.getByRole('textbox','Naam',{exact:true}).fill('Do not replace');await screen.getByRole('textbox','Instructies',{exact:true}).fill('Manual survives 4921');
 await browser.evaluate(()=>{const target=document.querySelector('[data-skill-import-drop]')!,transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([0xc0,0xaf])],'invalid.md',{type:'text/markdown'}));transfer.items.add(new File(['# Dropped proof\nDROP_BODY_3842'],'drop.md',{type:'text/markdown'}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});
 await expect(screen.getByRole('region','Import controleren',{exact:true})).toContainText('drop');await expect(screen.getByText('1 bestand overgeslagen',{exact:true})).toBeVisible();expect((await canonical(browser)).skills).toHaveLength(0);
 await screen.getByRole('button','Importeren',{exact:true}).click();await expect(screen.getByText('1 skill geïmporteerd.',{exact:true})).toBeVisible();
 const original=(await canonical(browser)).skills[0];
 await browser.locator('[data-skill-import-files]').setInputFiles(await files({'oversized.md':'z'.repeat(32768)}));await expect(screen.getByRole('alert')).toContainText('32768');expect((await canonical(browser)).skills).toEqual([original]);
 await expect(screen.getByRole('textbox','Naam',{exact:true})).toHaveValue('Do not replace');await expect(screen.getByRole('textbox','Instructies',{exact:true})).toHaveValue('Manual survives 4921');await expect(screen.getByRole('button','Importeren',{exact:true})).toHaveCount(0);await app.screenshot('import-drop-and-explicit-local-limit');
});

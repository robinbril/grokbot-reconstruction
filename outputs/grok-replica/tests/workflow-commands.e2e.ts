import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {expectComposerText} from './fixtures/composer-assertions';

async function boot(app:any,browser:any,screen:any){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
}
async function createSkill(screen:any,instructions='Vat uitsluitend de opgegeven week samen en vermeld ontbrekende bronnen.'){
 await screen.getByRole('button','Accountmenu',{exact:true}).click();
 await screen.getByRole('menuitem','Apps en vaardigheden beheren',{exact:true}).click();
 await screen.getByRole('dialog','Plug-ins en vaardigheden beheren').getByRole('button','Toevoegen',{exact:true}).click();
 const form=screen.getByRole('dialog','Privévaardigheid toevoegen');
 await form.getByLabel('Naam',{exact:true}).fill('Weekoverzicht');
 await form.getByLabel('Instructies',{exact:true}).fill(instructions);
 await form.getByRole('button','Opslaan',{exact:true}).click();
 await expect(screen.getByRole('dialog','Plug-ins en vaardigheden beheren')).toContainText('Weekoverzicht');
 await screen.getByRole('dialog','Plug-ins en vaardigheden beheren').getByRole('button','Sluiten',{exact:true}).click();
}
const input=(screen:any)=>screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
const skillChip=(browser:any)=>browser.locator('#message-input [data-type="skill-reference"]');
function inlineSkills(richText:string){
 const doc=JSON.parse(richText) as {content:{content?:{type:string;attrs?:{id:string;label:string}}[]}[]};
 return doc.content.flatMap(paragraph=>(paragraph.content??[]).filter(node=>node.type==='workflowReference').map(node=>({id:node.attrs!.id,label:node.attrs!.label})));
}
const read=(browser:any)=>browser.evaluate(()=>JSON.parse(localStorage.getItem('grok-local-replica-v1')!));

test('composer preserves Shift Enter and IME drafts and ignores repeated Enter',async({app,screen,browser})=>{
 await boot(app,browser,screen);
 await input(screen).fill('eerste regel');await input(screen).press('Shift+Enter');
 await expectComposerText(browser,'eerste regel\n');
 await browser.evaluate(()=>{const field=document.querySelector('#message-input')!;field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));});
 await expectComposerText(browser,'eerste regel\n');
 expect((await read(browser)).messages.marketing??[]).toEqual([]);
 await input(screen).press('Enter');
 await expect.poll(async()=>((await read(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(1);
});

test('slash theme action is selected before Enter sends and keeps the composer focused',async({app,screen,browser,agent})=>{
 await boot(app,browser,screen);await input(screen).fill('/donker');
 await expect(screen.getByRole('listbox','Vaardigheden en acties')).toBeVisible();
 await agent.act('Kies Donker thema uit de slashsuggesties boven het berichtveld.');
 await expect(browser.locator('html')).toHaveAttribute('data-theme','dark');
 await expectComposerText(browser,'');
 expect((await read(browser)).messages.marketing??[]).toEqual([]);
 await expect(input(screen)).toBeFocused();
 await input(screen).fill('/licht');await input(screen).press('Enter');
 await expect(browser.locator('html')).toHaveAttribute('data-theme','light');
 await expect(screen.getByRole('listbox','Vaardigheden en acties')).toHaveCount(0);
 expect((await read(browser)).messages.marketing??[]).toEqual([]);
});

test('skill reference survives conversation switch and reload then sends one immutable snapshot',async({app,screen,browser})=>{
 await boot(app,browser,screen);await createSkill(screen);
 await input(screen).fill('Maak dit met /Week');await input(screen).press('Tab');
 await expectComposerText(browser,'Maak dit met @Weekoverzicht ');
 await expect(skillChip(browser)).toBeVisible();
 let s=await read(browser);expect(s.composerSkillReferences.marketing).toHaveLength(1);expect(s.messages.marketing??[]).toEqual([]);
 const ref=s.composerSkillReferences.marketing[0],draftRichText=s.draftRichTexts.marketing;
 expect(inlineSkills(draftRichText)).toEqual([{id:ref.id,label:ref.label}]);
 await screen.getByRole('button','Find Customers',{exact:true}).click();
 await expect(skillChip(browser)).toHaveCount(0);
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await browser.reload();
 await expectComposerText(browser,'Maak dit met @Weekoverzicht ');
 await expect(skillChip(browser)).toBeVisible();
 await input(screen).press('Enter');
 await expect.poll(async()=>((await read(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(1);
 s=await read(browser);const m=s.messages.marketing.find((m:any)=>m.role==='user');expect(m.skillReferences).toEqual([ref]);expect(m.richText).toBe(draftRichText);expect(inlineSkills(m.richText)).toEqual([{id:ref.id,label:ref.label}]);expect(s.composerSkillReferences.marketing??[]).toEqual([]);
 await expect(skillChip(browser)).toHaveCount(0);
 await expect(browser.locator('.message.user').last()).toContainText('Weekoverzicht');
 const sentId=m.id;await browser.reload();expect((await read(browser)).messages.marketing.find((row:any)=>row.id===sentId).skillReferences).toEqual([ref]);
});

test('skill-only submission is payload and local computation refuses to silently ignore references',async({app,screen,browser})=>{
 await boot(app,browser,screen);await createSkill(screen);
 await input(screen).fill('/Week');await input(screen).press('Enter');
 await expectComposerText(browser,'@Weekoverzicht ');await expect(skillChip(browser)).toHaveText('@Weekoverzicht');await expect(screen.getByRole('button','Bericht sturen',{exact:true})).toBeVisible();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();await screen.getByRole('menuitem','Gespreksbewerking',{exact:true}).click();
 const dialog=screen.getByRole('dialog','Gespreksbewerking');await dialog.getByLabel('Lokale bewerking').selectOption({value:'upper'});await dialog.getByRole('button','Gebruiken',{exact:true}).click();
 await input(screen).click();await input(screen).press('End');await input(screen).pressSequentially('tekst met vaardigheid');await input(screen).press('Enter');
 await expectComposerText(browser,'@Weekoverzicht tekst met vaardigheid');await expect(skillChip(browser)).toBeVisible();
 let s=await read(browser);expect(Object.keys(s.chatRuns??{})).toHaveLength(0);expect(s.messages.marketing??[]).toEqual([]);
 const ref=s.composerSkillReferences.marketing[0];
 await screen.getByRole('button','Normaal bericht',{exact:true}).click();
 await browser.evaluate(async()=>{const path='/composer-input.js';const {setComposerSelection}=await import(path);setComposerSelection(document.querySelector('#message-input'),'@Weekoverzicht '.length,'@Weekoverzicht tekst met vaardigheid'.length);});
 await input(screen).press('Backspace');await expectComposerText(browser,'@Weekoverzicht ');
 expect((await read(browser)).composerSkillReferences.marketing).toEqual([ref]);
 await screen.getByRole('button','Bericht sturen',{exact:true}).click();
 await expect.poll(async()=>((await read(browser)).messages.marketing??[]).filter((m:any)=>m.role==='user').length).toBe(1);
 s=await read(browser);const sent=s.messages.marketing.find((m:any)=>m.role==='user');expect(sent.skillReferences).toEqual([ref]);expect(sent.text).toBe('@Weekoverzicht ');expect(inlineSkills(sent.richText)).toEqual([{id:ref.id,label:ref.label}]);
});

test('denied skill insertion preserves slash draft and the next successful choice commits once',async({app,screen,browser})=>{
 await boot(app,browser,screen);await createSkill(screen);await input(screen).fill('/Week');
 await browser.evaluate(()=>{const write=Storage.prototype.setItem;(window as any).__denySkill=true;Storage.prototype.setItem=function(k,v){if(k==='grok-local-replica-v1'&&(window as any).__denySkill&&JSON.parse(v).composerSkillReferences?.marketing?.length)throw new DOMException('Denied skill ref','QuotaExceededError');return write.call(this,k,v);};});
 await input(screen).press('Enter');await expectComposerText(browser,'/Week');
 expect((await read(browser)).composerSkillReferences?.marketing??[]).toEqual([]);
 await expect(screen.getByRole('listbox','Vaardigheden en acties')).toBeVisible();
 await browser.evaluate(()=>{(window as any).__denySkill=false;});await input(screen).press('Enter');
 await expect(skillChip(browser)).toBeVisible();
 expect((await read(browser)).composerSkillReferences.marketing).toHaveLength(1);
 await skillChip(browser).click();await expect(skillChip(browser)).toHaveAttribute('class',/ProseMirror-selectednode/);await input(screen).press('Backspace');
 await expect(skillChip(browser)).toHaveCount(0);expect((await read(browser)).composerSkillReferences.marketing??[]).toEqual([]);
 await expect(screen.getByRole('button','Spraakmodus',{exact:true})).toBeVisible();
});

test('slash escape leaves literal text and long suggestion lists stay bounded inside mobile viewport',async({app,screen,browser})=>{
 await boot(app,browser,screen);await browser.setViewport({width:390,height:740});
 await input(screen).fill('/');await expect(screen.getByRole('listbox','Vaardigheden en acties')).toBeVisible();
 expect(await screen.getByRole('option').count()).toBeLessThanOrEqual(8);
 const bounds=await screen.getByRole('listbox','Vaardigheden en acties').boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
 await input(screen).press('ArrowDown');await input(screen).press('Escape');
 await expect(screen.getByRole('listbox','Vaardigheden en acties')).toHaveCount(0);await expectComposerText(browser,'/');
 expect((await read(browser)).messages.marketing??[]).toEqual([]);
});

test('oversized legacy skill is visibly refused without truncating its instructions or consuming the slash draft',async({app,screen,browser})=>{
 await boot(app,browser,screen);const instructions='x'.repeat(4001);await createSkill(screen,instructions);
 await input(screen).fill('/Week');await input(screen).press('Enter');
 await expect(browser.locator('[data-composer-command-status]')).toContainText('maximaal 4000 tekens');
 await expectComposerText(browser,'/Week');
 const s=await read(browser);expect(s.privateSkills[0].description).toBe(instructions);expect(s.composerSkillReferences?.marketing??[]).toEqual([]);expect(s.messages.marketing??[]).toEqual([]);
});

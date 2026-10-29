import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
const github='https://github.com/example/project/pull/42';
const authored='https://github.com/example/project/pull/43';
const origin='https://cursor.com/codebase/example/project/pull/44';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
const replies:Record<string,string>={
 PR_BASIC:`Auto: ${github}\n\nAuthored: [**de review**](${authored})\n\nOrigin: ${origin}\n\nFiles: ${github}/files\n\nQuery: ${github}?tab=files\n\n[${github}](${github})`,
 PR_SAFE:`[ ](${github})\n\n[**review** & _details_](${authored})\n\n\`https://github.com/example/project/pull/99\`\n\n<a class="pr-reference-source" href="${github}">fake</a>\n\n[unsafe](javascript:alert(1))`,
 PR_OTHER:'https://github.com/other/repository/pull/42',
};
async function open(browser:Browser){
 const model={status:()=>({state:'ready',provider:'synthetic-pr-fixture',model:'deterministic',modelExecution:'synthetic'}),async complete({messages}:{messages:Array<{role:string;content:unknown}>}){const content=messages.findLast(row=>row.role==='user')?.content,text=typeof content==='string'?content:'';return {text:'',toolCalls:[{id:crypto.randomUUID(),name:'SendMessage',arguments:{text:{content:replies[text]??'SYNTHETIC_PR_RESPONSE'}}}]};}};
 protocol=await startWorkflowProtocolServer({port:18912,model});await browser.goto(protocol.baseUrl);
}
async function capture(browser:Browser){
 await browser.evaluate(()=>{const state=window as Window&{__prOpens:string[]};state.__prOpens=[];document.addEventListener('click',event=>{const anchor=(event.target as Element).closest?.('a.pr-reference');if(anchor){event.preventDefault();state.__prOpens.push(anchor.getAttribute('href')??'');}},true);});
}
async function send(browser:Browser,screen:Screen,key:string){
 await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});await input.fill(key);await input.press('Enter');
 await expect(browser.locator('.live-run-status')).toContainText('Voltooid');
}

test('actual harness reply renders native PR links and preserves authored formatting and exact targets',async({browser,screen,agent})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await send(browser,screen,'PR_BASIC');
 const links=browser.locator('.transcript a.pr-reference');await expect(links).toHaveCount(4);
 const auto=screen.getByRole('button','#42 (GitHub)',{exact:true});await expect(auto).toHaveAttribute('href',github);await expect(auto).toHaveText('#42');
 await expect(browser.locator(`a.pr-reference[href="${authored}"] strong`)).toHaveText('de review');
 await expect(screen.getByRole('button','#44 (Cursor)',{exact:true})).toHaveAttribute('href',origin);
 await expect(browser.locator(`a.pr-reference-authored[href="${github}"]`)).toHaveText(github);
 await expect(browser.locator(`.transcript a[href="${github}/files"]`)).not.toHaveAttribute('role','button');
 await expect(browser.locator(`.transcript a[href="${github}?tab=files"]`)).not.toHaveAttribute('role','button');
 const painted=await browser.evaluate(()=>{const link=document.querySelector('.transcript a.pr-reference')!,box=link.getBoundingClientRect();return !!document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('a.pr-reference');});expect(painted).toBe(true);
 await capture(browser);await agent.act('Open the pull request #42 (GitHub) in the conversation.');
 await expect.poll(()=>browser.evaluate(()=>(window as Window&{__prOpens:string[]}).__prOpens)).toEqual([github]);
});

test('Space and Enter activate exactly once and repeated rerenders do not duplicate authored glyphs',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await send(browser,screen,'PR_BASIC');await capture(browser);
 const link=screen.getByRole('button','de review (GitHub)',{exact:true});await link.press('Space');await link.press('Enter');
 await expect.poll(()=>browser.evaluate(()=>(window as Window&{__prOpens:string[]}).__prOpens)).toEqual([authored,authored]);
 await browser.locator('.header-identity-button').click();await browser.locator('.header-identity-button').click();
 await expect(browser.locator(`a.pr-reference[href="${authored}"] > .pr-reference-mark`)).toHaveCount(1);
 await expect(browser.locator(`a.pr-reference[href="${authored}"] .pr-reference-mark`)).toHaveCount(1);
 await expect(browser.locator(`a.pr-reference[href="${authored}"] .pr-reference-label > strong`)).toHaveText('de review');
 await browser.reload();await expect(screen.getByRole('button','de review (GitHub)',{exact:true})).toHaveAttribute('href',authored);
});

test('raw HTML code and unsafe href cannot impersonate a PR control, while blank labels use the native number',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await send(browser,screen,'PR_SAFE');
 await expect(browser.locator('.transcript a.pr-reference')).toHaveCount(2);
 await expect(screen.getByRole('button','#42 (GitHub)',{exact:true})).toHaveText('#42');
 await expect(browser.locator('.transcript pre a.pr-reference,.transcript code a.pr-reference')).toHaveCount(0);
 await expect(browser.locator('.transcript a[href^="javascript:"]')).toHaveCount(0);
 await expect(browser.locator(`a.pr-reference[href="${authored}"] strong`)).toHaveText('review');
 await expect(browser.locator(`a.pr-reference[href="${authored}"] em`)).toHaveText('details');
});

test('conversation switch retains each original target and does not leak same-number candidates across chats',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await send(browser,screen,'PR_BASIC');
 await screen.getByRole('button','Find Customers',{exact:true}).click();await expect(browser.locator('.transcript a.pr-reference')).toHaveCount(0);await send(browser,screen,'PR_OTHER');
 await expect(screen.getByRole('button','#42 (GitHub)',{exact:true})).toHaveAttribute('href','https://github.com/other/repository/pull/42');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await expect(screen.getByRole('button','#42 (GitHub)',{exact:true})).toHaveAttribute('href',github);
});

test('streamed markdown reuses the anchor while refreshing authored labels and activation ownership',async({browser,screen})=>{
 await open(browser);await capture(browser);
 await browser.evaluate(async(href:string)=>{
  const path='/chat-markdown.js',module=await import(path),parsed=module.parseChatMarkdown(href,{isStreaming:true});
  const view=module.createChatMarkdownBlock({source:parsed.source,block:parsed.blocks[0],context:{conversationId:'synthetic-stream',entryId:'entry',revision:1,isStreaming:true,isStable:false}});
  view.element.dataset.prStreamFixture='';document.querySelector('.transcript')!.append(view.element);
  (window as Window&{__prStream:unknown}).__prStream={view,anchor:view.element.querySelector('a')};
 },github);
 await expect(screen.getByRole('button','#42 (GitHub)',{exact:true})).toHaveText('#42');
 for(const [source,label] of [[`[**first review**](${github})`,'first review'],[`[review _revised_](${github})`,'review revised'],[github,'#42']]){
  const same=await browser.evaluate(async(source:string)=>{const path='/chat-markdown.js',module=await import(path),parsed=module.parseChatMarkdown(source,{isStreaming:true}),state=(window as Window&{__prStream:{view:{element:HTMLElement;update:(props:unknown)=>void};anchor:Element}}).__prStream;state.view.update({source:parsed.source,block:parsed.blocks[0],context:{conversationId:'synthetic-stream',entryId:'entry',revision:2,isStreaming:true,isStable:false}});return state.view.element.querySelector('a')===state.anchor;},source);
  expect(same).toBe(true);await expect(browser.locator('[data-pr-stream-fixture] .pr-reference-label')).toHaveText(label);await expect(browser.locator('[data-pr-stream-fixture] .pr-reference-mark')).toHaveCount(1);
 }
 await screen.getByRole('button','#42 (GitHub)',{exact:true}).press('Space');
 await expect.poll(()=>browser.evaluate(()=>(window as Window&{__prOpens:string[]}).__prOpens)).toEqual([github]);
 await browser.evaluate(()=>{const state=(window as Window&{__prStream:{view:{destroy:()=>void}}}).__prStream;state.view.destroy();});await expect(browser.locator('[data-pr-stream-fixture]')).toHaveCount(0);
 await browser.evaluate(async(href:string)=>{const path='/rich-transcript.js',module=await import(path),row=document.createElement('article');row.dataset.prLegacyFixture='';row.innerHTML=module.renderRichText(`[**saved label**](${href})`);document.querySelector('.transcript')!.append(row);const surfaces=(window as Window&{productSurfaces:{afterRender:()=>void}}).productSurfaces;surfaces.afterRender();surfaces.afterRender();},github);
 await expect(browser.locator('[data-pr-legacy-fixture] a.pr-reference strong')).toHaveText('saved label');await expect(browser.locator('[data-pr-legacy-fixture] .pr-reference-mark')).toHaveCount(1);
});

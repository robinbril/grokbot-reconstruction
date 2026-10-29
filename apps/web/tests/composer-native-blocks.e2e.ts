import {test,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {setComposerText} from './fixtures/composer-assertions';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
afterEach(async()=>{await protocol?.close();});
async function open(browser:Browser){protocol=await startWorkflowProtocolServer({port:18895});await browser.goto(protocol.baseUrl);}
async function snapshot(browser:Browser){return browser.evaluate(async()=>{
 const path='/composer-input.js',module=await import(path);return module.readComposerInput(document.querySelector('#message-input'));
});}
async function seed(browser:Browser,document:unknown){await browser.evaluate(async document=>{
 const inputPath='/composer-input.js',documentPath='/composer-document.js',input=await import(inputPath),projection=await import(documentPath);
 const value={text:projection.projectComposerDocument(document),richText:JSON.stringify(document),references:[]};
 const controller=input.composerController(window.document.querySelector('#message-input'));
 if(!controller.restore(value,{resetHistory:true}))throw Error('Fixture restore rejected');
 // Hydration chooses an exact caret; End remains a native line-end action.
 controller.focus();controller.setSelection(value.text.length);
},document);}
const paragraph=(text:string)=>({type:'paragraph',content:[{type:'text',text}]});

test('plain multiline hydration uses hard breaks and paragraph projection stays native through typing and reload',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path);module.replaceComposerText(document.querySelector('#message-input'),'one\ntwo');});
 await expect(input).toHaveText('one two');await expect(browser.locator('#message-input p')).toHaveCount(1);await expect(browser.locator('#message-input br')).toHaveCount(1);
 expect((await snapshot(browser)).text).toBe('one\ntwo');
 await seed(browser,{type:'doc',content:[paragraph('alpha'),paragraph('beta')]});
 await input.press('End');await input.pressSequentially('!');expect((await snapshot(browser)).text).toBe('alpha\n\nbeta!');
 await browser.reload();await expect(browser.locator('#message-input p')).toHaveCount(2);expect((await snapshot(browser)).text).toBe('alpha\n\nbeta!');
});

test('native lists split sink lift and exit without sending then retain nested numbering after reload',async({browser,screen,app})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.pressSequentially('- first');await expect(browser.locator('#message-input ul > li')).toHaveCount(1);
 expect((await snapshot(browser)).text).toBe('- first');await input.press('Shift+Enter');await input.pressSequentially('second');
 await expect(browser.locator('#message-input ul > li')).toHaveCount(2);expect((await snapshot(browser)).text).toBe('- first\n- second');
 await input.press('Tab');await expect(browser.locator('#message-input ul ul > li')).toHaveCount(1);expect((await snapshot(browser)).text).toBe('- first\n  - second');
 await input.press('Shift+Tab');await expect(browser.locator('#message-input ul > li')).toHaveCount(2);expect((await snapshot(browser)).text).toBe('- first\n- second');
 await input.press('Shift+Enter');await input.press('Shift+Enter');await input.pressSequentially('outside');
 await expect(browser.locator('.message.user')).toHaveCount(0);expect((await snapshot(browser)).text).toBe('- first\n- second\n\noutside');
 await seed(browser,{type:'doc',content:[{type:'orderedList',attrs:{start:3,type:null},content:[{type:'listItem',content:[paragraph('third'),{type:'bulletList',content:[{type:'listItem',content:[paragraph('nested')]}]}]},{type:'listItem',content:[paragraph('fourth')]}]}]});
 await input.press('End');await input.pressSequentially('!');expect((await snapshot(browser)).text).toBe('3. third\n   - nested\n4. fourth!');
 await browser.reload();await expect(browser.locator('#message-input ol')).toHaveAttribute('start','3');expect((await snapshot(browser)).text).toBe('3. third\n   - nested\n4. fourth!');
 await app.screenshot('composer-native-nested-lists');
});

test('native link marks project one suffix and typing outside the link stays unmarked',async({browser,screen,app})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await seed(browser,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Read ',marks:[{type:'link',attrs:{href:'https://example.test',target:'_blank',rel:'noopener noreferrer nofollow',class:null}}]}]}]});
 await expect(browser.locator('#message-input a')).toHaveText('Read');expect((await snapshot(browser)).text).toBe('Read  (https://example.test)');
 await input.press('End');await input.pressSequentially('after');await expect(browser.locator('#message-input a')).toHaveText('Read');
 expect((await snapshot(browser)).text).toBe('Read  (https://example.test)after');
 const saved=JSON.parse((await snapshot(browser)).richText);expect(saved.content[0].content.at(-1)).toEqual({type:'text',text:'after'});
 await browser.reload();await expect(browser.locator('#message-input a')).toHaveAttribute('href','https://example.test');expect((await snapshot(browser)).text).toBe('Read  (https://example.test)after');
 await app.screenshot('composer-native-link-label');
});

async function paste(browser:Browser,text:string,html=''){
 await browser.evaluate(({text,html})=>{
  const input=document.querySelector('#message-input');if(!input)throw Error('Missing editor');
  const data=new DataTransfer();data.setData('text/plain',text);if(html)data.setData('text/html',html);
  input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },{text,html});
}

test('HTML lists links and URL paste use native schema while scripts and foreign skill IDs stay inert',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.focus();await paste(browser,'third\nnested\nfourth','<ol start="3"><li>third<ul><li>nested</li></ul></li><li>fourth</li></ol>');
 await expect(browser.locator('#message-input ol')).toHaveAttribute('start','3');await expect(browser.locator('#message-input ol ul li')).toHaveText('nested');
 expect((await snapshot(browser)).text).toBe('3. third\n   - nested\n4. fourth');
 await setComposerText(browser,'');await paste(browser,'Read more','<p><a href="https://example.test">Read more</a></p>');
 await expect(browser.locator('#message-input a')).toHaveText('Read more');expect((await snapshot(browser)).text).toBe('Read more (https://example.test)');
 await setComposerText(browser,'selected');await input.press('ControlOrMeta+a');await paste(browser,'https://example.test');
 await expect(browser.locator('#message-input a')).toHaveText('selected');expect((await snapshot(browser)).text).toBe('selected (https://example.test)');
 await setComposerText(browser,'');await paste(browser,'https://example.test');await expect(browser.locator('#message-input a')).toHaveAttribute('href','https://example.test');expect((await snapshot(browser)).text).toBe('https://example.test');
 await setComposerText(browser,'');await input.pressSequentially('example.com ');await expect(browser.locator('#message-input a')).toHaveAttribute('href','https://example.com');
 expect((await snapshot(browser)).text).toBe('example.com ');
 await setComposerText(browser,'');await paste(browser,'unsafe','<a href="javascript:alert(1)">unsafe</a>');await expect(browser.locator('#message-input a')).toHaveCount(0);expect((await snapshot(browser)).text).toBe('unsafe');
 await setComposerText(browser,'');await paste(browser,'foreign','<ul><li><span data-type="skill-reference" data-id="foreign" data-label="foreign">foreign</span></li></ul>');
 await expect(browser.locator('#message-input [data-type="skill-reference"]')).toHaveCount(0);expect((await snapshot(browser)).references).toEqual([]);expect((await snapshot(browser)).text).toBe('- foreign');
 await seed(browser,{type:'doc',content:[{type:'paragraph'}]});await paste(browser,'one\r\ntwo\n\n');expect((await snapshot(browser)).text).toBe('one\ntwo\n');
});


test('linked hard breaks and empty list paragraphs retain native projection and precise cursor boundaries',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.focus();await paste(browser,'a\nb','<a href="https://example.test">a<br>b</a>');
 await expect(browser.locator('#message-input a')).toHaveCount(1);
 const linked=await snapshot(browser);expect(linked.text).toBe('a\nb (https://example.test)');
 const document=JSON.parse(linked.richText);expect(document.content[0].content[1].type).toBe('hardBreak');
 expect(document.content[0].content[1].marks[0].type).toBe('link');
 await seed(browser,{type:'doc',content:[{type:'bulletList',content:[{type:'listItem',content:[paragraph('a'),{type:'paragraph'},paragraph('b')]}]}]});
 expect((await snapshot(browser)).text).toBe('- a\n  \n  b');
 const positions=await browser.evaluate(async()=>{const path='/composer-input.js',module=await import(path),controller=module.composerController(window.document.querySelector('#message-input'));
  controller.setSelection(3);const a=controller.getSelection();controller.setSelection(9);return {a,b:controller.getSelection()};
 });
 expect(positions.a.start).toBe(3);expect(positions.b.start).toBe(9);
 await input.pressSequentially('!');expect((await snapshot(browser)).text).toBe('- a\n  \n  !b');
});

test('nested partial clipboard slices preserve cached skill identity instead of degrading to text',async({browser,screen})=>{
 await open(browser);const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 const before=await browser.evaluate(async()=>{
  const inputPath='/composer-input.js',documentPath='/composer-document.js',input=await import(inputPath),projection=await import(documentPath),controller=input.composerController(document.querySelector('#message-input'));
  const rich={type:'doc',content:[{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'outer'}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'workflowReference',attrs:{id:'synthetic-clipboard-skill',label:'Clip',iconId:null,iconUrl:null}}]}]}]}]}]}]};
  const snapshot={text:projection.projectComposerDocument(rich),richText:JSON.stringify(rich),references:[{id:'synthetic-clipboard-skill',label:'Clip',revision:1,description:'Synthetic clipboard identity only.'}]};
  controller.restore(snapshot,{resetHistory:true});controller.focus();const start=snapshot.text.indexOf('@Clip');controller.setSelection(start,start+5);
  const data=new DataTransfer(),element=document.querySelector('#message-input');element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
  const encoded=data.getData('application/x-grok-composer-fragment+json'),slice=JSON.parse(encoded).slice;
  if(slice.openStart<=2)throw Error('Fixture must copy a genuinely nested open slice');
  element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  return snapshot;
 });
 await expect(browser.locator('#message-input [data-type="skill-reference"]')).toHaveCount(1);
 expect((await snapshot(browser)).text).toBe(before.text);expect((await snapshot(browser)).references).toEqual(before.references);
 await input.press('ArrowRight');await input.pressSequentially('!');expect((await snapshot(browser)).text).toBe(before.text+'!');
});

test('Tab chooses a slash skill before inserting a tab or sinking its list item',async({browser,screen})=>{
 await open(browser);await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const name='REA Tab native';await browser.evaluate(async name=>{const path='/live-harness-client.js',module=await import(path),client=module.createLiveHarnessClient();await client.createSkill({requestId:crypto.randomUUID(),name,description:'Synthetic Tab precedence.',content:'REA_TAB_PRIVATE_BODY'});},name);
 await browser.reload();const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill('/'+name);await expect(screen.getByRole('option',name,{exact:true})).toBeVisible();await input.press('Tab');
 await expect(browser.locator('#message-input [data-type="skill-reference"]')).toHaveText('@'+name);expect((await snapshot(browser)).text).toBe('@'+name+' ');
 await seed(browser,{type:'doc',content:[{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph'}]}]}]});
 await input.pressSequentially('/'+name);await expect(screen.getByRole('option',name,{exact:true})).toBeVisible();await input.press('Tab');
 await expect(browser.locator('#message-input [data-type="skill-reference"]')).toHaveText('@'+name);expect((await snapshot(browser)).text).toBe('- @'+name+' ');
 await expect(browser.locator('#message-input ul')).toHaveCount(1);expect((await snapshot(browser)).text.includes('\t')).toBe(false);
});

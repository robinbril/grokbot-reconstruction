import {test,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';

async function geometry(browser:Browser) {
 return browser.evaluate(async()=>{
  await document.fonts.ready;
  return ['.sidebar','.conversation','.conversation-header','.transcript','.composer-wrap','.context-pane'].map(selector=>{
   const node=document.querySelector(selector);
   if(!node)throw Error(`Missing layout surface: ${selector}`);
   const {x,y,width,height}=node.getBoundingClientRect();
   return {selector,x,y,width,height};
  });
 });
}

test('desktop titlebar preserves the upper hit area of an existing header control',async({app,browser,screen})=>{
 await app.open('/?desktop=1&reset=1');
 await expect(screen.getByRole('button','Chat sluiten',{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>{
  const button=document.querySelector<HTMLButtonElement>('.conversation-header [data-action="close-chat"]');
  if(!button)throw Error('Missing existing close-chat control');
  const rect=button.getBoundingClientRect();
  return document.elementFromPoint(rect.x+rect.width/2,rect.y+0.5)?.closest('button')===button;
 })).toBe(true);
});

test('desktop chrome preserves reference geometry and an editable retained draft',async({app,browser,screen})=>{
 await app.open('/?reset=1#reference-chat');
 await expect(browser.locator('[data-reference-chat]')).toBeVisible();
 await expect(browser.locator('.traffic-lights')).toBeVisible();
 const webGeometry=await geometry(browser);
 await app.open('/?desktop=1&reset=1#reference-chat');
 await expect(browser.locator('html')).toHaveAttribute('data-desktop-shell','');
 await expect(browser.locator('[data-reference-chat]')).toBeVisible();
 await expect(browser.locator('.traffic-lights')).toBeHidden();
 expect(await geometry(browser)).toEqual(webGeometry);
 expect(await browser.evaluate(()=>({
  region:getComputedStyle(document.querySelector('.conversation-header')!).getPropertyValue('app-region'),
  overlay:getComputedStyle(document.body,'::before').content,
  editorRegion:getComputedStyle(document.querySelector('#message-input')!).getPropertyValue('app-region'),
 }))).toEqual({region:'drag',overlay:'none',editorRegion:'no-drag'});
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.click();
 await expect(input).toBeFocused();
 await input.pressSequentially('Synthetic desktop draft');
 await expect(input).toHaveText('Synthetic desktop draft');
 await app.open('/?desktop=1#reference-chat');
 await expect(input).toHaveText('Synthetic desktop draft');
 await input.click();
 await input.press('End');
 await input.pressSequentially(' retained');
 await expect(input).toHaveText('Synthetic desktop draft retained');
 await expect(browser.locator('.message.user')).toHaveCount(1);
 await app.screenshot('native-chrome-with-retained-synthetic-draft');
});

test('default web chrome keeps its controls and desktop flag requires an exact opt-in',async({app,browser,screen,agent})=>{
 await app.open('/?reset=1');
 await expect(browser.locator('html')).not.toHaveAttribute('data-desktop-shell');
 await expect(browser.locator('.traffic-lights')).toBeVisible();
 await expect(screen.getByRole('button','Zoeken',{exact:true})).toBeVisible();
 await expect(screen.getByRole('button','Nieuwe chat',{exact:true})).toBeVisible();
 await expect(screen.getByRole('button','Download Grok Bot',{exact:true})).toBeVisible();
 await agent.act('Open Marketing Agent. Do not send any message.');
 await expect(browser.locator('.header-identity .header-title')).toHaveText('Marketing Agent');
 await agent.act('Open Zoeken using the sidebar search control.');
 const search=screen.getByRole('textbox','Zoeken in Bots en gesprekken',{exact:true});
 await expect(search).toBeFocused();
 await search.fill('Marketing');
 await expect(search).toHaveValue('Marketing');
 await app.open('/?desktop=0&reset=1');
 await expect(browser.locator('html')).not.toHaveAttribute('data-desktop-shell');
 await expect(browser.locator('.traffic-lights')).toBeVisible();
});

test('desktop reference stays bounded and preserves controls at three viewport widths',async({app,browser,screen})=>{
 for(const width of [1440,768,390]){
  await browser.setViewport({width,height:900});
  await app.open('/?desktop=1&reset=1#reference-chat');
  await expect(browser.locator('[data-original-avatar] svg').first()).toBeVisible();
  await expect(browser.locator('.traffic-lights')).toBeHidden();
  const bounds=await browser.evaluate(()=>{
   const composer=document.querySelector('.composer')!.getBoundingClientRect();
   return {page:document.documentElement.scrollWidth,viewport:innerWidth,left:composer.left,right:composer.right};
  });
  expect(bounds.viewport).toBe(width);
  expect(bounds.page).toBeLessThanOrEqual(width);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  await expect(screen.getByRole('button','Details sluiten')).toBeVisible();
  await app.screenshot(`desktop-reference-${width}`);
 }
});

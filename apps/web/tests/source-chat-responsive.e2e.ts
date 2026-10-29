import {test} from '@e2e-dev/web';
import {expect} from 'e2e';

test('source reference stays bounded at desktop tablet and narrow widths',async({app,browser,screen})=>{
 for(const width of [1440,768,390]){
  await browser.setViewport({width,height:900});
  await app.open('/?reset=1#reference-chat');
  await expect(browser.locator('[data-original-avatar] svg').first()).toBeVisible();
  const bounds=await browser.evaluate(()=>{
   const pane=document.querySelector('.context-pane')!.getBoundingClientRect();
   const composer=document.querySelector('.composer')!.getBoundingClientRect();
   return{page:document.documentElement.scrollWidth,viewport:innerWidth,paneRight:pane.right,composerLeft:composer.left,composerRight:composer.right};
  });
  expect(bounds.page).toBeLessThanOrEqual(width);
  expect(bounds.paneRight).toBeLessThanOrEqual(width);
  expect(bounds.composerLeft).toBeGreaterThanOrEqual(0);
  expect(bounds.composerRight).toBeLessThanOrEqual(width);
  await expect(screen.getByRole('button','Details sluiten')).toBeVisible();
  await app.screenshot(`source-reference-${width}`);
 }
});

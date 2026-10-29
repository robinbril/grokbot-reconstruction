import type {Browser} from '@e2e-dev/web';
import {expect,type Screen} from 'e2e';

// Native quote navigation owns scrolling, while keyboard focus stays on the clicked quote.
export async function expectOriginalJump(browser:Browser,button:ReturnType<Screen['getByRole']>,selector:string){
 await button.click();await expect(button).toBeFocused();await expect(browser.locator(selector)).toBeVisible();
 await expect.poll(()=>browser.evaluate(selector=>{
  const viewport=document.querySelector('.transcript')!,node=document.querySelector(selector)!;
  const box=viewport.getBoundingClientRect(),target=node.getBoundingClientRect();
  const destination=Math.max(0,Math.min(viewport.scrollHeight-viewport.clientHeight,viewport.scrollTop+target.top+target.height/2-box.top-viewport.clientHeight/2));
  return {landed:Math.abs(destination-viewport.scrollTop)<=1,intersects:target.bottom>box.top&&target.top<box.bottom};
 },selector)).toEqual({landed:true,intersects:true});
}

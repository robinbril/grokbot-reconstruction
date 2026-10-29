import type {Browser} from '@e2e-dev/web';
import {expect} from 'e2e';

// Canonical plain text is exact: DOM text assertions collapse spaces/newlines.
export async function expectComposerText(browser:Browser,text:string){
 const input=browser.locator('#message-input[data-rich-composer]');
 await expect(input).toBeVisible();
 await expect(input).toHaveText(text);
 await expect.poll(()=>browser.evaluate(async()=>{
  const modulePath='/composer-input.js';
  const {readComposerInput}=await import(modulePath);
  return readComposerInput(document.querySelector('#message-input')).text;
 })).toBe(text);
}

// Fixture hydration, not a keyboard simulation: contenteditable fill creates
// paragraph nodes. The native plain-text hydration instead uses hardBreaks.
// Keep original fixture bytes, including a final newline, before the UI send.
export async function setComposerText(browser:Browser,text:string){
 const accepted=await browser.evaluate(async(value:string)=>{
  const modulePath='/composer-input.js';
  const {replaceComposerText}=await import(modulePath);
  return replaceComposerText(document.querySelector('#message-input'),value);
 },text);
 expect(accepted).toBe(true);
 await expectComposerText(browser,text);
}

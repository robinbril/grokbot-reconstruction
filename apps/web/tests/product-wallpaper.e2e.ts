import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
test('source onboarding JPEG wallpaper is served with its type and really decodes',async({app,screen,browser})=>{
 await app.open('/?reset=1');expect(await browser.evaluate(async()=>{const r=await fetch('/assets/demo-computer-wallpaper-BO7Ye4dV.jpg');return {status:r.status,type:r.headers.get('content-type')};})).toEqual({status:200,type:'image/jpeg'});
 await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Introductie',exact:true}).click();await screen.getByRole('button',{name:'Volgende',exact:true}).click();await expect.poll(()=>browser.evaluate(()=>{const i=document.querySelector('[data-demo-desktop] > img') as HTMLImageElement|null;return Boolean(i?.complete&&i.naturalWidth>0);})).toBe(true);
});

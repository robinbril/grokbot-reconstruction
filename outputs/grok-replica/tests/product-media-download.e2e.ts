import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('gallery download follows the selected source and returns its exact original bytes',async({app,screen,browser})=>{
 const name='demo-computer-wallpaper-BO7Ye4dV.jpg';
 const expectedHash=createHash('sha256').update(await readFile('assets/'+name)).digest('hex');
 await app.open('/?reset=1');await browser.evaluate(async()=>{await(window as any).productSurfaces.ready;});
 await screen.getByRole('button',{name:'Marketing Agent',exact:true}).click();
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/profile.png','assets/'+name]);
 await expect(screen.getByRole('button',{name:'Bijlage openen: '+name,exact:true})).toBeVisible();
 const selectedId=await screen.getByRole('button',{name:'Bijlage openen: '+name,exact:true}).getAttribute('data-id');expect(Boolean(selectedId)).toBe(true);
 await screen.getByRole('button',{name:'Bijlage openen: profile.png',exact:true}).click();
 await screen.getByRole('button',{name:'Afbeelding 2 van 2',exact:true}).click();
 await expect.poll(()=>browser.evaluate(()=>{const img=document.querySelector('[data-media-image]')as HTMLImageElement;return img.naturalWidth>1&&getComputedStyle(img).opacity==='1';})).toBe(true);
 await expect(screen.getByRole('button',{name:'Downloaden',exact:true})).toHaveAttribute('data-id',selectedId!);
 // Observe the actual downloaded Blob and filename; still perform the real anchor click.
 await browser.evaluate(()=>{const w=window as any;w.__downloadBlobs=new Map();w.__downloadURLOriginal=URL.createObjectURL;w.__downloadClickOriginal=HTMLAnchorElement.prototype.click;w.__downloadRecord=null;
  URL.createObjectURL=function(blob:Blob){const url=w.__downloadURLOriginal.call(URL,blob);w.__downloadBlobs.set(url,blob);return url;};
  HTMLAnchorElement.prototype.click=function(){const blob=w.__downloadBlobs.get(this.href),name=this.download;if(name&&blob)w.__downloadPromise=blob.arrayBuffer().then((bytes:ArrayBuffer)=>crypto.subtle.digest('SHA-256',bytes)).then((digest:ArrayBuffer)=>{w.__downloadRecord={name,sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};});return w.__downloadClickOriginal.call(this);};
 });
 try{
  await screen.getByRole('button',{name:'Downloaden',exact:true}).click();
  await expect.poll(()=>browser.evaluate(()=>Boolean((window as any).__downloadRecord))).toBe(true);
  expect(await browser.evaluate(()=>(window as any).__downloadRecord)).toEqual({name,sha256:expectedHash});
 }finally{await browser.evaluate(()=>{const w=window as any;URL.createObjectURL=w.__downloadURLOriginal;HTMLAnchorElement.prototype.click=w.__downloadClickOriginal;w.__downloadBlobs.clear();});}
});

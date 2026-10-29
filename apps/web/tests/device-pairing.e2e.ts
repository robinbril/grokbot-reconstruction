import {test} from '@e2e-dev/web';
import {expect,type App,type Screen} from 'e2e';
import {randomUUID} from 'node:crypto';

async function devicePanel(app: App,screen: Screen){
 await app.open('/');await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();
 await screen.getByRole('menuitem',{name:'Apparaten',exact:true}).click();
 await expect(screen.getByRole('heading',{name:'Apparaten',exact:true})).toBeVisible();
}
async function sourceDevice(base: string){
 const status=await fetch(base+'/api/harness/status');if(!status.ok)throw Error('Source device status unavailable');
 const cookie=status.headers.get('set-cookie')?.split(';')[0],identity=await status.json();if(!cookie)throw Error('Source device cookie unavailable');
 const request=async(path: string,body: Record<string,unknown>)=>{
  const response=await fetch(base+'/api/harness'+path,{method:'POST',headers:{cookie,origin:base,'Content-Type':'application/json','x-harness-csrf':identity.csrfToken},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw Error(value.error?.message||'Source device request failed');return value;
 };
 return {identity,request};
}

test('device management is discoverable in the actual account menu',async({app,agent,screen})=>{
 await app.open('/');await agent.act('Open Apparaten via Accountmenu. Maak geen koppelcode en trek geen toegang in.');
 await expect(screen.getByRole('heading',{name:'Apparaten',exact:true})).toBeVisible();
 await expect(screen.getByRole('button',{name:'Koppelcode maken',exact:true})).toBeVisible();
 await app.screenshot('device-management-without-credential');
});

test('real pairing rotates the browser identity into the source owner and exposes actual revocable devices',async({app,browser,screen})=>{
 await devicePanel(app,screen);
 const origin=await browser.evaluate(()=>location.origin),source=await sourceDevice(origin);
 await source.request('/conversations/device-ui-'+randomUUID()+'/descriptor',{requestId:randomUUID(),clientKey:'device-ui-source',name:'Synthetisch apparaatgesprek'});
 const pair=await source.request('/devices/pairing',{});
 await screen.getByRole('textbox',{name:'Koppelcode',exact:true}).fill(pair.code);
 await screen.getByRole('textbox',{name:'Apparaatnaam',exact:true}).fill('Synthetische telefoon');
 await screen.getByRole('button',{name:'Apparaat koppelen',exact:true}).click();
 await expect(screen.getByText('Dit apparaat is gekoppeld.',{exact:true})).toBeVisible();
 const state=await browser.evaluate(async()=>{const response=await fetch('/api/harness/devices');return response.json();});
 expect(state.principalScope).toBe(source.identity.principalScope);expect(state.devices).toHaveLength(2);
 expect(state.devices.find((device:{current:boolean})=>device.current).label).toBe('Synthetische telefoon');
 await expect(screen.getByRole('textbox',{name:'Koppelcode',exact:true})).toHaveValue('');
 await screen.getByRole('button',{name:'Sluiten',exact:true}).click();
 await screen.getByRole('button',{name:'Synthetisch apparaatgesprek',exact:true}).click();
 await expect.poll(()=>browser.evaluate(()=>{
  const w=window as Window&{productSurfaces:{diagnostics():{modules:Array<{id:string;conversations?:number}>}}};return w.productSurfaces.diagnostics().modules.find(module=>module.id==='live-harness')?.conversations;
 }),{timeout:15000}).toBe(1);
 await expect(browser.locator('[data-live-send-error]')).toBeHidden();
 await screen.getByRole('button',{name:'Accountmenu',exact:true}).click();await screen.getByRole('menuitem',{name:'Apparaten',exact:true}).click();
 const other=state.devices.find((device:{current:boolean})=>!device.current);
 await browser.locator(`[data-device-id="${other.id}"] [data-action="device-revoke"]`).click();
 await expect(screen.getByText('De toegang van dit apparaat is ingetrokken.',{exact:true})).toBeVisible();
 await expect.poll(()=>browser.evaluate(async()=>{const response=await fetch('/api/harness/devices');return (await response.json()).devices.length;})).toBe(1);
 await app.screenshot('paired-device-and-revoked-secondary-device');
});

test('invalid pairing keeps the exact code and device name available for correction',async({app,screen})=>{
 await devicePanel(app,screen);
 await screen.getByRole('textbox',{name:'Koppelcode',exact:true}).fill('synthetic-invalid-code');
 await screen.getByRole('textbox',{name:'Apparaatnaam',exact:true}).fill('Mijn testapparaat');
 await screen.getByRole('button',{name:'Apparaat koppelen',exact:true}).click();
 await expect(screen.getByRole('alert')).toBeVisible();
 await expect(screen.getByRole('textbox',{name:'Koppelcode',exact:true})).toHaveValue('synthetic-invalid-code');
 await expect(screen.getByRole('textbox',{name:'Apparaatnaam',exact:true})).toHaveValue('Mijn testapparaat');
});

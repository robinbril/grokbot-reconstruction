import {test,beforeAll,afterAll,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {oauthFixture} from './fixtures/oauth-provider.mjs';
let provider:Awaited<ReturnType<typeof oauthFixture>>;
beforeAll(async()=>{provider=await oauthFixture({consent:true});});
afterAll(async()=>{await provider.close();});

async function holdInitialAccessHistory(browser:Browser){
 await browser.addInitScript(()=>{
  const original=window.fetch.bind(window);let released=sessionStorage.getItem('access-draft-history-released')==='yes';
  const gate=new Promise<void>(resolve=>window.addEventListener('access-release-draft-history',()=>{released=true;sessionStorage.setItem('access-draft-history-released','yes');resolve();},{once:true}));
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const response=await original(...args),path=new URL(String(args[0]),location.href).pathname;
   if((args[1]?.method||'GET')==='GET'&&path==='/api/harness/access'&&!released){sessionStorage.setItem('access-draft-history-held','yes');await gate;}
   return response;
  };
 });
}

async function verifyTeamDraftDuringRefresh(browser:Browser){
 const field=browser.locator('[data-access-field="teamName"]');
 try{
  await expect.poll(()=>browser.evaluate(()=>sessionStorage.getItem('access-draft-history-held'))).toBe('yes');
  await field.fill('Access proof team');
  await browser.evaluate(()=>{
   const input=document.querySelector<HTMLInputElement>('[data-access-field="teamName"]');if(!input)throw new Error('Missing team input');
   (window as Window & {__accessDraftInput?:HTMLInputElement}).__accessDraftInput=input;
   window.dispatchEvent(new Event('access-release-draft-history'));
  });
  await expect.poll(()=>browser.evaluate(()=>document.querySelector('[data-live-access-root]')?.textContent?.includes('Rechten ophalen…'))).toBe(false);
  expect(await browser.evaluate(()=>{const original=(window as Window & {__accessDraftInput?:HTMLInputElement}).__accessDraftInput;return Boolean(original?.isConnected&&original===document.querySelector('[data-access-field="teamName"]'));})).toBe(true);
  await expect(field).toHaveValue('Access proof team');await expect(field).toBeFocused();
 }finally{await browser.evaluate(()=>window.dispatchEvent(new Event('access-release-draft-history')));}
}

test('real local OAuth callback creates an account; rename and disconnect persist',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Leave the current tab unchanged and do not submit a message or connect a server.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await expect(screen.getByRole('dialog','Accounts beheren',{exact:true})).toBeVisible();
 await screen.getByLabel('Accountnaam',{exact:true}).fill('OAuth proof');
 await screen.getByLabel('Account MCP-server-URL',{exact:true}).fill(provider.resourceUrl);
 await screen.getByRole('button','Account toevoegen',{exact:true}).click();
 await expect(screen.getByRole('dialog','Account verbinden',{exact:true})).toBeVisible();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Wacht op toestemming');
 const before=await browser.evaluate(async()=>fetch('/api/harness/accounts').then(response=>response.json()));
 expect(before.accounts).toEqual([]);
 const authorization=await screen.getByRole('link','Doorgaan met authenticatie',{exact:true}).getAttribute('href');
 expect(authorization).toContain('/authorize?');
 await browser.goto(authorization!);
 await expect(screen.getByRole('button','Allow',{exact:true})).toBeVisible();
 await screen.getByRole('button','Allow',{exact:true}).click();
 await browser.goto('/');
 await screen.getByRole('button','Computer openen',{exact:true}).click();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await expect(screen.getByRole('button','Account beheren: OAuth proof',{exact:true})).toBeVisible();
 await screen.getByRole('button','Account beheren: OAuth proof',{exact:true}).click();
 await expect(screen.getByRole('status','Accountstatus',{exact:true})).toHaveText('Verbonden');
 await screen.getByLabel('Accountnaam wijzigen',{exact:true}).fill('OAuth renamed');
 await screen.getByRole('button','Naam bewaren',{exact:true}).click();
 await expect(screen.getByRole('heading','OAuth renamed',{exact:true})).toBeVisible();
 await screen.getByRole('button','Verbinding verbreken',{exact:true}).click();
 await expect(screen.getByRole('status','Accountstatus',{exact:true})).toHaveText('Niet verbonden');
 await browser.reload();
 await screen.getByRole('button','Computer openen',{exact:true}).click();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await screen.getByRole('button','Account beheren: OAuth renamed',{exact:true}).click();
 await expect(screen.getByRole('status','Accountstatus',{exact:true})).toHaveText('Niet verbonden');
 expect(provider.exchanges).toBe(1);expect(provider.revocations).toBe(1);
});

test('invalid OAuth start retains the form; cancelling pending consent creates no account',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Leave the current tab unchanged and do not submit a message or connect a server.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await expect(screen.getByRole('dialog','Accounts beheren',{exact:true})).toBeVisible();
 await screen.getByLabel('Accountnaam',{exact:true}).fill('Cancel proof');
 await screen.getByLabel('Account MCP-server-URL',{exact:true}).fill('javascript:alert(1)');
 await screen.getByRole('button','Account toevoegen',{exact:true}).click();
 await expect(screen.getByRole('alert')).toBeVisible();
 await expect(screen.getByLabel('Account MCP-server-URL',{exact:true})).toHaveValue('javascript:alert(1)');
 await screen.getByLabel('Account MCP-server-URL',{exact:true}).fill(provider.resourceUrl);
 await screen.getByRole('button','Account toevoegen',{exact:true}).click();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Wacht op toestemming');
 await screen.getByRole('button','Authenticatie stoppen',{exact:true}).click();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Authenticatie gestopt');
 await expect(screen.getByRole('link','Doorgaan met authenticatie',{exact:true})).toHaveCount(0);
 const receipt=await browser.evaluate(async()=>fetch('/api/harness/accounts').then(response=>response.json()));
 expect(receipt.accounts).toEqual([]);
});

test('local team and Bot sharing persist through authoritative access management',async({app,agent,screen,browser})=>{
 await holdInitialAccessHistory(browser);
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Leave the current tab unchanged and do not submit a message or connect a server.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await screen.getByRole('button','Bots en teams',{exact:true}).click();
 await expect(screen.getByRole('dialog','Bots en teams',{exact:true})).toBeVisible();
 await verifyTeamDraftDuringRefresh(browser);
 await screen.getByRole('button','Team maken',{exact:true}).click();
 await expect(browser.locator('details.detail-section > summary').filter({hasText:'Access proof team'})).toHaveCount(1);
 await expect(browser.locator('.account-state .fill').filter({hasText:' · jij'})).toHaveCount(1);
 await screen.getByRole('button','Deze Bot registreren',{exact:true}).click();
 await expect(screen.getByLabel('Team voor Bot: Marketing Agent',{exact:true})).toBeVisible();
 await screen.getByLabel('Team voor Bot: Marketing Agent',{exact:true}).selectOption('Access proof team');
 await screen.getByRole('button','Delen bewaren',{exact:true}).click();
 await expect.poll(async()=>browser.evaluate(async()=>{
  const response=await fetch('/api/harness/access').then(value=>value.json());
  return response.bots.some((bot:{teamId:string})=>response.teams.some((team:{id:string,name:string})=>team.name==='Access proof team'&&team.id===bot.teamId));
 })).toBe(true);
 await screen.getByRole('button','Uitnodiging maken',{exact:true}).click();
 await expect(screen.getByLabel('Nieuwe uitnodigingscode',{exact:true})).toBeVisible();
 await browser.reload();
 await screen.getByRole('button','Computer openen',{exact:true}).click();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await screen.getByRole('button','Bots en teams',{exact:true}).click();
 await expect(screen.getByLabel('Team voor Bot: Marketing Agent',{exact:true})).toHaveValue(await browser.evaluate(async()=>{
  const response=await fetch('/api/harness/access').then(value=>value.json());return response.teams.find((team:{id:string,name:string})=>team.name==='Access proof team').id;
 }));
});

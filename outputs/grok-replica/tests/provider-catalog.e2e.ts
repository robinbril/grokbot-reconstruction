// Synthetic account receipts isolate UI wiring. Real provider exchanges are
// covered separately by provider-oauth{,-http}.test.mjs. No external consent.
import {test,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';

const github={id:'github',name:'GitHub',status:'ready'};
const notion={id:'notion',name:'Notion',status:'setupRequired',setup:{message:'Configureer de synthetische Notion OAuth-integratie.',environmentVariables:['NOTION_CLIENT_ID']}};
const githubAccount={id:'synthetic-github',providerId:'github',name:'Synthetisch GitHub-account',status:'connected'};
const notionAccount={id:'synthetic-notion',providerId:'notion',name:'Synthetisch Notion-account',status:'authenticationRequired'};
async function demoFlags(browser:Browser){return browser.evaluate(()=>{
 const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}');
 return {installed:state.installed,authenticated:state.authenticated};
});}

test('catalog cards open scoped live accounts and truthful missing setup without changing demo flags',async({app,browser,screen,agent})=>{
 let starts=0;
 await browser.route('**/api/harness/accounts/providers',async route=>{await route.fulfill({json:{providers:[github,notion]}});});
 await browser.route('**/api/harness/accounts',async route=>{await route.fulfill({json:{accounts:[githubAccount,notionAccount],pendingFlows:[]}});});
 await browser.route('**/api/harness/accounts/providers/*/start',async route=>{starts++;await route.fulfill({status:500,json:{error:{message:'Unexpected synthetic consent start'}}});});
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const before=await demoFlags(browser);
 await screen.getByRole('button','Apps verbinden',{exact:true}).click();
 await agent.act('Open uitsluitend de Notion-appkaart in Apps verbinden. Start geen authenticatie en verleen geen toegang.');
 await expect(screen.getByRole('heading','Notion',{exact:true,level:1})).toBeVisible();
 await expect(screen.getByRole('status','Notion configuratie',{exact:true})).toHaveText('Configuratie nodig');
 await expect(screen.getByRole('button','Notion verbinden',{exact:true})).toBeDisabled();
 await expect(screen.getByText(notion.setup.message,{exact:true})).toBeVisible();
 await expect(screen.getByRole('button','Account beheren: Synthetisch Notion-account',{exact:true})).toBeVisible();
 await expect(screen.getByRole('button','Account beheren: Synthetisch GitHub-account',{exact:true})).toHaveCount(0);
 await app.screenshot('notion-catalog-real-setup-light');
 await screen.getByRole('button','Terug',{exact:true}).click();
 await agent.act('Open uitsluitend de GitHub-appkaart. Start geen authenticatie en verleen geen toegang.');
 await expect(screen.getByRole('heading','GitHub',{exact:true,level:1})).toBeVisible();
 await expect(screen.getByRole('status','GitHub configuratie',{exact:true})).toHaveText('Klaar om te verbinden');
 await expect(screen.getByRole('button','Account beheren: Synthetisch GitHub-account',{exact:true})).toBeVisible();
 await expect(screen.getByRole('button','Account beheren: Synthetisch Notion-account',{exact:true})).toHaveCount(0);
 await screen.getByRole('button','Account beheren: Synthetisch GitHub-account',{exact:true}).click();
 await expect(screen.getByRole('status','Accountstatus',{exact:true})).toHaveText('Verbonden');
 await screen.getByRole('button','Terug',{exact:true}).click();
 await expect(screen.getByRole('heading','GitHub',{exact:true,level:1})).toBeVisible();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await expect(screen.getByRole('heading','Accounts beheren',{exact:true,level:1})).toBeVisible();
 await expect(screen.getByRole('button',/^Account beheren:/)).toHaveCount(2);
 await screen.getByRole('button','Sluiten',{exact:true}).click();
 await screen.getByRole('button','Bijvoegen',{exact:true}).click();
 await screen.getByRole('menuitem','App koppelen',{exact:true}).click();
 await expect(screen.getByRole('heading','App koppelen aan gesprek',{exact:true})).toBeVisible();
 await agent.act('Kies uitsluitend GitHub in App koppelen aan gesprek. Start geen authenticatie en verleen geen toegang.');
 await expect(screen.getByRole('heading','GitHub',{exact:true,level:1})).toBeVisible();
 await expect(screen.getByRole('button','Account beheren: Synthetisch GitHub-account',{exact:true})).toBeVisible();
 await expect(browser.locator('.transcript .product-connector-card')).toHaveCount(0);
 expect(starts).toBe(0);expect(await demoFlags(browser)).toEqual(before);
});

test('catalog provider consent stays pending, cancels without an account and exposes start failures in dark mode',async({app,browser,screen,agent})=>{
 let starts=0,cancelled=false,failStart=false;
 // This is only synthetic browser-local appearance state, never a user account.
 await browser.addInitScript(()=>{localStorage.setItem('grok-local-replica-v1',JSON.stringify({version:1,theme:'dark'}));});
 await browser.route('**/api/harness/accounts/providers',async route=>{await route.fulfill({json:{providers:[github,notion]}});});
 await browser.route('**/api/harness/accounts',async route=>{await route.fulfill({json:{accounts:[],pendingFlows:[]}});});
 await browser.route('**/api/harness/accounts/providers/github/start',async route=>{
  starts++;await route.fulfill(failStart?{status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'Synthetische GitHub-start mislukt.'}}}:{json:{flowId:'catalog-synthetic-flow',providerId:'github',status:'pending',authorizationUrl:'http://127.0.0.1:8893/synthetic-consent-never-opened'}});
 });
 await browser.route('**/api/harness/accounts/flows/catalog-synthetic-flow',async route=>{await route.fulfill({json:{flowId:'catalog-synthetic-flow',providerId:'github',status:cancelled?'cancelled':'pending'}});});
 await browser.route('**/api/harness/accounts/flows/catalog-synthetic-flow/cancel',async route=>{cancelled=true;await route.fulfill({json:{flowId:'catalog-synthetic-flow',providerId:'github',status:'cancelled'}});});
 await app.open('/');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const before=await demoFlags(browser);
 await screen.getByRole('button','Apps verbinden',{exact:true}).click();
 await agent.act('Open uitsluitend de GitHub-appkaart. Start nog geen authenticatie. Dit is een synthetische lokale test.');
 await expect(screen.getByRole('heading','GitHub',{exact:true,level:1})).toBeVisible();
 await expect(screen.getByRole('button','GitHub verbinden',{exact:true})).toBeEnabled();expect(starts).toBe(0);
 await screen.getByRole('button','GitHub verbinden',{exact:true}).click();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Wacht op toestemming');
 await expect(screen.getByRole('link','Doorgaan met authenticatie',{exact:true})).toHaveAttribute('href','http://127.0.0.1:8893/synthetic-consent-never-opened');
 expect(starts).toBe(1);
 await screen.getByRole('button','Authenticatie stoppen',{exact:true}).click();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Authenticatie gestopt');
 await expect(screen.getByRole('link','Doorgaan met authenticatie',{exact:true})).toHaveCount(0);
 await screen.getByRole('button','Terug',{exact:true}).click();
 await expect(screen.getByRole('heading','GitHub',{exact:true,level:1})).toBeVisible();
 await expect(screen.getByRole('button',/^Account beheren:/)).toHaveCount(0);
 failStart=true;await screen.getByRole('button','GitHub verbinden',{exact:true}).click();
 await expect(screen.getByRole('alert')).toHaveText('Synthetische GitHub-start mislukt.');
 await expect(screen.getByRole('button','GitHub verbinden',{exact:true})).toBeEnabled();
 expect(starts).toBe(2);expect(await demoFlags(browser)).toEqual(before);
 await app.screenshot('github-catalog-no-false-connection-dark');
});

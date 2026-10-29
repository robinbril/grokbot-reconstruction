import {test} from '@e2e-dev/web';
import {expect} from 'e2e';

const github={id:'github',name:'GitHub',status:'ready',resourceUrl:'https://api.githubcopilot.com/mcp/'};
const notion={id:'notion',name:'Notion',status:'setupRequired',setup:{message:'Configureer de Notion OAuth-integratie.',environmentVariables:['NOTION_CLIENT_ID','NOTION_CLIENT_SECRET']}};

test('provider readiness explains missing setup without claiming a connected account',async({app,agent,screen,browser})=>{
 await browser.route('**/api/harness/accounts/providers',async route=>{await route.fulfill({json:{providers:[github,notion]}});});
 await browser.route('**/api/harness/accounts',async route=>{await route.fulfill({json:{accounts:[],pendingFlows:[]}});});
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Do not submit a message, connect a provider or execute a command.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await expect(screen.getByRole('button','GitHub verbinden',{exact:true})).toBeEnabled();
 await expect(screen.getByRole('button','Notion verbinden',{exact:true})).toBeDisabled();
 await expect(screen.getByRole('status','Notion configuratie',{exact:true})).toHaveText('Configuratie nodig');
 await expect(screen.getByText('Configureer de Notion OAuth-integratie.',{exact:true})).toBeVisible();
 await expect(screen.getByRole('button',/^Account beheren:/)).toHaveCount(0);
});

test('provider consent remains pending and cancellation creates no account',async({app,agent,screen,browser})=>{
 let cancelled=false;
 await browser.route('**/api/harness/accounts/providers',async route=>{await route.fulfill({json:{providers:[github,notion]}});});
 await browser.route('**/api/harness/accounts',async route=>{await route.fulfill({json:{accounts:[],pendingFlows:[]}});});
 await browser.route('**/api/harness/accounts/providers/github/start',async route=>{await route.fulfill({json:{flowId:'synthetic-provider-flow',providerId:'github',status:'pending',authorizationUrl:'https://github.com/login/oauth/authorize?state=synthetic-test-only'}});});
 await browser.route('**/api/harness/accounts/flows/synthetic-provider-flow',async route=>{await route.fulfill({json:{flowId:'synthetic-provider-flow',providerId:'github',status:cancelled?'cancelled':'pending'}});});
 await browser.route('**/api/harness/accounts/flows/synthetic-provider-flow/cancel',async route=>{cancelled=true;await route.fulfill({json:{flowId:'synthetic-provider-flow',status:'cancelled'}});});
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Do not submit a message, connect a provider or execute a command.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await screen.getByRole('button','GitHub verbinden',{exact:true}).click();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Wacht op toestemming');
 await expect(screen.getByRole('link','Doorgaan met authenticatie',{exact:true})).toBeVisible();
 await screen.getByRole('button','Authenticatie stoppen',{exact:true}).click();
 await expect(screen.getByRole('status','Authenticatiestatus',{exact:true})).toHaveText('Authenticatie gestopt');
 await expect(screen.getByRole('link','Doorgaan met authenticatie',{exact:true})).toHaveCount(0);
 await screen.getByRole('button','Terug',{exact:true}).click();
 await expect(screen.getByRole('button',/^Account beheren:/)).toHaveCount(0);
});

test('provider start failure stays visible with no connected account',async({app,agent,screen,browser})=>{
 await browser.route('**/api/harness/accounts/providers',async route=>{await route.fulfill({json:{providers:[github,notion]}});});
 await browser.route('**/api/harness/accounts',async route=>{await route.fulfill({json:{accounts:[],pendingFlows:[]}});});
 await browser.route('**/api/harness/accounts/providers/github/start',async route=>{await route.fulfill({status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'GitHub is tijdelijk niet bereikbaar.'}}});});
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Do not submit a message, connect a provider or execute a command.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await screen.getByRole('button','Accounts beheren',{exact:true}).click();
 await screen.getByRole('button','GitHub verbinden',{exact:true}).click();
 await expect(screen.getByRole('alert')).toHaveText('GitHub is tijdelijk niet bereikbaar.');
 await expect(screen.getByRole('button','GitHub verbinden',{exact:true})).toBeEnabled();
 await expect(screen.getByRole('button',/^Account beheren:/)).toHaveCount(0);
});

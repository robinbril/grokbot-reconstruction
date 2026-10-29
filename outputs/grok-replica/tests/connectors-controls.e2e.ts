import {test} from '@e2e-dev/web';
import {expect} from 'e2e';
import {fileURLToPath} from 'node:url';

const fixture=fileURLToPath(new URL('./fixtures/harness-math-mcp.mjs',import.meta.url));

test('reopening a demo connector never duplicates tool permission controls',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as Window & {productSurfaces:{ready:Promise<void>}}).productSurfaces.ready;});
 await agent.act('Open Apps verbinden and search for Context7. Open its details without adding or connecting it.');
 await expect(screen.getByRole('dialog','Context7')).toBeVisible();
 await expect(browser.locator('[data-connector-permission]')).toHaveCount(3);
 await browser.evaluate(()=>{const surfaces=(window as Window & {productSurfaces:{afterRender:()=>void}}).productSurfaces;surfaces.afterRender();surfaces.afterRender();});
 await expect(browser.locator('[data-connector-permission]')).toHaveCount(3);
 await screen.getByRole('button','Sluiten',{exact:true}).click();
 await screen.getByRole('button','Apps verbinden',{exact:true}).click();
 await screen.getByRole('combobox').fill('Context7');
 await screen.getByRole('option').filter({hasText:'Context7'}).click();
 await expect(browser.locator('[data-connector-permission]')).toHaveCount(3);
});

test('real discovered tool policy and connector enabled state survive reload',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await screen.getByRole('button','Apps verbinden',{exact:true}).click();
 await expect(screen.getByRole('button','10 lokale voorbeelden',{exact:true})).toBeVisible();
 await screen.getByRole('button','Sluiten',{exact:true}).click();
 await agent.act('Open Computer openen. Leave the current tab unchanged and do not submit a message or connect a server.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await expect(screen.getByRole('tab','Tools',{exact:true})).toBeSelected();
 await screen.getByText('MCP-server toevoegen',{exact:true}).click();
 await screen.getByLabel('MCP-server-ID').fill('controls_proof');
 await screen.getByLabel('MCP-servernaam').fill('Controls proof');
 await screen.getByLabel('MCP-commando').fill(process.execPath);
 await screen.getByLabel('MCP-argumenten').fill(JSON.stringify([fixture]));
 await screen.getByRole('button','Server verbinden',{exact:true}).click();
 await expect(screen.getByRole('heading','Controls proof connected')).toBeVisible({timeout:120_000});
 await expect(screen.getByLabel('sum inschakelen',{exact:true})).toHaveCount(1);
 await expect(screen.getByLabel('sum inschakelen',{exact:true})).toBeChecked();
 await screen.getByText('sum',{exact:true}).click();
 await screen.getByLabel('sum inschakelen',{exact:true}).uncheck();
 await expect(screen.getByLabel('sum inschakelen',{exact:true})).not.toBeChecked({timeout:120_000});
 const policy=await browser.evaluate(async()=>{
  const local=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=local.liveHarness.serverIds[local.selected];
  const snapshot=await fetch('/api/harness/conversations/'+encodeURIComponent(id)).then(response=>response.json());
  return snapshot.servers.find((server:{id:string})=>server.id==='custom_controls_proof').configuration;
 });
 expect(policy.disabledTools).toEqual(['sum']);
 await browser.reload();
 await screen.getByRole('button','Computer openen',{exact:true}).click();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await expect(screen.getByLabel('sum inschakelen',{exact:true})).not.toBeChecked();
 await expect(screen.getByLabel('sum inschakelen',{exact:true})).toHaveCount(1);
 await screen.getByLabel('Controls proof inschakelen',{exact:true}).uncheck();
 await expect(screen.getByRole('heading','Controls proof disabled')).toBeVisible({timeout:120_000});
 await browser.reload();
 await screen.getByRole('button','Computer openen',{exact:true}).click();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await expect(screen.getByLabel('Controls proof inschakelen',{exact:true})).not.toBeChecked();
 await screen.getByLabel('Controls proof inschakelen',{exact:true}).check();
 await expect(screen.getByRole('heading','Controls proof connected')).toBeVisible({timeout:120_000});
 await expect(screen.getByLabel('sum inschakelen',{exact:true})).not.toBeChecked();
});

test('invalid HTTP registration retains the form without claiming a connection',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 await agent.act('Open Computer openen. Leave the current tab unchanged and do not submit a message or connect a server.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await screen.getByRole('tab','Tools',{exact:true}).click();
 await expect(screen.getByRole('tab','Tools',{exact:true})).toBeSelected();
 await screen.getByText('MCP-server toevoegen',{exact:true}).click();
 await screen.getByLabel('MCP-transport').selectOption('HTTP-server');
 await screen.getByLabel('MCP-server-ID').fill('http_form_proof');
 await screen.getByLabel('MCP-servernaam').fill('HTTP form proof');
 await screen.getByLabel('MCP-server-URL').fill('not-a-url');
 await screen.getByRole('button','Server verbinden',{exact:true}).click();
 await expect(browser.locator('[data-live-panel-error]')).toHaveText('Vul een geldige HTTP-server-URL in.');
 await expect(screen.getByLabel('MCP-server-URL')).toHaveValue('not-a-url');
 await expect(screen.getByLabel('MCP-servernaam')).toHaveValue('HTTP form proof');
 await expect(screen.getByRole('heading','HTTP form proof connected')).toHaveCount(0);
});

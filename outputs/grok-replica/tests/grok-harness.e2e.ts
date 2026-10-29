import {test} from '@e2e-dev/web';
import {expect} from 'e2e';

test('the product runs its independent Grok Bot harness and exposes missing configuration honestly',async({app,agent,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();
 await screen.getByRole('radio','Echte harness').check();
 const status=await browser.evaluate(async()=>fetch('/api/harness/status').then(response=>response.json()));
 expect(status.runtime.adapter).toBe('grok-bot-harness');
 await agent.act('Open Computer openen. Do not submit a message, connect a provider or execute a command.');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toBeVisible();
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).toContainText('Grok Bot-harness');
 await expect(screen.getByRole('region','Echte harness computer',{exact:true})).not.toContainText('Codex CLI');
});

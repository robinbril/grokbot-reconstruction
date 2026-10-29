import {test} from '@e2e-dev/web';
import {expect} from 'e2e';

test('help and about describe the independent Grok Bot runtime and local examples accurately',async({app,browser,screen})=>{
 await app.open('/?reset=1');
 const description=await browser.locator('meta[name="description"]').getAttribute('content');
 expect(description).toContain('onafhankelijke Grok Bot-harness');expect(description).not.toContain('Codex');
 await screen.getByRole('button','Accountmenu',{exact:true}).click();
 await screen.getByRole('menuitem','Help en feedback',{exact:true}).click();
 const help=screen.getByRole('dialog','Help en feedback',{exact:true});
 await expect(help).toContainText('eigen Grok Bot-harness');await expect(help).not.toContainText('Codex');
 await help.getByRole('button','Sluiten',{exact:true}).click();
 await screen.getByRole('button','Accountmenu',{exact:true}).click();
 await screen.getByRole('menuitem','Over Grok Bot',{exact:true}).click();
 const about=screen.getByRole('dialog','Over deze reconstructie',{exact:true});
 await expect(about).toContainText('In Lokale voorbeelden blijven chats en instellingen in de browser.');
 await expect(about).toContainText('eigen Grok Bot-harness');await expect(about).not.toContainText('Codex');
});

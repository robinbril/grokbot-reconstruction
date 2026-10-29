import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('reply group survives reload and its native button jumps to the exact original with Enter and Space',async({app,screen,browser})=>{
 await app.open('/?reset=1');
 await screen.getByRole('button','Accountmenu').click();await screen.getByRole('menuitem','Help en feedback').click();await screen.getByRole('button','Gespreksvoorbeelden openen').click();
 await browser.locator('.message.bot').first().click();await screen.getByRole('button','Beantwoorden').first().click();await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Controleer dit citaat');await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 const group=screen.getByRole('group','Antwoord op Pipelinekwaliteit');await expect(group).toBeVisible();
 const jump=group.getByRole('button','Naar oorspronkelijk bericht');await expect(jump).toBeVisible();
 expect(await jump.getAttribute('type')).toBe('button');
 const original=await browser.locator('.message[data-message-id]').first().getAttribute('data-message-id');
 await jump.press('Enter');await expect(browser.locator('.message.product-quote-flash')).toHaveAttribute('data-message-id',original!);
 await expect(browser.locator('.message.product-quote-flash')).toHaveCount(0,{timeout:5000});
 await jump.press('Space');await expect(browser.locator('.message.product-quote-flash')).toHaveAttribute('data-message-id',original!);
 await app.screenshot('native-reply-button-source-jump');
 await app.open('/');await expect(screen.getByRole('group','Antwoord op Pipelinekwaliteit')).toContainText('Pipelinekwaliteit');await expect(screen.getByRole('button','Naar oorspronkelijk bericht')).toBeVisible();
});

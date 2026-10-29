import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('groep bewaart leden en verwijderbare ontvangers geven de juiste groep', async ({ app, agent, screen }) => {
  await app.open('/?reset=1');
  await agent.act('Start via Nieuwe chat een Nieuwe groep. Selecteer Marketing Agent en Find Customers. Maak de groep nog niet. Sluit alleen de ontvangerkiezer door Escape.');
  await expect(screen.getByRole('button', 'Ontvanger verwijderen: Find Customers')).toBeVisible();
  await screen.getByRole('button', 'Ontvanger verwijderen: Find Customers').click();
  await expect(screen.getByRole('button', 'Ontvanger verwijderen: Find Customers')).toHaveCount(0);
  await screen.getByRole('button', 'Start a chat with...').click();
  await screen.getByRole('button', 'Find Customers').last().click();
  await screen.getByRole('menuitem', 'Groep maken').click();
  await screen.getByRole('button', 'Gespreksdetails').first().click();
  await screen.getByRole('tab', 'Leden').click();
  await expect(screen.getByRole('tabpanel')).toContainText('Marketing Agent');
  await expect(screen.getByRole('tabpanel')).toContainText('Find Customers');
  await expect(screen.getByRole('tab', 'Computer')).toHaveCount(0);
  await app.open('/');
  await expect(screen.getByRole('tab', 'Leden')).toBeVisible();
  await expect(screen.getByRole('tabpanel')).toContainText('Find Customers');
});

test('bericht sturen maakt dezelfde groep met blijvende leden als expliciet bevestigen', async ({ app, screen }) => {
  await app.open('/?reset=1');
  await screen.getByRole('button', 'Nieuwe chat').click();
  await screen.getByRole('menuitem', 'Nieuwe groep').click();
  await screen.getByRole('button', 'Marketing Agent').last().click();
  await screen.getByRole('button', 'Find Customers').last().click();
  await screen.getByRole('textbox', 'Zoek een Bot of persoon').press('Escape');
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').fill('Samen de lokale populatie controleren');
  await screen.getByRole('textbox', 'Bericht sturen naar Bot').press('Enter');
  await screen.getByRole('button', 'Gespreksdetails').first().click();
  await screen.getByRole('tab', 'Leden').click();
  await expect(screen.getByRole('tabpanel')).toContainText('Marketing Agent');
  await expect(screen.getByRole('tabpanel')).toContainText('Find Customers');
  await expect(screen.getByRole('tab', 'Computer')).toHaveCount(0);
  await app.open('/');
  await expect(screen.getByRole('tabpanel')).toContainText('Marketing Agent');
  await expect(screen.getByRole('tabpanel')).toContainText('Find Customers');
});

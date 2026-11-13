import { expect, test, type Page } from '@playwright/test';
import { MONDAY, chooseFromMenu, expandToFullDay, leaveSettings, openAt, openPreferences, openSettings as openSettingsPage, seedRecords } from './helpers';

/** Issue #39: Settings → Energy units (kJ, kcal or both). A device preference; stored values never change. */

const LUNCH_NEXT = '2026-11-02T12:10:00+11:00'; // Monday: lunch is "Do this next"
const store = (page: Page) => page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
const savedChoice = (page: Page) => page.evaluate(() => localStorage.getItem('pft.display.energy'));

// Today's imported active energy: 1,338.9 kJ stored (320 kcal).
const activeEnergy = {
  id: 'ae1', date: '2026-11-02', metric: 'active_energy', value: 1338.9, unit: 'kJ', kind: 'observed', label: null, note: null,
  recordedAt: '2026-11-02T08:00:00+11:00',
  source: { type: 'screenshot', app: 'fitbit', capturedAt: null, confidence: 0.9, importId: 'imp', assetId: 'a', evidence: '320 cal', edited: false },
};

/** ☰ → Settings → App preferences (#174). */
const openSettings = openPreferences;
async function choose(page: Page, name: 'Kilojoules (kJ)' | 'Calories (kcal)' | 'Both') {
  await openSettings(page);
  await page.getByRole('radio', { name }).click();
  await expect(page.getByRole('radio', { name })).toBeChecked();
  await leaveSettings(page);
  await expect(page.getByTestId('app-preferences')).toHaveCount(0);
}

test('kJ by default: the menu says so and the sheet explains kcal', async ({ page }) => {
  await openAt(page, MONDAY);
  await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,530 kJ');
  await openSettingsPage(page);
  await expect(page.getByTestId('settings-preferences')).toContainText('Energy in kJ');
  await page.getByTestId('settings-preferences').click();
  await expect(page.getByRole('radio', { name: 'Kilojoules (kJ)' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Calories (kcal)' })).not.toBeChecked();
  await expect(page.getByTestId('app-preferences')).toContainText('Food “calories” are kilocalories (kcal). 1 kcal = 4.184 kJ.');
  expect(await savedChoice(page)).toBeNull(); // nothing chosen yet
});

test('a choice applies immediately everywhere, survives a restart, and never changes stored data', async ({ page }) => {
  await seedRecords(page, { observations: [activeEnergy] });
  await openAt(page, LUNCH_NEXT);
  const before = await store(page);
  await expect(page.getByTestId('next-action-meal-nutrition')).toHaveText('≈ 1,780 kJ · 42 g protein');
  await expect(page.getByTestId('recorded-active_energy')).toContainText('1,340 kJ');

  await choose(page, 'Calories (kcal)');
  await expect(page.getByTestId('targets')).toContainText('Energy ≤ 1,800 kcal');
  await expect(page.getByTestId('targets')).toContainText('Protein 160–180 g'); // grams never change
  await expect(page.getByTestId('next-action-meal-nutrition')).toHaveText('≈ 425 kcal · 42 g protein');
  await expect(page.getByTestId('recorded-active_energy')).toContainText('320 kcal');
  await expect(page.getByTestId('recorded-active_energy')).not.toContainText('kJ');
  // Screen readers hear the unit word.
  await expect(page.getByTestId('recorded-active_energy')).toHaveAccessibleName(/320 kilocalories/);

  await choose(page, 'Both');
  await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,530 kJ / 1,800 kcal');
  await expect(page.getByTestId('next-action-meal-nutrition')).toHaveText('≈ 1,780 kJ / 425 kcal · 42 g protein');
  await expect(page.getByTestId('recorded-active_energy')).toContainText('1,340 kJ / 320 kcal');
  await openSettingsPage(page);
  await expect(page.getByTestId('settings-preferences')).toContainText('Energy in kJ and kcal');
  await leaveSettings(page);

  expect(await savedChoice(page)).toBe('both');
  expect(await store(page)).toBe(before); // switching units wrote nothing to the records or the plan

  await page.reload();
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,530 kJ / 1,800 kcal');

  await choose(page, 'Kilojoules (kJ)');
  await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,530 kJ');
  await expect(page.getByTestId('targets')).not.toContainText('kcal');
  expect(await store(page)).toBe(before);
});

test('correcting an energy value in kcal stores it back in kJ; saving unchanged text rewrites nothing', async ({ page }) => {
  await seedRecords(page, { observations: [activeEnergy] });
  await openAt(page, MONDAY);
  await choose(page, 'Calories (kcal)');

  await page.getByTestId('recorded-active_energy').click();
  await expect(page.getByTestId('observation-input')).toHaveValue('320');
  await page.getByRole('button', { name: 'Save' }).click();
  const unchanged = JSON.parse((await store(page))!).observations.find((o: any) => o.id === 'ae1');
  expect(unchanged.value).toBe(1338.9);

  await page.getByTestId('recorded-active_energy').click();
  // Wait for the controlled field's opening effect before fill selects/replaces its contents.
  await expect(page.getByTestId('observation-input')).toHaveValue('320');
  await page.getByTestId('observation-input').fill('350');
  await expect(page.getByTestId('observation-input')).toHaveValue('350');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('recorded-active_energy')).toContainText('350 kcal');
  const saved = JSON.parse((await store(page))!).observations.find((o: any) => o.id === 'ae1');
  expect(saved.unit).toBe('kJ');
  expect(saved.value).toBeCloseTo(350 * 4.184, 6);
});

test('Configure with AI shows energy in the chosen units', async ({ page }) => {
  await openAt(page, MONDAY);
  await choose(page, 'Calories (kcal)');
  await chooseFromMenu(page, 'Configure with AI');
  await expect(page.getByTestId('summary-nutrition')).toContainText('Energy ≤ 1,800 kcal');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('settings-sheet', async ({ page }) => {
    await openAt(page, MONDAY);
    await openSettings(page); // App preferences, the page that replaced the Settings sheet (#174)
    await expect(page).toHaveScreenshot('settings-sheet.png');
  });
  test('today-both-units', async ({ page }) => {
    await seedRecords(page, { observations: [activeEnergy] });
    await openAt(page, LUNCH_NEXT);
    await choose(page, 'Both');
    await expect(page.getByTestId('next-action-meal-nutrition')).toHaveText('≈ 1,780 kJ / 425 kcal · 42 g protein');
    await expect(page).toHaveScreenshot('today-both-units.png');
  });
  test('today-both-units-full', async ({ page }) => {
    await seedRecords(page, { observations: [activeEnergy] });
    await openAt(page, MONDAY);
    await choose(page, 'Both');
    await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,530 kJ / 1,800 kcal');
    await expandToFullDay(page);
    await expect(page).toHaveScreenshot('today-both-units-full.png');
  });
});

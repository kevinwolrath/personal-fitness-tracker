import { expect, test, type Page } from '@playwright/test';
import { openAt, row } from './helpers';

/** #97: replace a scheduled meal with a photographed one, estimated by an external AI. */

const at = (hhmm: string) => `2026-11-02T${hhmm}:00+11:00`; // Monday, home day
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const bar = (page: Page) => page.getByTestId('meal-bar');

const reply = `Here's my estimate of your meal:
\`\`\`json
${JSON.stringify(
  {
    schemaVersion: 1,
    mealName: 'Chicken burrito bowl',
    items: [
      { name: 'Rice', quantity: 180, unit: 'g', energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 },
      { name: 'Grilled chicken', quantity: 120, unit: 'g', energyKj: 830, proteinG: 30, carbsG: 0, fatG: 5 },
      { name: 'Black beans', quantity: 0.5, unit: 'cup', energyKj: 480, proteinG: 7, carbsG: 20, fatG: 1 },
      { name: 'Guacamole', quantity: null, unit: null, energyKj: null, proteinG: null, carbsG: null, fatG: null },
    ],
    totals: { energyKj: 3100, proteinG: 38, carbsG: 82, fatG: 24 },
    confidence: 'medium',
    assumptions: ['Sauce not visible, not counted'],
    uncertainties: ['White or brown rice'],
  },
  null,
  2,
)}
\`\`\`
Portions are estimates.`;

async function startWithPhoto(page: Page) {
  await openAt(page, at('12:10'));
  await page.getByTestId('next-action-log-different').click();
  await expect(page.getByTestId('meal-context')).toContainText('Step 1 of 5 · Replaces Fixed lunch');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('meal-library').click();
  await (await chooser).setFiles('e2e/fixtures/meal.jpg');
  await expect(page.getByTestId('meal-photo-0')).toBeVisible();
}

test('logs a different meal: photo, share, paste, review, save; Today shows the replacement and what was eaten', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await startWithPhoto(page);
  await expect(page.getByTestId('meal-context')).toContainText('Step 2 of 5');
  await bar(page).getByRole('button', { name: 'Next' }).click();

  await expect(page.getByTestId('meal-share')).toBeVisible();
  await page.getByTestId('meal-see-prompt').click();
  await expect(page.getByTestId('meal-prompt')).toContainText('kilojoules (kJ, not kcal)');
  await page.getByTestId('meal-copy-prompt').click();
  await expect(page.getByTestId('meal-notice')).toContainText('Prompt copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"schemaVersion": 1');

  await page.getByTestId('meal-to-paste').click();
  // A reply that can't be read gets one actionable message (a missing schemaVersion is read as 1 since #179).
  await page.getByTestId('meal-reply').fill('{"mealName": "cut off", "items": [{"name": "x"');
  await page.getByTestId('meal-check').click();
  await expect(page.getByTestId('meal-reply-error')).toContainText('cut off');

  await page.getByTestId('meal-reply').fill(reply);
  await page.getByTestId('meal-check').click();
  await expect(page.getByTestId('meal-review')).toBeVisible();
  await expect(page.getByTestId('meal-confidence')).toHaveText('Medium confidence');
  await expect(page.getByTestId('meal-totals')).toContainText('≈ 2,290');
  await expect(page.getByTestId('meal-discrepancies')).toContainText('the AI’s total is 3,100 kJ; the foods add up to 2,290 kJ');
  await expect(page.getByTestId('meal-save')).toHaveText('Save meal');
  await expect(page.getByTestId('meal-context')).toContainText('Replaces Fixed lunch');
  if (test.info().project.name === 'phone') await expect(page).toHaveScreenshot('meal-photo-review.png');

  await page.getByTestId('meal-save').click();
  await expect(row(page, 'lunch').getByTestId('replaced-lunch')).toHaveText('Replaced: Chicken burrito bowl');
  await expect(row(page, 'lunch')).toContainText('Photo estimate');
  await expect(page.getByTestId('day-progress')).toContainText('1 of 7 done');
  await expect(page.getByTestId('eaten')).toContainText('Eaten ≈ 2,290 kJ · 42 g protein · 72 g carbs · 7 g fat');
  await expect(page.getByTestId('eaten')).toContainText('some foods unknown');

  const doc = await store(page);
  expect(doc.mealLogs).toHaveLength(1);
  expect(doc.mealLogs[0]).toMatchObject({ name: 'Chicken burrito bowl', activityId: 'lunch', source: 'photo-ai', schemaVersion: 1 });
  expect(doc.mealLogs[0].photos).toHaveLength(1);
  expect(await page.evaluate((uri) => !!localStorage.getItem(`pft:meal-photo:${uri.slice('pft-photo:'.length)}`), doc.mealLogs[0].photos[0].uri)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('pft:meal-draft'))).toBeNull();

  // The meal's sheet: what was eaten, photos, Edit and Remove.
  await row(page, 'lunch').getByRole('button', { name: /replaced by Chicken burrito bowl/ }).click();
  await expect(page.getByTestId('replaced-meal')).toContainText('Chicken burrito bowl');
  await expect(page.getByTestId('replaced-meal-summary')).toContainText('≈ 2,290 kJ · 42 g protein · 72 g carbs · 7 g fat');
  if (test.info().project.name === 'phone') await expect(page).toHaveScreenshot('meal-photo-replaced-sheet.png');
  await page.getByTestId('replaced-photo-0').click();
  await expect(page.getByTestId('meal-photo-viewer')).toBeVisible();
  await page.getByRole('button', { name: 'Close photo' }).click();
});

test('the draft survives a reload (the app restarting while you are in the AI app)', async ({ page }) => {
  await startWithPhoto(page);
  await bar(page).getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('meal-to-paste').click();
  await page.getByTestId('meal-reply').fill('partial reply');
  await page.reload(); // the wizard's own URL reopens it where it was
  await expect(page.getByTestId('meal-reply')).toHaveValue('partial reply');
  await expect(page.getByTestId('meal-context')).toContainText('Step 4 of 5');
  // From Today too: the same meal's button picks the draft up again.
  await openAt(page, at('12:10'));
  await page.getByTestId('next-action-log-different').click();
  await expect(page.getByTestId('meal-reply')).toHaveValue('partial reply');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('meal-photo-0')).toBeVisible();
});

test('the wizard screens fit the phone with one primary action each', async ({ page }) => {
  await startWithPhoto(page);
  const project = test.info().project.name;
  if (project === 'phone') await expect(page).toHaveScreenshot('meal-photo-photos.png');
  await bar(page).getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('meal-share')).toBeInViewport();
  if (project === 'phone') await expect(page).toHaveScreenshot('meal-photo-share.png');
  const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noHorizontalScroll()).toBe(true);
  await page.getByTestId('meal-to-paste').click();
  await page.getByTestId('meal-reply').fill(reply);
  await page.getByTestId('meal-check').click();
  await expect(page.getByTestId('meal-save')).toBeInViewport();
  expect(await noHorizontalScroll()).toBe(true);
});

test('the due meal card offers Log different meal under Done; the meal sheet offers it for any meal', async ({ page }) => {
  await openAt(page, at('12:10'));
  const card = page.getByTestId('next-action');
  await expect(card.getByRole('button', { name: 'Done: Fixed lunch' })).toBeVisible();
  await expect(card.getByTestId('next-action-log-different')).toHaveText('📷 Log different meal');
  const done = await card.getByRole('button', { name: 'Done: Fixed lunch' }).boundingBox();
  const other = await card.getByTestId('next-action-log-different').boundingBox();
  expect(other!.y).toBeGreaterThan(done!.y);

  await row(page, 'dinner').getByRole('button', { name: 'Family dinner details' }).click();
  await page.getByTestId('sheet-log-different').click();
  await expect(page.getByTestId('meal-context')).toContainText('Replaces Family dinner');
});

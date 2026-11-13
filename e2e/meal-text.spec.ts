import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openAt, row } from './helpers';

/**
 * #179: an AI's plain-text estimate is logged as one meal, without JSON, photos or a food-by-food breakdown. Unclear
 * numbers are left for the user to fill in, never invented; replacing again edits the same meal.
 */

const at = (hhmm: string) => `2026-11-02T${hhmm}:00+11:00`; // Monday, home day
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const shots = 'docs/design/issue-179';
const shot = async (page: Page, name: string) => {
  if (test.info().project.name !== 'phone') return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const ESTIMATE = `Sure! Here's my estimate for your dinner on 2 November 2026:

Beef curry, lentil dhal, low-carb potatoes, rice and low-carb wrap.

Estimated total: about 2,650 kJ (≈633 kcal) and 45 g protein.

These are rough estimates, not measurements.`;

async function pasteEstimate(page: Page, text: string) {
  await expect(page.getByTestId('meal-paste-text')).toBeVisible();
  await shot(page, '1-start');
  await page.getByTestId('meal-paste-text').click();
  await page.getByTestId('meal-reply').fill(text);
  await shot(page, '2-paste');
  await page.getByTestId('meal-check').click();
}

test('a plain-English dinner estimate imports as one meal, reviewed and confirmed without JSON', async ({ page }) => {
  await openAt(page, at('18:00'));
  await row(page, 'dinner').getByRole('button', { name: /details/ }).click();
  await page.getByRole('button', { name: 'Log different meal' }).click();
  await pasteEstimate(page, ESTIMATE);

  const summary = page.getByTestId('meal-estimate-summary');
  await expect(summary).toContainText('Dinner — 2 November 2026');
  await expect(summary).toContainText('Beef curry, lentil dhal, low-carb potatoes, rice and low-carb wrap');
  await expect(page.getByTestId('meal-estimate-totals')).toHaveText('Estimated: 2,650 kJ · 45 g protein');
  await expect(page.getByTestId('meal-totals')).toHaveCount(0); // the details wait for Edit
  await expect(page.getByTestId('meal-save')).toHaveText('Confirm');
  await shot(page, '3-review');
  await page.getByTestId('meal-save').click();

  await expect(row(page, 'dinner').getByTestId('replaced-dinner')).toHaveText('Replaced: Beef curry, lentil dhal, low-carb potatoes, rice and low-carb wrap');
  await expect(row(page, 'dinner')).toContainText('AI estimate');
  const doc = await store(page);
  expect(doc.mealLogs).toHaveLength(1);
  expect(doc.mealLogs[0]).toMatchObject({ activityId: 'dinner', source: 'photo-ai', schemaVersion: null, photos: [], assumptions: ['AI estimate as written: ~2,650 kJ, 45 g protein.'] });
  expect(doc.mealLogs[0].items).toEqual([{ name: 'Beef curry, lentil dhal, low-carb potatoes, rice and low-carb wrap', quantity: null, unit: null, energyKj: 2650, proteinG: 45, carbsG: null, fatG: null }]);

  // Log a different meal for dinner again: it edits that meal (same id), never adds a second one.
  await row(page, 'dinner').getByRole('button', { name: /replaced by/ }).click();
  await page.getByTestId('replaced-meal-edit').click();
  await expect(page.getByTestId('meal-estimate-summary')).toBeVisible();
  await page.getByTestId('meal-estimate-edit').click();
  await page.getByRole('textbox', { name: /energy kJ$/ }).fill('2400');
  await expect(page.getByTestId('meal-estimate-totals')).toHaveText('Estimated: 2,400 kJ · 45 g protein');
  await page.getByTestId('meal-save').click();
  const after = await store(page);
  expect(after.mealLogs).toHaveLength(1);
  expect(after.mealLogs[0]).toMatchObject({ id: doc.mealLogs[0].id, edited: true, items: [{ energyKj: 2400, proteinG: 45 }] });
});

test('unclear numbers are left empty with the reason; junk text gets one actionable message', async ({ page }) => {
  await openAt(page, at('12:10'));
  await page.getByTestId('next-action-log-different').click();
  await page.getByTestId('meal-paste-text').click();
  await page.getByTestId('meal-reply').fill('Thanks! Have a lovely evening.');
  await page.getByTestId('meal-check').click();
  await expect(page.getByTestId('meal-reply-error')).toContainText('No meal estimate found');

  await page.getByTestId('meal-reply').fill('Lunch: chicken wrap, 2,000–2,400 kJ, 30 g protein');
  await page.getByTestId('meal-check').click();
  await expect(page.getByTestId('meal-estimate-totals')).toHaveText('Estimated: — kJ · 30 g protein');
  await expect(page.getByTestId('meal-issues')).toContainText('The energy was given as a range (2,000–2,400 kJ)');
  await shot(page, '4-review-unclear');
  await page.getByRole('button', { name: 'Enter the missing values' }).click();
  await page.getByRole('textbox', { name: /energy kJ$/ }).fill('2200');
  await expect(page.getByTestId('meal-estimate-totals')).toHaveText('Estimated: 2,200 kJ · 30 g protein');
  await page.getByTestId('meal-save').click();
  await expect(row(page, 'lunch').getByTestId('replaced-lunch')).toHaveText('Replaced: Chicken wrap');
  expect((await store(page)).mealLogs[0].items[0]).toMatchObject({ energyKj: 2200, proteinG: 30 });
});

test('Back from pasting with no photo returns to the first choice', async ({ page }) => {
  await openAt(page, at('12:10'));
  await page.getByTestId('next-action-log-different').click();
  await page.getByTestId('meal-paste-text').click();
  await expect(page.getByTestId('meal-reply')).toBeVisible();
  await page.getByTestId('meal-bar').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('meal-paste-text')).toBeVisible();
});

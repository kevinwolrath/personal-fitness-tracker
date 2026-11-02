import { expect, test, type Page } from '@playwright/test';
import seed from '../plans/seed.plan.json';
import { openAt, row, seedPlan } from './helpers';

/** Issue #26: tap a meal → what exactly am I eating, how much, and how do I make it? */

const at = (hhmm: string) => `2026-11-02T${hhmm}:00+11:00`; // Monday, home day
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const sheet = (page: Page) => page.getByTestId('meal-details');
const lunchChecked = (page: Page) => row(page, 'lunch').getByRole('checkbox');

test('"Do this next" shows the lunch ingredients, preparation and nutrition with no extra tap (B)', async ({ page }) => {
  await openAt(page, at('12:10'));
  await expect(page.getByTestId('next-action-title')).toHaveText('Fixed lunch');
  const ingredients = page.getByTestId('next-action-meal-ingredients');
  for (const text of ['High-protein yoghurt', '200 g', '~¾ cup', 'Rolled oats', '40 g', '~½ cup', 'Protein powder', '30 g', '~¼ cup / 1 scoop', 'Water', 'as needed']) {
    await expect(ingredients).toContainText(text);
  }
  await expect(page.getByTestId('next-action-meal-preparation')).toHaveText(
    'Mix yoghurt and protein powder first, then add oats. Add water as needed to reach the desired consistency.',
  );
  await expect(page.getByTestId('next-action-meal-nutrition')).toHaveText('≈ 1,780 kJ · 42 g protein');
  await expect(page.getByRole('button', { name: 'Done: Fixed lunch' })).toBeVisible();
});

test('tapping the meal row opens its details without completing it; the circle completes it (ii)', async ({ page }) => {
  await openAt(page, at('09:00'));
  const before = (await store(page)).completionEvents?.length ?? 0;

  // Scroll the day a little so we can check the position is kept.
  await page.mouse.move(200, 600);
  await page.mouse.wheel(0, 300);
  const scrollTop = () => page.getByTestId('day-scroll').evaluate((el) => (el as HTMLElement).scrollTop);
  await expect.poll(scrollTop).toBeGreaterThan(0);
  const y = await scrollTop();

  await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByTestId('modal-title')).toHaveText('Fixed lunch');
  await expect(page.getByText('What to prepare')).toBeVisible();
  await expect(sheet(page)).toContainText('High-protein yoghurt');
  await expect(page.getByTestId('meal-details-preparation')).toContainText('Add water as needed');
  await expect(page.getByTestId('meal-details-nutrition')).toHaveText('≈ 1,780 kJ · 42 g protein');

  await page.getByTestId('modal-dismiss').click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(lunchChecked(page)).not.toBeChecked(); // viewing never completes
  expect((await store(page)).completionEvents?.length ?? 0).toBe(before);
  expect(await scrollTop()).toBe(y); // back where you were

  await lunchChecked(page).click(); // the explicit control
  await expect(lunchChecked(page)).toBeChecked();
  await expect(sheet(page)).toHaveCount(0);
});

test('Mark done in the meal sheet completes it; Skip skips it', async ({ page }) => {
  await openAt(page, at('09:00'));
  await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(lunchChecked(page)).toBeChecked();

  await row(page, 'snack').getByRole('button', { name: 'Fixed snack details' }).click();
  await expect(page.getByText('What to prepare')).toHaveCount(0); // the snack has no ingredients in the plan
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(row(page, 'snack')).toContainText('Skipped');
});

test('the same details on past and future days; completion is only offered where it can be', async ({ page }) => {
  await openAt(page, at('09:00'));
  for (const step of ['Previous day', 'Next day', 'Next day']) {
    await page.getByRole('button', { name: step }).click();
    await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
    await expect(sheet(page)).toContainText('Rolled oats');
    await page.getByTestId('modal-dismiss').click();
  }
  // Tomorrow is view-only: details open, completion doesn't.
  await expect(lunchChecked(page)).toBeDisabled();
  await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
  await expect(page.getByRole('button', { name: 'Mark done' })).toBeDisabled();
});

test('a different plan renders a completely different meal (the plan is the data)', async ({ page }) => {
  await seedPlan(page, {
    ...seed,
    units: { ...seed.units, energy: 'kcal' },
    activities: seed.activities.map((a: any) =>
      a.id === 'lunch'
        ? { ...a, label: 'Rice bowl', nutrition: { energy: 520 }, ingredients: [{ name: 'Cooked rice', grams: 150, measure: '~1 cup' }, { name: 'Milk', ml: 250 }], preparation: 'Warm the rice.' }
        : a,
    ),
  });
  await openAt(page, at('09:00'));
  await row(page, 'lunch').getByRole('button', { name: 'Rice bowl details' }).click();
  await expect(sheet(page)).toContainText('Cooked rice');
  await expect(sheet(page)).toContainText('~1 cup');
  await expect(sheet(page)).toContainText('250 ml');
  await expect(sheet(page)).not.toContainText('yoghurt');
  await expect(page.getByTestId('meal-details-nutrition')).toHaveText('≈ 520 kcal');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('next-action-meal', async ({ page }) => {
    await openAt(page, at('12:10'));
    await expect(page.getByTestId('next-action-meal')).toBeVisible();
    await expect(page).toHaveScreenshot('next-action-meal.png');
  });
  test('meal-sheet', async ({ page }) => {
    await openAt(page, at('09:00'));
    await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page).toHaveScreenshot('meal-sheet.png');
  });
});

test('an already-configured plan gets the lunch with a lunch-only update; the other meals stay exactly as they were', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // A plan configured before #26: formatVersion 2, lunch without ingredients, a customised snack.
  const before = JSON.parse(JSON.stringify(seed));
  before.formatVersion = 2;
  for (const a of before.activities) {
    delete a.notifications; // reminders arrived later (#30, formatVersion 4)
    if (a.id === 'lunch') {
      delete a.ingredients;
      delete a.preparation;
      delete a.nutrition;
      a.detail = 'Cold high-protein lunch, no heating needed';
    }
    if (a.id === 'snack') a.detail = 'Apple and cheese';
  }
  await seedPlan(page, before);
  await openAt(page, at('09:00'));
  const { chooseFromMenu } = await import('./helpers');
  await chooseFromMenu(page, 'Configure with AI');
  await page.getByLabel('AI update').fill(require('node:fs').readFileSync('fixtures/config/lunch.update.json', 'utf8'));
  await page.getByRole('button', { name: 'Check update' }).click();
  await expect(page.getByTestId('preview-nutrition')).toContainText('Fixed lunch');
  await page.getByTestId('preview-nutrition').getByRole('button').first().click();
  await expect(page.getByTestId('preview-nutrition')).not.toContainText('Fixed snack');
  await page.getByRole('button', { name: /^Apply 1 change$/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(row(page, 'snack')).toContainText('Apple and cheese'); // untouched
  await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
  await expect(sheet(page)).toContainText('Protein powder');
  await expect(page.getByTestId('meal-details-preparation')).toContainText('Add water as needed');
});

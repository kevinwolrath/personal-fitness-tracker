import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openAt, row } from './helpers';

/**
 * #183 on the web test surface: Take photo → the photo and the prompt handed to the share target together → the AI's
 * block arriving (on Android via the share sheet; here as the route the share receiver opens) → Description, Energy
 * (kJ), Save → one meal, back on the day. The Android share sheet and the AI app are outside this surface.
 */
const at = (hhmm: string) => `2026-11-02T${hhmm}:00+11:00`; // Monday, home day
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const lastShare = (page: Page) => page.evaluate(() => (window as unknown as { __pftLastShare?: { uri: string; text: string } }).__pftLastShare ?? null);
const shots = 'docs/design/issue-183';
const shot = async (page: Page, name: string) => {
  if (test.info().project.name !== 'phone') return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const BLOCK = 'Beef curry with lentil dhal and rice\nEstimated energy: ~2,650 kJ\nProtein: ~45 g';
const returnWith = (page: Page, text: string) => page.goto(`/meal-return?text=${encodeURIComponent(text)}`);

test('Take photo → photo + prompt shared together → the AI block → Save once → the lunch is replaced', async ({ page }) => {
  await openAt(page, at('12:10'));
  await shot(page, '1-card');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('next-action-take-photo').click();
  await (await chooser).setFiles('e2e/fixtures/meal.jpg');
  await expect.poll(() => lastShare(page)).not.toBeNull();
  const shared = (await lastShare(page))!;
  expect(shared.uri).toMatch(/^pft-photo:/);
  expect(shared.text).toMatch(/^Analyse this meal photo\. In your FIRST reply output a native shareable text\/writing block/);
  await expect(page.getByTestId('meal-photo')).toHaveCount(0); // no wizard
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('pft:meal-pending-share')!));
  expect(pending).toMatchObject({ date: '2026-11-02', activityId: 'lunch', replacedLabel: 'Fixed lunch', photo: { uri: shared.uri } });

  await returnWith(page, BLOCK);
  await expect(page.getByTestId('meal-return-context')).toHaveText(/^Replaces Fixed lunch · /);
  await expect(page.getByTestId('meal-return-description')).toHaveValue('Beef curry with lentil dhal and rice');
  await expect(page.getByTestId('meal-return-energy')).toHaveValue('2650');
  await expect(page.getByTestId('meal-return-protein')).toContainText('Protein ≈ 45 g');
  await expect(page.getByTestId('meal-return-energy-error')).toHaveCount(0);
  await shot(page, '2-return');
  await page.getByTestId('meal-return-save').click(); // (a double tap is covered by the native test: one meal)

  await expect(row(page, 'lunch').getByTestId('replaced-lunch')).toHaveText('Replaced: Beef curry with lentil dhal and rice');
  const doc = await store(page);
  expect(doc.mealLogs).toHaveLength(1);
  expect(doc.mealLogs[0]).toMatchObject({ activityId: 'lunch', items: [{ energyKj: 2650, proteinG: 45 }], photos: [{ uri: shared.uri }] });
  expect(await page.evaluate(() => localStorage.getItem('pft:meal-pending-share'))).toBeNull();
  await shot(page, '4-day');
});

test('unreadable energy is flagged inline; typing it saves; the return page fits one screen with Save in view', async ({ page }) => {
  await openAt(page, at('12:10'));
  await returnWith(page, 'Lunch: chicken wrap, 2,000–2,400 kJ, 30 g protein');
  await expect(page.getByTestId('meal-return-energy-error')).toContainText('range');
  await expect(page.getByTestId('meal-return-context')).toHaveText(/^Extra meal · /); // no photo was taken: nothing replaced
  await expect(page.getByTestId('meal-return-save')).toBeInViewport();
  await shot(page, '3-return-unclear');
  await page.getByTestId('meal-return-save').click();
  expect((await store(page)).mealLogs ?? []).toHaveLength(0);
  await page.getByTestId('meal-return-energy').fill('2200');
  await expect(page.getByTestId('meal-return-energy-error')).toHaveCount(0);
  await page.getByTestId('meal-return-save').click();
  await expect(page.getByTestId('day-progress')).toBeVisible();
  const doc = await store(page);
  expect(doc.mealLogs[0]).toMatchObject({ activityId: null, name: 'Chicken wrap', items: [{ energyKj: 2200, proteinG: 30 }] });
});

test('the wizard stays one tap away in the meal’s details (gallery, paste, manual)', async ({ page }) => {
  await openAt(page, at('12:10'));
  await row(page, 'lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
  await expect(page.getByTestId('sheet-take-photo')).toBeVisible();
  await page.getByTestId('sheet-log-different').click();
  await expect(page.getByTestId('meal-photo')).toBeVisible();
});

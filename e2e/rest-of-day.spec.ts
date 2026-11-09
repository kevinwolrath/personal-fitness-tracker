import { expect, test, type Page } from '@playwright/test';
import { openAt } from './helpers';

/** #99: after a logged meal, optional rest-of-day suggestions on Today. */

const DAY = 'weight-loss-v1|2026-11-02';
const meal = (energyKj: number, proteinG: number) => ({
  id: 'm1', date: '2026-11-02', at: '2026-11-02T12:30:00+11:00', planId: 'weight-loss-v1', activityId: 'lunch', replacedLabel: 'Fixed lunch',
  name: 'Beef burrito', items: [{ name: 'Burrito', quantity: 1, unit: 'piece', energyKj, proteinG, carbsG: 90, fatG: 40 }],
  aiTotals: null, confidence: 'medium', assumptions: [], uncertainties: [], source: 'photo-ai', schemaVersion: 1, edited: false, photos: [], recordedAt: 't', updatedAt: 't',
});
async function seedMeal(page: Page, energyKj: number, proteinG: number) {
  await page.addInitScript((m) => {
    if (sessionStorage.getItem('pft:e2e:meal')) return;
    sessionStorage.setItem('pft:e2e:meal', '1');
    const key = 'pft:tracking:v1';
    const doc = JSON.parse(localStorage.getItem(key)!);
    doc.mealLogs = [m.meal];
    doc.activities = { [m.day]: { lunch: { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'Fixed lunch', updatedAt: 't' } } };
    localStorage.setItem(key, JSON.stringify(doc));
  }, { meal: meal(energyKj, proteinG), day: DAY });
}

test('a large lunch: over the limit, keep the plan first, a smaller protein-rich dinner, never skip it', async ({ page }) => {
  await seedMeal(page, 6500, 55);
  await openAt(page, '2026-11-02T13:00:00+11:00');
  const card = page.getByTestId('rest-of-day');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('rest-of-day-headline')).toContainText('over your limit');
  await expect(page.getByTestId('rest-of-day-keep')).toContainText('Keep the plan');
  await expect(page.getByTestId('rest-of-day-dinner')).toContainText('smaller, protein-rich family dinner');
  await expect(page.getByTestId('rest-of-day-protein')).toContainText('short of your minimum');
  await expect(card).not.toContainText(/skip (the )?dinner/i);
  await page.getByTestId('rest-of-day-why').click();
  await expect(page.getByTestId('rest-of-day-explanation')).toContainText('Eaten so far ≈ 6,500 kJ');
  if (test.info().project.name === 'phone') {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: 'docs/design/issue-99-rest-of-day/card.png' });
  }
});

test('a normal lunch: keep the plan, with what’s left for dinner', async ({ page }) => {
  await seedMeal(page, 1800, 42);
  await openAt(page, '2026-11-02T13:00:00+11:00');
  await expect(page.getByTestId('rest-of-day-headline')).toHaveText('On track: keep the plan');
  await expect(page.getByTestId('rest-of-day-dinner')).toContainText('left');
});

test('no logged meal: no card', async ({ page }) => {
  await openAt(page, '2026-11-02T13:00:00+11:00');
  await expect(page.getByTestId('rest-of-day')).toHaveCount(0);
});

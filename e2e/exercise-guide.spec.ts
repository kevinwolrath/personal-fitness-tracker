import { expect, test, type Page } from '@playwright/test';
import example from '../fixtures/plans/prescription-example.plan.json';
import { openAt, row, seedPlan, seedRecords } from './helpers';

/** Issue #12: tap a prescribed exercise → see how to do it → close → back where I was, nothing changed. */

const at = (hhmm: string) => `2026-11-02T${hhmm}:00+11:00`; // Monday, home day
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const schoolRunDone = {
  'weight-loss-v1|2026-11-02': { 'school-run-am': { activityId: 'school-run-am', status: 'done', count: 0, labelSnapshot: 'School run', updatedAt: '2026-11-02T08:40:00Z' } },
};
const guide = (page: Page) => page.getByTestId('exercise-guide');

test('opens from the "Do this next" card, steps through the illustrations, and closes without changing anything', async ({ page }) => {
  await seedRecords(page, { activities: schoolRunDone });
  await openAt(page, at('10:30'));
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout');
  const progressBefore = await page.getByTestId('day-progress').textContent();
  const eventsBefore = (await store(page)).completionEvents?.length ?? 0;

  await page.getByTestId('next-action-session').getByRole('button', { name: /Kettlebell squat, 3 × 10\. Show how/ }).click();
  await expect(guide(page)).toBeVisible();
  await expect(page.getByTestId('guide-title')).toHaveText('Kettlebell squat');
  await expect(page.getByTestId('guide-prescription')).toContainText('Today: 3 × 10');
  await expect(page.getByTestId('guide-equipment')).toContainText('kettlebell');
  await expect(page.getByTestId('guide-instructions')).toBeVisible();

  await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
  const first = await page.getByTestId('guide-caption').textContent();
  await expect(page.getByRole('button', { name: 'Previous step' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByTestId('guide-position')).toHaveText('2 / 2');
  await expect(page.getByTestId('guide-caption')).not.toHaveText(first!);
  await expect(page.getByRole('button', { name: 'Next step' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
  await expect(page.getByTestId('guide-caption')).toHaveText(first!);

  await page.getByRole('button', { name: 'Close guide' }).click();
  await expect(guide(page)).toHaveCount(0);
  // Read-only: still the next thing to do, nothing logged.
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout');
  await expect(row(page, 'resistance').getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('day-progress')).toHaveText(progressBefore!);
  expect((await store(page)).completionEvents?.length ?? 0).toBe(eventsBefore);
});

test('each exercise has its own guide, and closing returns to the workout sheet it was opened from', async ({ page }) => {
  await openAt(page, at('10:30'));
  await row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click();
  await expect(page.getByTestId('sheet-session')).toBeVisible();

  await page.getByTestId('sheet-session').getByRole('button', { name: /^Lat pulldown \(Fortis\)/ }).click();
  await expect(page.getByTestId('guide-title')).toHaveText('Lat pulldown');
  await expect(page.getByTestId('guide-equipment')).toHaveText('Fortis home multi-gym');
  const pulldownCaption = await page.getByTestId('guide-caption').textContent();
  await expect(page.getByRole('img', { name: /Lat pulldown, step 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close guide' }).click();

  // Back on the workout sheet, not the day.
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByTestId('sheet-session')).toBeVisible();

  await page.getByRole('radio', { name: 'Short · 10 min' }).click(); // the short version's own list (#28)
  await page.getByTestId('sheet-session').getByRole('button', { name: /^Kettlebell squat/ }).click();
  await expect(page.getByTestId('guide-title')).toHaveText('Kettlebell squat');
  await expect(page.getByTestId('guide-position')).toHaveText('1 / 2'); // always starts on the first step
  await expect(page.getByTestId('guide-caption')).not.toHaveText(pulldownCaption!);
  await page.getByRole('button', { name: 'Close guide' }).click();
  await expect(page.getByTestId('sheet-session')).toBeVisible();
  await expect(row(page, 'resistance').getByRole('checkbox')).not.toBeChecked();
});

test('substitutes and exercises without a guide degrade gracefully', async ({ page }) => {
  await seedPlan(page, example);
  await openAt(page, at('15:00'));
  await page.getByTestId('workout-expand').click();
  const session = page.getByTestId('next-action-session');

  await session.getByRole('button', { name: /^Hammer curl/ }).click();
  await expect(page.getByTestId('guide-title')).toHaveText('Hammer curl');
  await expect(guide(page)).toContainText('Instead of biceps curl');
  await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
  await page.getByRole('button', { name: 'Close guide' }).click();

  await session.getByRole('button', { name: /^Overhead press/ }).click();
  await expect(guide(page)).toBeVisible();
  await expect(page.getByTestId('guide-no-image')).toHaveText('No guide for this exercise yet.');
  await expect(guide(page)).toContainText('Caution: shoulder');
  await page.getByRole('button', { name: 'Close guide' }).click();
  await expect(guide(page)).toHaveCount(0);
});

test('visual: exercise guide', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'baselines are kept for the phone project only');
  await seedRecords(page, { activities: schoolRunDone });
  await openAt(page, at('10:30'));
  await page.getByTestId('next-action-session').getByRole('button', { name: /^Kettlebell squat/ }).click();
  await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
  await expect(page).toHaveScreenshot('exercise-guide.png');
});

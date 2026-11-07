import { expect, test, type Page } from '@playwright/test';
import { closeWorkoutSheet, openAt, openSessionOptions, openWorkoutSheet, seedPlan, seedRecords, seedWithStrengthWindow, workoutCard, workoutSheet } from './helpers';

/**
 * #56 layout A: Today's workout. One compact card on Today, and a sheet with every eligible strength exercise.
 * A tap on a planned exercise ticks its session (#28 rules); any other exercise is one free log.
 */

const at = (hhmm: string, day = '02') => `2026-11-${day}T${hhmm}:00+11:00`; // Mon 2 Nov: home day with a strength session
const DAY = 'weight-loss-v1|2026-11-02';
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const schoolRunDone = { [DAY]: { 'school-run-am': { activityId: 'school-run-am', status: 'done', count: 0, labelSnapshot: 'School run', updatedAt: 't' } } };
const counts = (page: Page) => page.getByTestId('today-workout-counts');
const tick = (page: Page, name: RegExp | string) => workoutSheet(page).getByRole('checkbox', { name });

test.beforeEach(async ({ page }) => {
  await seedPlan(page, seedWithStrengthWindow('morning')); // a plan-defined window, so the session is due at 10:15 (#41)
  await seedRecords(page, { activities: schoolRunDone });
  await openAt(page, at('10:15'));
  await expect(workoutCard(page)).toContainText("Do this next · Today's workout");
});

test('collapsed: counts, one tickable exercise; ticking moves on, ⓘ never ticks', async ({ page }) => {
  await expect(counts(page)).toHaveText('0 of 12 done · 12 left');
  await expect(workoutCard(page).getByRole('checkbox')).toHaveCount(1);
  await workoutCard(page).getByRole('button', { name: 'Goblet squat. Show how' }).click();
  await expect(page.getByTestId('exercise-guide')).toBeVisible();
  await page.getByRole('button', { name: 'Close guide' }).click();
  await expect(counts(page)).toHaveText('0 of 12 done · 12 left');

  await workoutCard(page).getByRole('checkbox', { name: 'Goblet squat, 3 × 10' }).click();
  await expect(counts(page)).toHaveText('1 of 12 done · 11 left');
  await expect(workoutCard(page).getByRole('checkbox')).toHaveAccessibleName(/^Chest press machine/); // the next one
  // A planned exercise writes its session tick, never a free log.
  const s = await store(page);
  expect(s.activities[DAY].resistance.exercisesDone).toEqual(['full:0:kettlebell_squat']);
  expect(s.exerciseLogs ?? []).toEqual([]);
});

test('the sheet lists every eligible exercise; a non-plan tick is one free log, untick removes it; done rows go last; it persists', async ({ page }) => {
  await openWorkoutSheet(page);
  await expect(page.getByTestId('today-workout-totals')).toContainText('12');
  await expect(workoutSheet(page).getByRole('checkbox')).toHaveCount(12);
  await expect(workoutSheet(page)).not.toContainText('VR boxing'); // conditioning stays its own task

  await tick(page, 'Standing calf raises, 3 × 15').click();
  await expect(page.getByTestId('today-workout-done').getByRole('checkbox', { name: 'Standing calf raises, 3 × 15' })).toBeChecked();
  let logs = (await store(page)).exerciseLogs;
  expect(logs).toEqual([expect.objectContaining({ id: 'tap-2026-11-02-standing_calf_raise', movement: 'standing_calf_raise', sets: 3, reps: 15 })]);

  // Untick removes it; a second tap stores one record again (fixed id per day and movement).
  await tick(page, 'Standing calf raises, 3 × 15').click();
  await expect(page.getByTestId('today-workout-todo').getByRole('checkbox', { name: 'Standing calf raises, 3 × 15' })).not.toBeChecked();
  expect((await store(page)).exerciseLogs).toEqual([]);
  await tick(page, 'Standing calf raises, 3 × 15').click();
  await expect(page.getByTestId('today-workout-done').getByRole('checkbox')).toHaveCount(1);
  logs = (await store(page)).exerciseLogs;
  expect(logs).toHaveLength(1);

  await closeWorkoutSheet(page);
  await page.reload();
  await expect(counts(page)).toHaveText('1 of 12 done · 11 left');
});

test('ticking every planned exercise completes the session; the card says so; untick reopens it', async ({ page }) => {
  await openWorkoutSheet(page);
  for (const name of [/^Goblet squat/, /^Chest press machine/, /^Lat pulldown/, /^One-arm kettlebell row/, /^Hammer curls/]) await tick(page, name).click();
  await expect(page.getByText('Strength workout complete')).toBeVisible(); // toast
  expect((await store(page)).activities[DAY].resistance).toMatchObject({ status: 'done', variant: 'full' });
  await closeWorkoutSheet(page);
  await expect(workoutCard(page)).toContainText('Strength workout · done ✓');
  await expect(counts(page)).toHaveText('5 of 12 done · 7 left'); // the rest of the inventory stays available

  await openWorkoutSheet(page);
  await tick(page, /^Hammer curls/).click();
  expect((await store(page)).activities[DAY].resistance.status).toBe('pending');
});

test('Full / Short lives in the session options; switching mid-workout asks first; the inventory stays complete', async ({ page }) => {
  await openSessionOptions(page);
  await page.getByRole('radio', { name: 'Short · 10 min' }).click(); // nothing ticked yet: no question
  await page.getByTestId('modal-dismiss').filter({ visible: true }).last().click();
  await expect(workoutSheet(page).getByRole('checkbox', { name: 'Goblet squat, 2 × 10' })).toBeVisible(); // short dose
  await expect(workoutSheet(page).getByRole('checkbox')).toHaveCount(12);
  await tick(page, 'Goblet squat, 2 × 10').click();

  await workoutSheet(page).getByRole('button', { name: 'Strength workout: full or short, skip and more' }).click();
  await page.getByRole('radio', { name: 'Full · 35 min' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Switch to the full version?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('radio', { name: 'Short · 10 min' })).toBeChecked();
  expect((await store(page)).activities[DAY].resistance).toMatchObject({ variant: 'short', exercisesDone: ['short:0:kettlebell_squat'] });
});

test('a past day is corrected from its own workout card', async ({ page }) => {
  await openAt(page, at('10:00', '04')); // Wednesday; Monday is now in the past
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await openWorkoutSheet(page);
  await tick(page, /^Goblet squat/).click();
  await closeWorkoutSheet(page);
  await expect(counts(page)).toHaveText('1 of 12 done · 11 left');
  expect((await store(page)).activities[DAY].resistance.exercisesDone).toEqual(['full:0:kettlebell_squat']);
});

test('Friday rest day: optional, nothing due, voluntary exercise still logs', async ({ page }) => {
  await openAt(page, at('09:00', '06'));
  await expect(page.getByTestId('today-workout-subtitle')).toHaveText('Rest day · optional');
  await openWorkoutSheet(page);
  await expect(workoutSheet(page)).not.toContainText('! Due');
  await tick(page, 'Plank, 1 × 20 s').click();
  expect((await store(page)).exerciseLogs).toEqual([expect.objectContaining({ movement: 'plank', date: '2026-11-06', sets: 1, seconds: 20 })]);
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test("today's workout: card, sheet, ticked", async ({ page }) => {
    await expect(page).toHaveScreenshot('today-workout-card.png');
    await openWorkoutSheet(page);
    await expect(page).toHaveScreenshot('today-workout-sheet.png');
    await tick(page, 'Standing calf raises, 3 × 15').click();
    await tick(page, /^Goblet squat/).click();
    await workoutSheet(page).hover();
    await page.mouse.wheel(0, 3000);
    await expect(page).toHaveScreenshot('today-workout-sheet-done.png');
  });
});

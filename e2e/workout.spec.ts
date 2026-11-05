import { expect, test, type Page } from '@playwright/test';
import { openAt, row, seedRecords } from './helpers';

/** Issue #28: a strength workout is a live checklist on "Do this next", collapsed and compact by default. */

const at = (hhmm: string, day = '02') => `2026-11-${day}T${hhmm}:00+11:00`; // Mon 2 Nov: home day with a strength session
const DAY = 'weight-loss-v1|2026-11-02';
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const schoolRunDone = { [DAY]: { 'school-run-am': { activityId: 'school-run-am', status: 'done', count: 0, labelSnapshot: 'School run', updatedAt: 't' } } };
const card = (page: Page) => page.getByTestId('next-action');
/** The top slot's title: "Do this next" when something is due, "Up next" otherwise (#51). */
const slotTitle = (page: Page) => page.getByTestId(/^(next-action|up-next)-title$/);
const summary = (page: Page) => page.getByTestId('workout-summary');
const checklist = (page: Page) => page.getByTestId('next-action-session');
const tickNext = (page: Page) => checklist(page).getByRole('checkbox', { checked: false }).first().click();

test.beforeEach(async ({ page }) => {
  await seedRecords(page, { activities: schoolRunDone });
  await openAt(page, at('10:30'));
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout');
});

test('collapsed by default: just the workout, its progress and the next exercise; no whole-workout Done', async ({ page }) => {
  await expect(summary(page)).toHaveText('35 min · 0 of 5 exercises');
  await expect(checklist(page).getByRole('checkbox')).toHaveCount(1);
  await expect(checklist(page)).toContainText('Next');
  await expect(checklist(page)).toContainText('Kettlebell squat');
  await expect(card(page).getByRole('radiogroup')).toHaveCount(0); // no Full/Short in the collapsed card
  await expect(card(page).getByRole('button', { name: /^Done/ })).toHaveCount(0);
  await expect(card(page).getByText('Skip and more')).toHaveCount(0);
  const box = (await card(page).boundingBox())!;
  expect(box.height, 'collapsed card stays compact').toBeLessThanOrEqual(200);
  const target = (await checklist(page).getByRole('checkbox').boundingBox())!;
  expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(44);
});

test('tick → the next exercise appears; ⓘ opens the guide and never ticks', async ({ page }) => {
  await checklist(page).getByRole('button', { name: /^Kettlebell squat, 3 × 10\. Show how/ }).click();
  await expect(page.getByTestId('guide-title')).toHaveText('Kettlebell squat');
  await page.getByRole('button', { name: 'Close guide' }).click();
  await expect(summary(page)).toHaveText('35 min · 0 of 5 exercises');

  await tickNext(page);
  await expect(summary(page)).toHaveText('35 min · 1 of 5 exercises');
  await expect(checklist(page)).toContainText('Chest press (Fortis)');
  await expect(page.getByTestId('day-progress')).toHaveText('1 of 7 done'); // the workout is still one item
  await expect(row(page, 'resistance')).toContainText('1 of 5 exercises');
});

test('expanding shows the whole checklist; collapsing and restarting keep every tick', async ({ page }) => {
  await tickNext(page);
  await tickNext(page);
  await page.getByTestId('workout-expand').click();
  await expect(checklist(page).getByRole('checkbox')).toHaveCount(5);
  await expect(checklist(page).getByRole('checkbox', { checked: true })).toHaveCount(2); // done ones stay visible
  await expect(page.getByRole('radio', { name: 'Full · 35 min' })).toBeChecked();
  await page.getByTestId('workout-expand').click(); // collapse
  await expect(summary(page)).toHaveText('35 min · 2 of 5 exercises');

  await page.reload();
  await expect(summary(page)).toHaveText('35 min · 2 of 5 exercises');
  await expect(checklist(page).getByRole('checkbox')).toHaveCount(1); // collapsed again by default
  await expect(checklist(page)).toContainText('Lat pulldown (Fortis)');
  const s = await store(page);
  expect(s.activities[DAY].resistance).toMatchObject({ status: 'pending', variant: 'full', exercisesDone: ['full:0:kettlebell_squat', 'full:1:chest_press'] });
});

test('the last tick completes the workout: "complete · 5 of 5" is shown, then "Do this next" moves on', async ({ page }) => {
  for (let i = 0; i < 5; i++) await tickNext(page);
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout complete');
  await expect(summary(page)).toHaveText('5 of 5 exercises ✓');
  await expect(page.getByTestId('day-progress')).toHaveText('2 of 7 done');
  await expect(row(page, 'resistance').getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: "Show what's next" }).click();
  await expect(slotTitle(page)).not.toHaveText(/Strength workout/);

  const events = (await store(page)).completionEvents.filter((e: any) => e.activityId === 'resistance').map((e: any) => e.action);
  expect(events).toEqual(['tick', 'tick', 'tick', 'tick', 'complete']);
});

test('the completed card also moves on by itself after a moment', async ({ page }) => {
  for (let i = 0; i < 5; i++) await tickNext(page);
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout complete');
  await expect(slotTitle(page)).not.toHaveText(/Strength workout/, { timeout: 7000 });
});

test('unticking a finished exercise in the details sheet reopens the workout; history keeps both', async ({ page }) => {
  for (let i = 0; i < 5; i++) await tickNext(page);
  await page.getByRole('button', { name: "Show what's next" }).click();
  await row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click();
  await page.getByTestId('sheet-session').getByRole('checkbox', { name: /^Hammer curl/ }).click();
  await expect(page.getByTestId('sheet-session').getByRole('checkbox', { checked: true })).toHaveCount(4);
  await page.getByTestId('modal-dismiss').click();
  await expect(row(page, 'resistance').getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('day-progress')).toHaveText('1 of 7 done');
  const actions = (await store(page)).completionEvents.filter((e: any) => e.activityId === 'resistance').map((e: any) => e.action);
  expect(actions.slice(-2)).toEqual(['complete', 'undo']);
});

test('Full / Short is an explicit choice; switching mid-workout asks first; Short completes with its own list', async ({ page }) => {
  await page.getByTestId('workout-expand').click();
  await page.getByRole('radio', { name: 'Short · 10 min' }).click(); // nothing ticked yet: no question
  await expect(summary(page)).toHaveText('Short · 10 min · 0 of 3 exercises');
  await tickNext(page);

  await page.getByRole('radio', { name: 'Full · 35 min' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Switch to the full version?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('radio', { name: 'Short · 10 min' })).toBeChecked();

  await tickNext(page);
  await tickNext(page);
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout complete');
  await expect(summary(page)).toHaveText('3 of 3 exercises ✓');
  expect((await store(page)).activities[DAY].resistance).toMatchObject({ status: 'done', variant: 'short' });
});

test('ticks in the details sheet correct a past day', async ({ page }) => {
  await openAt(page, at('10:00', '04')); // Wednesday; Monday is now in the past
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click();
  await page.getByTestId('sheet-session').getByRole('checkbox', { name: /^Kettlebell squat/ }).click();
  await page.getByTestId('modal-dismiss').click();
  await expect(row(page, 'resistance')).toContainText('1 of 5 exercises');
  expect((await store(page)).activities[DAY].resistance.exercisesDone).toEqual(['full:0:kettlebell_squat']);
});

test('whole-workout completion stays as a manual override in the list', async ({ page }) => {
  await row(page, 'resistance').getByRole('checkbox').click();
  await expect(page.getByTestId('day-progress')).toHaveText('2 of 7 done');
  await expect(slotTitle(page)).not.toHaveText(/Strength workout/);
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('workout card: collapsed, expanded, complete', async ({ page }) => {
    await tickNext(page);
    await page.waitForTimeout(400); // let the next exercise's fade-in finish (it's a JS animation)
    await expect(page).toHaveScreenshot('workout-collapsed.png');
    await page.getByTestId('workout-expand').click();
    await expect(page).toHaveScreenshot('workout-expanded.png');
    for (let i = 0; i < 4; i++) await tickNext(page);
    await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout complete');
    await expect(page).toHaveScreenshot('workout-complete.png');
  });
});

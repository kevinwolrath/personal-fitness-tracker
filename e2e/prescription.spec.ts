import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import example from '../fixtures/plans/prescription-example.plan.json';
import { openAt, row, seedPlan, seedRecords, chooseFromMenu, exportAllData, closeWorkoutSheet, openSessionOptions, openWorkoutSheet, workoutCard, workoutSheet, leaveSettings } from './helpers';

/** Issue #10: "Open app → see what I should do now → do it → tick it off → app tells me what's next." */

const at = (hhmm: string) => `2026-11-02T${hhmm}:00+11:00`; // Monday, home day
const card = (page: Page) => page.getByTestId('next-action');
const nextTitle = (page: Page) => page.getByTestId('next-action-title');
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const done = (ids: string[], date = '2026-11-02') => ({
  [`weight-loss-v1|${date}`]: Object.fromEntries(ids.map((id) => [id, { activityId: id, status: 'done', count: 0, labelSnapshot: id, updatedAt: `${date}T08:00:00Z` }])),
});

test('shows what to do now, ticks it off from the card, and moves on immediately', async ({ page }) => {
  await openAt(page, at('08:40'));
  await expect(card(page)).toContainText('Do this next');
  await expect(nextTitle(page)).toHaveText('School run');
  await expect(page.getByTestId('next-action-when')).toContainText('Now · 8:30 am');
  await expect(page.getByTestId('activity-school-run-am')).toHaveCSS('border-left-width', '4px'); // highlighted in the list too

  await page.getByRole('button', { name: 'Done: School run' }).click();
  await expect(row(page, 'school-run-am').getByRole('checkbox')).toBeChecked();
  // Recalculated (#41): untimed Strength is not promoted just for being open, and lunch is hours away: no card.
  await expect(page.getByTestId(/^(next-action|up-next)$/)).toHaveCount(0);
  await expect(page.getByText(/Nothing left|Nothing planned/)).toHaveCount(0);
  await expect(workoutCard(page)).toContainText('0 of 5 done'); // Strength stays on Today's workout, actionable (#56)
  await expect(page.getByTestId('activity-school-run-am')).not.toHaveCSS('border-left-width', '4px');

  // Undo from the list: the run is next again.
  await row(page, 'school-run-am').getByRole('checkbox').click();
  await expect(nextTitle(page)).toHaveText('School run');
});

test('#41 the reported case: Monday 09:34, the overdue school run, untimed Strength and a noon lunch are not promoted', async ({ page }) => {
  await openAt(page, at('09:34'));
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(page.getByTestId(/^(next-action|up-next)$/)).toHaveCount(0);
  await expect(row(page, 'school-run-am').getByRole('checkbox')).not.toBeChecked(); // overdue: left as it was
  await expect(workoutCard(page)).toContainText('Strength workout · plan'); // listed, not promoted
  await expect(row(page, 'lunch')).toBeVisible();
  // Nearer noon, lunch is recommended.
  await openAt(page, at('11:50'));
  await expect(nextTitle(page)).toHaveText('Fixed lunch');
});

test('completion persists with a timestamp, history is append-only, and survives restart', async ({ page }) => {
  await openAt(page, at('12:10'));
  await expect(nextTitle(page)).toHaveText('Fixed lunch');
  await page.getByRole('button', { name: 'Done: Fixed lunch' }).click();
  await row(page, 'lunch').getByRole('checkbox').click(); // undo
  await row(page, 'lunch').getByRole('checkbox').click(); // redo

  const s = await store(page);
  expect(s.activities['weight-loss-v1|2026-11-02'].lunch).toMatchObject({ status: 'done', updatedAt: '2026-11-02T12:10:00+11:00' });
  expect(s.completionEvents.filter((e: any) => e.activityId === 'lunch').map((e: any) => e.action)).toEqual(['complete', 'undo', 'complete']);
  expect(s.daySnapshots['weight-loss-v1|2026-11-02'].prescribed.items.map((i: any) => i.key)).toContain('req:hard-conditioning');

  await page.reload();
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeChecked();
  await expect(nextTitle(page)).not.toHaveText('Fixed lunch');
});

test('one conditioning alternative satisfies the requirement; no redundant ropes or bag', async ({ page }) => {
  await seedRecords(page, { activities: done(['school-run-am', 'lunch', 'school-run-pm', 'snack', 'dinner', 'resistance']) });
  await openAt(page, at('20:00'));
  await expect(nextTitle(page)).toHaveText('High-intensity conditioning');
  await expect(card(page)).toContainText('Any one of these counts for today');

  // VR boxing is count-tracked: three rounds from the requirement row.
  const vr = page.getByTestId('option-vr-boxing');
  for (let i = 0; i < 3; i++) await vr.click();
  const req = page.getByTestId('requirement-hard-conditioning');
  await expect(req).toContainText('Done with VR boxing · 3 rounds');
  await expect(page.getByTestId('option-heavy-bag')).toHaveCount(0); // #90: the others are hidden once one is done
  await expect(page.getByTestId('option-battle-ropes')).toHaveCount(0);
  await expect(page.getByTestId('day-progress')).toHaveText('All 7 done');
  await expect(card(page)).toHaveCount(0); // never Battle ropes or Heavy bag; nothing left, so no card (#41)

  const s = await store(page);
  expect(s.activities['weight-loss-v1|2026-11-02']['vr-boxing']).toMatchObject({ status: 'done', count: 3, requirementId: 'hard-conditioning' });
});

test('any alternative works: heavy bag from the next-action card', async ({ page }) => {
  await seedRecords(page, { activities: done(['school-run-am', 'lunch', 'school-run-pm', 'snack', 'dinner', 'resistance']) });
  await openAt(page, at('19:00'));
  await page.getByRole('button', { name: 'Do Heavy bag rounds' }).click();
  await expect(page.getByTestId('requirement-hard-conditioning')).toContainText('Done with Heavy bag rounds · 12 min');
  await expect(page.getByTestId('option-vr-boxing')).toHaveCount(0);
});

test('short version of the strength session is recorded as such', async ({ page }) => {
  await openAt(page, at('09:45'));
  await openSessionOptions(page); // full or short now lives in the session's options (#56)
  await page.getByRole('radio', { name: 'Short · 10 min' }).click(); // explicit choice (#28)
  await expect(page.getByTestId('sheet-session')).toContainText('Kettlebell squat');
  await expect(page.getByTestId('sheet-session')).not.toContainText('Lat pulldown');
  await page.getByRole('button', { name: 'Mark whole workout done (short)' }).click(); // closes the options sheet
  // The short version's 3 planned exercises are done; the rest of the inventory stays available.
  await expect(workoutSheet(page).getByRole('checkbox', { checked: true })).toHaveCount(3);
  await closeWorkoutSheet(page);
  await expect(workoutCard(page)).toContainText('Strength workout · done ✓');
  const s = await store(page);
  expect(s.activities['weight-loss-v1|2026-11-02'].resistance).toMatchObject({ status: 'done', variant: 'short' });
});

test('avoided movements show the configured substitute (from the #7 exercise config)', async ({ page }) => {
  await seedPlan(page, example);
  await openAt(page, at('15:00'));
  await expect(workoutCard(page)).toContainText("Do this next · Today's workout");
  await openWorkoutSheet(page);
  const session = workoutSheet(page);
  await expect(session.getByTestId('workout-row-hammer_curl')).toContainText('instead of biceps curl');
  await expect(session).not.toContainText('Biceps curl');
  await expect(session.getByTestId('workout-row-overhead_press')).toContainText('Caution');
});

test('respects "after": the snack waits for lunch; overdue lunch stays in the list but is not promoted', async ({ page }) => {
  await seedRecords(page, { activities: done(['school-run-am']) });
  await openAt(page, at('14:20'));
  // Lunch's window has passed and the snack (after lunch) isn't available, so only the afternoon school run
  // (15:15, due from 14:45, within the hour) is previewed (#41).
  await expect(page.getByTestId('up-next-title')).toHaveText('School run');
  await expect(row(page, 'lunch').getByRole('checkbox')).not.toBeChecked();
  await row(page, 'lunch').getByRole('checkbox').click(); // ticked from the list, late
  await expect(nextTitle(page)).toHaveText('Fixed snack'); // the afternoon snack is open now
});

test('nothing left: no card and no placeholder (#41)', async ({ page }) => {
  await seedRecords(page, { activities: { ...done(['school-run-am', 'lunch', 'dog-walk', 'school-run-pm', 'snack', 'dinner', 'resistance', 'vr-boxing']) } });
  await openAt(page, at('21:00'));
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText('Nothing left for today')).toHaveCount(0);
});

test('the next-action card is only for today; other days are the plain log', async ({ page }) => {
  await openAt(page, at('09:00'));
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(card(page)).toHaveCount(0);
});

test('history is not destroyed by a later plan change', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAt(page, at('10:00'));
  await openSessionOptions(page);
  await page.getByRole('button', { name: 'Mark whole workout done (full)' }).click(); // closes the options sheet
  await closeWorkoutSheet(page);

  // Remove the Monday strength session from the plan through the #7 protocol.
  const seed = JSON.parse(readFileSync('plans/seed.plan.json', 'utf8'));
  const activities = seed.activities.filter((a: any) => a.kind !== 'meal' && a.id !== 'resistance');
  await chooseFromMenu(page, 'Configure with AI');
  await page.getByLabel('AI update').fill(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, schedule: { activities } } }));
  await page.getByRole('button', { name: 'Check update' }).click();
  await page.getByTestId('preview-schedule').getByRole('button').first().click();
  await expect(page.getByTestId('preview-schedule')).toContainText('Removed Strength workout');
  await page.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await leaveSettings(page); // Configure returns to Settings → Plan & goals (#174)

  await expect(workoutCard(page)).toContainText('No workout planned'); // no longer prescribed
  await expect(page.getByTestId('history-resistance')).toContainText('Done'); // but what happened is still on the day

  const doc = await exportAllData(page);
  expect(doc.completionEvents.map((e: any) => [e.activityId, e.action, e.at])).toContainEqual(['resistance', 'complete', '2026-11-02T10:00:00+11:00']);
  const snapshot = doc.daySnapshots.find((d: any) => d.date === '2026-11-02');
  expect(snapshot.prescribed.items.find((i: any) => i.key === 'resistance').session.exercises[0].label).toBe('Kettlebell squat');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('prescription-morning', async ({ page }) => {
    // Mid-morning, school run done: nothing is due and lunch is more than an hour off, so there is no card (#41).
    // Untimed Strength stays in the checklist under "Anytime today".
    await seedRecords(page, { activities: done(['school-run-am']) });
    await openAt(page, at('10:30'));
    await expect(page.getByTestId('day-progress')).toBeVisible();
    await expect(page.getByTestId(/^(next-action|up-next)$/)).toHaveCount(0);
    const height = await page.getByTestId('day-scroll').evaluate((el) => {
      const s = el as HTMLElement;
      return Math.ceil(window.innerHeight - s.clientHeight + s.scrollHeight);
    });
    await page.setViewportSize({ width: 390, height });
    await expect(page).toHaveScreenshot('prescription-morning-full.png');
  });
});

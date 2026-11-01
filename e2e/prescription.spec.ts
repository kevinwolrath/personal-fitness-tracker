import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import example from '../fixtures/plans/prescription-example.plan.json';
import { openAt, row, seedPlan, seedRecords } from './helpers';

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
  // Recalculated: nothing else is due this morning, so the required anytime strength session is next.
  await expect(nextTitle(page)).toHaveText('Strength workout');
  await expect(page.getByTestId('next-action-when')).toContainText('Anytime today · 35 min');
  await expect(page.getByTestId('next-action-session')).toContainText('Kettlebell squat');
  await expect(page.getByTestId('next-action-session')).toContainText('3 × 10');
  await expect(page.getByTestId('next-action-session')).toContainText('Cable row (Fortis)');

  // Undo from the list: the run is next again.
  await row(page, 'school-run-am').getByRole('checkbox').click();
  await expect(nextTitle(page)).toHaveText('School run');
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
  await expect(req).toContainText('Done with VR boxing');
  await expect(page.getByTestId('option-heavy-bag')).toBeDisabled();
  await expect(page.getByTestId('option-heavy-bag')).toHaveAttribute('aria-label', /not needed today/);
  await expect(page.getByTestId('option-battle-ropes')).toBeDisabled();
  await expect(nextTitle(page)).not.toHaveText(/conditioning|Battle ropes|Heavy bag/);
  await expect(page.getByTestId('day-progress')).toHaveText('All 7 done');

  const s = await store(page);
  expect(s.activities['weight-loss-v1|2026-11-02']['vr-boxing']).toMatchObject({ status: 'done', count: 3, requirementId: 'hard-conditioning' });
});

test('any alternative works: heavy bag from the next-action card', async ({ page }) => {
  await seedRecords(page, { activities: done(['school-run-am', 'lunch', 'school-run-pm', 'snack', 'dinner', 'resistance']) });
  await openAt(page, at('19:00'));
  await page.getByRole('button', { name: 'Do Heavy bag rounds' }).click();
  await expect(page.getByTestId('requirement-hard-conditioning')).toContainText('Done with Heavy bag rounds');
  await expect(page.getByTestId('option-vr-boxing')).toBeDisabled();
});

test('short version of the strength session is recorded as such', async ({ page }) => {
  await openAt(page, at('09:45'));
  await row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click();
  await expect(page.getByTestId('sheet-session-short')).toContainText('Kettlebell squat');
  await page.getByRole('button', { name: 'Done (short version, 10 min)' }).click();
  await expect(row(page, 'resistance')).toContainText('Short version');
  const s = await store(page);
  expect(s.activities['weight-loss-v1|2026-11-02'].resistance).toMatchObject({ status: 'done', variant: 'short' });
});

test('avoided movements show the configured substitute (from the #7 exercise config)', async ({ page }) => {
  await seedPlan(page, example);
  await openAt(page, at('15:00'));
  await expect(nextTitle(page)).toHaveText('Strength workout');
  const session = page.getByTestId('next-action-session');
  await expect(session).toContainText('Hammer curl');
  await expect(session).toContainText('instead of biceps curl');
  await expect(session).not.toContainText('Biceps curl');
  await expect(session).toContainText('caution'); // overhead press
});

test('respects "after": the snack waits for lunch; overdue items still surface', async ({ page }) => {
  await seedRecords(page, { activities: done(['school-run-am']) });
  await openAt(page, at('14:20'));
  // Lunch window (11:30–13:00) has passed: it's overdue and required, and the snack (after lunch) isn't available yet.
  await expect(nextTitle(page)).toHaveText('Strength workout'); // required anytime ranks before required overdue
  await page.getByRole('button', { name: 'Done: Strength workout' }).click();
  await expect(nextTitle(page)).toHaveText('Fixed lunch');
  await expect(page.getByTestId('next-action-when')).toContainText('Was due 12:00 pm');
  await page.getByRole('button', { name: 'Done: Fixed lunch' }).click();
  await expect(nextTitle(page)).toHaveText('Fixed snack');
});

test('nothing left: the card says so', async ({ page }) => {
  await seedRecords(page, { activities: { ...done(['school-run-am', 'lunch', 'dog-walk', 'school-run-pm', 'snack', 'dinner', 'resistance', 'vr-boxing']) } });
  await openAt(page, at('21:00'));
  await expect(card(page)).toContainText('Nothing left for today');
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
  await page.getByRole('button', { name: 'Done: Strength workout' }).click();

  // Remove the Monday strength session from the plan through the #7 protocol.
  const seed = JSON.parse(readFileSync('plans/seed.plan.json', 'utf8'));
  const activities = seed.activities.filter((a: any) => a.kind !== 'meal' && a.id !== 'resistance');
  await page.getByRole('button', { name: 'Configure with AI' }).click();
  await page.getByLabel('AI update').fill(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, schedule: { activities } } }));
  await page.getByRole('button', { name: 'Check update' }).click();
  await expect(page.getByTestId('preview-schedule')).toContainText('Removed Strength workout');
  await page.getByRole('button', { name: 'Apply update' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByTestId('activity-resistance')).toHaveCount(0); // no longer prescribed
  await expect(page.getByTestId('history-resistance')).toContainText('Done'); // but what happened is still on the day

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data' }).click();
  const doc = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(doc.completionEvents.map((e: any) => [e.activityId, e.action, e.at])).toContainEqual(['resistance', 'complete', '2026-11-02T10:00:00+11:00']);
  const snapshot = doc.daySnapshots.find((d: any) => d.date === '2026-11-02');
  expect(snapshot.prescribed.items.find((i: any) => i.key === 'resistance').session.exercises[0].label).toBe('Kettlebell squat');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('prescription-morning', async ({ page }) => {
    // Mid-morning, school run done: nothing else is due yet, so the (anytime, required) strength session is next.
    await seedRecords(page, { activities: done(['school-run-am']) });
    await openAt(page, at('10:30'));
    await expect(nextTitle(page)).toHaveText('Strength workout');
    const height = await page.getByTestId('day-scroll').evaluate((el) => {
      const s = el as HTMLElement;
      return Math.ceil(window.innerHeight - s.clientHeight + s.scrollHeight);
    });
    await page.setViewportSize({ width: 390, height });
    await expect(page).toHaveScreenshot('prescription-morning-full.png');
  });
});

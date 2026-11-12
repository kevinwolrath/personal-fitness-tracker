import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { MONDAY, openAt, seedPlan, seedRecords, seedWithStrengthWindow, openWorkoutSheet, closeWorkoutSheet, chooseFromMenu, workoutSheet } from './helpers';

test('#56 acceptance: session/extra weighted totals, reports tab, held choices, clear/reload and rest-day freedom', async ({ page }, info) => {
  await seedPlan(page, seedWithStrengthWindow());
  await seedRecords(page, { exerciseLogs: [
    { id: 'old', movement: 'standing_calf_raise', date: '2026-10-20', at: '2026-10-20T08:00:00+11:00', sets: 1, reps: 15, seconds: null, intensity: null },
    { id: 'pull', movement: 'lat_pulldown', date: '2026-10-29', at: '2026-10-29T08:00:00+11:00', sets: 2, reps: 10, seconds: null, intensity: null },
  ] });
  await openAt(page, MONDAY);
  await openWorkoutSheet(page);
  await workoutSheet(page).getByRole('checkbox', { name: /^Chest press machine,/ }).click();
  await expect(page.getByTestId('today-workout-totals')).toContainText('1done');
  await closeWorkoutSheet(page);
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  const sheet = page.getByTestId('coverage-sheet');
  await expect(sheet.locator('[data-testid^="select-muscle-"]')).toHaveCount(14);
  await expect(sheet.getByTestId('select-muscle-chest')).toContainText('3 / 6 effective sets');
  await expect(sheet.getByTestId('select-muscle-triceps')).toContainText('1.5 / 6 effective sets');
  await expect(sheet.getByTestId('select-muscle-biceps')).toContainText('1 / 6 effective sets');
  await sheet.getByRole('radio', { name: /^Reports/ }).click();
  await expect(sheet.getByTestId('reports-empty')).toBeVisible();
  await sheet.getByTestId('select-muscle-biceps').click();
  await sheet.getByRole('button', { name: 'Report sore', exact: true }).click();
  await expect(sheet.getByRole('radio', { name: /^Reports/ })).toBeChecked();
  await expect(sheet.getByTestId('muscle-detail')).toContainText('≋ Sore');
  if (info.project.name === 'phone') {
    mkdirSync('docs/design/issue-56/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/design/issue-56/screenshots/reports-sore.png' });
  }
  await sheet.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await sheet.getByRole('button', { name: 'Choose Hammer curls', exact: true }).click();
  await expect(sheet).toContainText('Biceps: sore');
  await page.getByLabel('Sets or rounds').fill('2');
  await page.getByLabel('Reps per set', { exact: true }).fill('12');
  await sheet.getByRole('button', { name: 'Save exercise log', exact: true }).click();
  await sheet.getByRole('button', { name: 'Back to muscle coverage', exact: true }).click();
  await expect(sheet.getByRole('radio', { name: /^Reports/ })).toBeChecked();
  await expect(sheet.getByTestId('muscle-detail')).toContainText('3 / 6 effective sets');
  await sheet.getByRole('button', { name: 'Report injured', exact: true }).click();
  await expect(sheet.getByTestId('muscle-detail')).toContainText('! Injured');
  await sheet.getByRole('button', { name: 'Clear report', exact: true }).click();
  await expect(sheet.getByTestId('reports-empty')).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /^Reports/ })).toBeChecked();
  await sheet.getByRole('radio', { name: 'Priority', exact: true }).click();
  await expect(sheet.getByTestId('muscle-detail')).toContainText('Recovering');
  if (info.project.name === 'phone') await page.screenshot({ path: 'docs/design/issue-56/screenshots/priority-weighted.png' });
  await page.getByRole('button', { name: 'Close coverage', exact: true }).click();
  await page.reload();
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  await page.getByTestId('select-muscle-biceps').click();
  await expect(page.getByTestId('muscle-detail')).toContainText('3 / 6 effective sets');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
  expect(saved.exerciseLogs).toHaveLength(3); // two seeds + one extra; session ticks are not free logs
  expect(saved.muscleReports).toHaveLength(2);
  expect(saved.muscleReports.every((report: any) => report.clearedAt)).toBe(true);
  await page.getByRole('button', { name: 'Close coverage', exact: true }).click();
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+11:00'));
  await page.reload();
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  await expect(page.getByTestId('coverage-sheet')).toContainText('Rest day; voluntary exercise is still available.');
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose Hammer curls', exact: true })).toBeVisible();
});

test('#56 coverage recovery refreshes with the foreground clock while the sheet stays open', async ({ page }) => {
  await seedPlan(page, seedWithStrengthWindow());
  await seedRecords(page, { exerciseLogs: [
    { id: 'old', movement: 'standing_calf_raise', date: '2026-10-20', at: '2026-10-20T08:00:00+11:00', sets: 1, reps: 15, seconds: null, intensity: null },
    { id: 'press', movement: 'chest_press', date: '2026-10-31', at: '2026-10-31T11:00:00+11:00', sets: 3, reps: 10, seconds: null, intensity: null },
  ] });
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  await expect(page.getByTestId('muscle-detail')).toContainText('Recovering');
  await page.clock.setFixedTime(new Date('2026-11-02T11:01:00+11:00'));
  await page.clock.runFor(61_000);
  await expect(page.getByTestId('muscle-detail')).not.toContainText('Recovering');
  await expect(page.getByTestId('muscle-detail')).toContainText('3 / 6 effective sets');
});

test('#56 a completed extra moves last, undo restores its slot, and next-day order reflects trained muscles', async ({ page }) => {
  await seedPlan(page, seedWithStrengthWindow());
  await seedRecords(page, { exerciseLogs: [
    { id: 'old', movement: 'plank', date: '2026-10-20', at: '2026-10-20T08:00:00+11:00', sets: 1, seconds: 20, reps: null, intensity: null },
    { id: 'quads', movement: 'leg_extension', date: '2026-11-02', at: '2026-11-02T08:00:00+11:00', sets: 6, reps: 12, seconds: null, intensity: null },
  ] });
  await openAt(page, '2026-11-05T09:00:00+11:00');
  await openWorkoutSheet(page);
  await expect(page.getByTestId('today-workout-extras')).toHaveAttribute('aria-expanded', 'true'); // extras open by default with no prescribed session
  const list = page.getByTestId('today-workout-extras-list');
  await expect(list.getByTestId('workout-row-standing_calf_raise')).toBeVisible();
  const order = () => list.locator('[data-testid^="workout-row-"]').evaluateAll(elements => elements.map(el => el.getAttribute('data-testid')));
  const before = await order();
  expect(before.indexOf('workout-row-standing_calf_raise')).toBeLessThan(before.indexOf('workout-row-leg_extension'));
  const calf = list.getByRole('checkbox', { name: /^Standing calf raises,/ });
  await calf.click();
  await expect(calf).toBeChecked();
  expect((await order()).at(-1)).toBe('workout-row-standing_calf_raise');
  await calf.click();
  await expect(calf).not.toBeChecked();
  expect(await order()).toEqual(before);
  await calf.click();
  await expect(calf).toBeChecked();
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('pft:tracking:v1')!).exerciseLogs ?? []).some((log: any) => log.id === 'tap-2026-11-05-standing_calf_raise'))).toBe(true);
  await closeWorkoutSheet(page);
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+11:00'));
  await page.reload();
  await openWorkoutSheet(page);
  await expect(page.getByTestId('today-workout-extras')).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('checkbox', { name: /^Standing calf raises,/ })).not.toBeChecked();
  await expect(list.getByTestId('workout-status-standing_calf_raise')).toHaveText('↻ Recovering');
  const next = await order();
  expect(next.indexOf('workout-row-standing_calf_raise')).toBeGreaterThan(next.indexOf('workout-row-leg_extension'));
});

test('#56 custom exercise draft uses its shared timed dose without logging by viewing', async ({ page }, info) => {
  const base = seedWithStrengthWindow();
  await seedPlan(page, { ...base, exercise: { ...base.exercise, customExercises: [{ movement: 'custom_hold', name: 'Custom hold', equipment: [], primary: ['biceps'], defaultDose: { sets: 4, seconds: 35 } }] } });
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Custom hold', exact: true }).click();
  await expect(page.getByLabel('Sets or rounds')).toHaveValue('4');
  await expect(page.getByLabel('Seconds per round or set')).toHaveValue('35');
  await expect(page.getByRole('radio', { name: 'Seconds', exact: true })).toBeChecked();
  const recorded = await page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!).exerciseLogs ?? []);
  expect(recorded).toEqual([]);
  if (info.project.name === 'phone') {
    await page.getByLabel('Sets or rounds').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/design/issue-56/screenshots/custom-dose.png' });
  }
});

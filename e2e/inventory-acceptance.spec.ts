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

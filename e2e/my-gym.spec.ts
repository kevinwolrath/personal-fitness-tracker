import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import seed from '../plans/seed.plan.json';
import { MONDAY, openAt, seedPlan, seedRecords, openWorkoutSheet, closeWorkoutSheet, chooseFromMenu } from './helpers';

for (const hero of ['male', 'female', 'other']) {
  test(`#158 ${hero}: grouped equipment access drives Resistance, Muscle Growth, logs and offline guides without changing doses`, async ({ page }, info) => {
    const plan = { ...seed, formatVersion: 9, profile: { gender: hero }, exercise: { ...seed.exercise, equipment: [], muscleGrowth: { enabled: true, targets: ['biceps', 'chest'], exercises: [{ movement: 'hammer_curl', sets: 2, reps: 12 }, { movement: 'chest_press', sets: 3, reps: 10 }] } } };
    await seedPlan(page, plan);
    const pastLog = { id: 'past-hammer', movement: 'hammer_curl', date: '2026-11-01', at: '2026-11-01T09:00:00Z', sets: 2, reps: 12, seconds: null, intensity: null };
    await seedRecords(page, { exerciseLogs: [pastLog] });
    await openAt(page, MONDAY);
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!).plan.json).then(JSON.parse);
    const before = await read();
    await chooseFromMenu(page, 'My Gym');
    await expect(page.getByTestId('my-gym')).toBeVisible();
    await expect(page.getByTestId('gym-plan-review')).toContainText('planned workout');
    await page.getByTestId('gym-search').fill('fixed dumbbells');
    const fixed = page.getByRole('checkbox', { name: 'Fixed dumbbells', exact: true });
    await expect(fixed).toBeVisible(); // search opens matching groups automatically
    await expect(page.getByRole('img', { name: 'Fixed dumbbells', exact: true })).toBeVisible();
    await fixed.click();
    await expect(fixed).toBeChecked();
    await expect.poll(async () => (await read()).exercise.equipment.some((item: any) => item.catalogueId === 'dumbbells_fixed')).toBe(true);
    await page.getByTestId('gym-search').fill('');
    await page.getByRole('button', { name: 'Selected only', exact: true }).click();
    await expect(page.getByTestId('my-gym').getByRole('checkbox')).toHaveCount(1);
    await page.getByRole('button', { name: 'Details for Fixed dumbbells', exact: true }).click();
    await expect(page.getByTestId('gym-detail')).toBeVisible();
    if (info.project.name === 'phone' && hero === 'male') {
      mkdirSync('docs/design/issue-158/screenshots', { recursive: true });
      await page.screenshot({ path: 'docs/design/issue-158/screenshots/detail.png' });
      await expect(page).toHaveScreenshot('my-gym-detail.png');
    }
    await page.getByRole('button', { name: 'Show Hammer curls guide', exact: true }).click();
    await expect(page.getByTestId('guide-image-1')).toBeVisible();
    await expect(page.getByTestId('guide-no-image')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('2 / 2');
    for (const step of [1, 2]) await expect.poll(() => page.getByTestId(`guide-image-${step}`).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.context().setOffline(true);
    await page.getByRole('button', { name: 'Previous step', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('2 / 2');
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Close guide', exact: true }).click();
    await page.getByRole('button', { name: 'Back to My Gym', exact: true }).click();
    if (info.project.name === 'phone' && hero === 'male') {
      mkdirSync('docs/design/issue-158/screenshots', { recursive: true });
      await page.screenshot({ path: 'docs/design/issue-158/screenshots/selected.png' });
      await expect(page).toHaveScreenshot('my-gym-selected.png');
    }
    await page.getByRole('button', { name: 'All equipment', exact: true }).click();
    await page.getByTestId('gym-search').fill('multi-gym');
    const chest = page.getByRole('checkbox', { name: 'Chest press station', exact: true });
    await chest.click();
    await expect(chest).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Lat pulldown station', exact: true })).not.toBeChecked();
    const after = await read();
    expect(after.activities).toEqual(before.activities);
    expect(after.exercise.muscleGrowth).toEqual(before.exercise.muscleGrowth);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.reload();
    await expect(page.getByTestId('muscle-growth')).toContainText('Hammer curls');
    await openWorkoutSheet(page);
    await expect(page.getByTestId('workout-equipment-lat_pulldown')).toBeVisible();
    await page.getByTestId('today-workout-extras').click();
    await expect(page.getByTestId('today-workout-extras-list').getByTestId('workout-row-floor_press')).toBeVisible();
    await expect(page.getByTestId('today-workout-extras-list').getByTestId('workout-row-kettlebell_romanian_deadlift')).toHaveCount(0);
    await closeWorkoutSheet(page);
    await chooseFromMenu(page, 'Muscle coverage & exercise log');
    await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose Chest press machine', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Lat pulldown', exact: true })).toHaveCount(0);
    await page.getByTestId('modal-dismiss').filter({ visible: true }).last().click();
    await chooseFromMenu(page, 'My Gym');
    await page.getByTestId('gym-search').fill('fixed dumbbells');
    await page.getByRole('checkbox', { name: 'Fixed dumbbells', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Fixed dumbbells', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Undo equipment change', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Fixed dumbbells', exact: true })).toBeChecked();
    await page.getByTestId('gym-search').fill('Dumbbells');
    await page.getByRole('button', { name: 'Select all Dumbbells', exact: true }).click();
    await expect(page.getByTestId('gym-group-dumbbells').getByRole('checkbox', { checked: true })).toHaveCount(6);
    await page.getByRole('button', { name: 'Deselect all Dumbbells', exact: true }).click();
    await expect(page.getByTestId('gym-group-dumbbells').getByRole('checkbox', { checked: true })).toHaveCount(0);
    const final = await read();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByTestId('muscle-growth-equipment-review')).toContainText('Hammer curls');
    expect(final.activities).toEqual(before.activities);
    expect(final.exercise.muscleGrowth).toEqual(before.exercise.muscleGrowth);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!).exerciseLogs)).toEqual([pastLog]);
  });
}

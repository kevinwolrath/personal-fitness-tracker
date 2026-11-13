import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MONDAY, closeWorkoutSheet, leaveSettings, openAt, openPreferences, openWorkoutSheet, seedPlan, seedWithStrengthWindow, workoutSheet } from './helpers';

/** ☰ → Settings → App preferences (#174). */
const settings = openPreferences;
async function coverage(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByTestId('menu-coverage').click();
  await expect(page.getByTestId('muscle-detail')).toBeVisible();
}
const tracking = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));

test('Hero Forge is the default; Classic selection persists and changes no tracking data', async ({ page }) => {
  await openAt(page, MONDAY);
  await expect(page.getByTestId('app-name')).toHaveText('Body Anvil');
  await expect(page.getByTestId('day-scroll')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const before = await tracking(page);
  await settings(page);
  await expect(page.getByRole('radio', { name: 'Hero Forge · Theme 01' })).toBeChecked();
  await page.getByRole('radio', { name: 'Classic light' }).click();
  await leaveSettings(page);
  await expect(page.getByTestId('phone-frame')).toHaveCSS('background-color', 'rgb(245, 242, 235)');
  await page.reload();
  await settings(page);
  await expect(page.getByRole('radio', { name: 'Classic light' })).toBeChecked();
  await page.getByRole('radio', { name: 'Hero Forge · Theme 01' }).click();
  await leaveSettings(page);
  await expect(page.getByTestId('phone-frame')).toHaveCSS('background-color', 'rgb(16, 21, 25)');
  expect(await tracking(page)).toEqual(before);
});

test('coverage reports, clears and logs an eligible exercise exactly once, surviving reload', async ({ page }) => {
  await openAt(page, MONDAY);
  await coverage(page);
  await expect(page.locator('[data-testid^="select-muscle-"]')).toHaveCount(14);
  await expect(page.getByTestId('muscle-detail')).toContainText('Not enough history');
  // #75: the Reports view only shows reports; its legend doesn't name priority outlines.
  await page.getByRole('radio', { name: /^Reports/ }).click();
  await expect(page.getByTestId('reports-empty')).toBeVisible();
  await expect(page.getByTestId('coverage-sheet').getByTestId('muscle-map-art')).not.toContainText('Outline');
  await page.getByRole('button', { name: 'Report sore', exact: true }).click();
  await expect(page.getByTestId('muscle-detail')).toContainText('≋ Sore');
  await expect(page.getByTestId('coverage-sheet').getByTestId('muscle-front-chest')).toHaveAttribute('fill', /sore/);
  await page.getByRole('button', { name: 'Report injured', exact: true }).click();
  await expect(page.getByTestId('muscle-detail')).toContainText('! Injured');
  await expect(page.getByTestId('coverage-sheet').getByTestId('muscle-front-chest')).toHaveAttribute('fill', /injured/);
  await expect(page.getByTestId('reports-empty')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Priority', exact: true }).click();
  await expect(page.getByTestId('coverage-sheet').getByTestId('muscle-map-art')).toContainText('◇ Outline: below this week’s target');
  await page.getByRole('button', { name: 'Clear report', exact: true }).click();
  await expect(page.getByTestId('muscle-detail')).not.toContainText('Injured');
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Goblet squat', exact: true }).click();
  await expect(page.getByTestId('coverage-sheet')).toContainText('Primary: Quadriceps, Glutes');
  await expect(page.getByTestId('coverage-sheet').getByTestId('muscle-front-quadriceps')).toHaveAttribute('fill', '#78C9DF');
  await expect(page.getByTestId('coverage-sheet').getByTestId('muscle-front-core')).toHaveAttribute('stroke-dasharray', '12 8');
  await page.getByLabel('Sets or rounds').fill('2');
  await page.getByLabel('Reps per set', { exact: true }).fill('8');
  // Two physical taps cannot submit the same form twice.
  await page.getByRole('button', { name: 'Save exercise log', exact: true }).dblclick();
  await expect.poll(async () => (await tracking(page)).exerciseLogs.length).toBe(1);
  await page.getByRole('button', { name: 'Close coverage', exact: true }).click();
  await page.reload();
  await coverage(page);
  await page.getByTestId('select-muscle-quadriceps').click();
  await expect(page.getByTestId('muscle-detail')).toContainText('2 / 6 effective sets');
  expect((await tracking(page)).exerciseLogs).toHaveLength(1);
});

for (const gender of ['male', 'female', 'other'] as const) test(`saved profile ${gender} selects matching real artwork and timed inventory`, async ({ page }) => {
  await seedPlan(page, { ...seedWithStrengthWindow(), profile: { gender }, exercise: { equipment: [] } });
  await openAt(page, MONDAY);
  await coverage(page);
  const art = page.getByTestId('coverage-sheet').getByTestId('muscle-map-art');
  await expect(art.locator('image').first()).toHaveAttribute('href', new RegExp(`${gender === 'other' ? 'neutral' : gender}-front`));
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose Chest press machine', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose One-arm kettlebell row', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose Plank', exact: true }).click();
  await expect(page.getByLabel('Seconds per round or set')).toHaveValue('20');
  await expect(page.getByRole('radio', { name: 'Seconds', exact: true })).toBeChecked();
});

test('actual app before/after captures: Today, Progress, Workout and Coverage', async ({ page }) => {
  await seedPlan(page, { ...seedWithStrengthWindow(), profile: { gender: 'female' } });
  await openAt(page, MONDAY);
  const width = page.viewportSize()!.width;
  const dir = 'docs/design/hero-forge-app/screenshots';
  mkdirSync(dir, { recursive: true });
  for (const theme of ['classic', 'hero-forge'] as const) {
    await settings(page);
    await page.getByTestId(`theme-${theme}`).click();
    await leaveSettings(page);
    await page.getByTestId('day-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${dir}/${width}-${theme}-today.png` });
    await page.getByRole('tab', { name: 'Progress' }).click();
    await expect(page.getByTestId('progress-summary')).toBeVisible();
    await page.screenshot({ path: `${dir}/${width}-${theme}-progress.png` });
    await page.getByRole('tab', { name: 'Today' }).click();
    await openWorkoutSheet(page); // Today's workout (#56)
    await page.screenshot({ path: `${dir}/${width}-${theme}-workout.png` });
    await workoutSheet(page).getByRole('button', { name: 'Muscle coverage. Open the full view' }).click();
    await expect(page.getByTestId('muscle-detail')).toBeVisible();
    await page.screenshot({ path: `${dir}/${width}-${theme}-coverage.png` });
    const art = page.getByTestId('coverage-sheet').getByTestId('muscle-map-art');
    await expect(art.locator('image')).toHaveCount(2);
    const loaded = await art.locator('image').evaluateAll(async nodes => Promise.all(nodes.map(n => new Promise<boolean>(resolve => {
      const im = new Image(); im.onload = () => resolve(im.naturalWidth === 1024); im.onerror = () => resolve(false); im.src = n.getAttribute('href')!;
    }))));
    expect(loaded).toEqual([true, true]);
    await page.getByRole('button', { name: 'Close coverage', exact: true }).click();
    await closeWorkoutSheet(page);
  }
});

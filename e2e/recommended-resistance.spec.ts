import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import seed from '../plans/seed.plan.json';
import { openAt, seedPlan, seedRecords, MONDAY, expandToFullDay } from './helpers';

const plan = { ...seed, formatVersion: 8, activities: seed.activities.filter(a => !a.session), exercise: { ...seed.exercise, equipment: [{ type: 'dumbbells' }, { type: 'resistance_bands' }], muscleGrowth: { enabled: true, targets: ['biceps'], exercises: [{ movement: 'hammer_curl', sets: 2, reps: 12 }] } } };
const logs = [
  { id: 'old', movement: 'hammer_curl', date: '2026-10-20', at: '2026-10-20T09:00:00+11:00', sets: 2, reps: 10, seconds: null, intensity: null },
  { id: 'recent', movement: 'standing_calf_raise', date: '2026-10-29', at: '2026-10-29T09:00:00+11:00', sets: 2, reps: 15, seconds: null, intensity: null },
];

test('#157 A: history reason, compatible illustrated choices, guide, canonical optional logging, retry-safe identity and Undo', async ({ page }, info) => {
  await seedPlan(page, plan);
  await seedRecords(page, { exerciseLogs: logs });
  await openAt(page, MONDAY);
  const card = page.getByTestId('recommended-resistance');
  await expect(card.getByTestId('recommended-muscle')).toContainText('Chest');
  if (info.project.name === 'phone') {
    mkdirSync('docs/design/issue-157/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/design/issue-157/screenshots/today-first-screen.png' });
  }
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText('0 recorded effective sets');
  await expect(page.getByTestId('muscle-growth')).toBeVisible();
  const progress = await page.getByTestId('day-progress').textContent();
  if (info.project.name === 'phone') {
    mkdirSync('docs/design/issue-157/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/design/issue-157/screenshots/collapsed.png' });
    await expect(page).toHaveScreenshot('recommended-resistance-collapsed.png');
  }
  await card.getByRole('button', { name: /^Recommended Resistance Training\. Chest\. Optional\./ }).click();
  await expect(card.getByTestId('recommended-exercises')).toBeVisible();
  await expect(card.getByTestId('recommendation-row-hammer_curl')).toHaveCount(0);
  await expect(card.getByTestId('recommendation-row-chest_press')).toHaveCount(0); // unconfirmed station
  const first = card.locator('[data-testid^="recommendation-row-"]').first();
  const movement = (await first.getAttribute('data-testid'))!.replace('recommendation-row-', '');
  await expect(first.locator('img')).toBeVisible();
  if (info.project.name === 'phone') {
    await page.screenshot({ path: 'docs/design/issue-157/screenshots/expanded.png' });
    await expect(page).toHaveScreenshot('recommended-resistance-expanded.png');
  }
  await first.getByRole('button', { name: /Show how/ }).click();
  await expect(page.getByTestId('guide-image-1')).toBeVisible();
  await page.getByRole('button', { name: 'Close guide', exact: true }).click();
  await first.getByRole('button', { name: /^Log optional/ }).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
  await expect.poll(async () => (await read()).exerciseLogs.filter((l: any) => l.date === '2026-11-02' && l.movement === movement).length).toBe(1);
  await expect(page.getByTestId('day-progress')).toHaveText(progress!);
  const saved = await read();
  expect(JSON.parse(saved.plan.json)).toEqual(plan);
  expect(saved.exerciseLogs.find((l: any) => l.movement === movement && l.date === '2026-11-02').id).toBe(`tap-2026-11-02-${movement}`);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await read()).exerciseLogs.length).toBe(2);
  await expect(card.getByTestId('recommended-muscle')).toContainText('Chest');
  await first.getByRole('button', { name: /^Log optional/ }).click();
  await page.reload();
  await expect.poll(async () => (await read()).exerciseLogs.length).toBe(3);
  expect((await read()).activities ?? {}).toEqual({});
  if (info.project.name === 'phone') {
    await expandToFullDay(page);
    await page.screenshot({ path: 'docs/design/issue-157/screenshots/today-full.png' });
  }
  await page.goto('/?date=2026-11-01');
  await expect(card).toHaveCount(0); // recommendation is about today only
});

test('#157 insufficient history and rest days stay neutral, without mandatory or log controls', async ({ page }) => {
  await openAt(page, MONDAY);
  const card = page.getByTestId('recommended-resistance');
  await expect(card).toContainText('More recorded training history');
  await expect(card.getByTestId('recommended-muscle')).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+11:00'));
  await page.reload();
  await expect(card).toContainText('Rest day');
  await expect(card.getByRole('button', { name: /^Log optional/ })).toHaveCount(0);
});

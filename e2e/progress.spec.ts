import { expect, test, type Page } from '@playwright/test';
import { seedRecords } from './helpers';

/** #52 first PR: the Progress tab with measurement and weight-trend charts. Friday 6 Nov, 60 days of history. */

const TODAY = '2026-11-06';
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const src = { type: 'manual', app: null, capturedAt: null, confidence: null, importId: null, assetId: null, evidence: null, edited: false };
const observations = [
  ...Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, date: day(-59 + i), metric: 'weight', value: Math.round((100 - 0.05 * i + (i % 2 ? 0.2 : -0.2)) * 10) / 10, unit: 'kg', kind: 'observed', label: null, note: null, source: src, recordedAt: `${day(-59 + i)}T07:00:00Z` })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, date: day(-58 + i * 7), metric: 'waist', value: 105 - 0.4 * i, unit: 'cm', kind: 'observed', label: null, note: null, source: src, recordedAt: `${day(-58 + i * 7)}T07:00:00Z` })),
];

async function openProgress(page: Page) {
  await seedRecords(page, { observations });
  await page.clock.setFixedTime(new Date(`${TODAY}T09:00:00+11:00`));
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
}

test('Today and Progress tabs; Progress shows weight, waist and trend charts from the recorded history', async ({ page }) => {
  await openProgress(page);
  await expect(page.getByTestId('tab-progress')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('range-30d')).toBeChecked();
  await expect(page.getByTestId('chart-weight')).toContainText(/9\d\.\d kg/);
  await expect(page.getByTestId('chart-weight')).toContainText('7-day average');
  await expect(page.getByTestId('chart-waist')).toContainText('cm');
  await expect(page.getByTestId('chart-rate')).toContainText('kg/week');
  await expect(page.getByTestId('chart-goal')).toContainText('Goal: 78.0 kg');
  await expect(page.getByTestId('chart-bmi-empty')).toContainText('Add your height'); // no height in the plan: no BMI
  await expect(page.getByTestId('chart-body-fat-empty')).toBeVisible();

  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Today' }).click();
  await expect(page.getByTestId('day-progress')).toBeVisible();
});

test('tap to inspect shows the date, value and source; the range changes the period', async ({ page }) => {
  await openProgress(page);
  const plot = page.getByTestId('chart-weight-plot');
  const box = (await plot.boundingBox())!;
  await page.mouse.click(box.x + box.width - 6, box.y + 40);
  await expect(page.getByTestId('chart-weight-plot-picked')).toContainText(/6 Nov · \d+\.\d kg · /);
  await page.getByTestId('range-7d').click();
  await expect(page.getByTestId('chart-weight')).toContainText('in 7 days');
});

test('Edit charts: hide and reorder, remembered on this phone', async ({ page }) => {
  await openProgress(page);
  await page.getByTestId('edit-charts').click();
  await page.getByRole('switch', { name: 'Show Waist' }).click();
  await page.getByRole('button', { name: 'Move BMI up' }).click();
  await page.getByRole('button', { name: 'Move BMI up' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('chart-waist')).toHaveCount(0);
  const cards = () => page.locator('[data-testid^="chart-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!).filter((id) => /^chart-[a-z-]+$/.test(id) && !/-(plot|empty|picked)$/.test(id)));
  expect((await cards()).slice(0, 2)).toEqual(['chart-bmi', 'chart-weight']);
  await page.reload();
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('chart-waist')).toHaveCount(0);
});

test('a weigh-in logged on Today appears on Progress', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T09:00:00+11:00`));
  await page.goto('/');
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('chart-weight-empty')).toBeVisible();
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Today' }).click();
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('96.4');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('chart-weight')).toContainText('96.4 kg');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('progress, 30 days', async ({ page }) => {
    await openProgress(page);
    await expect(page.getByTestId('chart-weight-plot')).toBeVisible();
    await expect(page).toHaveScreenshot('progress-30d.png');
  });
});

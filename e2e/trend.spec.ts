import { expect, test, type Page } from '@playwright/test';
import { addDays } from '../src/plan/dates';
import { openAt, seedRecords } from './helpers';

/** #57: Trend card, forecast on the Goal chart, and the weight-trend alert (dot on Progress, one notification). */

const TODAY = '2026-11-06';
const src = { type: 'manual', app: null, capturedAt: null, confidence: null, importId: null, assetId: null, evidence: null, edited: false };
const weigh = (days: number, f: (i: number) => number) =>
  Array.from({ length: days }, (_, i) => {
    const date = addDays(TODAY, -(days - 1) + i);
    return { id: `w${i}`, date, metric: 'weight', value: Math.round(f(i) * 10) / 10, unit: 'kg', kind: 'observed', label: null, note: null, source: src, recordedAt: `${date}T07:00:00Z` };
  });
// Five weeks of steady loss, then five flat weeks.
const plateau = weigh(70, (i) => (i < 35 ? 95 - i * 0.1 : 91.5 + (i % 2 ? 0.3 : -0.3)));
const allowNotifications = (page: Page) => page.addInitScript(() => localStorage.setItem('pft.test.notifications', JSON.stringify({ status: 'granted', scheduled: [] })));
const progress = (page: Page) => page.getByTestId('tab-bar').getByRole('tab', { name: /Progress/ });

test('a plateau shows on Progress with optional steps, a dot on the tab and one notification', async ({ page }) => {
  await seedRecords(page, { observations: plateau });
  await allowNotifications(page);
  await openAt(page, `${TODAY}T09:00:00+11:00`);
  await expect(page.getByTestId('tab-progress-dot')).toBeVisible();
  const notified = () => page.evaluate(() => (window as unknown as { __pftNotified?: { title: string }[] }).__pftNotified ?? []);
  await expect.poll(async () => (await notified()).length).toBe(1);
  expect((await notified())[0].title).toMatch(/flat for \d+ weeks/);

  await progress(page).click();
  await expect(page.getByTestId('progress-trend-title')).toHaveText(/^Flat for \d+ weeks$/);
  await expect(page.getByTestId('progress-trend')).toContainText('isn’t your body refusing');
  await page.getByTestId('progress-trend-steps-toggle').click();
  await expect(page.getByTestId('progress-trend-steps')).toContainText('Nothing changes in your plan unless you change it.');
  await expect(page.getByTestId('chart-goal')).toContainText('Forecast');
  await expect(page.getByTestId('tab-progress-dot')).toHaveCount(0); // seen

  // A reload doesn't alert again for the same finding.
  await page.reload();
  await expect(page.getByTestId('progress-trend')).toBeVisible();
  expect(await notified()).toHaveLength(0); // window state resets; nothing new was sent
  await expect(page.getByTestId('tab-progress-dot')).toHaveCount(0);
});

test('a steady loss: no alert; too few weigh-ins: says so', async ({ page }) => {
  await seedRecords(page, { observations: weigh(42, (i) => 95 - i * 0.07) });
  await openAt(page, `${TODAY}T09:00:00+11:00`);
  await expect(page.getByTestId('tab-progress-dot')).toHaveCount(0);
  await progress(page).click();
  await expect(page.getByTestId('progress-trend-title')).toHaveText('Steady');
});

test('alerts can be turned off in Settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pft.trend.alerts', 'false'));
  await seedRecords(page, { observations: plateau });
  await openAt(page, `${TODAY}T09:00:00+11:00`);
  await expect(page.getByTestId('tab-progress-dot')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import fixture from './fixtures/walking-health-connect.json';
import { MONDAY, openAt } from './helpers';

test('compact walking totals, expansion, provenance and persistent source records', async ({ page }) => {
  await page.addInitScript(f => localStorage.setItem('pft.test.healthConnect', JSON.stringify(f)), fixture);
  await openAt(page, MONDAY);
  const summary = page.getByTestId('recorded-walking-summary');
  await expect(summary).toContainText('1 hr 45 min');
  await expect(summary).toContainText('4.8 km recorded');
  await expect(summary).toContainText('4 records');
  await expect(page.getByTestId('recorded-exercise_session')).toHaveCount(0);
  await expect(page.getByTestId('recorded-health-grid')).toContainText('7 hr 45 min');
  await summary.click();
  const records = page.getByTestId('recorded-exercise_session');
  await expect(records).toHaveCount(4);
  await expect(records.first()).toContainText('45 min · 3 km');
  await expect(records.first()).toContainText('Samsung Health');
  await expect(page.getByText('Overlapping source record', {exact:true})).toBeVisible();
  await records.first().click();
  await expect(page.getByText('Activity time', {exact:true})).toBeVisible();
  await expect(page.getByText('Distance', {exact:true})).toBeVisible();
  await expect(page.getByTestId('observation-input')).toHaveValue('45');
  await page.getByTestId('modal-dismiss').click();
  await summary.click();
  await expect(records).toHaveCount(0);
  await page.reload();
  await expect(summary).toContainText('1 hr 45 min');
});

test('missing distance stays absent, including expanded records', async ({ page }) => {
  await page.addInitScript(f => localStorage.setItem('pft.test.healthConnect', JSON.stringify(f)), { ...fixture, data: { ...fixture.data, distances: [] } });
  await openAt(page, MONDAY);
  const summary = page.getByTestId('recorded-walking-summary');
  await expect(summary).toContainText('1 hr 45 min');
  await expect(summary).not.toContainText(/\bkm\b|\d+ m\b/);
  await summary.click();
  await expect(page.getByTestId('recorded-exercise_session').first()).toContainText('45 min');
  await expect(page.getByTestId('recorded-walking-records')).not.toContainText(/\bkm\b|\d+ m\b/);
});

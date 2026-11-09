import { expect, test, type Page } from '@playwright/test';
import { openAt } from './helpers';

/** #108: weight and waist on every day, with the latest value and the date it was measured. */

const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const waist = (page: Page) => page.getByTestId('measurement-waist');
async function logWaist(page: Page, value: string) {
  await waist(page).click();
  await page.getByTestId('measure-input').fill(value);
  await page.getByRole('button', { name: 'Save' }).click();
}

test('waist is on every day, with Add when there is none, and the latest value carries over with its date', async ({ page }) => {
  for (const day of ['02', '03', '04', '05', '06', '07', '08']) {
    await openAt(page, `2026-11-${day}T09:00:00+11:00`);
    await expect(waist(page)).toContainText('Add waist');
  }
  await openAt(page, '2026-11-03T09:00:00+11:00');
  await logWaist(page, '107');
  await expect(waist(page)).toContainText('107 cm');
  await openAt(page, '2026-11-05T09:00:00+11:00');
  await expect(waist(page)).toContainText('107 cm');
  await expect(page.getByTestId('measurement-waist-detail')).toHaveText('Measured 3 Nov');
});

test('backdating and editing write only that day; weight is untouched', async ({ page }) => {
  await openAt(page, '2026-11-05T09:00:00+11:00');
  await logWaist(page, '108');
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await logWaist(page, '109'); // backdated to 3 Nov
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(waist(page)).toContainText('108 cm'); // the later value is still the latest
  const obs = (await store(page)).observations.filter((o: any) => o.metric === 'waist').map((o: any) => [o.date, o.value]);
  expect(obs.sort()).toEqual([['2026-11-03', 109], ['2026-11-05', 108]]);
  expect((await store(page)).observations.filter((o: any) => o.metric === 'weight')).toEqual([]);
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('chart-waist')).toBeVisible();
});

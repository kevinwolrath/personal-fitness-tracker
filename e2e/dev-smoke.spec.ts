import { expect, test } from '@playwright/test';
import { MONDAY, openAt } from './helpers';

/**
 * Runs against the Metro *development* server (npm run test:e2e:dev), which loads modules differently
 * from the production export (React Refresh, no tree-shaking). It catches dev-only crashes that every
 * production-build test would miss.
 */
test('dev server: app boots without errors, and a measurement can be logged end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await openAt(page, MONDAY);
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('97.3');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('measurement-weight')).toContainText('97.3 kg');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('app-menu')).toBeVisible();

  expect(errors).toEqual([]);
});

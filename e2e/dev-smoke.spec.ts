import { expect, test } from '@playwright/test';
import { presetApiKey, stubClaude } from './claudeStub';
import { MONDAY, importScreenshots, openAt } from './helpers';

/**
 * Runs against the Metro *development* server (npm run test:e2e:dev), which loads modules differently
 * from the production export (React Refresh, no tree-shaking). It catches dev-only crashes such as the
 * SDK import-cycle error that every production-build test missed.
 */
test('dev server: app boots without errors and screenshot import works end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await presetApiKey(page);
  const requests = await stubClaude(page);
  await openAt(page, MONDAY);

  await importScreenshots(page, ['e2e/fixtures/scale.png']);
  await page.getByRole('button', { name: 'Read 1 screenshot' }).click();
  await expect(page.getByTestId('review-scale.png')).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Save 2 values' }).click();
  await expect(page.getByTestId('measurement-weight')).toContainText('97.3 kg');

  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MONDAY, chooseFromMenu, openAt, seedRecords } from './helpers';

/**
 * Export all data, including records from the removed screenshot import (#138): historical imports, their sessions
 * and provenance are kept, exported and shown exactly as before.
 */
const SCREENSHOT = { type: 'screenshot', app: 'renpho', capturedAt: '2026-11-02T07:10:00+11:00', importId: 'imp', assetId: 'a', edited: false };
const historicalImport = {
  observations: [
    { id: 'w', date: '2026-11-02', metric: 'weight', value: 97.25, unit: 'kg', kind: 'observed', label: null, note: null, recordedAt: '2026-11-02T07:15:00+11:00', source: { ...SCREENSHOT, confidence: 0.95, evidence: '97.25 kg' } },
    { id: 'c', date: '2026-11-02', metric: 'weight', value: 99.8, unit: 'kg', kind: 'inferred', label: null, note: null, recordedAt: '2026-11-02T07:15:00+11:00', source: { ...SCREENSHOT, confidence: 0.7, evidence: '97.25 + 2.55' } },
  ],
  imports: [{ id: 'imp', createdAt: '2026-11-02T07:15:00+11:00', extractor: 'anthropic:claude-opus-5-5', assets: [{ id: 'a', fileName: 'scale.png', mimeType: 'image/png', capturedAt: '2026-11-02T07:10:00+11:00', storedUri: null, sourceApp: 'renpho' }] }],
};

test('export all data downloads a versioned full-history JSON with provenance, historical screenshot imports included', async ({ page }) => {
  await seedRecords(page, historicalImport);
  await openAt(page, MONDAY);

  // History: an older manual weight and today's activity, alongside the historical import.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('98.4');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByTestId('activity-lunch').getByRole('checkbox').click();

  await chooseFromMenu(page, 'Export all data');
  const download = page.waitForEvent('download');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Export JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('fitness-export-2026-11-02.json');
  const doc = JSON.parse(readFileSync((await file.path())!, 'utf8'));

  expect(doc).toMatchObject({ format: 'pft-export', exportVersion: 1, range: { from: '2026-10-31', to: '2026-11-02' } });
  expect(doc.plans[0].plan.goals[0]).toMatchObject({ measurementId: 'weight', target: 78 });
  expect(doc.activityLogs).toEqual([expect.objectContaining({ date: '2026-11-02', activityId: 'lunch', status: 'done' })]);
  const kinds = doc.observations.map((o: any) => [o.date, o.metric, o.value, o.kind, o.source.type, o.source.app]);
  expect(kinds).toEqual(
    expect.arrayContaining([
      ['2026-10-31', 'weight', 98.4, 'observed', 'manual', null],
      ['2026-11-02', 'weight', 97.25, 'observed', 'screenshot', 'renpho'],
      ['2026-11-02', 'weight', 99.8, 'inferred', 'screenshot', 'renpho'],
    ]),
  );
  expect(doc.observations.every((o: any) => o.recordedAt && o.source)).toBe(true);
  expect(doc.imports).toEqual(historicalImport.imports);

  // Today still shows the measured historical weight, never the calculated one, with its source.
  await expect(page.getByTestId('measurement-weight')).toContainText('97.3 kg');
});

test('#138: no screenshot import anywhere: no menu item, and /import is not a route', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
  await expect(page.getByTestId('app-menu')).not.toContainText(/screenshot/i);
  await expect(page.getByTestId('menu-import')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser', { timeout: 1000 }).catch(() => null);
  await page.getByTestId('app-menu').getByRole('button').first().click();
  expect(await chooser).toBeNull(); // the first item no longer opens an image picker
});

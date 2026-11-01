import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { presetApiKey, stubClaude } from './claudeStub';
import { MONDAY, exportAllData, importScreenshots, openAt } from './helpers';

const fixture = (name: string) => `e2e/fixtures/${name}`;

const pick = (page: import('@playwright/test').Page, files: string[]) => importScreenshots(page, files.map(fixture));

test.describe('screenshot import', () => {
  test('asks for an API key, keeping the chosen screenshots, and stores it on the device', async ({ page }) => {
    await openAt(page, MONDAY);
    await pick(page, ['scale.png']);
    await expect(page.getByText('Connect screenshot reading')).toBeVisible();
    await page.getByLabel('Anthropic API key').fill('sk-ant-test-key');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.getByRole('button', { name: 'Read 1 screenshot' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('pft.anthropic.apiKey'))).toBe('sk-ant-test-key');
  });

  test('multiple screenshots from two apps → review, edit, remove → saved with provenance', async ({ page }) => {
    await presetApiKey(page);
    const requests = await stubClaude(page);
    await openAt(page, MONDAY);
    await pick(page, ['fitbit-today.png', 'scale.png']);
    await page.getByRole('button', { name: 'Read 2 screenshots' }).click();

    // One request per screenshot, through the real SDK, with the image and the expected options.
    await expect(page.getByTestId('review-fitbit-today.png')).toBeVisible();
    await expect(page.getByTestId('review-scale.png')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(requests[0].body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(requests[0].headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(requests[0].headers.authorization).toBe('Bearer sk-ant-test-key'); // SDK 1.x sends API keys as Bearer
    expect(requests[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const fitbit = page.getByTestId('review-fitbit-today.png');
    const scale = page.getByTestId('review-scale.png');
    await expect(fitbit).toContainText('fitbit');
    await expect(scale).toContainText('renpho');
    // Values read like the Daily Log, and stay editable (#21).
    await expect(fitbit.getByLabel('Sleep value')).toHaveValue('7h 45m');
    await expect(fitbit.getByLabel('Steps value')).toHaveValue('13,765');
    await expect(fitbit).toContainText('check this'); // low-confidence readiness

    // The calculated starting weight is shown separately and excluded by default.
    await expect(scale).toContainText('not shown on screen');
    await expect(scale.getByRole('checkbox', { name: 'Include Weight (calculated)' })).not.toBeChecked();
    await expect(scale.getByRole('checkbox', { name: 'Include Weight', exact: true })).toBeChecked();

    // Edit one value, remove another.
    await fitbit.getByLabel('Steps value').fill('13800');
    await fitbit.getByLabel('Sleep value').fill('7h 50m'); // durations are edited as written
    await fitbit.getByRole('checkbox', { name: 'Include Sleep score' }).click();

    await page.getByRole('button', { name: 'Save 5 values' }).click();

    // Back on Today: the imported weight is today's weight, with its source.
    await expect(page.getByTestId('measurement-weight')).toContainText('97.3 kg');
    await expect(page.getByTestId('measurement-weight')).toContainText('Renpho screenshot');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
    const byMetric = Object.fromEntries(stored.observations.map((o: any) => [o.metric, o]));
    expect(Object.keys(byMetric).sort()).toEqual(['readiness_score', 'sleep_duration', 'steps', 'weight', 'weight_change']);
    expect(byMetric.steps).toMatchObject({ value: 13800, date: '2026-11-02', kind: 'observed', source: { type: 'screenshot', app: 'fitbit', evidence: '13,765', edited: true, confidence: 0.98 } });
    expect(byMetric.sleep_duration).toMatchObject({ value: 470, unit: 'min', source: { edited: true } });
    expect(byMetric.weight).toMatchObject({ value: 97.25, unit: 'kg', source: { app: 'renpho', edited: false } });
    expect(stored.imports).toHaveLength(1);
    expect(stored.imports[0]).toMatchObject({ extractor: 'anthropic:claude-opus-5-5' });
    expect(stored.imports[0].assets.map((a: any) => [a.fileName, a.sourceApp])).toEqual([
      ['fitbit-today.png', 'fitbit'],
      ['scale.png', 'renpho'],
    ]);
  });

  test('screenshot date can be changed before saving', async ({ page }) => {
    await presetApiKey(page);
    await stubClaude(page);
    await openAt(page, MONDAY);
    await pick(page, ['scale.png']);
    await page.getByRole('button', { name: 'Read 1 screenshot' }).click();
    await expect(page.getByRole('button', { name: 'renpho: next day' })).toBeDisabled(); // no future dates
    await page.getByRole('button', { name: 'renpho: previous day' }).click();
    await page.getByRole('button', { name: 'Save 2 values' }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
    expect(stored.observations.map((o: any) => o.date)).toEqual(['2026-11-01', '2026-11-01']);
  });

  test('a failed extraction is reported on that screenshot and can be retried', async ({ page }) => {
    await presetApiKey(page);
    let calls = 0;
    await page.route('https://api.anthropic.com/**', (route) => {
      calls++;
      return route.fulfill({
        status: 401,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
      });
    });
    await openAt(page, MONDAY);
    await pick(page, ['scale.png']);
    await page.getByRole('button', { name: 'Read 1 screenshot' }).click();
    await expect(page.getByText('The API key was rejected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read 1 screenshot' })).toBeVisible(); // retry offered
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

test('export all data downloads a versioned full-history JSON with provenance', async ({ page }) => {
  await presetApiKey(page);
  await stubClaude(page);
  await openAt(page, MONDAY);

  // History: an older manual weight, today's activity, and a screenshot import.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('98.4');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByTestId('activity-lunch').getByRole('checkbox').click();
  await pick(page, ['scale.png']);
  await page.getByRole('button', { name: 'Read 1 screenshot' }).click();
  await page.getByRole('checkbox', { name: 'Include Weight (calculated)' }).click(); // user explicitly keeps the calculation
  await page.getByRole('button', { name: 'Save 3 values' }).click();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('app-menu').getByRole('button', { name: 'Export all data' }).click();
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
      ['2026-11-02', 'weight_change', -2.55, 'observed', 'screenshot', 'renpho'],
    ]),
  );
  expect(doc.observations.every((o: any) => o.recordedAt && o.source)).toBe(true);
  expect(doc.imports[0].assets[0]).toMatchObject({ fileName: 'scale.png', sourceApp: 'renpho' });

  // Today still shows the measured weight, never the calculated one.
  await expect(page.getByTestId('measurement-weight')).toContainText('97.3 kg');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('import-review', async ({ page }) => {
    await presetApiKey(page);
    await stubClaude(page);
    await openAt(page, MONDAY);
    await pick(page, ['fitbit-today.png', 'scale.png']);
    await page.getByRole('button', { name: 'Read 2 screenshots' }).click();
    await expect(page.getByTestId('review-scale.png')).toBeVisible();
    const height = await page.getByTestId('import-scroll').evaluate((el) => {
      const s = el as HTMLElement;
      return Math.ceil(window.innerHeight - s.clientHeight + s.scrollHeight);
    });
    await page.setViewportSize({ width: 390, height });
    await expect(page).toHaveScreenshot('import-review-full.png');
  });
});

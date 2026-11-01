import { expect, test, type Page } from '@playwright/test';
import { presetApiKey, stubClaude } from './claudeStub';
import { MONDAY, chooseFromMenu, exportAllData, openAt, seedRecords } from './helpers';

/** Issue #15: the Daily Log is about the day; import, configuration and export are one level down in the menu. */

const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const countDownloads = (page: Page) => {
  const seen = { n: 0 };
  page.on('download', () => seen.n++);
  return seen;
};

test("the Daily Log has no I'm hungry action or history, and no app-level links", async ({ page }) => {
  // A hunger entry recorded before #15 stays in storage (and the export), but isn't shown.
  await seedRecords(page, { quickLogs: [{ id: 'q1', planId: 'weight-loss-v1', quickLogId: 'hunger', date: '2026-11-02', at: '2026-11-02T08:30:00+11:00' }] });
  await openAt(page, MONDAY);
  await expect(page.getByRole('button', { name: "I'm hungry" })).toHaveCount(0);
  await expect(page.getByText(/hungry/i)).toHaveCount(0);
  await expect(page.getByTestId('quick-log-summary')).toHaveCount(0);
  for (const name of ['Import from screenshots', 'Configure with AI', 'Export all data']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  const doc = await exportAllData(page);
  expect(doc.quickLogs).toHaveLength(1);
});

test('the header menu holds import, configure and export, and closes cleanly', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByTestId('app-menu');
  await expect(menu.getByRole('button')).toHaveText([/Import from screenshots/, /Configure with AI/, /Export all data/]);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('next-action')).toBeVisible();
});

test('import opens the image picker directly (images, multi-select); cancel changes nothing', async ({ page }) => {
  await openAt(page, MONDAY);
  const before = await store(page);
  const chooser = page.waitForEvent('filechooser');
  await chooseFromMenu(page, 'Import from screenshots');
  const fc = await chooser; // straight from the menu tap: no in-app "select screenshots" step
  expect(fc.isMultiple()).toBe(true);
  const accept = (await fc.element().getAttribute('accept'))!.split(',').filter(Boolean);
  expect(accept.length).toBeGreaterThan(0);
  expect(accept.every((t) => t.startsWith('image/'))).toBe(true); // images only

  await fc.element().dispatchEvent('cancel');
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: 'Import screenshots' })).toHaveCount(0);
  await expect(page.getByTestId('app-menu')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$|\/\?/);
  expect(await store(page)).toEqual(before);
});

test('selected screenshots go straight to review, dated from the open day', async ({ page }) => {
  await presetApiKey(page);
  await stubClaude(page);
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Previous day' }).click(); // Sun 1 Nov

  const chooser = page.waitForEvent('filechooser');
  await chooseFromMenu(page, 'Import from screenshots');
  await (await chooser).setFiles(['e2e/fixtures/fitbit-today.png', 'e2e/fixtures/scale.png']);
  await expect(page.getByRole('heading', { name: 'Import screenshots' })).toBeVisible();
  await page.getByRole('button', { name: 'Read 2 screenshots' }).click(); // both selections arrived
  await expect(page.getByTestId('review-scale.png')).toBeVisible();
  await page.getByRole('button', { name: /^Save \d+ values$/ }).click();

  await expect(page.getByTestId('day-title')).toHaveText('Yesterday');
  const scale = (await store(page)).observations.filter((o: any) => o.source.app === 'renpho');
  expect(scale.length).toBeGreaterThan(0);
  expect(scale.every((o: any) => o.date === '2026-11-01')).toBe(true);
});

test('configure opens the existing configuration flow', async ({ page }) => {
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Configure with AI');
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
});

test('export asks first; Cancel (or Escape) exports nothing, Export JSON downloads the full export', async ({ page }) => {
  await openAt(page, MONDAY);
  const downloads = countDownloads(page);

  await chooseFromMenu(page, 'Export all data');
  const dialog = page.getByRole('alertdialog', { name: 'Export all fitness data?' });
  await expect(dialog).toContainText('This creates a JSON file containing your complete fitness-tracker history, configuration and recorded observations.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await chooseFromMenu(page, 'Export all data');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(downloads.n).toBe(0);

  const doc = await exportAllData(page);
  expect(doc).toMatchObject({ format: 'pft-export', exportVersion: 1 });
  expect(downloads.n).toBe(1);
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('app-menu', async ({ page }) => {
    await openAt(page, MONDAY);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByTestId('app-menu')).toBeVisible();
    await expect(page).toHaveScreenshot('app-menu.png');
  });
  test('export-confirm', async ({ page }) => {
    await openAt(page, MONDAY);
    await chooseFromMenu(page, 'Export all data');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page).toHaveScreenshot('export-confirm.png');
  });
});

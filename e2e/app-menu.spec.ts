import { expect, test, type Page } from '@playwright/test';
import { MONDAY, chooseFromMenu, exportAllData, leaveSettings, openAt, seedRecords } from './helpers';

/** Issue #15: the Daily Log is about the day; configuration and export are one level down in the menu (#138: no import). */

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
  for (const name of ['Import from screenshots', 'Configure with AI', 'Export all data']) { // import: gone everywhere (#138)
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  const doc = await exportAllData(page);
  expect(doc.quickLogs).toHaveLength(1);
});

test('the header menu is grouped: Training, Sync & Share, then Settings (#174); it closes cleanly', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByTestId('app-menu');
  await expect(menu.getByRole('button')).toHaveText([/Muscle Growth/, /Muscle coverage & exercise log/, /Health data sync/, /Health Connect/, /Settings/]);
  await expect(menu.getByRole('heading')).toHaveText(['Training', 'Sync & Share']);
  // Today and Progress are tabs, not menu items.
  await expect(menu.getByRole('button', { name: /^(Today|Progress)$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('next-action')).toBeVisible();
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

  await page.getByRole('button', { name: 'Export all data', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await leaveSettings(page);
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

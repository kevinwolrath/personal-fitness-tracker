import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MONDAY, openAt, openSettings } from './helpers';

/**
 * #174: the ☰ menu holds Training and Sync & Share; Settings is a page with five sections. Every one of the twelve
 * destinations the flat menu had is still reachable, and back (the header's, or the browser's, standing in for
 * Android's) goes up one level at a time.
 */

const menu = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true });
const dialog = (page: Page) => page.locator('[role="dialog"]').last();
const closeSheet = (page: Page) => dialog(page).getByTestId('modal-dismiss').last().click();
const back = (page: Page, from: string) => page.getByRole('button', { name: `Back from ${from}`, exact: true }).click();
async function fromMenu(page: Page, label: string, shows: Locator) {
  await menu(page).click();
  await page.getByTestId('app-menu').getByRole('button', { name: label, exact: true }).click();
  await expect(shows).toBeVisible();
  await closeSheet(page);
  await expect(page.getByTestId('day-progress')).toBeVisible();
}

test('the menu is short and grouped; every former menu destination is reachable', async ({ page }) => {
  await openAt(page, MONDAY);

  // Training and Sync & Share stay one tap from the menu.
  await fromMenu(page, 'Muscle Growth', page.getByTestId('muscle-growth-editor'));
  await fromMenu(page, 'Muscle coverage & exercise log', page.getByTestId('coverage-sheet'));
  await fromMenu(page, 'Health data sync', page.getByTestId('health-sync-share-everything'));
  await fromMenu(page, 'Health Connect', page.getByTestId('health-connect-sheet'));

  // Settings: five sections.
  await openSettings(page);
  await expect(page.getByTestId('settings-screen').getByRole('button')).toHaveText([/^Back$/, /Plan & goals/, /My Gym/, /Reminders/, /App preferences/, /Data management/]);

  await page.getByTestId('settings-plan').click();
  await expect(page.getByTestId('plan-summary')).toContainText('Energy: ≤ 7,530 kJ');
  await page.getByRole('button', { name: 'Configure with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('settings-plan-screen')).toBeVisible(); // back where it was opened
  await page.getByRole('button', { name: 'Edit setup answers', exact: true }).click();
  await expect(page.getByTestId('setup-about')).toBeVisible();
  await page.goBack(); // browser back, as Android's back button
  await expect(page.getByTestId('settings-plan-screen')).toBeVisible();
  await back(page, 'Plan & goals');

  await page.getByTestId('settings-my-gym').click();
  await expect(page.getByTestId('my-gym')).toBeVisible();
  await closeSheet(page);
  await page.getByTestId('settings-reminders').click();
  await expect(page.getByTestId('reminders-sheet')).toBeVisible();
  await closeSheet(page);
  await expect(page.getByTestId('settings-screen')).toBeVisible(); // a sheet closes back to its page

  await page.getByTestId('settings-preferences').click();
  await expect(page.getByRole('radio', { name: 'Kilojoules (kJ)' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Gamification' })).toBeVisible();
  await back(page, 'App preferences');

  await page.getByTestId('settings-data').click();
  await page.getByTestId('settings-backup').click();
  await expect(page.getByTestId('backup-create')).toBeVisible();
  await closeSheet(page);
  await page.getByTestId('settings-restore').click();
  await expect(page.getByTestId('restore-choose')).toBeVisible();
  await closeSheet(page);
  await page.getByTestId('settings-export').click();
  await expect(page.getByRole('alertdialog', { name: 'Export all fitness data?' })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

  // Back, one level at a time: Data management → Settings → Today.
  await back(page, 'Data management');
  await expect(page).toHaveURL(/\/settings$/);
  await back(page, 'Settings');
  await expect(page.getByTestId('day-progress')).toBeVisible();
});

test('browser (Android) back pops one level; a deep link to a subpage backs up to Settings, then Today', async ({ page }) => {
  await openAt(page, MONDAY);
  await openSettings(page);
  await page.getByTestId('settings-preferences').click();
  await expect(page.getByTestId('app-preferences')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('day-progress')).toBeVisible();

  await page.goto('/settings/data');
  await expect(page.getByTestId('settings-data-screen')).toBeVisible();
  await back(page, 'Data management');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await back(page, 'Settings');
  await expect(page.getByTestId('day-progress')).toBeVisible();
});

test.describe('screens', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'review screenshots at the reference phone width'));
  test('menu, Settings and each subpage at 390 px', async ({ page }) => {
    const dir = 'docs/design/issue-174';
    mkdirSync(dir, { recursive: true });
    await openAt(page, MONDAY);
    await menu(page).click();
    await expect(page.getByTestId('app-menu')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/after-menu.png` });
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.screenshot({ path: `${dir}/after-settings.png` });
    for (const [row, screen] of [['settings-plan', 'plan'], ['settings-preferences', 'preferences'], ['settings-data', 'data']] as const) {
      await page.getByTestId(row).click();
      await expect(page.getByTestId(`settings-${screen}-screen`)).toBeVisible();
      await page.screenshot({ path: `${dir}/after-settings-${screen}.png` });
      await page.getByRole('button', { name: /^Back from / }).click();
      await expect(page.getByTestId('settings-screen')).toBeVisible();
    }
  });
});

import { expect, test, type Page } from '@playwright/test';
import { MONDAY, openAt, openSettings } from './helpers';

/**
 * #142: sheets scroll their content above the sheet's bottom edge, so the last row can always be fully revealed and
 * tapped: small screens, the normal and large phone, and a very short window (standing in for large font/display
 * scaling, which leaves the same few rows of room).
 */
async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByTestId('app-menu')).toBeVisible();
}

async function lastRowFullyVisible(page: Page) {
  const last = page.getByTestId('app-menu').getByRole('button').last();
  await last.scrollIntoViewIfNeeded();
  const row = (await last.boundingBox())!;
  const scroll = (await page.getByTestId('app-menu-scroll').boundingBox())!;
  const view = page.viewportSize()!;
  // Inside the scroll area (not hidden under the sheet's bottom edge) and inside the window.
  expect(row.y + row.height).toBeLessThanOrEqual(scroll.y + scroll.height + 0.5);
  expect(row.y + row.height).toBeLessThanOrEqual(view.height);
  expect(row.y).toBeGreaterThanOrEqual(scroll.y - 0.5);
  return last;
}

test('the menu scrolls: its last item is fully visible and tappable', async ({ page }) => {
  await openAt(page, MONDAY);
  await openMenu(page);
  const header = page.getByRole('button', { name: 'Close', exact: true });
  const last = await lastRowFullyVisible(page);
  await expect(last).toHaveAccessibleName('Settings');
  await expect(header).toBeVisible(); // the header stays put while the rows scroll
  await last.click();
  await expect(page.getByTestId('app-menu')).toHaveCount(0); // the tap reached the item: the menu closed
});

test.describe('short window (large font or display scaling)', () => {
  test.use({ viewport: { width: 320, height: 480 } });
  test('the menu still scrolls to its last item', async ({ page }) => {
    await openAt(page, MONDAY);
    await openMenu(page);
    const scroll = page.getByTestId('app-menu-scroll');
    const sizes = await scroll.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(sizes.scrollHeight).toBeGreaterThan(sizes.clientHeight); // genuinely scrolls here
    await lastRowFullyVisible(page);
    await page.screenshot({ path: 'docs/design/issue-142/menu-scrolled-320x480.png' });
  });
});

test('short content: the sheet is only as tall as its content (no permanent blank space)', async ({ page }) => {
  await openAt(page, MONDAY);
  await openSettings(page);
  await page.getByTestId('settings-reminders').click();
  const scroll = page.getByTestId('reminders-scroll');
  await expect(scroll).toBeVisible();
  // The scroll area is exactly its content's height: nothing to scroll, no padding stretched below it.
  const sizes = await scroll.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(Math.abs(sizes.scrollHeight - sizes.clientHeight)).toBeLessThanOrEqual(1);
  const dialog = (await page.getByRole('dialog', { name: 'Reminders' }).boundingBox())!;
  expect(dialog.height).toBeLessThan(page.viewportSize()!.height * 0.92);
});

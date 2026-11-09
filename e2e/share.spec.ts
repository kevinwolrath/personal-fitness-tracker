import { expect, test, type Page } from '@playwright/test';
import { MONDAY, openAt, row } from './helpers';

/**
 * #76 Share this day: the date row's Share opens a preview of the exact text; Share hands that same text to the
 * system share sheet (on web: the Web Share API, else the clipboard). Only recorded data for the selected date.
 */

const shareButton = (page: Page) => page.getByTestId('share-day');
const preview = (page: Page) => page.getByTestId('share-preview');

/** Stand in for the browser's share sheet and remember what it was given. */
async function stubWebShare(page: Page) {
  await page.addInitScript(() => {
    (window as any).__shared = [];
    (navigator as any).share = async (data: ShareData) => {
      (window as any).__shared.push(data.text);
    };
  });
}
const shared = (page: Page) => page.evaluate(() => (window as any).__shared as string[]);

test('today: tick, weigh, Share → the preview is accurate, and exactly that text is shared', async ({ page }) => {
  await stubWebShare(page);
  await openAt(page, MONDAY);
  await expect(shareButton(page)).toHaveText('⤴ Share');
  await expect(shareButton(page)).toHaveAccessibleName('Share this day');

  await row(page, 'school-run-am').getByRole('checkbox').click();
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('97.8');
  await page.getByRole('button', { name: 'Save' }).click();

  await shareButton(page).click();
  await expect(page.getByTestId('share-sheet')).toContainText('It includes your weight.');
  const text = (await preview(page).textContent())!;
  expect(text.startsWith('Review my daily fitness activity for weight loss.')).toBe(true);
  expect(text).toContain('Body Anvil — Daily activity — Mon 2 Nov 2026 (Home day)');
  expect(text).toContain('Weight: 97.8 kg (target 78.0 kg)');
  expect(text).toContain('School run (8:30 am) done');
  expect(text).toContain('Strength workout (full): 0 of 5 done');

  await page.getByTestId('share-confirm').click();
  await expect(page.getByTestId('share-sheet')).toHaveCount(0);
  expect(await shared(page)).toEqual([text]);
});

test('Cancel shares nothing', async ({ page }) => {
  await stubWebShare(page);
  await openAt(page, MONDAY);
  await shareButton(page).click();
  await page.getByRole('button', { name: 'Cancel sharing' }).click();
  await expect(page.getByTestId('share-sheet')).toHaveCount(0);
  expect(await shared(page)).toEqual([]);
});

test('no share sheet in the browser: the exact text is copied, and the app says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => delete (navigator as any).share);
  await openAt(page, MONDAY);
  await shareButton(page).click();
  const text = (await preview(page).textContent())!;
  await page.getByTestId('share-confirm').click();
  await expect(page.getByText('Copied. Paste it into ChatGPT, Claude or another app.')).toBeVisible();
  // Windows' system clipboard normalizes line breaks to CRLF; content stays identical.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(text.replace(/\r\n/g, '\n'));
});

test('another date shares that date, labelled correctly; a future date has no Share', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await shareButton(page).click();
  await expect(preview(page)).toContainText('Body Anvil — Daily activity — Sun 1 Nov 2026 (Weekend)');
  await expect(preview(page)).not.toContainText('Mon 2 Nov');
  await page.getByRole('button', { name: 'Cancel sharing' }).click();

  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByRole('button', { name: 'Back to Today' })).toBeVisible();
  await expect(shareButton(page)).toHaveCount(0);
});

test('on the narrowest phones, a past date keeps Share (icon only) without crowding the date', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(shareButton(page)).toHaveText('⤴');
  const date = (await page.getByTestId('date-button').boundingBox())!;
  const today = (await page.getByRole('button', { name: 'Back to Today' }).boundingBox())!;
  expect(date.x + date.width).toBeLessThanOrEqual(today.x); // the date row still fits
});

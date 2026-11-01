import { expect, test } from '@playwright/test';
import { MONDAY, THURSDAY, chooseFromMenu, openAt } from './helpers';

/** Issue #19: layout layers (contract 02): app shell bar → screen header → content, and the vertical budget. */

test('the menu lives in the app bar, above the Daily Log header, and stays put while the day scrolls', async ({ page }) => {
  await openAt(page, MONDAY);
  const bar = page.getByTestId('app-bar');
  const menu = bar.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('day-scroll').getByRole('button', { name: 'Menu' })).toHaveCount(0);

  const barBox = (await bar.boundingBox())!;
  const dateBox = (await page.getByTestId('date-button').boundingBox())!;
  expect(barBox.y).toBe(0);
  expect(dateBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height); // screen header below the shell

  const before = (await menu.boundingBox())!;
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await page.getByTestId('date-button').boundingBox())?.y ?? -1).toBeLessThan(dateBox.y);
  expect(await menu.boundingBox()).toEqual(before);
  await expect(menu).toBeVisible();
});

test('the menu is in the same place on any day', async ({ page }) => {
  await openAt(page, MONDAY);
  const where = async () => page.getByTestId('app-bar').getByRole('button', { name: 'Menu' }).boundingBox();
  const today = await where();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('button', { name: 'Back to Today' })).toBeVisible();
  expect(await where()).toEqual(today);
});

test('vertical budget: "Do this next" starts within 200 px on a 390 × 844 phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const at of [MONDAY, THURSDAY]) {
    await openAt(page, at);
    const card = (await page.getByTestId('next-action').boundingBox())!;
    expect(card.y, at).toBeLessThanOrEqual(200);
  }
});

test('modal routes have their own header, not the app bar', async ({ page }) => {
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Configure with AI');
  const heading = page.getByRole('heading', { name: 'Configure with AI' });
  await expect(heading).toBeVisible();
  const box = (await heading.boundingBox())!;
  expect(box.y).toBeLessThan(60); // the modal's header is at the top: no app bar above it
});

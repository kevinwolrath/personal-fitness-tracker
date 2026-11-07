import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import inventory from '../src/exercises/inventory.json';
import { MONDAY, openAt } from './helpers';

test('all tracked movements load two local hero steps without changing tracking data', async ({ page }, info) => {
  await openAt(page, MONDAY);
  const before = await page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByTestId('menu-coverage').click();
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  for (const exercise of inventory.exercises) {
    await page.getByRole('button', { name: `Choose ${exercise.name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Show exercise guide', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
    const first = page.getByTestId('guide-image-1');
    await expect(first).toBeVisible();
    const bounds = await first.boundingBox();
    expect(bounds!.height).toBeCloseTo(bounds!.width * 3 / 4, 0);
    // React Native Web exposes the native Image as an accessible wrapper plus an img.
    await expect.poll(() => first.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const firstUrl = await first.locator('img').getAttribute('src');
    expect(firstUrl).toContain('/assets/');
    expect(firstUrl).toMatch(/\.jpg/);
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('2 / 2');
    const second = page.getByTestId('guide-image-2');
    await expect.poll(() => second.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await second.locator('img').getAttribute('src')).not.toBe(firstUrl);
    await expect.poll(async () => Math.abs((await second.boundingBox())!.x - (await page.getByTestId('guide-pager').boundingBox())!.x)).toBeLessThan(1);
    if (['kettlebell_squat', 'chest_press', 'lat_pulldown'].includes(exercise.movement)) {
      const dir = 'docs/design/hero-exercises/screenshots';
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${info.project.name}-${exercise.movement}-step-2.png` });
      await page.getByRole('button', { name: 'Previous step', exact: true }).click();
      await expect.poll(async () => Math.abs((await first.boundingBox())!.x - (await page.getByTestId('guide-pager').boundingBox())!.x)).toBeLessThan(1);
      await page.screenshot({ path: `${dir}/${info.project.name}-${exercise.movement}-step-1.png` });
    }
    await page.getByRole('button', { name: 'Close guide', exact: true }).click();
    await page.getByRole('button', { name: 'Back to exercise inventory', exact: true }).click();
  }
  expect(await page.evaluate(() => localStorage.getItem('pft:tracking:v1'))).toBe(before);
});

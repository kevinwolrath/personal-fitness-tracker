import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import seed from '../plans/seed.plan.json';
import { MONDAY, openAt, seedPlan } from './helpers';

const movement = 'supinated_cross_body_dumbbell_curl';
const name = 'Supinated cross-body dumbbell curl';
for (const hero of ['male', 'female', 'neutral']) {
  test(`#151 ${hero}: select, demonstrate both arms, log and persist`, async ({ page }, info) => {
    await seedPlan(page, { ...seed, profile: { gender: hero === 'neutral' ? 'other' : hero } });
    await openAt(page, MONDAY);
    await expect(page.getByTestId('muscle-growth')).toHaveCount(0);
    const before = await page.getByTestId('today-workout-counts').textContent();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByTestId('menu-muscle-growth').click();
    await page.getByTestId('mg-target-biceps').click();
    await page.getByTestId(`mg-option-${movement}`).getByRole('checkbox').click();
    await page.getByTestId('mg-save').click();
    const list = page.getByTestId('muscle-growth-list');
    await expect(list).toContainText(name);
    await list.getByRole('button', { name: /Supinated cross-body dumbbell curl.*Show how/ }).click();
    for (let step = 1; step <= 3; step++) {
      await expect(page.getByTestId('guide-position')).toHaveText(`${step} / 3`);
      const img = page.getByTestId(`guide-image-${step}`).locator('img');
      await expect(img).toHaveAttribute('src', new RegExp(`supinated-cross-body-dumbbell-curl-${hero}-${step}`));
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      await expect.poll(async () => Math.abs((await page.getByTestId(`guide-image-${step}`).boundingBox())!.x - (await page.getByTestId('guide-pager').boundingBox())!.x)).toBeLessThan(1);
      if (info.project.name === 'phone') {
        mkdirSync('docs/design/cross-body-curl/screenshots', { recursive: true });
        await page.screenshot({ path: `docs/design/cross-body-curl/screenshots/${hero}-${step}.png` });
      }
      if (step < 3) await page.getByRole('button', { name: 'Next step', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Close guide', exact: true }).click();
    await list.getByRole('checkbox', { name: new RegExp(name) }).click();
    await page.getByTestId(`muscle-growth-details-${movement}`).click();
    await page.getByTestId('mg-log-load').fill('7');
    await page.getByTestId('mg-log-rir').fill('2');
    await page.getByTestId('mg-log-save').click();
    await page.reload();
    await expect(page.getByTestId('muscle-growth-counts')).toHaveText('1 of 1 done');
    await expect(page.getByTestId(`muscle-growth-details-${movement}`)).toContainText('2 × 12 · 7 kg · 2 in reserve');
    await expect(page.getByTestId('today-workout-counts')).toHaveText(before!);
    const logs = await page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!).exerciseLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ movement, loadKg: 7, sets: 2, reps: 12, routine: 'muscle_growth' });
  });
}

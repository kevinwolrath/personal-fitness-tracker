import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import inventory from '../src/exercises/inventory.json';
import manifest from '../assets/exercises/heroes/manifest.json';
import seed from '../plans/seed.plan.json';
import library from '../src/exercises/library.json';
import { MONDAY, openAt, seedPlan, chooseFromMenu } from './helpers';

const customShrug = { movement: 'kettlebell_shrug', name: 'Kettlebell shrug', kind: 'strength' as const, equipment: ['kettlebell' as const], primary: ['upper_back'], secondary: ['forearms'], defaultDose: { sets: 2, reps: 12 } };

for (const hero of ['male', 'female', 'neutral'] as const) {
  test(`all tracked movements use the ${hero} profile hero without changing tracking data`, async ({ page }, info) => {
    await seedPlan(page, { ...seed, formatVersion: 8, exercise: { ...seed.exercise, customExercises: [customShrug] }, profile: { gender: hero === 'neutral' ? 'other' : hero } });
    await openAt(page, MONDAY);
    const before = await page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByTestId('menu-coverage').click();
    await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
    for (const exercise of [...inventory.exercises, customShrug]) {
      const stepCount = library.exercises.find(entry => entry.id === exercise.movement)!.steps.length;
      await page.getByRole('button', { name: `Choose ${exercise.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Show exercise guide', exact: true }).click();
      await expect(page.getByTestId('guide-position')).toHaveText(`1 / ${stepCount}`);
      const first = page.getByTestId('guide-image-1');
      await expect(first).toBeVisible();
      const bounds = await first.boundingBox();
      expect(bounds!.height).toBeCloseTo(bounds!.width * 3 / 4, 0);
      // React Native Web exposes the native Image as an accessible wrapper plus an img.
      await expect.poll(() => first.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const firstUrl = await first.locator('img').getAttribute('src');
      expect(firstUrl).toContain('/assets/');
      const pose = manifest.find(entry => entry.movement === exercise.movement && entry.step === 1 && entry.hero === hero)!;
      expect(firstUrl).toContain(pose.id);
      await expect(page.getByTestId('guide-artwork-note')).toHaveCount(0);
      if (exercise.movement === 'kettlebell_shrug' && info.project.name === 'phone') {
        mkdirSync('docs/design/issue-153/screenshots', { recursive: true });
        await expect(page.getByTestId('exercise-guide')).toHaveScreenshot(`exercise-kettlebell-shrug-${hero}.png`);
        await page.screenshot({ path: `docs/design/issue-153/screenshots/${hero}-start.png` });
      }
      await page.getByRole('button', { name: 'Next step', exact: true }).click();
      await expect(page.getByTestId('guide-position')).toHaveText(`2 / ${stepCount}`);
      const second = page.getByTestId('guide-image-2');
      await expect.poll(() => second.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(await second.locator('img').getAttribute('src')).not.toBe(firstUrl);
      const secondPose = manifest.find(entry => entry.movement === exercise.movement && entry.step === 2 && entry.hero === hero)!;
      expect(await second.locator('img').getAttribute('src')).toContain(secondPose.id);
      await expect.poll(async () => Math.abs((await second.boundingBox())!.x - (await page.getByTestId('guide-pager').boundingBox())!.x)).toBeLessThan(1);
      if (exercise.movement === 'kettlebell_shrug' && info.project.name === 'phone') {
        await page.screenshot({ path: `docs/design/issue-153/screenshots/${hero}-raised.png` });
      }
      if (exercise.movement === 'kettlebell_squat' && info.project.name === 'phone') {
        const dir = 'docs/design/profile-exercise-heroes/screenshots';
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${hero}-step-2.png` });
        await page.getByRole('button', { name: 'Previous step', exact: true }).click();
        await expect.poll(async () => Math.abs((await first.boundingBox())!.x - (await page.getByTestId('guide-pager').boundingBox())!.x)).toBeLessThan(1);
        await expect(page.getByTestId('exercise-guide')).toHaveScreenshot(`exercise-profile-${hero}.png`);
        await page.screenshot({ path: `${dir}/${hero}-step-1.png` });
      }
      await page.getByRole('button', { name: 'Close guide', exact: true }).click();
      await page.getByRole('button', { name: 'Back to exercise inventory', exact: true }).click();
    }
    expect(await page.evaluate(() => localStorage.getItem('pft:tracking:v1'))).toBe(before);
  });
}

test('saved profile changes replace the guide hero without reloading the app', async ({ page }) => {
  await openAt(page, MONDAY);
  for (const gender of ['male', 'female', 'other', undefined]) {
    await chooseFromMenu(page, 'Edit setup answers');
    if (gender) await page.getByTestId(`gender-${gender}`).click();
    else await page.getByTestId('gender-other').click(); // clear the previous answer
    await page.getByTestId('setup-primary').click();
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByTestId('day-progress')).toBeVisible();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByTestId('menu-coverage').click();
    await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Goblet squat', exact: true }).click();
    await page.getByRole('button', { name: 'Show exercise guide', exact: true }).click();
    const hero = gender === 'male' || gender === 'female' ? gender : 'neutral';
    const pose = manifest.find(entry => entry.movement === 'kettlebell_squat' && entry.step === 1 && entry.hero === hero)!;
    await expect(page.getByTestId('guide-image-1').locator('img')).toHaveAttribute('src', new RegExp(pose.id));
    await page.getByRole('button', { name: 'Close guide', exact: true }).click();
    await page.getByRole('button', { name: 'Back to exercise inventory', exact: true }).click();
    await page.getByTestId('modal-dismiss').filter({ visible: true }).last().click();
  }
});

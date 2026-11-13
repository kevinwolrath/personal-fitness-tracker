import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import seed from '../plans/seed.plan.json';
import manifest from '../assets/exercises/heroes/manifest.json';
import { MONDAY, chooseFromMenu, leaveSettings, openAt, openPreferences, seedPlan } from './helpers';

for (const gender of ['male', 'female', 'other', undefined]) {
  test(`#98 ${gender ?? 'unspecified'}: compact push-up activation, same hero, paging and offline read-only guide`, async ({ page }, info) => {
    await seedPlan(page, { ...seed, profile: { gender }, exercise: { ...seed.exercise, equipment: [] } });
    await openAt(page, MONDAY);
    const before = await page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
    await chooseFromMenu(page, 'Muscle coverage & exercise log');
    await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Push-ups (knuckles)', exact: true }).click();
    await page.getByRole('button', { name: 'Show exercise guide', exact: true }).click();
    const activation = page.getByTestId('guide-activation');
    const hero = gender === 'male' || gender === 'female' ? gender : 'neutral';
    await expect(activation).toBeAttached();
    await expect(activation.locator('image').first()).toHaveAttribute('href', new RegExp(`${hero}-front`));
    const pose = manifest.find(entry => entry.movement === 'knuckle_push_up' && entry.hero === hero && entry.step === 1)!;
    await expect(page.getByTestId('guide-image-1').locator('img')).toHaveAttribute('src', new RegExp(pose.id));
    await expect(activation.getByTestId('muscle-front-chest')).toHaveAttribute('fill', '#78C9DF');
    await expect(activation.getByTestId('muscle-front-core')).toHaveAttribute('stroke-dasharray', '12 8');
    await expect(activation.getByTestId('muscle-front-quadriceps')).toHaveAttribute('fill', 'transparent');
    const maps = await activation.locator('svg').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(maps).toHaveLength(2);
    expect(maps.every(height => height > 100 && height < 180)).toBe(true);
    if (info.project.name === 'phone') {
      mkdirSync('docs/design/issue-98/screenshots', { recursive: true });
      await page.screenshot({ path: `docs/design/issue-98/screenshots/${gender ?? 'unspecified'}-guide.png` });
      await activation.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `docs/design/issue-98/screenshots/${gender ?? 'unspecified'}-activation.png` });
    }
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('2 / 2');
    await expect.poll(() => page.getByTestId('guide-image-2').locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.context().setOffline(true);
    await page.getByRole('button', { name: 'Previous step', exact: true }).click();
    await expect(page.getByTestId('guide-position')).toHaveText('1 / 2');
    await page.getByRole('button', { name: 'Close guide', exact: true }).click();
    await page.context().setOffline(false);
    expect(await page.evaluate(() => localStorage.getItem('pft:tracking:v1'))).toBe(before);
  });
}

test('#98 a custom movement shows its configured muscles and an explicit missing-pose state', async ({ page }) => {
  await seedPlan(page, { ...seed, formatVersion: 8, profile: { gender: 'female' }, exercise: { ...seed.exercise, customExercises: [{ movement: 'custom_hold', name: 'Custom hold', equipment: [], primary: ['core'], secondary: ['shoulders'], defaultDose: { sets: 2, seconds: 30 } }] } });
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Custom hold', exact: true }).click();
  await page.getByRole('button', { name: 'Show exercise guide', exact: true }).click();
  await expect(page.getByTestId('guide-no-image')).toContainText('No illustration');
  await expect(page.getByTestId('guide-primary-muscles')).toHaveText('Primary: Core/abdominals');
  await expect(page.getByTestId('guide-secondary-muscles')).toHaveText('Secondary: Shoulders');
  await expect(page.getByTestId('guide-activation').locator('image').first()).toHaveAttribute('href', /female-front/);
  await expect(page.getByTestId('guide-image-1')).toHaveCount(0);
});

test('#98 compact activation uses the existing Classic theme with readable labels', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'theme capture at the reference phone width');
  await openAt(page, MONDAY);
  await openPreferences(page);
  await page.getByRole('radio', { name: 'Classic light', exact: true }).click();
  await leaveSettings(page);
  await chooseFromMenu(page, 'Muscle coverage & exercise log');
  await page.getByRole('button', { name: 'Log exercise', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Push-ups (knuckles)', exact: true }).click();
  await page.getByRole('button', { name: 'Show exercise guide', exact: true }).click();
  await page.getByTestId('guide-activation').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('guide-primary-muscles')).toHaveCSS('color', 'rgb(28, 27, 24)');
  await page.screenshot({ path: 'docs/design/issue-98/screenshots/classic-activation.png' });
});

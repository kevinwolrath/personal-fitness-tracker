import { expect, test, type Page } from '@playwright/test';
import { chooseFromMenu, MONDAY, openAt } from './helpers';

const data = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const check = async (page: Page, text: string) => {
  await page.getByLabel('AI update').fill(text);
  await page.getByRole('button', { name: 'Check update' }).click();
};
test.beforeEach(async ({ page }) => {
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Configure with AI');
});

test('natural independent units preserve quantities through preview, Apply and Undo', async ({ page }) => {
  const before = await data(page);
  const original = JSON.parse(before.plan.json);
  await check(page, 'use kg for weight and kcal for energy');
  await expect(page.getByTestId('config-preview')).toBeVisible();
  expect((await data(page)).plan.json).toBe(before.plan.json);
  await page.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
  await expect(page.getByTestId('config-history')).toContainText('revision');
  const updated = JSON.parse((await data(page)).plan.json);
  expect(updated.units).toEqual({ mass: 'kg', energy: 'kcal', length: 'cm' });
  expect(updated.nutrition.targets[0].max).toBeCloseTo(original.nutrition.targets[0].max / 4.184);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByTestId('config-history')).toContainText('Undo');
  const undone = JSON.parse((await data(page)).plan.json);
  expect({ ...undone, revision: 0 }).toEqual({ ...original, revision: 0 });
});

test('mixed rice and junk routes to meal review and only Save writes a food log', async ({ page }) => {
  const before = await data(page);
  await check(page, 'add 500 kcal of rice and swim with sharks');
  await expect(page.getByTestId('input-intents')).toContainText('No supported instruction');
  await expect(page.getByTestId('config-preview')).toHaveCount(0);
  expect(await data(page)).toEqual(before);
  if (test.info().project.name === 'phone') await page.screenshot({ path: 'artifacts/input-intents-meal-route.png' });
  await page.getByRole('button', { name: 'Review meal entry' }).click();
  await expect(page.getByTestId('meal-review')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Food 1 name', exact: true })).toHaveValue('rice');
  expect((await data(page)).mealLogs ?? []).toHaveLength(0);
  if (test.info().project.name === 'phone') await page.screenshot({ path: 'artifacts/input-intents-meal-review.png' });
  await page.getByTestId('meal-save').click();
  await expect.poll(async () => (await data(page)).mealLogs?.length).toBe(1);
  const after = await data(page);
  expect(after.plan.json).toBe(before.plan.json);
  expect(after.configChanges).toEqual(before.configChanges);
  expect(after.mealLogs[0].items[0]).toMatchObject({ name: 'rice', energyKj: 2092, quantity: null, proteinG: null });
});

test('junk is ignored and slabs require clarification without a mutation', async ({ page }) => {
  const before = await data(page);
  await check(page, 'jump in the river in your pajamas and swim with sharks');
  await expect(page.getByTestId('input-intents')).toContainText('No supported instruction');
  await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
  await check(page, 'increase my chest press to 7 slabs');
  await expect(page.getByTestId('input-intents')).toContainText('supply their weight');
  expect(await data(page)).toEqual(before);
});

test('applying a configuration leaves a mixed food proposal available, and meal handoff consumes it', async ({ page }) => {
  await check(page, 'use kcal for energy and add rice');
  await expect(page.getByRole('button', { name: 'Review meal entry' })).toBeVisible();
  await page.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
  await expect(page.getByRole('button', { name: 'Review meal entry' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review meal entry' }).click();
  await expect(page.getByTestId('meal-review')).toBeVisible();
  await page.getByTestId('meal-save').click();
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review meal entry' })).toHaveCount(0);
  expect((await data(page)).mealLogs).toHaveLength(1);
  expect(JSON.parse((await data(page)).plan.json).units.energy).toBe('kcal');
});

test('imperfect section casing, field title, equals sign and trailing commas recover into a preview', async ({ page }) => {
  await check(page, 'BODY ANVIL UPDATE v1\n[EXERCISE]\nRest Days = [FRI, SAT,],\nEND UPDATE');
  await expect(page.getByTestId('config-preview')).toContainText('Exercise');
  await expect(page.getByTestId('config-preview')).toContainText('formatting');
});

test('meal review first retains the pending configuration preview', async ({ page }) => {
  await check(page, 'use kcal for energy and add rice');
  await page.getByRole('button', { name: 'Review meal entry' }).click();
  await expect(page.getByTestId('meal-review')).toBeVisible();
  await page.getByTestId('meal-save').click();
  await expect(page.getByTestId('config-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review meal entry' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
  await expect(page.getByTestId('config-history')).toBeVisible();
  const saved = await data(page);
  expect(saved.mealLogs).toHaveLength(1);
  expect(saved.configChanges).toHaveLength(1);
});

test('a new handoff preserves an existing unsaved meal draft', async ({ page }) => {
  await check(page, 'add rice');
  await page.getByRole('button', { name: 'Review meal entry' }).click();
  await expect(page.getByTestId('meal-review')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('pft:meal-draft') ?? 'null')?.items[0]?.name)).toBe('rice');
  await page.goto('/configure');
  await check(page, 'add 1000 kJ of chicken');
  await page.getByRole('button', { name: 'Review meal entry' }).click();
  await expect(page.getByTestId('meal-other-draft')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pft:meal-draft')!).items[0].name)).toBe('rice');
  expect((await data(page)).mealLogs ?? []).toHaveLength(0);
});

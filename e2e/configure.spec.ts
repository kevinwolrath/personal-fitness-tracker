import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import seed from '../plans/seed.plan.json';
import { MONDAY, expandToFullDay, openAt, row, seedPlan, chooseFromMenu, exportAllData } from './helpers';

/** Issue #7: AI-configurable fitness profile with partial, previewed, confirmed updates. */

const fixture = (name: string) => readFileSync(`e2e/../fixtures/config/${name}.update.json`, 'utf8');
const storedPlan = (page: Page) => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('pft:tracking:v1')!).plan.json));
const sectionsOf = (p: any) => ({
  profile: JSON.stringify([p.units, p.profile]),
  goals: JSON.stringify(p.goals),
  nutrition: JSON.stringify([p.nutrition, p.activities.filter((a: any) => a.kind === 'meal')]),
  exercise: JSON.stringify(p.exercise),
  schedule: JSON.stringify([p.dayTypes, p.schedule, p.activities.filter((a: any) => a.kind !== 'meal')]),
  tracking: JSON.stringify([p.measurements, p.quickLogs]),
});

/** Start from the seed before any exercise configuration, so #7 updates show as changes. */
const { exercise: _exercise, ...unconfigured } = seed as any;

async function openConfigure(page: Page) {
  await seedPlan(page, unconfigured);
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Configure with AI');
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
}

/** Preview rows are collapsed to a summary: open one to see every change in it. */
async function openSection(page: Page, section: string) {
  const row = page.getByTestId(`preview-${section}`);
  await row.getByRole('button').first().click();
  return row;
}

const applyButton = (page: Page) => page.getByRole('button', { name: /^Apply \d+ changes?$/ });

async function checkUpdate(page: Page, text: string) {
  await page.getByLabel('AI update').fill(text);
  await page.getByRole('button', { name: 'Check update' }).click();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('copies AI session instructions with the current config and protocol', async ({ page }) => {
  await openConfigure(page);
  await page.getByRole('button', { name: 'Copy AI instructions' }).click();
  await expect(page.getByText('Instructions copied')).toBeVisible(); // step 1 collapses to one line
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Configuration schema version: 1');
  expect(text).toContain('"Fixed lunch"');
  expect(text).toContain('Include ONLY the sections you are changing');
  expect(text).toContain('"fitnessConfigUpdate"');
});

test('exercise-only update: preview, explicit confirm, only exercise changes', async ({ page }) => {
  await openConfigure(page);
  const before = sectionsOf(await storedPlan(page));

  await checkUpdate(page, fixture('real-world-exercise'));
  const preview = page.getByTestId('config-preview');
  await expect(preview).toContainText('What changes');
  const exercise = await openSection(page, 'exercise');
  for (const line of ['Added Fortis home multi-gym', 'Added 16 kg and 24 kg kettlebells', 'Added Heavy bag', 'Added Battle ropes', 'Avoid biceps curl (aggravates elbow)', 'Hammer curl permitted']) {
    await expect(exercise).toContainText(line);
  }
  await expect(page.getByTestId('preview-nutrition')).toHaveCount(0); // only sections that change are listed
  await expect(page.getByTestId('preview-unchanged')).toContainText('nutrition');

  // Nothing is persisted before confirmation.
  expect(sectionsOf(await storedPlan(page))).toEqual(before);

  await applyButton(page).click();
  await expect(page.getByTestId('config-preview')).toHaveCount(0);
  await expect(page.getByTestId('summary-exercise')).toContainText('Avoid biceps curl');
  await expect(page.getByTestId('config-history')).toContainText('Exercise');

  const after = sectionsOf(await storedPlan(page));
  expect(after.exercise).not.toEqual(before.exercise);
  expect({ ...after, exercise: '' }).toEqual({ ...before, exercise: '' }); // every other section byte-identical

  await page.reload();
  await expect(page.getByTestId('summary-exercise')).toContainText('16 kg and 24 kg kettlebells'); // persisted
});

test('nutrition-only update leaves exercise untouched and immediately drives the Daily Log', async ({ page }) => {
  await openConfigure(page);
  await checkUpdate(page, fixture('real-world-exercise'));
  await applyButton(page).click();
  const exerciseBefore = sectionsOf(await storedPlan(page)).exercise;

  await checkUpdate(page, fixture('nutrition'));
  await expect(page.getByTestId('preview-exercise')).toHaveCount(0);
  await expect(page.getByTestId('preview-unchanged')).toContainText('exercise');
  await expect(page.getByTestId('preview-nutrition')).toContainText('Energy');
  await applyButton(page).click();
  await expect(page.getByTestId('config-preview')).toHaveCount(0);
  expect(sectionsOf(await storedPlan(page)).exercise).toBe(exerciseBefore);

  // The log is a view over the same configuration: fixed meals now have values, so dinner shows its budget.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,300 kJ');
  await expect(row(page, 'dinner')).toContainText('≈ 4,300 kJ left');
});

test('combined update in a fenced block with chat prose around it, pasted from the clipboard', async ({ page }) => {
  await openConfigure(page);
  const reply = `Great, here is your update:\n\n\`\`\`json\n${fixture('combined')}\`\`\`\n\nAnything else?`;
  await page.evaluate((t) => navigator.clipboard.writeText(t), reply);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByRole('button', { name: 'Check update' }).click();
  await expect(await openSection(page, 'exercise')).toContainText('Added Fortis home multi-gym');
  await expect(await openSection(page, 'nutrition')).toContainText('Energy: ≤ 7,530 kJ → ≤ 7,300 kJ');
  await expect(page.getByTestId('preview-unchanged')).toContainText('schedule');
  await applyButton(page).click();
  await expect(page.getByTestId('summary-nutrition')).toContainText('Energy ≤ 7,300 kJ');
  await expect(page.getByTestId('summary-exercise')).toContainText('Hammer curl permitted');
});

test('after checking, the update collapses and Apply is on screen without scrolling (vertical budget)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openConfigure(page);
  await checkUpdate(page, fixture('combined'));
  await expect(page.getByLabel('AI update')).toHaveCount(0); // the pasted JSON collapses to one line
  await expect(page.getByText('Update checked')).toBeVisible();
  const apply = (await applyButton(page).boundingBox())!;
  expect(apply.y + apply.height).toBeLessThanOrEqual(844);
  // "Change" brings the text back, unchanged.
  await page.getByRole('button', { name: 'Change update' }).click();
  await expect(page.getByLabel('AI update')).toHaveValue(/fitnessConfigUpdate/);
});

test('invalid payloads show actionable errors and change nothing', async ({ page }) => {
  await openConfigure(page);
  const before = JSON.stringify(await storedPlan(page));

  await checkUpdate(page, JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { equipment: [{ type: 'trampoline' }] }, diet: {} } }));
  const errors = page.getByTestId('config-errors');
  await expect(errors).toContainText("This update can't be used");
  await expect(errors).toContainText('fitnessConfigUpdate.diet: unknown section');
  await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0);

  await checkUpdate(page, JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { equipment: [{ type: 'trampoline' }] } } }));
  await expect(errors).toContainText('fitnessConfigUpdate.exercise.equipment[0].type');

  await checkUpdate(page, 'Sure, I updated your nutrition!');
  await expect(errors).toContainText("isn't valid JSON");

  expect(JSON.stringify(await storedPlan(page))).toBe(before);
});

test('undo restores the previous configuration exactly', async ({ page }) => {
  await openConfigure(page);
  const before = sectionsOf(await storedPlan(page));
  await checkUpdate(page, fixture('combined'));
  await applyButton(page).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByTestId('config-history')).toContainText('Undo');
  expect(sectionsOf(await storedPlan(page))).toEqual(before);
  await expect(page.getByTestId('summary-exercise')).toContainText('Not set up yet');
});

test('configuration changes are included in the full export', async ({ page }) => {
  await openConfigure(page);
  await checkUpdate(page, fixture('real-world-exercise'));
  await applyButton(page).click();
  await page.getByRole('button', { name: 'Close' }).click();
  const doc = await exportAllData(page);
  expect(doc.plans[0]).toMatchObject({ origin: 'config', plan: { formatVersion: 2, exercise: { constraints: { gymMembership: false } } } });
  expect(doc.configChanges).toHaveLength(1);
  expect(doc.configChanges[0]).toMatchObject({ sections: ['exercise'] });
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('configure-start', async ({ page }) => {
    await openConfigure(page);
    await expect(page).toHaveScreenshot('configure-start.png');
  });
  test('configure-preview', async ({ page }) => {
    await openConfigure(page);
    await checkUpdate(page, fixture('combined'));
    await expect(page.getByTestId('config-preview')).toBeVisible();
    await expect(page).toHaveScreenshot('configure-preview.png');
    await openSection(page, 'nutrition');
    await expect(page).toHaveScreenshot('configure-preview-open.png');
  });
});

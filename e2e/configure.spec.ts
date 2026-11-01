import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MONDAY, expandToFullDay, openAt, row } from './helpers';

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

async function openConfigure(page: Page) {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Configure with AI' }).click();
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
}

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
  await expect(page.getByRole('button', { name: 'Copy AI instructions' })).toContainText('Copied');
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
  await expect(preview).toContainText('Configuration update detected');
  const exercise = page.getByTestId('preview-exercise');
  for (const line of ['Added Fortis home multi-gym', 'Added 16 kg and 24 kg kettlebells', 'Added Heavy bag', 'Added Battle ropes', 'Avoid biceps curl (aggravates elbow)', 'Hammer curl permitted']) {
    await expect(exercise).toContainText(line);
  }
  await expect(page.getByTestId('preview-nutrition')).toContainText('Not in this update · unchanged');

  // Nothing is persisted before confirmation.
  expect(sectionsOf(await storedPlan(page))).toEqual(before);

  await page.getByRole('button', { name: 'Apply update' }).click();
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
  await page.getByRole('button', { name: 'Apply update' }).click();
  const exerciseBefore = sectionsOf(await storedPlan(page)).exercise;

  await checkUpdate(page, fixture('nutrition'));
  await expect(page.getByTestId('preview-exercise')).toContainText('Not in this update · unchanged');
  await expect(page.getByTestId('preview-nutrition')).toContainText('Energy');
  await page.getByRole('button', { name: 'Apply update' }).click();
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
  await expect(page.getByTestId('preview-exercise')).toContainText('Added Fortis home multi-gym');
  await expect(page.getByTestId('preview-nutrition')).toContainText('Energy');
  await expect(page.getByTestId('preview-schedule')).toContainText('unchanged');
  await page.getByRole('button', { name: 'Apply update' }).click();
  await expect(page.getByTestId('summary-nutrition')).toContainText('Energy ≤ 7300');
  await expect(page.getByTestId('summary-exercise')).toContainText('Hammer curl permitted');
});

test('invalid payloads show actionable errors and change nothing', async ({ page }) => {
  await openConfigure(page);
  const before = JSON.stringify(await storedPlan(page));

  await checkUpdate(page, JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { equipment: [{ type: 'trampoline' }] }, diet: {} } }));
  const errors = page.getByTestId('config-errors');
  await expect(errors).toContainText("This update can't be used");
  await expect(errors).toContainText('fitnessConfigUpdate.diet: unknown section');
  await expect(page.getByRole('button', { name: 'Apply update' })).toHaveCount(0);

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
  await page.getByRole('button', { name: 'Apply update' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByTestId('config-history')).toContainText('Undo');
  expect(sectionsOf(await storedPlan(page))).toEqual(before);
  await expect(page.getByTestId('summary-exercise')).toContainText('Not set up yet');
});

test('configuration changes are included in the full export', async ({ page }) => {
  await openConfigure(page);
  await checkUpdate(page, fixture('real-world-exercise'));
  await page.getByRole('button', { name: 'Apply update' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data' }).click();
  const doc = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(doc.plans[0]).toMatchObject({ origin: 'config', plan: { formatVersion: 2, exercise: { constraints: { gymMembership: false } } } });
  expect(doc.configChanges).toHaveLength(1);
  expect(doc.configChanges[0]).toMatchObject({ sections: ['exercise'] });
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('configure-preview', async ({ page }) => {
    await openConfigure(page);
    await checkUpdate(page, fixture('combined'));
    await expect(page.getByTestId('config-preview')).toBeVisible();
    const height = await page.getByTestId('configure-scroll').evaluate((el) => {
      const s = el as HTMLElement;
      return Math.ceil(window.innerHeight - s.clientHeight + s.scrollHeight);
    });
    await page.setViewportSize({ width: 390, height });
    await expect(page).toHaveScreenshot('configure-preview-full.png');
  });
});

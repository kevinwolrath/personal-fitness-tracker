import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { chooseFromMenu, leaveSettings, openAt, THURSDAY } from './helpers';

/**
 * #49 + #53: first-run setup. A fresh install (empty storage) goes About you → Goals → Your starter plan
 * (Exercise | Meals), then Today. Adults get an offline starter plan; AI refinement is optional; under 18 is
 * tracking only. Existing installs can edit their setup answers from the menu, with confirmation and undo.
 */

const reply = readFileSync('fixtures/onboarding/ai-reply.txt', 'utf8');
const doc = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1') ?? 'null'));
const storedPlan = async (page: Page) => JSON.parse((await doc(page)).plan.json);
const primary = (page: Page) => page.getByTestId('setup-primary');

async function openFresh(page: Page) {
  await page.clock.setFixedTime(new Date(THURSDAY));
  await page.goto('/');
  await expect(page.getByTestId('setup-about')).toBeVisible();
}

async function answerAll(page: Page) {
  await page.getByTestId('gender-female').click();
  await page.getByTestId('age-40_59').click();
  await page.getByTestId('weight-70_99').click();
  await primary(page).click();
  await expect(page.getByTestId('setup-goals')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Gradual weight loss' }).click();
  await page.getByRole('checkbox', { name: 'Gain muscle' }).click();
  await page.getByTestId('activity-some_walking').click();
  await page.getByTestId('days-4').click();
  await page.getByTestId('equipment-none').click();
  await page.getByTestId('diet-vegetarian').click();
}

test.describe('first run', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a fresh install starts with setup (3 steps), not Today, and nothing is stored yet', async ({ page }) => {
    await openFresh(page);
    await expect(page.getByTestId('setup-step')).toHaveText('Step 1 of 3');
    await expect(page.getByTestId('day-progress')).toHaveCount(0);
    expect(await doc(page)).toBeNull();
  });

  test('offline path: answers → starter plan with Exercise and Meals tabs → swap a meal → start → Today', async ({ page }) => {
    await openFresh(page);
    await answerAll(page);
    await page.getByRole('checkbox', { name: 'Faster weight loss' }).click();
    await expect(page.getByRole('checkbox', { name: 'Gradual weight loss' })).not.toBeChecked(); // either/or
    await page.getByRole('checkbox', { name: 'Gradual weight loss' }).click();
    await primary(page).click(); // See my plan

    await expect(page.getByTestId('setup-review')).toBeVisible();
    await expect(page.getByTestId('tab-exercise')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('exercise-options')).toContainText('Option 1 of 3');
    await expect(page.getByTestId('plan-strength')).toContainText('Full-body strength at home');
    await expect(page.getByTestId('review-rest')).toContainText('Rest:');
    await page.getByTestId('exercise-options-next').click();
    await expect(page.getByTestId('exercise-options')).toContainText('More strength');
    await expect(page.getByTestId('exercise-options')).toContainText('Option 2 of 3');

    await page.getByTestId('tab-meals').click();
    await expect(page.getByTestId('meal-options')).toContainText('Option 1 of 3');
    const meals = page.getByTestId('review-meals');
    await expect(meals).not.toContainText(/chicken|fish|tuna|mince/i); // vegetarian
    await expect(page.getByTestId('review-meals-note')).toContainText("not food you've logged");
    await page.getByRole('button', { name: 'Swap lunch' }).click();
    await expect(page.getByTestId('setup-swap')).toBeVisible();
    await expect(page.getByTestId('setup-swap')).not.toContainText(/chicken|tuna/i); // only safe options offered
    await page.getByRole('button', { name: 'Use Chickpea, potato and vegetable bowl' }).click();
    await expect(page.getByTestId('meal-lunch')).toContainText('Chickpea, potato and vegetable bowl');
    expect(await doc(page)).toBeNull(); // nothing saved before Start

    await primary(page).click(); // Start with this plan
    await expect(page.getByTestId('day-progress')).toBeVisible();
    const plan = await storedPlan(page);
    expect((await doc(page)).plan.origin).toBe('onboarding');
    expect(plan.activities.find((a: any) => a.id === 'lunch')).toMatchObject({ label: 'Chickpea, potato and vegetable bowl', required: false });
    expect(plan.activities.every((a: any) => a.nutrition === undefined)).toBe(true);
    expect(plan.nutrition).toEqual({ targets: [] });
    expect(plan.profile).toMatchObject({ gender: 'female', ageBand: '40_59', weightBand: '70_99', dietary: ['vegetarian'] });
    expect((await doc(page)).observations).toEqual([]); // a band is never a weigh-in

    await page.reload();
    await expect(page.getByTestId('day-progress')).toBeVisible();
    await expect(page.getByTestId('setup-about')).toHaveCount(0);
  });

  test('optional AI refinement reuses the importer; sample meals stay, AI nutrition is left out', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openFresh(page);
    await answerAll(page);
    await primary(page).click();
    await page.getByTestId('review-refine').click();
    await expect(page.getByTestId('setup-ai')).toBeVisible();
    await page.getByTestId('setup-copy-prompt').click();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('Vegetarian');
    expect(prompt).toMatch(/Leave nutrition out completely/);
    await page.getByTestId('setup-reply').fill('not a plan');
    await primary(page).click();
    await expect(page.getByTestId('setup-errors')).toBeVisible();
    await page.getByTestId('setup-reply').fill(reply);
    await primary(page).click();
    await expect(page.getByTestId('review-ai')).toContainText('AI-generated suggestion, not medical advice');
    await expect(page.getByTestId('review-ai')).toContainText("Nutrition isn't set up yet");
    await expect(page.getByTestId('plan-home-strength')).toBeVisible();
    await primary(page).click();
    await expect(page.getByTestId('day-progress')).toBeVisible();
    const plan = await storedPlan(page);
    expect(plan.activities.map((a: any) => a.id)).toEqual(expect.arrayContaining(['home-strength', 'breakfast']));
    expect(plan.nutrition).toEqual({ targets: [] });
  });

  test('resumes where it left off after a restart', async ({ page }) => {
    await openFresh(page);
    await answerAll(page);
    await page.reload();
    await expect(page.getByTestId('setup-goals')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Gain muscle' })).toBeChecked();
    await expect(page.getByTestId('diet-vegetarian')).toBeChecked();
  });

  test('a specific weight is logged as a weigh-in only when ticked; height is optional', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('setup-weight-exact').click();
    await page.getByTestId('setup-exact-weight').fill('82.4');
    const box = page.getByTestId('setup-log-weigh-in');
    await expect(box).not.toBeChecked();
    await box.click();
    await page.getByTestId('setup-height').fill('170');
    await page.getByTestId('setup-skip').click();
    await page.getByTestId('setup-skip').click();
    await expect(page.getByTestId('review-weigh-in')).toHaveText("82.4 kg will be logged as today's weigh-in.");
    await primary(page).click();
    await expect(page.getByTestId('day-progress')).toBeVisible();
    expect((await doc(page)).observations).toEqual([expect.objectContaining({ metric: 'weight', value: 82.4, date: '2026-11-05' })]);
    expect((await storedPlan(page)).profile).toEqual({ weight: 82.4, heightCm: 170 });
  });

  test('under 18: an accessible tracking-only entry, no goals, no plan', async ({ page }) => {
    await openFresh(page);
    const under = page.getByRole('checkbox', { name: "I'm under 18: tracking only" });
    await expect(under).toBeVisible();
    await under.click();
    await expect(page.getByTestId('setup-minor')).toContainText('for people 18 and over');
    await expect(page.getByTestId('setup-step')).toHaveText('Step 1 of 2');
    await primary(page).click();
    await expect(page.getByTestId('review-basic')).toContainText('No exercise or meal plan');
    await primary(page).click(); // Start tracking
    await expect(page.getByTestId('no-plan')).toContainText('Tracking only');
    const plan = await storedPlan(page);
    expect(plan.activities).toEqual([]);
    expect(plan.profile).toEqual({ ageBand: 'under_18' });
  });

  test('a specific age under 18 is tracking only too', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('setup-age-mode').click();
    await page.getByTestId('setup-exact-age').fill('16');
    await expect(page.getByTestId('setup-minor')).toBeVisible();
    await expect(page.getByTestId('setup-step')).toHaveText('Step 1 of 2');
  });
});

test.describe('edit setup answers (existing install)', () => {
  test('Edit profile saves the answers only: the customised schedule, meals and day types stay exactly as they were', async ({ page }) => {
    await openAt(page, THURSDAY);
    const before = await doc(page);
    await chooseFromMenu(page, 'Edit setup answers');
    await expect(page.getByTestId('setup-about')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await leaveSettings(page); // Edit setup answers returns to Settings → Plan & goals (#174)
    await expect(page.getByTestId('day-progress')).toBeVisible();
    expect((await doc(page)).plan).toEqual(before.plan); // cancelled: untouched

    await chooseFromMenu(page, 'Edit setup answers');
    await answerAll(page);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByTestId('setup-edit-profile')).toContainText('Your schedule, day types, meals, activities and targets stay exactly as they are');
    await primary(page).click(); // Save profile
    await leaveSettings(page); // Edit setup answers returns to Settings → Plan & goals (#174)
    await expect(page.getByTestId('day-progress')).toBeVisible();

    const after = await doc(page);
    const b = JSON.parse(before.plan.json);
    const a = JSON.parse(after.plan.json);
    for (const key of ['activities', 'dayTypes', 'schedule', 'requirements', 'nutrition', 'measurements', 'goals', 'units']) expect(a[key]).toEqual(b[key]);
    expect(a.profile).toMatchObject({ fitnessGoals: ['gradual_loss', 'gain_muscle'], dietary: ['vegetarian'] });
    expect(after.plan).toMatchObject({ planId: before.plan.planId, revision: before.plan.revision + 1 });
    expect(after.configChanges[0]).toMatchObject({ sections: ['profile'], previousPlanJson: before.plan.json });
  });

  test('Rebuild starter plan shows what will change and replaces only after confirming', async ({ page }) => {
    await openAt(page, THURSDAY);
    const before = await doc(page);
    await chooseFromMenu(page, 'Edit setup answers');
    await answerAll(page);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByTestId('edit-preview-rebuild').click();
    const changes = page.getByTestId('rebuild-changes');
    await expect(changes).toContainText('Removed:');
    await expect(changes).toContainText('School run');
    await expect(changes).toContainText('Kept: measurements, goals, nutrition targets, workout history and imports');
    await primary(page).click(); // Replace my plan
    const dialog = page.getByRole('alertdialog', { name: 'Replace your current plan?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await doc(page)).plan).toEqual(before.plan); // not confirmed: untouched
    await primary(page).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace plan' }).click();

    await leaveSettings(page); // Edit setup answers returns to Settings → Plan & goals (#174)
    await expect(page.getByTestId('day-progress')).toBeVisible();
    const after = await doc(page);
    expect(after.plan).toMatchObject({ planId: before.plan.planId, revision: before.plan.revision + 1, origin: 'config' });
    const plan = JSON.parse(after.plan.json);
    expect(plan.measurements.map((m: any) => m.id)).toEqual(expect.arrayContaining(['weight', 'waist']));
    expect(plan.activities.some((a: any) => a.id === 'strength')).toBe(true);
    expect(after.configChanges[0]).toMatchObject({ sections: ['setup'], previousPlanJson: before.plan.json });
  });

  test('visual: the Edit profile screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only');
    await openAt(page, THURSDAY);
    await chooseFromMenu(page, 'Edit setup answers');
    await answerAll(page);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByTestId('setup-edit-profile')).toBeVisible();
    await expect(page).toHaveScreenshot('setup-edit-profile.png');
  });
});

test.describe('visual', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('setup screens: about, goals, exercise and meals tabs, meal swap, tracking only', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('gender-female').click();
    await page.getByTestId('age-40_59').click();
    await page.getByTestId('weight-70_99').click();
    await expect(page).toHaveScreenshot('setup-about.png');
    await primary(page).click();
    await page.getByRole('checkbox', { name: 'Gradual weight loss' }).click();
    await page.getByRole('checkbox', { name: 'Gain muscle' }).click();
    await page.getByTestId('activity-some_walking').click();
    await page.getByTestId('days-4').click();
    await page.getByTestId('equipment-none').click();
    await page.getByTestId('diet-vegetarian').click();
    await page.getByTestId('setup-scroll').evaluate((el) => el.scrollTo(0, 0));
    await expect(page).toHaveScreenshot('setup-goals.png');
    await primary(page).click();
    await expect(page.getByTestId('setup-review')).toBeVisible();
    await expect(page).toHaveScreenshot('setup-review-exercise.png');
    await page.getByTestId('tab-meals').click();
    await expect(page).toHaveScreenshot('setup-review-meals.png');
    await page.getByRole('button', { name: 'Swap lunch' }).click();
    await expect(page).toHaveScreenshot('setup-meal-swap.png');
    await page.getByTestId('setup-primary').click();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('checkbox', { name: "I'm under 18: tracking only" }).click();
    await primary(page).click();
    await expect(page).toHaveScreenshot('setup-under-18.png');
  });
});

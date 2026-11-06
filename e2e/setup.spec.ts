import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { THURSDAY } from './helpers';

/**
 * #49: first-run setup. A fresh install (empty storage) goes through About you → Goals → Practical context →
 * Generate → Review, then Today. Existing installs (every other spec) never see it.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const reply = readFileSync('fixtures/onboarding/ai-reply.txt', 'utf8');
const doc = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1') ?? 'null'));
const storedPlan = async (page: Page) => JSON.parse((await doc(page)).plan.json);
const primary = (page: Page) => page.getByTestId('setup-primary');

async function openFresh(page: Page) {
  await page.clock.setFixedTime(new Date(THURSDAY));
  await page.goto('/');
  await expect(page.getByTestId('setup-about')).toBeVisible();
}

async function answerAboutYou(page: Page) {
  await page.getByTestId('gender-female').click();
  await page.getByTestId('age-40_49').click();
  await page.getByTestId('weight-80_99').click();
}

test('a fresh install starts with setup, not Today, and nothing is stored yet', async ({ page }) => {
  await openFresh(page);
  await expect(page.getByTestId('day-progress')).toHaveCount(0);
  await expect(page.getByTestId('app-bar')).toHaveCount(0); // before the app shell
  await expect(page.getByTestId('setup-step')).toHaveText('Step 1 of 4');
  expect(await doc(page)).toBeNull(); // no plan, and certainly not the bundled personal one
});

test('the whole AI path: answers → copy prompt → paste a chatty reply → review → confirm → Today; never again', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFresh(page);
  await answerAboutYou(page);
  await primary(page).click();

  await expect(page.getByTestId('setup-goals')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Lose a little weight' }).click();
  await page.getByRole('checkbox', { name: 'Gain muscle' }).click();
  await expect(page.getByTestId('goal-lose_weight-primary')).toBeVisible(); // the first one chosen leads
  await page.getByRole('button', { name: 'Make Gain muscle primary' }).click();
  await expect(page.getByTestId('goal-gain_muscle-primary')).toBeVisible();
  await primary(page).click();

  await expect(page.getByTestId('setup-context')).toBeVisible();
  await page.getByTestId('days-3').click();
  await page.getByTestId('minutes-45').click();
  await page.getByTestId('place-home').click();
  await page.getByTestId('setup-considerations').fill('Sore left knee');
  await primary(page).click();

  await expect(page.getByTestId('setup-generate')).toBeVisible();
  await expect(primary(page)).toBeDisabled(); // nothing pasted yet
  await page.getByTestId('setup-copy-prompt').click();
  await expect(page.getByTestId('setup-copy-prompt')).toHaveText(/Copied/);
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('Gain muscle (primary), Lose a little weight');
  expect(prompt).toContain('Sore left knee');
  expect(prompt).toMatch(/Leave nutrition out completely/);
  expect(prompt).not.toMatch(/Fixed lunch|Weight loss plan/);

  await page.getByTestId('setup-reply').fill(reply);
  await primary(page).click();

  await expect(page.getByTestId('setup-review')).toBeVisible();
  await expect(page.getByText('AI-generated suggestion, not medical advice.', { exact: false })).toBeVisible();
  const fromYou = page.getByTestId('review-from-you');
  await expect(fromYou).toContainText('Female');
  await expect(fromYou).toContainText('80–99 kg (a range)');
  const ai = page.getByTestId('review-ai');
  await expect(ai).toContainText('Brisk walk');
  await expect(ai).toContainText('Assumed');
  await expect(ai).toContainText("Nutrition isn't set up yet, so the AI's nutrition suggestions were left out.");
  await expect(page.getByTestId('review-nutrition')).toContainText('Not set up yet');
  expect(await doc(page)).toBeNull(); // still nothing saved before Confirm

  await primary(page).click(); // Confirm and start
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(page.getByTestId('next-action-title')).toHaveText('Brisk walk'); // Thursday morning
  const plan = await storedPlan(page);
  expect(plan).toMatchObject({ id: 'my-plan', formatVersion: 6, nutrition: { targets: [] } });
  expect(plan.profile).toMatchObject({ gender: 'female', ageBand: '40_49', weightBand: '80_99', primaryGoal: 'gain_muscle', considerations: 'Sore left knee' });
  expect((await doc(page)).plan.origin).toBe('onboarding');
  expect((await doc(page)).observations).toEqual([]); // a band is never a weigh-in

  await page.reload();
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(page.getByTestId('setup-about')).toHaveCount(0);
});

test('resumes where it left off after a restart', async ({ page }) => {
  await openFresh(page);
  await answerAboutYou(page);
  await primary(page).click();
  await page.getByRole('checkbox', { name: 'Improve cardio' }).click();
  await expect(page.getByRole('checkbox', { name: 'Improve cardio' })).toBeChecked();
  await page.reload();
  await expect(page.getByTestId('setup-goals')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Improve cardio' })).toBeChecked();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('gender-female')).toBeChecked();
});

test('skipping the AI: a basic profile with weight tracking; Today offers to set up a plan', async ({ page }) => {
  await openFresh(page);
  await page.getByTestId('setup-skip').click(); // About you
  await page.getByTestId('setup-skip').click(); // Goals
  await page.getByTestId('setup-skip').click(); // Context
  await page.getByTestId('setup-skip-ai').click();
  await expect(page.getByTestId('setup-review')).toBeVisible();
  await expect(page.getByTestId('review-basic')).toContainText('Weight tracking. No workouts yet.');
  await primary(page).click(); // Start tracking

  await expect(page.getByTestId('no-plan')).toContainText('No plan yet');
  await expect(page.getByTestId('next-action')).toHaveCount(0);
  await expect(page.getByTestId('up-next')).toHaveCount(0);
  await expect(page.getByTestId('measurement-weight')).toBeVisible();
  const plan = await storedPlan(page);
  expect(plan).toMatchObject({ activities: [], goals: [], nutrition: { targets: [] } });
  expect(plan.profile).toBeUndefined(); // nothing was answered, nothing invented
  await page.getByRole('button', { name: 'Set up a plan with AI' }).click();
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
});

test('an exact weight is logged as a weigh-in only when ticked (off by default)', async ({ page }) => {
  await openFresh(page);
  await page.getByTestId('setup-weight-exact').click();
  await page.getByTestId('setup-exact-weight').fill('82.4');
  const box = page.getByTestId('setup-log-weigh-in');
  await expect(box).not.toBeChecked();
  await box.click();
  await expect(box).toBeChecked();
  await page.getByTestId('setup-skip').click();
  await page.getByTestId('setup-skip').click();
  await page.getByTestId('setup-skip').click();
  await page.getByTestId('setup-skip-ai').click();
  await expect(page.getByTestId('review-weigh-in')).toHaveText("82.4 kg logged as today's weigh-in");
  await primary(page).click();
  await expect(page.getByTestId('no-plan')).toBeVisible();
  const obs = (await doc(page)).observations;
  expect(obs).toEqual([expect.objectContaining({ metric: 'weight', value: 82.4, date: '2026-11-05' })]);
  expect((await storedPlan(page)).profile).toEqual({ weight: 82.4 });
});

test('under 18: adults-only notice, no goals or AI step, tracking only', async ({ page }) => {
  await openFresh(page);
  await page.getByTestId('age-under_18').click();
  await expect(page.getByTestId('setup-minor')).toContainText('for people 18 and over');
  await expect(page.getByTestId('setup-step')).toHaveText('Step 1 of 2');
  await primary(page).click(); // Continue
  await expect(page.getByTestId('setup-review')).toBeVisible();
  await expect(page.getByTestId('review-ai')).toHaveCount(0);
  await expect(page.getByTestId('review-basic')).toContainText('Weight tracking only.');
  await primary(page).click();
  await expect(page.getByTestId('no-plan')).toContainText('Tracking only');
  await expect(page.getByRole('button', { name: 'Set up a plan with AI' })).toHaveCount(0);
  expect((await storedPlan(page)).profile).toEqual({ ageBand: 'under_18' });
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('setup screens and Today without a plan', async ({ page }) => {
    await openFresh(page);
    await answerAboutYou(page);
    await expect(page).toHaveScreenshot('setup-about.png');
    await primary(page).click();
    await page.getByRole('checkbox', { name: 'Lose a little weight' }).click();
    await page.getByRole('checkbox', { name: 'Gain muscle' }).click();
    await expect(page).toHaveScreenshot('setup-goals.png');
    await primary(page).click();
    await page.getByTestId('days-3').click();
    await page.getByTestId('minutes-45').click();
    await page.getByTestId('place-home').click();
    await page.getByTestId('activity-some_walking').click();
    await expect(page).toHaveScreenshot('setup-context.png');
    await primary(page).click();
    await expect(page).toHaveScreenshot('setup-generate.png');
    await page.getByTestId('setup-reply').fill(reply);
    await primary(page).click();
    await expect(page.getByTestId('setup-review')).toBeVisible();
    await expect(page).toHaveScreenshot('setup-review.png');
    await page.getByTestId('review-edit').click();
    await page.getByTestId('setup-skip').click();
    await page.getByTestId('setup-skip').click();
    await page.getByTestId('setup-skip').click();
    await page.getByTestId('setup-skip-ai').click();
    await primary(page).click();
    await expect(page.getByTestId('no-plan')).toBeVisible();
    await expect(page).toHaveScreenshot('today-no-plan.png');
  });
});

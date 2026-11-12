import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { MONDAY, openAt } from './helpers';

/**
 * #122 Muscle Growth: a configurable category over the shared exercise catalogue. Set up targets and a routine in the
 * app, add a custom exercise, then complete/skip items on Today; ticks persist per date and stay separate from
 * Today's workout, while counting in the same muscle accounting.
 */

const SHOTS = 'docs/design/issue-122-muscle-growth';
const section = (page: Page) => page.getByTestId('muscle-growth');
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!));
const shot = async (page: Page, name: string, info: { project: { name: string } }) => {
  if (info.project.name !== 'phone') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('app-menu').getByRole('button', { name: /Muscle Growth/ }).click();
  await expect(page.getByTestId('muscle-growth-editor')).toBeVisible();
}

async function setUpBicepsAndUpperBack(page: Page, info: { project: { name: string } }) {
  await openEditor(page);
  await page.getByTestId('mg-target-biceps').click();
  // Only exercises for the target, from the shared catalogue: hammer curl first, pulls that also work biceps after.
  const editor = page.getByTestId('muscle-growth-editor');
  await expect(page.getByTestId('mg-option-hammer_curl')).toBeVisible();
  await expect(page.getByTestId('mg-option-knuckle_push_up')).toHaveCount(0);
  await page.getByTestId('mg-option-hammer_curl').getByRole('checkbox').click();
  await page.getByTestId('mg-target-upper_back').click();
  await page.getByTestId('mg-when-lunch').click();
  await shot(page, 'editor-targets', info);
  // Upper traps count as Upper back; no built-in shrug, so add one to the catalogue.
  await page.getByTestId('mg-add-custom').click();
  await page.getByTestId('mg-custom-name').fill('Dumbbell shrug');
  await page.getByTestId('mg-custom-primary-biceps').click(); // was preselected from the first target: switch to upper back
  await page.getByTestId('mg-custom-primary-upper_back').click();
  await page.getByTestId('mg-custom-secondary-forearms').click();
  await page.getByTestId('mg-custom-equipment-dumbbells_fixed').click();
  await page.getByTestId('mg-custom-cue').fill('Shoulders straight up, pause, lower slowly.');
  await shot(page, 'editor-custom', info);
  await page.getByTestId('mg-custom-add').click();
  await expect(page.getByTestId('mg-option-dumbbell_shrug')).toContainText('custom');
  await expect(page.getByTestId('mg-option-dumbbell_shrug').getByRole('checkbox')).toBeChecked();
  await expect(editor).toBeVisible();
  await page.getByTestId('mg-save').click();
  await expect(page.getByTestId('muscle-growth-editor')).toHaveCount(0);
}

test('set up biceps and upper back (traps), complete and skip on Today, persist, amend; separate from Today\'s workout', async ({ page }, info) => {
  await openAt(page, MONDAY);
  await expect(section(page)).toHaveCount(0); // nothing until the user sets it up
  const workoutBefore = await page.getByTestId('today-workout-counts').textContent();
  await setUpBicepsAndUpperBack(page, info);

  await expect(section(page)).toBeVisible();
  await expect(page.getByTestId('muscle-growth-summary')).toHaveText('Biceps · Upper back · Lunch break');
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('0 of 2 done · 2 left');
  const list = page.getByTestId('muscle-growth-list');
  await expect(list).toContainText('Hammer curl');
  await expect(list).toContainText('Dumbbell shrug');
  await expect(page.getByTestId('muscle-growth-workload')).toContainText('Biceps');
  await section(page).scrollIntoViewIfNeeded();
  await shot(page, 'today-section', info);

  // Complete one, skip the other.
  await list.getByRole('checkbox', { name: /Hammer curl/ }).click();
  await page.getByRole('button', { name: 'Skip Dumbbell shrug' }).click();
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('1 of 2 done · 1 skipped');
  await expect(list.getByRole('checkbox', { name: /Hammer curl/ })).toBeChecked();
  await expect(list.getByRole('checkbox', { name: /Dumbbell shrug/ })).not.toBeChecked();
  await expect(list).toContainText('skipped');
  await section(page).scrollIntoViewIfNeeded();
  await shot(page, 'today-done-skipped', info);
  // Today's workout (Resistance Training) completion is unchanged.
  await expect(page.getByTestId('today-workout-counts')).toHaveText(workoutBefore!);

  // Log what was actually done: replaces the same record, never adds one.
  await page.getByTestId('muscle-growth-details-hammer_curl').click();
  await page.getByTestId('mg-log-load').fill('8');
  await page.getByTestId('mg-log-rir').fill('2');
  await page.getByTestId('mg-log-save').click();
  await expect(page.getByTestId('muscle-growth-details-hammer_curl')).toContainText('2 × 12 · 8 kg · 2 in reserve');

  // Persisted per date: survives a reload; one record per item.
  await page.reload();
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('1 of 2 done · 1 skipped');
  const logs = (await stored(page)).exerciseLogs.filter((l: any) => l.routine === 'muscle_growth');
  expect(logs.map((l: any) => [l.movement, l.status, l.sets, l.loadKg ?? null, l.rir ?? null]).sort()).toEqual([
    ['dumbbell_shrug', 'skipped', 0, null, null],
    ['hammer_curl', 'done', 2, 8, 2],
  ]);

  // Amend: undo the skip, then complete it instead; undo a completion. Still one record each.
  await page.getByRole('button', { name: 'Undo skip: Dumbbell shrug' }).click();
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('1 of 2 done · 1 left');
  await page.getByTestId('muscle-growth-list').getByRole('checkbox', { name: /Dumbbell shrug/ }).click();
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('2 of 2 done');
  await page.getByTestId('muscle-growth-list').getByRole('checkbox', { name: /Hammer curl/ }).click();
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('1 of 2 done · 1 left');
  expect((await stored(page)).exerciseLogs.filter((l: any) => l.routine === 'muscle_growth')).toHaveLength(1);

  // The custom exercise uses the same guide as built-ins (its own cue).
  await page.getByTestId('muscle-growth-list').getByRole('button', { name: /Dumbbell shrug.*Show how/ }).click();
  await expect(page.getByText('Shoulders straight up, pause, lower slowly.')).toBeVisible();
});

test('history: a past day shows what was logged; changing targets changes the checklist without deleting it', async ({ page }, info) => {
  await openAt(page, MONDAY);
  await setUpBicepsAndUpperBack(page, info);
  await page.getByTestId('muscle-growth-list').getByRole('checkbox', { name: /Dumbbell shrug/ }).click();
  await expect(page.getByTestId('muscle-growth-counts')).toHaveText('1 of 2 done · 1 left');

  // Next day, a different target selection: upper back only.
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00+11:00'));
  await page.goto('/');
  await openEditor(page);
  await page.getByTestId('mg-target-biceps').click(); // off
  await expect(page.getByTestId('mg-option-hammer_curl')).toHaveCount(0);
  await page.getByTestId('mg-save').click();
  await expect(page.getByTestId('muscle-growth-summary')).toHaveText('Upper back · Lunch break');
  await expect(page.getByTestId('muscle-growth-list')).not.toContainText('Hammer curl');
  await expect(page.getByTestId('muscle-growth-list')).toContainText('Dumbbell shrug');

  // Monday still shows what was actually logged there.
  await page.goto('/?date=2026-11-02');
  await expect(page.getByTestId('muscle-growth-list')).toContainText('Dumbbell shrug');
  await expect(page.getByTestId('muscle-growth-list').getByRole('checkbox', { name: /Dumbbell shrug/ })).toBeChecked();
});

test('the app menu shows Muscle Growth status; turning it off hides the section', async ({ page }, info) => {
  await openAt(page, MONDAY);
  await setUpBicepsAndUpperBack(page, info);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('menu-muscle-growth')).toContainText('On · Biceps, Upper back');
  await shot(page, 'menu', info);
  await page.getByTestId('menu-muscle-growth').click();
  await page.getByTestId('muscle-growth-enabled').click();
  await page.getByTestId('mg-save').click();
  await expect(section(page)).toHaveCount(0);
});

test('weekday selector: only the chosen days offer the routine; existing days are kept on later edits', async ({ page }, info) => {
  await openAt(page, MONDAY);
  await setUpBicepsAndUpperBack(page, info);
  await openEditor(page);
  await expect(page.getByTestId('mg-days-summary')).toHaveText('Every day');
  await page.getByTestId('mg-day-sat').click();
  await page.getByTestId('mg-day-sun').click();
  await expect(page.getByTestId('mg-days-summary')).toHaveText('Only Mon, Tue, Wed, Thu, Fri');
  await shot(page, 'editor-days', info);
  await page.getByTestId('mg-save').click();
  expect((await stored(page)).plan.json).toContain('"days":["mon","tue","wed","thu","fri"]');
  await expect(section(page)).toBeVisible(); // Monday

  // Reopen and change something else: the days are kept.
  await openEditor(page);
  await expect(page.getByTestId('mg-days-summary')).toHaveText('Only Mon, Tue, Wed, Thu, Fri');
  await page.getByTestId('mg-when-evening').click();
  await page.getByTestId('mg-save').click();
  expect(JSON.parse((await stored(page)).plan.json).exercise.muscleGrowth.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);

  // Saturday: not offered.
  await page.goto('/?date=2026-11-07');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(section(page)).toHaveCount(0);

  // No days at all is refused.
  await page.goto('/');
  await openEditor(page);
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) await page.getByTestId(`mg-day-${d}`).click();
  await page.getByTestId('mg-save').click();
  await expect(page.getByTestId('mg-error')).toHaveText('Choose at least one day.');
});

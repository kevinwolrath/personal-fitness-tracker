import { expect, test, type Page } from '@playwright/test';
import { openAt, openWorkoutSheet, seedPlan, seedRecords, seedWithStrengthWindow, workoutCard, workoutSheet } from './helpers';

/**
 * #56: Today's workout orders every eligible exercise by muscle priority once there's enough history (a week),
 * frozen for the day. Before that, the day's planned exercises come first in plan order.
 * Mon 2 Nov, 10:15, school run done; Strength has a morning window so the card is "Do this next".
 */

const at = (date: string, hhmm: string) => `${date}T${hhmm}:00+11:00`;
const schoolRunDone = { 'weight-loss-v1|2026-11-02': { 'school-run-am': { activityId: 'school-run-am', status: 'done', count: 0, labelSnapshot: 'School run', updatedAt: 't' } } };
const free = (id: string, movement: string, date: string, sets: number) => ({ id, movement, date, at: at(date, '07:00'), sets, reps: 10, seconds: null, intensity: null });
const order = (page: Page) =>
  page.getByTestId('today-workout-todo').getByRole('checkbox').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').split(',')[0]));

test('first use: the plan’s exercises first, in plan order; nothing is "Due"', async ({ page }) => {
  await seedPlan(page, seedWithStrengthWindow('morning'));
  await seedRecords(page, { activities: schoolRunDone });
  await openAt(page, at('2026-11-02', '10:15'));
  await expect(workoutCard(page).getByRole('checkbox')).toHaveAccessibleName(/^Goblet squat/);
  await openWorkoutSheet(page);
  expect((await order(page)).slice(0, 5)).toEqual(['Goblet squat', 'Chest press machine', 'Lat pulldown', 'One-arm kettlebell row', 'Hammer curls']);
  await expect(workoutSheet(page)).not.toContainText('! Due');
});

test('with history: the exercise for the muscles most in need comes first; well-trained muscles sink; nothing added or dropped', async ({ page }) => {
  await seedPlan(page, seedWithStrengthWindow('morning'));
  await seedRecords(page, {
    activities: schoolRunDone,
    exerciseLogs: [
      free('a', 'plank', '2026-10-19', 1), // history began two weeks ago
      free('b', 'chest_press', '2026-10-29', 6), // chest and quads at target this week, recovered
      free('c', 'leg_extension', '2026-10-29', 6),
    ],
  });
  await openAt(page, at('2026-11-02', '10:15'));
  await expect(workoutCard(page).getByRole('checkbox')).toHaveAccessibleName(/^One-arm kettlebell row/); // upper back and lats untrained
  await openWorkoutSheet(page);
  const names = await order(page);
  expect(names).toHaveLength(5); // #90: the plan, by priority
  expect(names[0]).toBe('One-arm kettlebell row');
  expect(names.indexOf('Chest press machine')).toBeGreaterThan(names.indexOf('Lat pulldown'));
  await page.getByTestId('today-workout-extras').click();
  const extras = await page.getByTestId('today-workout-extras-list').getByRole('checkbox').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').split(',')[0]));
  expect(extras).toHaveLength(16); // #158 adds illustrated extras without changing the five planned exercises.
  expect(extras.at(-1)).toBe('Leg extension'); // quads at target: nothing left to gain
  await expect(workoutSheet(page).getByTestId('workout-status-standing_calf_raise')).toHaveText('! Due');
  await expect(workoutSheet(page).getByTestId('workout-status-leg_extension')).toHaveText('✓ Trained');

  // Ticking never reshuffles what's left.
  await workoutSheet(page).getByRole('checkbox', { name: /^One-arm kettlebell row/ }).click();
  expect(await order(page)).toEqual(names.slice(1));
});

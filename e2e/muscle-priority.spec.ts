import { expect, test } from '@playwright/test';
import { openAt, seedPlan, seedRecords, seedWithStrengthWindow } from './helpers';

/**
 * #56 option C: a scheduled session keeps its exercises, shown in muscle-priority order once there's enough history.
 * Mon 2 Nov, 10:15, school run done; Strength has a morning window so it's on the card.
 */

const at = (date: string, hhmm: string) => `${date}T${hhmm}:00+11:00`;
const schoolRunDone = { 'weight-loss-v1|2026-11-02': { 'school-run-am': { activityId: 'school-run-am', status: 'done', count: 0, labelSnapshot: 'School run', updatedAt: 't' } } };
const free = (id: string, movement: string, date: string, sets: number) => ({ id, movement, date, at: at(date, '07:00'), sets, reps: 10, seconds: null, intensity: null });

test('first use: the plan order', async ({ page }) => {
  await seedPlan(page, seedWithStrengthWindow('morning'));
  await seedRecords(page, { activities: schoolRunDone });
  await openAt(page, at('2026-11-02', '10:15'));
  await expect(page.getByTestId('next-action-title')).toHaveText('Strength workout');
  await expect(page.getByTestId('next-action-session')).toContainText('Kettlebell squat');
});

test('with history: the exercise for the muscles most in need comes first; nothing is added or dropped', async ({ page }) => {
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
  const checklist = page.getByTestId('next-action-session');
  await expect(checklist).toContainText('One-arm kettlebell row'); // upper back and lats untrained: first
  await page.getByTestId('workout-expand').click();
  const names = await checklist.getByRole('checkbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const order = ['One-arm kettlebell row', 'Kettlebell squat', 'Lat pulldown', 'Hammer curl', 'Chest press'].map((n) => names.findIndex((x) => x.includes(n)));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b)); // chest (at target) last
  expect(names).toHaveLength(5);
});

import { convertEnergy, type EnergyDisplay } from '../energy';
import type { MealLog } from '../nutrition/contract';
import type { Observation } from '../observations/types';
import { addDays, type LocalDate } from '../plan/dates';
import { dailySeries, inRange, type Point } from './series';

/**
 * What else changed while the weight trend flattened or slowed (#57: "relevant observed changes, e.g. lower
 * activity"). Pure, advisory. Compares the last 3 finished weeks with the 3 weeks before them (today is still in
 * progress, so it never counts), using the same records Progress shows: steps, active energy, workout minutes (the
 * same no-double-counting rules as the charts) and how many days had food logged.
 *
 * Only clear changes with enough data on both sides are named: at least 7 days with a value in each window, and a
 * change of 15% or more (food-logging days: a drop of 5 days or more). It describes what happened at the same time;
 * it never claims it caused the weight change.
 */

export const WINDOW_DAYS = 21;
const MIN_DAYS = 7;
const MIN_CHANGE = 0.15;

export const CHANGES_CAVEAT = 'These changed over the same weeks. That doesn’t mean they caused the change in your weight.';

export type ObservedChange = { metric: 'steps' | 'active_energy' | 'exercise_minutes' | 'food_logging'; text: string; direction: 'down' | 'up' };

const thousands = (n: number) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(Math.round(n));

function windows(today: LocalDate) {
  const recentTo = addDays(today, -1);
  const recentFrom = addDays(today, -WINDOW_DAYS);
  const beforeTo = addDays(recentFrom, -1);
  const beforeFrom = addDays(recentFrom, -WINDOW_DAYS);
  return { recent: [recentFrom, recentTo] as const, before: [beforeFrom, beforeTo] as const };
}

function compareDaily(points: Point[], today: LocalDate): { recent: number; before: number } | null {
  const w = windows(today);
  const r = inRange(points, ...w.recent);
  const b = inRange(points, ...w.before);
  if (r.length < MIN_DAYS || b.length < MIN_DAYS) return null;
  const mean = (ps: Point[]) => ps.reduce((s, p) => s + p.value, 0) / ps.length;
  return { recent: mean(r), before: mean(b) };
}

export function observedChanges(observations: Observation[], mealLogs: MealLog[], today: LocalDate, energy: EnergyDisplay = 'kJ'): ObservedChange[] {
  const out: ObservedChange[] = [];
  const pct = (a: number, b: number) => (b === 0 ? null : (a - b) / b);
  const add = (metric: ObservedChange['metric'], c: { recent: number; before: number } | null, describe: (c: { recent: number; before: number }, p: number) => string) => {
    if (!c) return;
    const p = pct(c.recent, c.before);
    if (p === null || Math.abs(p) < MIN_CHANGE) return;
    out.push({ metric, direction: p < 0 ? 'down' : 'up', text: describe(c, p) });
  };
  const signedPct = (p: number) => `${p > 0 ? '+' : '−'}${Math.round(Math.abs(p) * 100)}%`;
  const dir = (p: number) => (p < 0 ? 'down' : 'up');

  add('steps', compareDaily(dailySeries(observations, 'steps'), today), (c, p) => `Steps: about ${thousands(c.recent)} a day in the last 3 weeks, ${dir(p)} from ${thousands(c.before)} (${signedPct(p)}).`);

  const unit = energy === 'kcal' ? 'kcal' : 'kJ';
  add('active_energy', compareDaily(dailySeries(observations, 'active_energy'), today), (c, p) => `Active energy: about ${thousands(convertEnergy(c.recent, 'kJ', unit))} ${unit} a day, ${dir(p)} from ${thousands(convertEnergy(c.before, 'kJ', unit))} (${signedPct(p)}).`);

  // Workout minutes per week: weeks without a workout count as 0, so both windows are whole 3-week totals.
  const w = windows(today);
  const sessions = dailySeries(observations, 'exercise_session', 'sum');
  const total = (from: LocalDate, to: LocalDate) => inRange(sessions, from, to).reduce((s, p) => s + p.value, 0);
  const sessionDays = (from: LocalDate, to: LocalDate) => inRange(sessions, from, to).length;
  if (sessionDays(...w.before) >= 3) {
    const recent = total(...w.recent) / 3;
    const before = total(...w.before) / 3;
    const p = pct(recent, before);
    if (p !== null && Math.abs(p) >= MIN_CHANGE) out.push({ metric: 'exercise_minutes', direction: p < 0 ? 'down' : 'up', text: `Workouts: about ${thousands(recent)} minutes a week, ${dir(p)} from ${thousands(before)} (${signedPct(p)}).` });
  }

  // Food logging: fewer logged days often means less complete intake records, not less eating.
  const logged = new Set([...mealLogs.map((m) => m.date), ...observations.filter((o) => o.metric === 'energy_intake' && o.kind === 'observed').map((o) => o.date)]);
  const days = (from: LocalDate, to: LocalDate) => [...logged].filter((d) => d >= from && d <= to).length;
  const rDays = days(...w.recent);
  const bDays = days(...w.before);
  if (bDays >= MIN_DAYS && bDays - rDays >= 5) out.push({ metric: 'food_logging', direction: 'down', text: `Food logged on ${rDays} of the last 21 days, down from ${bDays}. Unlogged meals make intake look lower than it is.` });

  return out;
}

import { formatMeasurement } from '../format';
import type { LocalDate } from '../plan/dates';
import type { Measurement, Plan } from '../plan/schema';
import { observationSource } from './format';
import { measurementMetric } from './planMetrics';
import type { Observation } from './types';

/**
 * One body-measurement tile on the Daily Log (#108). Pure. Every plan measurement shows on every day: its latest
 * value on or before the day with the date it was measured (never implying an older value is today's), or an
 * obvious "Add" when there is none. The cadence (e.g. waist on Sundays) only adds a "Due today" hint.
 */
export type MeasurementTile = {
  /** "82.4 kg"; null when nothing has been recorded on or before this day. */
  value: string | null;
  /** The value was measured on this day. */
  today: boolean;
  /** "Measured 8 Nov", "Due today", the source of today's value, or the goal. */
  detail: string | null;
  /** The goal and what's left, when it isn't already the detail. */
  goal: string | null;
  action: 'Add' | 'Edit' | 'Log';
  due: boolean;
};

/** "3 Nov": short enough for a half-width tile; the year only when it isn't this year's. */
const dayMonth = (d: LocalDate, today: LocalDate) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });

export function measurementTile(plan: Plan, m: Measurement, latest: Observation | null | undefined, date: LocalDate, due: boolean): MeasurementTile {
  const entry = latest && latest.date <= date ? { ...latest, value: measurementMetric(plan, m).toPlan(latest.value) } : null;
  const today = entry?.date === date;
  const goal = plan.goals.find((g) => g.measurementId === m.id);
  let goalText = goal ? `${goal.label} ${formatMeasurement(plan, m, goal.target)}` : null;
  if (goal && entry) {
    const gap = goal.direction === 'increase' ? goal.target - entry.value : entry.value - goal.target;
    if (goal.direction !== 'maintain' && gap > 0) goalText += ` · ${formatMeasurement(plan, m, gap)} to go`;
  }
  const via = today && entry.source.type !== 'manual' ? observationSource(entry) : null;
  const measured = entry && !today ? `Measured ${dayMonth(entry.date, date)}${due ? ' · due today' : ''}` : null;
  const detail = measured ?? via ?? (!entry && due ? 'Due today' : goalText);
  return {
    value: entry ? formatMeasurement(plan, m, entry.value) : null,
    today,
    detail,
    goal: detail === goalText ? null : goalText,
    action: !entry ? 'Add' : today ? 'Edit' : 'Log',
    due,
  };
}

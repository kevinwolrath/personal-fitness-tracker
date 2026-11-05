import type { DayPart, Plan } from '../plan/schema';

type ActivityKind = Plan['activities'][number]['kind'];

/** Broad day parts in local minutes since midnight (contract 08). Deliberately simple; not a calendar. */
export const PARTS: Record<Exclude<DayPart, 'anytime'>, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 11 * 60 },
  lunch: { start: 11 * 60, end: 14 * 60 },
  afternoon: { start: 14 * 60, end: 17 * 60 + 30 },
  evening: { start: 17 * 60 + 30, end: 22 * 60 },
};

export type Window = {
  part: DayPart;
  /** Scheduled minute (since local midnight): the exact time, or the start of the day part; 0 for anytime. */
  at: number;
  /** When it becomes due ("Do this next"): `at` minus its lead time for an exact time. */
  start: number;
  end: number;
  /** Exact "HH:MM" when the plan gives one. */
  time: string | null;
};

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function partOfMinute(min: number): Exclude<DayPart, 'anytime'> {
  if (min < PARTS.morning.end) return 'morning';
  if (min < PARTS.lunch.end) return 'lunch';
  if (min < PARTS.afternoon.end) return 'afternoon';
  return 'evening';
}

/** Format defaults: minutes before an exact time that an item becomes due, by activity kind (contract 08, #51). */
export const DEFAULT_LEAD_MINUTES: Record<ActivityKind, number> = { meal: 15, habit: 15, exercise: 30 };

/** Lead time for an item: its own `leadMinutes` > the plan's `timing.leadMinutes[kind]` > the format default. */
export function leadMinutesFor(plan: Pick<Plan, 'timing'>, kind: ActivityKind, own?: number): number {
  return own ?? plan.timing?.leadMinutes?.[kind] ?? DEFAULT_LEAD_MINUTES[kind];
}

/**
 * An exact time is due from `leadMinutes` before it until it has had its duration (at least an hour);
 * a day part is due for the whole part; anytime spans the day.
 */
export function windowFor(opts: { time?: string; when?: DayPart; durationMaxMinutes?: number; leadMinutes?: number }): Window {
  if (opts.time) {
    const t = toMinutes(opts.time);
    const lead = opts.leadMinutes ?? 30;
    return { part: partOfMinute(t), at: t, start: Math.max(0, t - lead), end: Math.min(24 * 60, t + Math.max(60, opts.durationMaxMinutes ?? 0)), time: opts.time };
  }
  const part = opts.when ?? 'anytime';
  if (part === 'anytime') return { part, at: 0, start: 0, end: 24 * 60, time: null };
  return { part, at: PARTS[part].start, ...PARTS[part], time: null };
}

export const partLabels: Record<DayPart, string> = {
  morning: 'Morning',
  lunch: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime today',
};
export const partOrder: DayPart[] = ['morning', 'lunch', 'afternoon', 'evening', 'anytime'];

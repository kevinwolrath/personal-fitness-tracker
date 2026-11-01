import type { DayPart } from '../plan/schema';

/** Broad day parts in local minutes since midnight (contract 08). Deliberately simple; not a calendar. */
export const PARTS: Record<Exclude<DayPart, 'anytime'>, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 11 * 60 },
  lunch: { start: 11 * 60, end: 14 * 60 },
  afternoon: { start: 14 * 60, end: 17 * 60 + 30 },
  evening: { start: 17 * 60 + 30, end: 22 * 60 },
};

export type Window = {
  part: DayPart;
  /** Minutes since local midnight. */
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

/**
 * An exact time is "current" from 30 min before until it has had its duration (at least an hour);
 * a day part is current for the whole part; anytime spans the day.
 */
export function windowFor(opts: { time?: string; when?: DayPart; durationMaxMinutes?: number }): Window {
  if (opts.time) {
    const t = toMinutes(opts.time);
    return { part: partOfMinute(t), start: Math.max(0, t - 30), end: Math.min(24 * 60, t + Math.max(60, opts.durationMaxMinutes ?? 0)), time: opts.time };
  }
  const part = opts.when ?? 'anytime';
  if (part === 'anytime') return { part, start: 0, end: 24 * 60, time: null };
  return { part, ...PARTS[part], time: null };
}

export const partLabels: Record<DayPart, string> = {
  morning: 'Morning',
  lunch: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime today',
};
export const partOrder: DayPart[] = ['morning', 'lunch', 'afternoon', 'evening', 'anytime'];

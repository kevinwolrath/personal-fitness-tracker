import { KJ_PER_KCAL } from '../energy';
import type { Observation } from '../observations/types';
import type { LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { dailySeries, type Point } from './series';

/**
 * Energy burned per day (Progress "Energy eaten vs burned" and "Energy balance"). Pure. All values in kJ.
 *
 * Two sources, never added together:
 * - **Total energy burned** (`total_energy`): a wearable's or app's whole-day total, entered, read from a screenshot
 *   or imported. When a day has one, it is that day's value.
 * - Otherwise, **active energy** (`active_energy`, what Health Connect provides as ActiveCaloriesBurned) plus an
 *   **estimated resting energy** (Mifflin–St Jeor, from the user's own height, age, sex and latest weight). Active
 *   energy alone is never shown as "burned": it leaves out the ~1,500–2,000 kcal the body uses at rest, and a
 *   balance against it would be wildly wrong. Active energy is never added to a total (that would double count).
 *
 * Resting energy is an estimate (±10–15% for most people), so these points are kind `estimate`.
 */

export type RestingInputs = { heightCm: number; age: number; sex: 'male' | 'female' | 'unknown' };
export type BurnedPoint = Point & { basis: 'total' | 'resting+active' };
export type Expenditure = {
  points: BurnedPoint[];
  /** Why resting energy can't be estimated (so active-energy days can't become "burned"), or null when it can. */
  missing: string[] | null;
  /** Days with active energy but no total and no estimate possible. */
  activeOnlyDays: number;
};

/** Ages used for the setup age bands when no exact age was given: the middle of each band. */
const bandAge: Record<string, number | null> = { under_18: null, '18_39': 29, '40_59': 50, '60_plus': 67 };

/** What the resting estimate needs, from the user's own profile answers (never assumed). */
export function restingInputs(plan: Plan): { inputs: Omit<RestingInputs, never> | null; missing: string[] } {
  const p = plan.profile;
  const missing: string[] = [];
  const heightCm = p?.heightCm;
  if (!heightCm) missing.push('height');
  const age = p?.age ?? (p?.ageBand ? bandAge[p.ageBand] : undefined);
  if (age === undefined) missing.push('age');
  if (age === null) return { inputs: null, missing: ['adult age (resting energy estimates are for adults)'] };
  if (missing.length || !heightCm || age === undefined) return { inputs: null, missing };
  const sex = p?.gender === 'male' ? 'male' : p?.gender === 'female' ? 'female' : 'unknown';
  return { inputs: { heightCm, age, sex }, missing: [] };
}

/** Resting energy, kcal/day (Mifflin–St Jeor). Unknown sex uses the midpoint of the two equations. */
export function restingKcal(weightKg: number, i: RestingInputs): number {
  const base = 10 * weightKg + 6.25 * i.heightCm - 5 * i.age;
  return base + (i.sex === 'male' ? 5 : i.sex === 'female' ? -161 : -78);
}

/** The latest weigh-in on or before `date`, else the earliest after it, else the setup weight; kg. */
function weightOn(date: LocalDate, weights: Point[], setupKg: number | null): number | null {
  let before: Point | null = null;
  for (const w of weights) if (w.date <= date) before = w;
  return before?.value ?? weights.find((w) => w.date > date)?.value ?? setupKg;
}

export function expenditureSeries(observations: Observation[], plan: Plan): Expenditure {
  const totals = dailySeries(observations, 'total_energy');
  const totalDays = new Set(totals.map((p) => p.date));
  const active = dailySeries(observations, 'active_energy').filter((p) => !totalDays.has(p.date));
  const { inputs, missing } = restingInputs(plan);
  const weights = dailySeries(observations, 'weight');
  const setupKg = plan.profile?.weight ? (plan.units.mass === 'lb' ? plan.profile.weight * 0.45359237 : plan.profile.weight) : null;

  const points: BurnedPoint[] = totals.map((p) => ({ ...p, kind: 'estimate', basis: 'total' }));
  let activeOnlyDays = 0;
  let noWeight = false;
  for (const a of active) {
    const kg = inputs ? weightOn(a.date, weights, setupKg) : null;
    if (!inputs || kg === null) {
      activeOnlyDays++;
      if (inputs && kg === null) noWeight = true;
      continue;
    }
    points.push({ date: a.date, value: restingKcal(kg, inputs) * KJ_PER_KCAL + a.value, kind: 'estimate', source: a.source, app: a.app, basis: 'resting+active' });
  }
  points.sort((x, y) => x.date.localeCompare(y.date));
  const why = !inputs ? missing : noWeight ? ['weight'] : null;
  return { points, missing: activeOnlyDays ? why : null, activeOnlyDays };
}

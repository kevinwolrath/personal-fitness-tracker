import type { Observation } from '../observations/types';
import { nutrientKeys, type MealLog, type NutrientKey } from './contract';
import type { ConfirmedMeal } from './plannedMeals';
import { mealTotals } from './totals';

/**
 * What was eaten on a day (#97, contract 15 "Day totals"). Pure.
 *
 * Two sources, never added together:
 * - **Meals**: logged meals (`MealLog`), summed once each from their food items, plus **ticked planned meals** (#154,
 *   `plannedMeals.ts`) at their planned estimates. A ticked meal that was replaced by a logged meal counts only as the
 *   logged meal. Planned values cover energy and protein only.
 * - **A day total** recorded elsewhere: an `energy_intake` / `protein_intake` observation entered by hand, read
 *   from a screenshot or imported. A day total already covers the whole day, so when one exists for a nutrient it
 *   is the day's value and the logged meals are **not** added on top (no double counting).
 * Carbohydrate and fat have no day-total metric, so they always come from logged meals.
 */

const dayMetric: Partial<Record<NutrientKey, string>> = { energyKj: 'energy_intake', proteinG: 'protein_intake' };

export type IntakeValue = {
  value: number;
  from: 'meals' | 'day-total';
  /** Logged meals whose food items don't all state this nutrient, or ticked meals the plan gives no value for: the sum may be low. */
  incomplete: boolean;
};

export type DayIntake = {
  meals: MealLog[];
  /** Ticked planned meals counted at their planned estimates (#154). */
  confirmed: ConfirmedMeal[];
  values: Record<NutrientKey, IntakeValue | null>;
  /** A day total from another source is used instead of the logged meals for these nutrients. */
  overridden: NutrientKey[];
};

const userFirst = (o: Observation) => (o.source.type === 'integration' ? 1 : 0);

/** The day's own total for a metric: the same precedence as everywhere else (user entry first, then the latest). */
export function dayTotal(observations: Observation[], metric: string, date: string): Observation | null {
  const os = observations.filter((o) => o.metric === metric && o.date === date && o.kind === 'observed' && Number.isFinite(o.value));
  return os.sort((a, b) => userFirst(a) - userFirst(b) || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0] ?? null;
}

const plannedValue: Partial<Record<NutrientKey, (c: ConfirmedMeal) => number | null>> = { energyKj: (c) => c.energyKj, proteinG: (c) => c.proteinG };

export function dayIntake(date: string, mealLogs: MealLog[], observations: Observation[], confirmedMeals: ConfirmedMeal[] = []): DayIntake {
  const meals = mealLogs.filter((m) => m.date === date);
  const confirmed = confirmedMeals.filter((c) => c.date === date);
  const totals = meals.map((m) => mealTotals(m.items));
  const values = {} as Record<NutrientKey, IntakeValue | null>;
  const overridden: NutrientKey[] = [];
  for (const k of nutrientKeys) {
    const metric = dayMetric[k];
    const total = metric ? dayTotal(observations, metric, date) : null;
    const planned = plannedValue[k];
    const plannedValues = planned ? confirmed.map(planned) : [];
    const known = [...totals.map((t) => t[k]), ...plannedValues].filter((v): v is number => v !== null);
    if (total) {
      values[k] = { value: total.value, from: 'day-total', incomplete: false };
      if (meals.length || (planned && confirmed.length)) overridden.push(k);
    } else if (known.length) {
      values[k] = { value: known.reduce((s, v) => s + v, 0), from: 'meals', incomplete: totals.some((t) => t.unknown[k] > 0) || plannedValues.some((v) => v === null) };
    } else values[k] = null;
  }
  return { meals, confirmed, values, overridden };
}

/** Dates with a logged meal or a ticked planned meal, sorted. */
export const mealDates = (mealLogs: MealLog[], confirmed: ConfirmedMeal[] = []) => [...new Set([...mealLogs.map((m) => m.date), ...confirmed.map((c) => c.date)])].sort();

/** Logged-meal sums per date for one nutrient (dates where no meal states it are absent, never zero). */
export function mealSumsByDate(mealLogs: MealLog[], key: NutrientKey): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of mealLogs) {
    const v = mealTotals(m.items)[key];
    if (v === null) continue;
    out.set(m.date, (out.get(m.date) ?? 0) + v);
  }
  return out;
}

/** Map a day-total metric id to the meal nutrient it covers, for Progress. */
export const nutrientForMetric = (metric: string): NutrientKey | null =>
  (Object.entries(dayMetric).find(([, m]) => m === metric)?.[0] as NutrientKey | undefined) ?? null;

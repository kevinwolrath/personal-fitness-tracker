import type { Observation } from '../observations/types';
import { nutrientKeys, type MealLog, type NutrientKey } from './contract';
import { mealTotals } from './totals';

/**
 * What was eaten on a day (#97, contract 15 "Day totals"). Pure.
 *
 * Two sources, never added together:
 * - **Logged meals** (`MealLog`): summed, each meal once, from its food items.
 * - **A day total** recorded elsewhere: an `energy_intake` / `protein_intake` observation entered by hand, read
 *   from a screenshot or imported. A day total already covers the whole day, so when one exists for a nutrient it
 *   is the day's value and the logged meals are **not** added on top (no double counting).
 * Ticked planned meals never count (contract 14): a replaced meal's plan recipe is never part of either source.
 * Carbohydrate and fat have no day-total metric, so they always come from logged meals.
 */

const dayMetric: Partial<Record<NutrientKey, string>> = { energyKj: 'energy_intake', proteinG: 'protein_intake' };

export type IntakeValue = {
  value: number;
  from: 'meals' | 'day-total';
  /** Logged meals whose food items don't all state this nutrient: the meal sum may be low. */
  incomplete: boolean;
};

export type DayIntake = {
  meals: MealLog[];
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

export function dayIntake(date: string, mealLogs: MealLog[], observations: Observation[]): DayIntake {
  const meals = mealLogs.filter((m) => m.date === date);
  const totals = meals.map((m) => mealTotals(m.items));
  const values = {} as Record<NutrientKey, IntakeValue | null>;
  const overridden: NutrientKey[] = [];
  for (const k of nutrientKeys) {
    const metric = dayMetric[k];
    const total = metric ? dayTotal(observations, metric, date) : null;
    const known = totals.map((t) => t[k]).filter((v): v is number => v !== null);
    if (total) {
      values[k] = { value: total.value, from: 'day-total', incomplete: false };
      if (meals.length) overridden.push(k);
    } else if (known.length) {
      values[k] = { value: known.reduce((s, v) => s + v, 0), from: 'meals', incomplete: totals.some((t) => t.unknown[k] > 0) };
    } else values[k] = null;
  }
  return { meals, values, overridden };
}

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

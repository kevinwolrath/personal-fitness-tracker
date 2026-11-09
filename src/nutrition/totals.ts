import { nutrientKeys, nutrientLabels, type MealItem, type NutrientKey, type Nutrients } from './contract';

/**
 * Meal totals (#97). Pure. Totals are always recalculated from the food items: the AI's own totals are only
 * compared, never used. Unknown (null) values are never filled in: a total with unknown items is "at least".
 */

export type MealTotals = Nutrients & {
  /** Per nutrient, how many items don't state it. A total with any unknown item may be low. */
  unknown: Record<NutrientKey, number>;
};

export function mealTotals(items: Pick<MealItem, NutrientKey>[]): MealTotals {
  const sum = {} as Nutrients;
  const unknown = {} as Record<NutrientKey, number>;
  for (const k of nutrientKeys) {
    const known = items.map((i) => i[k]).filter((v): v is number => v !== null && Number.isFinite(v));
    sum[k] = known.length ? known.reduce((s, v) => s + v, 0) : null;
    unknown[k] = items.length - known.length;
  }
  return { ...sum, unknown };
}

/** Tolerance before a difference is worth showing: 10%, and at least 100 kJ or 3 g. */
const tolerance: Record<NutrientKey, number> = { energyKj: 100, proteinG: 3, carbsG: 3, fatG: 3 };

export type Discrepancy = { key: NutrientKey; ai: number; items: number | null; message: string };

const fmt = (n: number, unit: 'kJ' | 'g') => `${new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(n)} ${unit}`;

/** Where the AI's totals and the item sums disagree (for the user to review). */
export function totalsDiscrepancies(ai: Nutrients | null, totals: MealTotals): Discrepancy[] {
  if (!ai) return [];
  const out: Discrepancy[] = [];
  for (const k of nutrientKeys) {
    const a = ai[k];
    if (a === null) continue;
    const s = totals[k];
    const { label, unit } = nutrientLabels[k];
    if (s === null) {
      out.push({ key: k, ai: a, items: null, message: `${label}: the AI’s total is ${fmt(a, unit)}, but no food states it.` });
      continue;
    }
    const diff = Math.abs(a - s);
    if (diff > tolerance[k] && diff > 0.1 * Math.max(a, s)) {
      out.push({ key: k, ai: a, items: s, message: `${label}: the AI’s total is ${fmt(a, unit)}; the foods add up to ${fmt(s, unit)}.` });
    }
  }
  return out;
}

/**
 * Energy implied by the macros (17 kJ/g protein and carbohydrate, 37 kJ/g fat). An item whose stated energy is far
 * from that (more than 35% and 200 kJ, with all three macros known) is flagged: one of its numbers is likely wrong.
 */
export function energyMismatch(item: Pick<MealItem, NutrientKey>): number | null {
  const { energyKj, proteinG, carbsG, fatG } = item;
  if (energyKj === null || proteinG === null || carbsG === null || fatG === null) return null;
  const implied = 17 * proteinG + 17 * carbsG + 37 * fatG;
  const diff = Math.abs(implied - energyKj);
  return diff > 200 && diff > 0.35 * Math.max(implied, energyKj) ? Math.round(implied) : null;
}

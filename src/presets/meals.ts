import data from '../../presets/meal-templates.json';
import type { dietaryNeeds } from '../plan/schema';

/**
 * Bundled sample meals (#53), pure. Suggestions for a starter plan, never logged intake. No energy or nutrient
 * targets: portions are hand-sized. Dietary needs and allergies are applied to the first choice and to every
 * swap; a meal slot with no safe template is left unplanned rather than inventing one.
 */
export const mealSlots = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof mealSlots)[number];
export type Diet = (typeof dietaryNeeds)[number];
export type MealTemplate = {
  id: string;
  slot: MealSlot;
  label: string;
  contains: string[];
  ingredients: { name: string; measure: string }[];
  preparation: string;
};

export const mealTemplates = data.meals as MealTemplate[];

/** What each dietary need rules out. Peanuts are listed as nuts in the templates. */
const excludes: Record<Diet, string[]> = {
  vegetarian: ['meat', 'fish'],
  vegan: ['meat', 'fish', 'dairy', 'egg'],
  dairy_free: ['dairy'],
  gluten_free: ['gluten'],
  nut_allergy: ['nuts'],
};

export const isSafe = (m: MealTemplate, diet: Diet[]) => !diet.some((d) => excludes[d].some((x) => m.contains.includes(x)));

/** Safe templates per slot, in bundled order. A slot may be empty. */
export function safeMeals(diet: Diet[]): Record<MealSlot, MealTemplate[]> {
  return Object.fromEntries(mealSlots.map((s) => [s, mealTemplates.filter((m) => m.slot === s && isSafe(m, diet))])) as Record<MealSlot, MealTemplate[]>;
}

/** Which slots a day plans: a snack only when it suits the goals (faster loss keeps three meals). */
export const plannedSlots = (goals: string[]): MealSlot[] => (goals.includes('faster_loss') ? ['breakfast', 'lunch', 'dinner'] : [...mealSlots]);

/**
 * One sample day for option `n` (0, 1, 2): a different template per slot for each option where there are enough.
 * `swaps` replace a slot's meal (by id, only if it's safe) or leave it unplanned (null).
 */
export function mealDay(
  options: Record<MealSlot, MealTemplate[]>,
  slots: MealSlot[],
  n: number,
  swaps: Partial<Record<MealSlot, string | null>> = {},
): Partial<Record<MealSlot, MealTemplate>> {
  const day: Partial<Record<MealSlot, MealTemplate>> = {};
  for (const s of slots) {
    const safe = options[s];
    if (!safe.length) continue;
    if (s in swaps) {
      const id = swaps[s];
      const chosen = id ? safe.find((m) => m.id === id) : undefined;
      if (chosen) day[s] = chosen;
      continue; // null or not safe: unplanned
    }
    day[s] = safe[n % safe.length];
  }
  return day;
}

const when: Record<MealSlot, string> = { breakfast: 'morning', lunch: 'lunch', dinner: 'evening', snack: 'afternoon' };

/** Plan activities (kind meal) for a sample day. Suggestions: optional, with no nutrition values. */
export function mealActivities(day: Partial<Record<MealSlot, MealTemplate>>): Record<string, unknown>[] {
  return mealSlots.flatMap((s) => {
    const m = day[s];
    if (!m) return [];
    return [
      {
        id: s,
        kind: 'meal',
        label: m.label,
        detail: 'Sample meal, a suggestion only · check ingredients and allergens',
        when: when[s],
        purpose: 'nutrition',
        required: false,
        ingredients: m.ingredients,
        ...(m.preparation ? { preparation: m.preparation } : {}),
      },
    ];
  });
}

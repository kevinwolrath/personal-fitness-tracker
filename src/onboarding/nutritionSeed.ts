import { safeMeals, type Diet, type MealSlot, type MealTemplate } from '../presets/meals';

/**
 * How a new user's nutrition is initialised (#49, #53). Today: the bundled sample meals (`presets/`), with
 * hand-sized portions and no energy or nutrient targets. The separate nutrition specification will replace
 * this provider with `setNutritionSeed`, without changing the wizard, its prompt or its review.
 */
export type NutritionSeed = {
  id: string;
  /** Safe sample meals per slot for these dietary needs (empty slot = leave that meal unplanned). */
  mealOptions(diet: Diet[]): Record<MealSlot, MealTemplate[]>;
  /** Extra instructions for the AI about nutrition, or null to tell it to leave nutrition out. */
  prompt(profile: Record<string, unknown>): string | null;
  /** Whether a nutrition section in the AI's reply may be applied. */
  allowsAiNutrition: boolean;
};

/** The bundled sample meals. The AI is asked to leave nutrition alone: meals are edited in the app. */
export const presetMeals: NutritionSeed = {
  id: 'preset-meals',
  mealOptions: safeMeals,
  prompt: () => null,
  allowsAiNutrition: false,
};

/** No meals at all (tracking only, or a future spec that plans nutrition differently). */
export const noNutritionSeed: NutritionSeed = {
  id: 'none',
  mealOptions: () => ({ breakfast: [], lunch: [], dinner: [], snack: [] }),
  prompt: () => null,
  allowsAiNutrition: false,
};

let active: NutritionSeed = presetMeals;

export const activeNutritionSeed = (): NutritionSeed => active;

/** Register the nutrition seed (when its specification is implemented), or reset to the bundled meals. */
export function setNutritionSeed(seed: NutritionSeed | null): void {
  active = seed ?? presetMeals;
}

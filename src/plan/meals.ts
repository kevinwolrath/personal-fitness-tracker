import { formatAmount } from '../format';
import type { Activity, Ingredient, Plan } from './schema';

export type IngredientLine = {
  name: string;
  /** Target amount from the plan: "200 g", "250 ml", or both. Null when the plan gives only a measure. */
  amount: string | null;
  /** The plan's everyday measure, exactly as written ("~¾ cup"). Never computed by the app. */
  measure: string | null;
};

export type MealView = {
  ingredients: IngredientLine[];
  preparation: string | null;
  /** "≈ 1,780 kJ · 42 g protein", from the meal's existing `nutrition`, in plan target order. */
  nutrition: string | null;
};

const amountOf = (g: Ingredient, plan: Plan): string | null => {
  const n = (v: number) => formatAmount(plan, 'grams', v).replace(/ g$/, '');
  const parts = [g.grams !== undefined ? `${n(g.grams)} g` : null, g.ml !== undefined ? `${n(g.ml)} ml` : null].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
};

/** The meal's planned energy and protein (or whatever targets it states), formatted like the Daily Log. */
export function mealNutrition(plan: Plan, a: Activity): string | null {
  if (!a.nutrition) return null;
  const parts = plan.nutrition.targets
    .filter((t) => a.nutrition![t.id] !== undefined)
    .map((t) => (t.quantity === 'energy' ? formatAmount(plan, t.quantity, a.nutrition![t.id]) : `${formatAmount(plan, t.quantity, a.nutrition![t.id])} ${t.label.toLowerCase()}`));
  return parts.length ? `≈ ${parts.join(' · ')}` : null;
}

/**
 * What to prepare for a meal (contract 03 formatVersion 3, #26). Pure: renders whatever the plan says;
 * no meal, ingredient or amount lives in UI code. Null for non-meals or meals with nothing to show.
 */
export function mealView(plan: Plan, a: Activity): MealView | null {
  if (a.kind !== 'meal') return null;
  const view: MealView = {
    ingredients: (a.ingredients ?? []).map((g) => ({ name: g.name, amount: amountOf(g, plan), measure: g.measure ?? null })),
    preparation: a.preparation ?? null,
    nutrition: mealNutrition(plan, a),
  };
  return view.ingredients.length || view.preparation || view.nutrition ? view : null;
}

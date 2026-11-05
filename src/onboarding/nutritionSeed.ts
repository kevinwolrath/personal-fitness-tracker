import type { RawPlan } from '../config/sections';

/**
 * How a new user's nutrition is initialised (#49). Deliberately empty for now: the nutrition seed is specified
 * separately and will plug in here as a provider, with no change to the wizard, its prompt builder or its review.
 *
 * Until then: no default diet, no meal plans, no energy targets, and the setup prompt asks the AI to leave
 * nutrition out (an AI's nutrition section is dropped, and the review says so).
 */
export type NutritionSeed = {
  id: string;
  /** Adds nutrition to the starter plan for this profile. Must return a valid plan; pure. */
  apply(raw: RawPlan, profile: Record<string, unknown>): RawPlan;
  /** Extra instructions for the AI about nutrition, or null to tell it to leave nutrition out. */
  prompt(profile: Record<string, unknown>): string | null;
  /** Whether a nutrition section in the AI's reply may be applied. */
  allowsAiNutrition: boolean;
};

/** The only provider today: changes nothing, asks for nothing. */
export const noNutritionSeed: NutritionSeed = {
  id: 'none',
  apply: (raw) => raw,
  prompt: () => null,
  allowsAiNutrition: false,
};

let active: NutritionSeed = noNutritionSeed;

export const activeNutritionSeed = (): NutritionSeed => active;

/** Register the nutrition seed (when its specification is implemented), or reset to none. */
export function setNutritionSeed(seed: NutritionSeed | null): void {
  active = seed ?? noNutritionSeed;
}

import type { RawPlan } from '../config/sections';
import { CURRENT_FORMAT_VERSION, weekdays } from '../plan/schema';
import { toProfile, type Draft } from './draft';
import { activeNutritionSeed, type NutritionSeed } from './nutritionSeed';

/** The id of a plan created by first-run setup. */
export const STARTER_PLAN_ID = 'my-plan';

/**
 * A new user's starting plan (#49): their profile, weight tracking and nothing else. No workouts, no meals,
 * no diet and no goal targets: nothing is copied from anyone else's plan. An AI suggestion (or Configure with
 * AI later) adds a schedule on top of this; the nutrition seed adds nutrition once it exists.
 */
export function buildStarterPlan(d: Draft, seed: NutritionSeed = activeNutritionSeed()): RawPlan {
  const profile = toProfile(d);
  const imperial = d.unit === 'lb';
  const raw: RawPlan = {
    format: 'pft-plan',
    formatVersion: CURRENT_FORMAT_VERSION,
    id: STARTER_PLAN_ID,
    revision: 1,
    title: 'My plan',
    units: { mass: d.unit, energy: imperial ? 'kcal' : 'kJ', length: imperial ? 'in' : 'cm' },
    dayTypes: [{ id: 'everyday', label: 'Every day' }],
    schedule: Object.fromEntries(weekdays.map((w) => [w, 'everyday'])),
    measurements: [{ id: 'weight', label: 'Weight', quantity: 'mass', decimals: 1, cadence: { every: 'day' } }],
    goals: [],
    nutrition: { targets: [] },
    activities: [],
    quickLogs: [],
    ...(Object.keys(profile).length ? { profile } : {}),
  };
  return seed.apply(raw, profile);
}

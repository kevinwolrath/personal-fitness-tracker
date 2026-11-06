import type { RawPlan } from '../config/sections';
import { CURRENT_FORMAT_VERSION, weekdays } from '../plan/schema';
import { exerciseStarter, exerciseStyles } from '../presets/exercisePlan';
import { mealActivities, mealDay, plannedSlots } from '../presets/meals';
import { isMinor, toProfile, type Draft } from './draft';
import { activeNutritionSeed, type NutritionSeed } from './nutritionSeed';

/** The id of a plan created by first-run setup. */
export const STARTER_PLAN_ID = 'my-plan';

/**
 * A new user's starting plan (#49, #53): their profile, weight tracking and, for adults, an offline starter
 * plan from the bundled presets (an exercise week with a rest day, and sample meals that respect their dietary
 * needs). Under 18: tracking only. Nothing is copied from anyone else's plan, and no energy targets are set.
 */
export function buildStarterPlan(d: Draft, seed: NutritionSeed = activeNutritionSeed()): RawPlan {
  const profile = toProfile(d);
  const imperial = d.unit === 'lb';
  let activities: Record<string, unknown>[] = [];
  let exercise: Record<string, unknown> | undefined;
  if (!isMinor(d)) {
    const ex = exerciseStarter({
      goals: d.fitnessGoals,
      activityLevel: d.activityLevel,
      equipment: d.equipment,
      limitations: d.physicalLimits,
      daysPerWeek: d.daysPerWeek,
      style: exerciseStyles[d.exerciseOption]?.id,
    });
    const meals = mealActivities(mealDay(seed.mealOptions(d.dietary), plannedSlots(d.fitnessGoals), d.mealOption, d.mealSwaps));
    activities = [...ex.activities, ...meals].filter((a) => !d.removed.includes(a.id as string));
    exercise = ex.exercise;
  }
  return {
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
    activities,
    quickLogs: [],
    ...(Object.keys(profile).length ? { profile } : {}),
    ...(exercise ? { exercise } : {}),
  };
}

/**
 * "Edit setup answers" on an existing plan (#53): the new schedule, profile and exercise settings, as the next
 * revision of the same plan (same id, so history stays attached). Kept as they were: measurements, measurement
 * goals, nutrition targets, quick logs and due times. Never applied without the user's confirmation.
 */
export function replanExisting(current: RawPlan, setup: RawPlan): RawPlan {
  const keepMeasurements = [...(current.measurements ?? [])];
  for (const m of setup.measurements) if (!keepMeasurements.some((x: { id: string }) => x.id === m.id)) keepMeasurements.push(m);
  const next: RawPlan = {
    ...current,
    formatVersion: CURRENT_FORMAT_VERSION,
    revision: (Number(current.revision) || 0) + 1,
    units: { ...current.units, mass: setup.units.mass },
    dayTypes: setup.dayTypes,
    schedule: setup.schedule,
    activities: setup.activities,
    measurements: keepMeasurements,
    profile: { ...stripSetupProfile(current.profile), ...(setup.profile ?? {}) },
  };
  delete next.requirements; // the old schedule's requirements belonged to its activities
  // Targets limited to the old day types would point at day types that no longer exist: they now apply every day.
  next.nutrition = {
    ...(current.nutrition ?? {}),
    targets: (current.nutrition?.targets ?? []).map((t: Record<string, any>) => {
      if (!t.appliesTo?.dayTypes) return t;
      const { appliesTo: _gone, ...rest } = t;
      return rest;
    }),
  };
  if (setup.exercise) next.exercise = { ...(current.exercise ?? {}), ...setup.exercise };
  return next;
}

/** The previous setup answers are replaced as a whole (an answer removed this time is removed). */
function stripSetupProfile(p: Record<string, unknown> | undefined): Record<string, unknown> {
  const setupKeys = ['gender', 'ageBand', 'age', 'weightBand', 'weight', 'fitnessGoals', 'daysPerWeek', 'activityLevel', 'equipment', 'physicalLimits', 'dietary', 'considerations'];
  return Object.fromEntries(Object.entries(p ?? {}).filter(([k]) => !setupKeys.includes(k)));
}

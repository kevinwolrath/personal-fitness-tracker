import seedJson from '../../plans/seed.plan.json';
import type { TrackingStore } from '../storage/types';
import { planSchema, type Plan } from './schema';
import { validatePlan } from './validate';

/**
 * Load the active plan, installing the bundled seed on a fresh install (contract 04).
 * A newer seed revision with the same id replaces the stored copy, but only while that copy is still the
 * untouched seed: once the user has changed their configuration (contract 07) the seed never overwrites it.
 * Tracking data is never touched.
 */
export async function loadActivePlan(store: TrackingStore, seed: unknown = seedJson, now = new Date()): Promise<Plan> {
  const stored = await store.getActivePlan();
  const seedResult = validatePlan(seed);
  if (!seedResult.ok) throw new Error(`Bundled seed plan is invalid:\n${seedResult.errors.join('\n')}`);
  const seedPlan = seedResult.plan;

  const storedIsSeed = (stored?.origin ?? 'seed') === 'seed';
  const seedIsNewer = !stored || (storedIsSeed && stored.planId === seedPlan.id && seedPlan.revision > stored.revision);
  if (seedIsNewer) {
    await store.setActivePlan({
      planId: seedPlan.id,
      revision: seedPlan.revision,
      formatVersion: seedPlan.formatVersion,
      json: JSON.stringify(seed),
      importedAt: now.toISOString(),
      origin: 'seed',
    });
    return seedPlan;
  }
  // Stored plans were validated on import; parse only to apply schema defaults.
  return planSchema.parse(JSON.parse(stored!.json));
}

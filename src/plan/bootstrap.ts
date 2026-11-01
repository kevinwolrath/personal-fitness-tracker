import seedJson from '../../plans/seed.plan.json';
import type { TrackingStore } from '../storage/types';
import { planSchema, type Plan } from './schema';
import { validatePlan } from './validate';

/**
 * Load the active plan, installing the bundled seed on a fresh install (contract 04).
 * A newer seed revision with the same id replaces the stored copy; tracking data is untouched.
 */
export async function loadActivePlan(store: TrackingStore, seed: unknown = seedJson, now = new Date()): Promise<Plan> {
  const stored = await store.getActivePlan();
  const seedResult = validatePlan(seed);
  if (!seedResult.ok) throw new Error(`Bundled seed plan is invalid:\n${seedResult.errors.join('\n')}`);
  const seedPlan = seedResult.plan;

  const seedIsNewer = !stored || (stored.planId === seedPlan.id && seedPlan.revision > stored.revision);
  if (seedIsNewer) {
    await store.setActivePlan({
      planId: seedPlan.id,
      revision: seedPlan.revision,
      formatVersion: seedPlan.formatVersion,
      json: JSON.stringify(seed),
      importedAt: now.toISOString(),
    });
    return seedPlan;
  }
  // Stored plans were validated on import; parse only to apply schema defaults.
  return planSchema.parse(JSON.parse(stored!.json));
}

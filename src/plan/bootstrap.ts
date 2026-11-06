import seedJson from '../../plans/seed.plan.json';
import type { TrackingStore } from '../storage/types';
import { planSchema, type Plan } from './schema';
import { validatePlan } from './validate';

/**
 * Load the active plan (contract 04). Returns null on a fresh install: first-run setup (#49) then creates the
 * user's own plan. The bundled seed is never installed for a new user.
 *
 * Installs that already run the bundled seed keep it: a newer seed revision with the same id replaces the stored
 * copy, but only while that copy is still the untouched seed. Once the user has changed their configuration
 * (contract 07) the seed never overwrites it. Tracking data is never touched.
 */
export async function loadActivePlan(store: TrackingStore, seed: unknown = seedJson, now = new Date()): Promise<Plan | null> {
  const stored = await store.getActivePlan();
  if (!stored) return null;
  const storedIsSeed = (stored.origin ?? 'seed') === 'seed';
  if (storedIsSeed) {
    const seedResult = validatePlan(seed);
    if (!seedResult.ok) throw new Error(`Bundled seed plan is invalid:\n${seedResult.errors.join('\n')}`);
    const seedPlan = seedResult.plan;
    if (stored.planId === seedPlan.id && seedPlan.revision > stored.revision) {
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
  }
  // Stored plans were validated on import; parse only to apply schema defaults.
  return planSchema.parse(JSON.parse(stored.json));
}

/** Install the bundled seed plan as the active plan (developer and test use only; never on a user's first run). */
export async function installSeedPlan(store: TrackingStore, seed: unknown = seedJson, now = new Date()): Promise<Plan> {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(`Bundled seed plan is invalid:\n${r.errors.join('\n')}`);
  await store.setActivePlan({ planId: r.plan.id, revision: r.plan.revision, formatVersion: r.plan.formatVersion, json: JSON.stringify(seed), importedAt: now.toISOString(), origin: 'seed' });
  return r.plan;
}

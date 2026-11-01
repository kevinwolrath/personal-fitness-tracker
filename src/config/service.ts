import { planSchema, type Plan } from '../plan/schema';
import { newId, type ConfigChange, type StoredPlan, type TrackingStore } from '../storage/types';
import type { RawPlan } from './sections';

/** Persist an applied update: new plan revision + history entry, atomically. Returns the new stored plan. */
export async function commitConfigUpdate(
  store: TrackingStore,
  current: StoredPlan,
  nextRaw: RawPlan,
  sections: string[],
  payload: unknown,
  now = new Date(),
): Promise<StoredPlan> {
  const next: StoredPlan = {
    planId: current.planId,
    revision: nextRaw.revision,
    formatVersion: nextRaw.formatVersion,
    json: JSON.stringify(nextRaw),
    importedAt: now.toISOString(),
    origin: 'config',
  };
  const change: ConfigChange = {
    id: newId(),
    appliedAt: now.toISOString(),
    sections,
    payload,
    fromRevision: current.revision,
    toRevision: next.revision,
    previousPlanJson: current.json,
  };
  await store.applyConfigChange(next, change);
  return next;
}

/**
 * Undo a change by restoring the plan it replaced, as a new revision (history only ever grows).
 * Only the most recent change can be undone, so nothing applied after it is lost.
 */
export async function undoConfigChange(store: TrackingStore, current: StoredPlan, change: ConfigChange, now = new Date()): Promise<StoredPlan> {
  if (change.toRevision !== current.revision) throw new Error('Only the most recent change can be undone.');
  const previous = JSON.parse(change.previousPlanJson);
  previous.revision = current.revision + 1;
  return commitConfigUpdate(store, current, previous, ['undo'], { undoOf: change.id }, now);
}

export const parseStoredPlan = (p: StoredPlan): Plan => planSchema.parse(JSON.parse(p.json));

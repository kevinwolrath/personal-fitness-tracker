import type { RawPlan } from '../config/sections';
import { measurementMetric } from '../observations/planMetrics';
import { manualSource, type Observation } from '../observations/types';
import type { LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { validatePlan } from '../plan/validate';
import { commitConfigUpdate } from '../config/service';
import { newId, type StoredPlan, type TrackingStore } from '../storage/types';
import { profileOnly, replanExisting } from './starterPlan';
import type { Draft } from './draft';

/**
 * Finish first-run setup (#49): store the confirmed plan, and record a weigh-in only when the user gave an exact
 * weight and ticked the box. A weight band is never recorded. Returns the active plan.
 */
export async function finishSetup(store: TrackingStore, raw: RawPlan, d: Draft, today: LocalDate, now = new Date()): Promise<Plan> {
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(`The plan isn't valid: ${r.errors.join('; ')}`);
  const plan = r.plan;
  await store.setActivePlan({
    planId: plan.id,
    revision: plan.revision,
    formatVersion: plan.formatVersion,
    json: JSON.stringify(raw),
    importedAt: now.toISOString(),
    origin: 'onboarding',
  });
  const weighIn = weighInFor(plan, d, today, now);
  if (weighIn) await store.addObservations([weighIn]);
  return plan;
}

/**
 * "Edit setup answers" on an existing install (#53): the new schedule becomes the next revision of the current
 * plan, recorded in the configuration history so it can be undone (contract 07). Measurements, workout history,
 * imports and earlier revisions are untouched. Call only after the user confirmed the replacement.
 */
export async function applySetupToExisting(store: TrackingStore, current: StoredPlan, setupRaw: RawPlan, d: Draft, today: LocalDate, now = new Date()): Promise<Plan> {
  const nextRaw = replanExisting(JSON.parse(current.json), setupRaw);
  const r = validatePlan(nextRaw);
  if (!r.ok) throw new Error(`The plan isn't valid: ${r.errors.join('; ')}`);
  await commitConfigUpdate(store, current, nextRaw, ['setup'], { setup: setupRaw.profile ?? {} }, now);
  const weighIn = weighInFor(r.plan, d, today, now);
  if (weighIn) await store.addObservations([weighIn]);
  return r.plan;
}

/**
 * "Edit profile" on an existing install (#53): only the setup answers change, as the next revision through the
 * configuration history (undoable). The schedule, day types, meals, activities and targets are untouched.
 */
export async function applyProfileToExisting(store: TrackingStore, current: StoredPlan, d: Draft, today: LocalDate, now = new Date()): Promise<Plan> {
  const nextRaw = profileOnly(JSON.parse(current.json), d);
  const r = validatePlan(nextRaw);
  if (!r.ok) throw new Error(`The profile isn't valid: ${r.errors.join('; ')}`);
  await commitConfigUpdate(store, current, nextRaw, ['profile'], { profile: nextRaw.profile ?? null }, now);
  const weighIn = weighInFor(r.plan, d, today, now);
  if (weighIn) await store.addObservations([weighIn]);
  return r.plan;
}

/** Today's weigh-in from the setup answers, or null (no exact weight, box not ticked, or no weight measurement). */
export function weighInFor(plan: Plan, d: Draft, today: LocalDate, now = new Date()): Observation | null {
  if (d.exactWeight === undefined || !d.logWeighIn) return null;
  const m = plan.measurements.find((x) => x.quantity === 'mass');
  if (!m) return null;
  // The answer was typed in the setup unit; the plan's measurement may use another (an AI could change units).
  const map = measurementMetric({ ...plan, units: { ...plan.units, mass: d.unit } }, m);
  return {
    id: newId(),
    date: today,
    metric: map.metric,
    value: map.toStored(d.exactWeight),
    unit: map.storedUnit,
    kind: 'observed',
    label: null,
    note: null,
    source: manualSource(),
    recordedAt: now.toISOString(),
  };
}

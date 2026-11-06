import type { RawPlan } from '../config/sections';
import { measurementMetric } from '../observations/planMetrics';
import { manualSource, type Observation } from '../observations/types';
import type { LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { validatePlan } from '../plan/validate';
import { newId, type TrackingStore } from '../storage/types';
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

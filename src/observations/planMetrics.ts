import type { Measurement, Plan } from '../plan/schema';
import { canonicalUnit, type Dimension } from './metrics';
import { fromCanonical, toCanonical } from './units';

/**
 * Bridge between a plan measurement (displayed in plan units) and the canonical observation store.
 * A plan measurement's `id` is the metric id it records (contract 03/06), so "weight" in a plan
 * shows weights from any source: manual entry, screenshots, future integrations.
 */
export function measurementMetric(plan: Plan, m: Measurement) {
  const dimension: Dimension | null = m.quantity === 'mass' ? 'mass' : m.quantity === 'length' ? 'length' : null;
  const planUnit = m.quantity === 'mass' ? plan.units.mass : m.quantity === 'length' ? plan.units.length : (m.unitLabel ?? '');
  return {
    metric: m.id,
    storedUnit: dimension ? canonicalUnit[dimension] : planUnit,
    planUnit,
    /** Plan-unit value (as typed) → stored value. */
    toStored: (v: number) => (dimension ? toCanonical(v, planUnit, dimension) ?? v : v),
    /** Stored value → plan-unit value for display. */
    toPlan: (v: number) => (dimension ? fromCanonical(v, planUnit, dimension) ?? v : v),
  };
}

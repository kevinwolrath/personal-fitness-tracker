import { formatEnergyBound, type EnergyDisplay } from '../energy';
import type { Plan } from '../plan/schema';

/**
 * Plan & goals in Settings (#174): a read-only summary of the current plan's daily targets and goals. Pure.
 * Changing them stays with Configure with AI and Edit setup answers.
 */
export function planSummary(plan: Plan, energy: EnergyDisplay): { title: string; targets: string[]; goals: string[] } {
  const bound = (t: { min?: number; max?: number }, unit: string) =>
    t.min !== undefined && t.max !== undefined ? `${t.min}–${t.max} ${unit}` : t.max !== undefined ? `≤ ${t.max} ${unit}` : `≥ ${t.min} ${unit}`;
  const targets = (plan.nutrition?.targets ?? []).map((t) =>
    `${t.label}: ${t.quantity === 'energy' ? formatEnergyBound(t, plan.units.energy, energy) : bound(t, 'g')}`,
  );
  const unitOf = (measurementId: string) => {
    const m = plan.measurements?.find((x) => x.id === measurementId);
    if (!m) return '';
    if (m.unitLabel) return ` ${m.unitLabel}`;
    return m.quantity === 'mass' ? ` ${plan.units.mass}` : m.quantity === 'length' ? ` ${plan.units.length}` : '';
  };
  const verb = { decrease: 'down to', increase: 'up to', maintain: 'hold at' } as const;
  const goals = (plan.goals ?? []).map((g) => `${g.label}: ${verb[g.direction]} ${g.target}${unitOf(g.measurementId)}`);
  return { title: plan.title, targets, goals };
}

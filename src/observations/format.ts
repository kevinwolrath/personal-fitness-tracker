import type { Plan } from '../plan/schema';
import { metricDef } from './metrics';
import type { Observation } from './types';
import { formatMinutes, fromCanonical } from './units';

const num = (n: number, decimals: number) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(n);

/** Human label for an observation: the workout type / on-screen label, else the catalog label. */
export function observationLabel(o: Observation): string {
  if (o.label && (o.metric === 'exercise_session' || o.metric === 'other')) return o.label;
  return metricDef(o.metric)?.label ?? o.label ?? o.metric;
}

/** Display an observation in the plan's units where the plan has a preference (kg/lb, kJ/kcal, cm/in). */
export function formatObservationValue(o: Observation, plan: Plan): string {
  const def = metricDef(o.metric);
  if (!def) return `${num(o.value, 2)}${o.unit ? ` ${o.unit}` : ''}`;
  switch (def.dimension) {
    case 'duration':
      return formatMinutes(o.value);
    case 'mass':
    case 'mass_change': {
      const v = fromCanonical(o.value, plan.units.mass, 'mass') ?? o.value;
      const sign = def.dimension === 'mass_change' && v > 0 ? '+' : '';
      return `${sign}${num(v, 2)} ${plan.units.mass}`;
    }
    case 'length':
      return `${num(fromCanonical(o.value, plan.units.length, 'length') ?? o.value, 1)} ${plan.units.length}`;
    case 'energy':
      return `${num(Math.round(fromCanonical(o.value, plan.units.energy, 'energy') ?? o.value), 0)} ${plan.units.energy}`;
    case 'count':
    case 'score':
      return num(o.value, 0);
    default:
      return `${num(o.value, def.decimals)} ${o.unit}`;
  }
}

/** "Fitbit screenshot", "Entered", "Fitbit screenshot · edited", plus "calculated" for inferred values. */
export function observationSource(o: Observation): string {
  const s = o.source;
  const app = s.app ? s.app.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null;
  const base = s.type === 'manual' ? 'Entered' : s.type === 'screenshot' ? `${app ?? 'Screenshot'}${app ? ' screenshot' : ''}` : (app ?? 'Integration');
  return [o.kind === 'inferred' ? 'Calculated' : null, base, s.edited ? 'edited' : null].filter(Boolean).join(' · ');
}

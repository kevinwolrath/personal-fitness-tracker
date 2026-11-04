import { formatEnergy, type EnergyDisplay } from '../energy';
import type { Plan } from '../plan/schema';
import { HC_IMPORT_ID } from './healthConnect';
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

/** Display an observation in the plan's units (kg/lb, cm/in) and the device's energy display (kJ, kcal or both, #39). */
export function formatObservationValue(o: Observation, plan: Plan, energy: EnergyDisplay): string {
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
      return formatEnergy(o.value, o.unit === 'kcal' ? 'kcal' : 'kJ', energy);
    case 'count':
    case 'score':
      return num(o.value, 0);
    default:
      return `${num(o.value, def.decimals)} ${o.unit}`;
  }
}

const appNames: Record<string, string> = {
  'samsung-health': 'Samsung Health',
  'google-fit': 'Google Fit',
  fitbit: 'Fitbit',
  withings: 'Withings',
  'garmin-connect': 'Garmin Connect',
  oura: 'Oura',
  strava: 'Strava',
  'huawei-health': 'Huawei Health',
  'mi-fitness': 'Mi Fitness',
  'polar-flow': 'Polar Flow',
  'health-connect': 'Health Connect',
  'pixel-watch': 'Pixel Watch',
};

/** A source app's display name: known apps by name, others from their slug ("renpho" → "Renpho"). */
export function appName(slug: string): string {
  if (appNames[slug]) return appNames[slug];
  // An unknown Health Connect origin is a package name ("com.example.tracker"): shown exactly as reported.
  if (slug.includes('.')) return slug;
  return slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * "Fitbit screenshot", "Entered", "Fitbit screenshot · edited", "Health Connect · Samsung Health", plus
 * "calculated" for inferred values.
 */
export function observationSource(o: Observation): string {
  const s = o.source;
  const app = s.app ? appName(s.app) : null;
  const integration = s.importId === HC_IMPORT_ID ? ['Health Connect', app && app !== 'Health Connect' ? app : null].filter(Boolean).join(' · ') : (app ?? 'Integration');
  const base = s.type === 'manual' ? 'Entered' : s.type === 'screenshot' ? `${app ?? 'Screenshot'}${app ? ' screenshot' : ''}` : integration;
  return [o.kind === 'inferred' ? 'Calculated' : null, base, s.edited ? 'edited' : null].filter(Boolean).join(' · ');
}

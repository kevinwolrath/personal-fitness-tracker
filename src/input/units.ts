import { fromCanonical, toCanonical } from '../observations/units';
import { readConfig, type RawPlan } from '../config/sections';
import type { Plan } from '../plan/schema';
import type { ConfigUpdate } from '../config/update';

export type Units = Plan['units'];
export const unitWords = 'kilograms?|kgs?|pounds?|lbs?|kilojoules?|kj|kilocalories?|kcal|calories|centimet(?:er|re)s?|cm|inches|inch|in';

export function namedUnit(word: string): string {
  const value = word.toLowerCase();
  if (/^(kg|kilogram|kgs)/.test(value)) return 'kg';
  if (/^(lb|pound)/.test(value)) return 'lb';
  if (/^(kj|kilojoule)/.test(value)) return 'kJ';
  if (/^(kcal|calorie|kilocalorie)/.test(value)) return 'kcal';
  if (/^(cm|centimet)/.test(value)) return 'cm';
  return 'in';
}

/** The existing observation conversion table also owns conversions for interpreted quantities. */
export function convert(value: number, from: string, to: string, dimension: 'mass' | 'length' | 'energy'): number {
  return fromCanonical(toCanonical(value, from, dimension)!, to, dimension)!;
}

/** Preserve the physical meaning of plan values when the user changes one unit dimension. */
export function unitsUpdate(raw: RawPlan, desired: Partial<Units>): ConfigUpdate['sections'] {
  const config = readConfig(raw);
  const before = config.profile.units as Units;
  const after = { ...before, ...desired };
  const result: ConfigUpdate['sections'] = { profile: { units: after } };
  if (before.mass !== after.mass && typeof config.profile.weight === 'number') {
    result.profile!.weight = convert(config.profile.weight, before.mass, after.mass, 'mass');
  }
  if (before.mass !== after.mass || before.length !== after.length) {
    const measurements = raw.measurements as Plan['measurements'];
    result.goals = { targets: (raw.goals as Plan['goals']).map((goal) => {
      const dimension = measurements.find((m) => m.id === goal.measurementId)?.quantity;
      return dimension === 'mass' || dimension === 'length'
        ? { ...goal, target: convert(goal.target, before[dimension], after[dimension], dimension) }
        : goal;
    }) };
  }
  if (before.energy !== after.energy) {
    const energyIds = new Set((raw.nutrition?.targets ?? []).filter((target: { quantity: string }) => target.quantity === 'energy').map((target: { id: string }) => target.id));
    const changedActivities = (raw.activities as Plan['activities']).filter((activity) => Object.keys(activity.nutrition ?? {}).some((id) => energyIds.has(id))).map((activity) => ({
      ...activity,
      nutrition: Object.fromEntries(Object.entries(activity.nutrition!).map(([id, amount]) => [id, energyIds.has(id) ? convert(amount, before.energy, after.energy, 'energy') : amount])),
    }));
    const meals = changedActivities.filter((activity) => activity.kind === 'meal');
    const other = changedActivities.filter((activity) => activity.kind !== 'meal');
    result.nutrition = {
      ...(meals.length ? { meals: { merge: meals } } : {}),
      targets: (raw.nutrition?.targets ?? []).map((target: { quantity: string; min?: number; max?: number }) => target.quantity === 'energy' ? {
        ...target,
        ...(target.min !== undefined ? { min: convert(target.min, before.energy, after.energy, 'energy') } : {}),
        ...(target.max !== undefined ? { max: convert(target.max, before.energy, after.energy, 'energy') } : {}),
      } : target),
    };
    if (other.length) result.schedule = { activities: { merge: other } };
  }
  return result;
}

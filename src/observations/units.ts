import { canonicalUnit, type Dimension } from './metrics';

/** Factor to convert a unit (lower-cased, trimmed) into the dimension's canonical unit. */
const factors: Record<Dimension, Record<string, number>> = {
  mass: { kg: 1, kgs: 1, kilogram: 1, kilograms: 1, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, st: 6.35029318, stone: 6.35029318 },
  mass_change: { kg: 1, kgs: 1, lb: 0.45359237, lbs: 0.45359237 },
  length: { cm: 1, mm: 0.1, m: 100, in: 2.54, inch: 2.54, inches: 2.54, '"': 2.54 },
  distance: { km: 1, m: 0.001, mi: 1.609344, mile: 1.609344, miles: 1.609344 },
  energy: { kj: 1, kcal: 4.184, cal: 4.184, cals: 4.184, calories: 4.184 },
  duration: { min: 1, mins: 1, minute: 1, minutes: 1, m: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, s: 1 / 60, sec: 1 / 60 },
  count: { count: 1, '': 1, steps: 1, step: 1, floors: 1, floor: 1 },
  score: { score: 1, '': 1, points: 1, pts: 1, '/100': 1, '%': 1 },
  percent: { '%': 1, percent: 1 },
  rate: { bpm: 1, 'beats/min': 1 },
  grams: { g: 1, gram: 1, grams: 1 },
};

/**
 * Convert a value in `unit` to the dimension's canonical unit.
 * Returns null when the unit doesn't belong to the dimension (the caller drops the value).
 * Food "Calories"/"cal" are treated as kcal, as fitness apps display them.
 */
export function toCanonical(value: number, unit: string, dimension: Dimension): number | null {
  const factor = factors[dimension][unit.trim().toLowerCase()];
  return factor === undefined ? null : value * factor;
}

export function fromCanonical(value: number, unit: string, dimension: Dimension): number | null {
  const factor = factors[dimension][unit.trim().toLowerCase()];
  return factor === undefined ? null : value / factor;
}

export const unitFor = (d: Dimension) => canonicalUnit[d];

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** "465" minutes → "7h 45m". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * Energy display (#39, contract 06 "Energy display"). Pure.
 *
 * Stored values never change: observations are kJ, plan amounts are in the plan's `units.energy`. Only the
 * text differs. Each shown number is converted from the stored value and rounded once, so totals and
 * "left" amounts never drift: callers compute on stored numbers and format the result.
 */

export type EnergyUnit = 'kJ' | 'kcal';
/** The device preference: one unit, or both ("1,780 kJ / 425 kcal"). */
export type EnergyDisplay = 'kJ' | 'kcal' | 'both';

export const KJ_PER_KCAL = 4.184;

/** Display rounding (Kevin, #39): kJ to the nearest 10, kcal to the nearest whole number. */
export const ENERGY_STEP: Record<EnergyUnit, number> = { kJ: 10, kcal: 1 };

export const energyDisplays: EnergyDisplay[] = ['kJ', 'kcal', 'both'];

export const isEnergyDisplay = (v: unknown): v is EnergyDisplay => v === 'kJ' || v === 'kcal' || v === 'both';

export function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number {
  if (from === to) return value;
  return from === 'kJ' ? value / KJ_PER_KCAL : value * KJ_PER_KCAL;
}

/** Round to the unit's display step. -0 becomes 0. */
export function roundEnergy(value: number, unit: EnergyUnit): number {
  const step = ENERGY_STEP[unit];
  return Math.round(value / step) * step + 0;
}

/** The units shown, in order: kJ first in "both". */
export const displayUnits = (d: EnergyDisplay): EnergyUnit[] => (d === 'both' ? ['kJ', 'kcal'] : [d]);

/** The unit someone types in when correcting an energy value: the first one shown. */
export const entryUnit = (d: EnergyDisplay): EnergyUnit => displayUnits(d)[0];

const grouped = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

/** One stored value in the chosen unit(s): "1,780 kJ", "425 kcal" or "1,780 kJ / 425 kcal". */
export function formatEnergy(value: number, from: EnergyUnit, display: EnergyDisplay): string {
  return displayUnits(display)
    .map((u) => `${grouped(roundEnergy(convertEnergy(value, from, u), u))} ${u}`)
    .join(' / ');
}

/**
 * A target bound: "≤ 7,530 kJ / ≤ 1,800 kcal" would repeat the sign, so the sign comes once and each unit
 * carries its own range: "≤ 7,530 kJ / 1,800 kcal", "6,300–7,100 kJ / 1,510–1,700 kcal".
 */
export function formatEnergyBound(bound: { min?: number; max?: number }, from: EnergyUnit, display: EnergyDisplay): string {
  const one = (v: number, u: EnergyUnit) => grouped(roundEnergy(convertEnergy(v, from, u), u));
  const parts = displayUnits(display).map((u) => {
    if (bound.min !== undefined && bound.max !== undefined) return `${one(bound.min, u)}–${one(bound.max, u)} ${u}`;
    return `${one((bound.max ?? bound.min)!, u)} ${u}`;
  });
  const sign = bound.min !== undefined && bound.max !== undefined ? '' : bound.max !== undefined ? '≤ ' : '≥ ';
  return sign + parts.join(' / ');
}

/** Screen readers say the unit words, not "kJ"/"kcal" (#39); "/" between units reads as a pause. */
export function speakEnergy(text: string): string {
  return text
    .replace(/(\d) kJ\b/g, '$1 kilojoules')
    .replace(/(\d) kcal\b/g, '$1 kilocalories')
    .replace(/ kilojoules \/ /g, ' kilojoules, ');
}

/** The spoken word for a unit label: "kJ" → "kilojoules", "kcal" → "kilocalories"; others unchanged. */
export const unitWord = (unit: string) => (unit === 'kJ' ? 'kilojoules' : unit === 'kcal' ? 'kilocalories' : unit);

/** "Energy in kJ" / "Energy in kcal" / "Energy in kJ and kcal", for the menu row. */
export function energyDisplayDetail(d: EnergyDisplay): string {
  return d === 'both' ? 'Energy in kJ and kcal' : `Energy in ${d}`;
}

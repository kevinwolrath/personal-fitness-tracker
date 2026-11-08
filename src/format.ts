import { formatEnergy, formatEnergyBound, type EnergyDisplay } from './energy';
import { parseLocalDate, type LocalDate } from './plan/dates';
import type { Measurement, NutritionTarget, Plan } from './plan/schema';

const number = (n: number, decimals = 0) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);

export function measurementUnit(plan: Plan, m: Measurement): string {
  if (m.quantity === 'mass') return plan.units.mass;
  if (m.quantity === 'length') return plan.units.length;
  return m.unitLabel ?? '';
}

export function formatMeasurement(plan: Plan, m: Measurement, value: number): string {
  const unit = measurementUnit(plan, m);
  return `${number(value, m.decimals)}${unit ? ` ${unit}` : ''}`;
}

/**
 * A daily target, e.g. "Energy ≤ 7,530 kJ / 1,800 kcal" or "Protein 160–180 g". Energy follows the device's
 * energy display (#39); plan amounts are written in the plan's `units.energy`.
 */
export function formatTarget(plan: Plan, t: NutritionTarget, energy: EnergyDisplay): string {
  if (t.quantity === 'energy') return `${t.label} ${formatEnergyBound(t, plan.units.energy, energy)}`;
  if (t.min !== undefined && t.max !== undefined) return `${t.label} ${number(t.min)}–${number(t.max)} g`;
  if (t.max !== undefined) return `${t.label} ≤ ${number(t.max)} g`;
  return `${t.label} ≥ ${number(t.min!)} g`;
}

/** A plan amount: energy in the chosen unit(s) (from the plan's unit), grams as written. */
export const formatAmount = (plan: Plan, quantity: NutritionTarget['quantity'], n: number, energy: EnergyDisplay) =>
  quantity === 'energy' ? formatEnergy(n, plan.units.energy, energy) : `${number(n)} g`;

/** Plan "HH:MM" → locale time, e.g. "8:30 am". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Time until something starts: "in 25 min", "in 4 hr", "in 4 hr 30 min"; "now" at or past it (#51). */
export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'now';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `in ${m} min`;
  return m ? `in ${h} hr ${m} min` : `in ${h} hr`;
}

export const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatShortDate = (date: LocalDate) =>
  parseLocalDate(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export const formatWeekday = (date: LocalDate) => parseLocalDate(date).toLocaleDateString(undefined, { weekday: 'long' });

export function formatDuration(d: { minutes: number } | { min: number; max: number } | undefined): string | null {
  if (!d) return null;
  return 'minutes' in d ? `${d.minutes} min` : `${d.min}–${d.max} min`;
}

/** Parse a user-typed decimal, accepting "," as the decimal separator. */
export function parseDecimal(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/** ISO timestamp with the local UTC offset (contract 04). */
export function localIsoTimestamp(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

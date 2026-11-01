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

export function targetUnit(plan: Plan, quantity: NutritionTarget['quantity']): string {
  return quantity === 'energy' ? plan.units.energy : 'g';
}

export function formatTarget(plan: Plan, t: NutritionTarget): string {
  const u = targetUnit(plan, t.quantity);
  if (t.min !== undefined && t.max !== undefined) return `${t.label} ${number(t.min)}–${number(t.max)} ${u}`;
  if (t.max !== undefined) return `${t.label} ≤ ${number(t.max)} ${u}`;
  return `${t.label} ≥ ${number(t.min!)} ${u}`;
}

export const formatAmount = (plan: Plan, quantity: NutritionTarget['quantity'], n: number) =>
  `${number(n)} ${targetUnit(plan, quantity)}`;

/** Plan "HH:MM" → locale time, e.g. "8:30 am". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

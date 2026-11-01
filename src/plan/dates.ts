import { weekdays, type Weekday } from './schema';

/** Local calendar date, `YYYY-MM-DD`. Day keys are never UTC (contract 04). */
export type LocalDate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseLocalDate(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // midday avoids DST edge cases
}

export function addDays(date: LocalDate, delta: number): LocalDate {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + delta);
  return toLocalDate(d);
}

export function weekdayOf(date: LocalDate): Weekday {
  // JS: 0 = Sunday; contract weekdays start Monday.
  return weekdays[(parseLocalDate(date).getDay() + 6) % 7];
}

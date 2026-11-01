import { addDays, parseLocalDate, type LocalDate } from '../../plan/dates';

export type DayLabels = {
  /** Big title: "Today", "Yesterday", "Tomorrow", a weekday within the week, else a date. */
  title: string;
  /** Header date, with the year when it isn't the current year. */
  date: string;
  /** Relative position of the date. */
  when: 'past' | 'today' | 'future';
};

/** Labels for any date in the Daily Log (contract 02). Pure; locale from the device. */
export function dayLabels(date: LocalDate, today: LocalDate, locale?: string): DayLabels {
  const d = parseLocalDate(date);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  // Compact header label: weekday for this year's dates; another year's dates show the year instead (fits small phones).
  const short: Intl.DateTimeFormatOptions = sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  const within = date >= addDays(today, -6) && date <= addDays(today, 6);
  const title =
    date === today
      ? 'Today'
      : date === addDays(today, -1)
        ? 'Yesterday'
        : date === addDays(today, 1)
          ? 'Tomorrow'
          : within
            ? d.toLocaleDateString(locale, { weekday: 'long' })
            : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
  return {
    title,
    date: d.toLocaleDateString(locale, short),
    when: date < today ? 'past' : date > today ? 'future' : 'today',
  };
}

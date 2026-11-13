import type { SyncStatus } from './service';

/**
 * The menu's Health data sync detail line (#174): the one-tap action, then when this phone last synced. Pure.
 * Dates are local, day and month only (the year when it isn't this year).
 */
export function syncSummary(status: SyncStatus | null, now: Date): string {
  const at = status?.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
  if (!at || Number.isNaN(at.getTime())) return 'Share everything with an AI · Not synced yet';
  const sameDay = at.toDateString() === now.toDateString();
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) };
  return `Share everything with an AI · Last synced ${sameDay ? 'today' : at.toLocaleDateString(undefined, opts)}`;
}

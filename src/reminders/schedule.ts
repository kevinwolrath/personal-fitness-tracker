import type { LocalDate } from '../plan/dates';
import type { Activity, Plan } from '../plan/schema';
import { prescribeDay } from '../prescription/prescribe';
import { PARTS, toMinutes } from '../prescription/windows';
import type { DayRecords } from '../storage/types';

/**
 * Plan-driven local reminders (#30, contract 10). Pure: no platform calls.
 *
 * The plan says WHAT to remind about and WHEN (`activity.notifications`). Whether reminders are turned on is a
 * device preference, never plan data. This module computes the reminders that SHOULD be pending; the platform
 * layer reconciles the system's pending list against it (cancel what's not wanted, schedule what's missing), so
 * there are no duplicates and nothing stale after a plan change, a completion or a restart.
 */

export const REMINDER_PREFIX = 'pft-reminder';
/** Days ahead (today included) that are kept scheduled. Re-synced on every app start and foreground. */
export const HORIZON_DAYS = 7;

export type ReminderStatus = 'pending' | 'done' | 'skipped';

export type Reminder = {
  /** Deterministic: plan, date, activity, index and a hash of time + wording. Any change = a new id. */
  id: string;
  date: LocalDate;
  /** Minutes since local midnight. */
  minute: number;
  activityId: string;
  activityLabel: string;
  title: string;
  body: string;
  /** done/skipped: the activity (or the requirement it belongs to) is already resolved, so it won't fire. */
  status: ReminderStatus;
};

/** Small stable string hash (djb2) for reminder ids. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Where `offsetMinutes` counts from: the activity's exact time, else the start of its day part. Null for "anytime". */
export function reminderBase(a: Pick<Activity, 'time' | 'when'>): number | null {
  if (a.time) return toMinutes(a.time);
  if (a.when && a.when !== 'anytime') return PARTS[a.when].start;
  return null;
}

/** Every reminder the plan defines for one day, with whether it would still fire. */
export function remindersForDay(plan: Plan, date: LocalDate, records: DayRecords): Reminder[] {
  const out: Reminder[] = [];
  for (const item of prescribeDay(plan, date, records).items) {
    const resolved: ReminderStatus = item.state === 'done' ? 'done' : item.state === 'skipped' ? 'skipped' : 'pending';
    const activities = item.kind === 'activity' && item.activity ? [item.activity] : item.options;
    for (const a of activities) {
      (a.notifications ?? []).forEach((n, i) => {
        const base = reminderBase(a);
        const minute = n.at ? toMinutes(n.at) : base === null ? null : base + (n.offsetMinutes ?? 0);
        if (minute === null || minute < 0 || minute >= 24 * 60) return; // can't fire on this day
        out.push({
          id: [REMINDER_PREFIX, plan.id, date, a.id, i, hash(`${minute}|${n.title}|${n.body}`)].join('|'),
          date,
          minute,
          activityId: a.id,
          activityLabel: a.label,
          title: n.title,
          body: n.body,
          status: resolved,
        });
      });
    }
  }
  return out.sort((x, y) => x.minute - y.minute || x.id.localeCompare(y.id));
}

/** The reminders that should be pending now: still to do, and still in the future. */
export function desiredReminders(plan: Plan, days: { date: LocalDate; records: DayRecords }[], today: LocalDate, nowMinute: number): Reminder[] {
  return days
    .flatMap((d) => remindersForDay(plan, d.date, d.records))
    .filter((r) => r.status === 'pending' && (r.date > today || (r.date === today && r.minute > nowMinute)));
}

/**
 * What to change so the system's pending list equals `desired`. Only our own reminders (by prefix) are ever
 * cancelled. Turning reminders off = reconciling against an empty desired list.
 */
export function reconcile(desired: Reminder[], scheduledIds: string[]): { cancel: string[]; schedule: Reminder[] } {
  const ours = scheduledIds.filter((id) => id.startsWith(`${REMINDER_PREFIX}|`));
  const want = new Set(desired.map((r) => r.id));
  const have = new Set(ours);
  return { cancel: ours.filter((id) => !want.has(id)), schedule: desired.filter((r) => !have.has(r.id)) };
}

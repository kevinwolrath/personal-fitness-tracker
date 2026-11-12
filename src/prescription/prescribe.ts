import { movementSupported } from '../exercises/availability';
import type { LocalDate } from '../plan/dates';
import { resolveDay, type ResolvedDay } from '../plan/resolveDay';
import type { Activity, Plan, Purpose, Requirement } from '../plan/schema';
import type { ActivityLog, DayRecords } from '../storage/types';
import { prescribeSession, type PrescribedSession } from './session';
import { leadMinutesFor, windowFor, type Window } from './windows';

/**
 * Today's prescription (contract 08): the concrete actions for one date, derived deterministically from
 * the plan (+ exercise configuration) and what has been logged. Requirements collapse their alternative
 * activities into one item that any of them can satisfy. Pure: no time-of-day, no I/O.
 */
export type ItemState = 'pending' | 'partial' | 'done' | 'skipped';

export type PrescriptionItem = {
  /** Activity id, or `req:<requirementId>`. */
  key: string;
  kind: 'activity' | 'requirement';
  label: string;
  detail?: string;
  purpose: Purpose | null;
  required: boolean;
  window: Window;
  /** Plan order, for stable ties. */
  order: number;
  state: ItemState;
  /** Activity items: the activity. Requirement items: undefined. */
  activity?: Activity;
  requirement?: Requirement;
  /** Requirement items: the alternatives scheduled today. */
  options: Activity[];
  /** Existing scheduled item is kept for review, but unavailable equipment is not recommended. */
  equipmentUnavailable?: boolean;
  /** Requirement items: which alternative satisfied it. */
  satisfiedBy?: { activityId: string; label: string };
  /** Count-tracked progress (activity, or the leading option of a requirement). */
  count?: number;
  target?: number;
  completedAt?: string;
  variant?: 'full' | 'short';
  session?: PrescribedSession;
  /** Item keys this should follow. */
  after: string[];
};

export type Prescription = {
  date: LocalDate;
  day: ResolvedDay;
  items: PrescriptionItem[];
  progress: { done: number; total: number; complete: boolean };
};

export const requirementKey = (id: string) => `req:${id}`;

const durationMax = (a: Activity) => (a.duration ? ('minutes' in a.duration ? a.duration.minutes : a.duration.max) : a.session?.minutes);

function stateOf(log: ActivityLog | undefined): ItemState {
  if (!log) return 'pending';
  if (log.status === 'done') return 'done';
  if (log.status === 'skipped') return 'skipped';
  return log.count > 0 || (log.exercisesDone?.length ?? 0) > 0 ? 'partial' : 'pending';
}

const isResolved = (s: ItemState) => s === 'done' || s === 'skipped';

export function prescribeDay(plan: Plan, date: LocalDate, records: DayRecords): Prescription {
  const day = resolveDay(plan, date, records.dayTypeOverride);
  const scheduled = [...day.timed, ...day.anytime];
  const order = new Map(plan.activities.map((a, i) => [a.id, i]));
  const logs = records.activities;

  // Activity → the item key it belongs to (its own, or its requirement's).
  const keyOf = new Map<string, string>();
  for (const a of scheduled) keyOf.set(a.id, a.satisfies ? requirementKey(a.satisfies) : a.id);
  const afterKeys = (acts: Activity[]) =>
    [...new Set(acts.flatMap((a) => a.after ?? []).map((d) => keyOf.get(d)).filter((k): k is string => !!k))];

  const items: PrescriptionItem[] = [];

  for (const a of scheduled.filter((x) => !x.satisfies)) {
    const log = logs[a.id];
    items.push({
      key: a.id,
      kind: 'activity',
      label: a.label,
      detail: a.detail,
      purpose: a.purpose ?? null,
      required: a.required,
      window: windowFor({ time: a.time, when: a.when, durationMaxMinutes: durationMax(a), leadMinutes: leadMinutesFor(plan, a.kind, a.leadMinutes) }),
      order: order.get(a.id) ?? 0,
      state: stateOf(log),
      activity: a,
      options: [],
      ...((a.movement && !movementSupported(a.movement, plan.exercise)) || (a.session?.exercises.length && a.session.exercises.every(e => !movementSupported(e.movement, plan.exercise))) ? { equipmentUnavailable: true } : {}),
      count: a.tracking.type === 'count' ? log?.count ?? 0 : undefined,
      target: a.tracking.type === 'count' ? a.tracking.target : undefined,
      completedAt: log?.status === 'done' ? log.updatedAt : undefined,
      variant: log?.variant,
      session: prescribeSession(a.session, plan.exercise),
      after: afterKeys([a]).filter((k) => k !== a.id),
    });
  }

  for (const r of plan.requirements ?? []) {
    const options = scheduled.filter((a) => a.satisfies === r.id);
    if (!options.length) continue; // no alternative scheduled today: not prescribed today
    const key = requirementKey(r.id);
    const own = logs[key];
    const done = options
      .filter((o) => logs[o.id]?.status === 'done')
      .sort((x, y) => logs[x.id]!.updatedAt.localeCompare(logs[y.id]!.updatedAt))[0];
    const started = options.find((o) => (logs[o.id]?.count ?? 0) > 0);
    const state: ItemState = own?.status === 'skipped' ? 'skipped' : done ? 'done' : started ? 'partial' : 'pending';
    const lead = done ?? started;
    const optionWindows = options.map((o) =>
      windowFor({ time: o.time, when: o.when, durationMaxMinutes: durationMax(o), leadMinutes: leadMinutesFor(plan, o.kind, r.leadMinutes ?? o.leadMinutes) }),
    );
    items.push({
      key,
      kind: 'requirement',
      label: r.label,
      detail: r.detail,
      purpose: r.purpose,
      required: r.required,
      window:
        r.time || r.when
          ? windowFor({ time: r.time, when: r.when, leadMinutes: leadMinutesFor(plan, options[0].kind, r.leadMinutes) })
          : optionWindows.sort((x, y) => x.at - y.at || x.start - y.start || x.end - y.end)[0],
      order: Math.min(...options.map((o) => order.get(o.id) ?? 0)),
      state,
      requirement: r,
      options: options.filter(o => !o.movement || movementSupported(o.movement, plan.exercise) || !!logs[o.id]?.status),
      ...(options.every(o => !!o.movement && !movementSupported(o.movement, plan.exercise)) ? { equipmentUnavailable: true } : {}),
      satisfiedBy: done ? { activityId: done.id, label: done.label } : undefined,
      count: lead && lead.tracking.type === 'count' ? logs[lead.id]?.count ?? 0 : undefined,
      target: lead && lead.tracking.type === 'count' ? lead.tracking.target : undefined,
      completedAt: done ? logs[done.id]!.updatedAt : undefined,
      variant: done ? logs[done.id]?.variant : undefined,
      after: afterKeys(options).filter((k) => k !== key),
    });
  }

  // Listed by scheduled time (not by when they become due, which depends on lead times).
  items.sort((x, y) => x.window.at - y.window.at || x.order - y.order);
  const counted = items.filter((i) => i.required && i.state !== 'skipped');
  const doneCount = counted.filter((i) => i.state === 'done').length;
  return { date, day, items, progress: { done: doneCount, total: counted.length, complete: counted.length > 0 && doneCount === counted.length } };
}

/** Items whose `after` dependencies are all done or skipped. */
export function isAvailable(item: PrescriptionItem, items: PrescriptionItem[]): boolean {
  return item.after.every((k) => {
    const dep = items.find((i) => i.key === k);
    return !dep || isResolved(dep.state);
  });
}

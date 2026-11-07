import type { LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { sessionProgress } from '../prescription/exercises';
import type { PrescriptionItem } from '../prescription/prescribe';
import type { SessionExercise } from '../plan/schema';
import type { ActivityLog, ExerciseLog } from '../storage/types';
import type { MuscleCoverage } from './coverage';
import { eligibleExercises, exerciseInventory, type Inventory } from './inventory';

/**
 * Today's workout (#56, layout A): one list of every eligible strength exercise plus today's planned session
 * exercises, with counts. Pure: the card and sheet only render this.
 *
 * - **What's listed:** eligible strength exercises from the inventory (the user's equipment, avoid removed) and every
 *   exercise of today's prescribed session version (plan wins, even outside the inventory). Conditioning stays its
 *   own Today activity and is never listed here.
 * - **Done:** a planned exercise is done through its session tick (or the whole workout marked done); any exercise
 *   can be done through a free log for that day. One tick writes one record, so nothing counts twice.
 * - **Order:** the day's frozen priority order (history before today), so rows never reshuffle while ticking. Until
 *   there's enough history, today's planned exercises come first in plan order. To-do rows come first; done rows
 *   follow in the same order.
 * - **Rest day:** nothing is due (no "Due" status), but everything stays tickable.
 */

export type Dose = { sets: number; reps?: number; seconds?: number };

export type RowStatus = 'due' | 'building' | 'trained' | 'recovering' | 'sore' | 'injured';

export type WorkoutRow = {
  movement: string;
  name: string;
  dose: Dose;
  doseLabel: string;
  /** In today's prescribed session (the chosen full/short version): ticking writes that session's tick. */
  plan: { activityId: string; key: string } | null;
  /** Primary muscle-group labels. */
  muscles: string[];
  status: RowStatus | null;
  caution: boolean;
  done: boolean;
  doneBy: 'session' | 'free' | null;
  /** Today's free logs for this movement (removed when unticked). */
  freeLogIds: string[];
};

export type TodayWorkout = {
  rows: WorkoutRow[];
  total: number;
  done: number;
  remaining: number;
  /** First to-do row: the collapsed card's exercise. */
  next: WorkoutRow | null;
  restDay: boolean;
  /** The day's strength sessions, skipped ones included (their options can restore them). */
  sessions: PrescriptionItem[];
};

/** The parts of `ExerciseState` the list needs (today only; other days use plan order and no statuses). */
export type WorkoutStateInput = {
  coverage: MuscleCoverage[];
  /** Eligible strength movements in the day's frozen priority order. */
  dayOrder: string[];
  /** History before today is long enough for priority to decide the order. */
  priorityOrder: boolean;
  restDay: boolean;
};

export const formatDose = (d: Dose) => (d.seconds !== undefined ? `${d.sets} × ${d.seconds} s` : d.reps !== undefined ? `${d.sets} × ${d.reps}` : `${d.sets} sets`);

const fromExercise = (e: Pick<SessionExercise, 'sets' | 'reps' | 'seconds'>): Dose => ({
  sets: e.sets ?? 1,
  ...(e.reps !== undefined ? { reps: e.reps } : e.seconds !== undefined ? { seconds: e.seconds } : {}),
});

/**
 * The one-tap dose for a movement: today's prescribed dose, else the plan's dose for it in any session (full
 * version first, plan order), else the inventory default, else one set. Never invented beyond the inventory data.
 */
export function doseFor(movement: string, plan: Plan, today?: Pick<SessionExercise, 'sets' | 'reps' | 'seconds'>, inventory: Inventory = exerciseInventory): Dose {
  if (today) return fromExercise(today);
  const sessions = plan.activities.flatMap((a) => (a.session ? [a.session.exercises, a.session.short?.exercises ?? []] : []));
  const planned = sessions.flat().find((e) => e.movement === movement);
  if (planned && (planned.sets || planned.reps || planned.seconds)) return fromExercise(planned);
  const d = inventory.exercises.find((e) => e.movement === movement)?.defaultDose;
  return d ? fromExercise(d) : { sets: 1 };
}

const STATUS_RANK: RowStatus[] = ['injured', 'sore', 'recovering', 'due', 'building', 'trained'];

function statusOf(primary: string[], coverage: MuscleCoverage[], restDay: boolean): RowStatus | null {
  const found = primary
    .map((m) => coverage.find((c) => c.muscle === m))
    .map((c): RowStatus | null => {
      if (!c) return null;
      if (c.report) return c.report;
      if (c.status === 'recovering') return 'recovering';
      if (c.status === 'red') return restDay ? null : 'due';
      if (c.status === 'amber') return 'building';
      if (c.status === 'green') return 'trained';
      return null; // unknown: neutral on first use
    })
    .filter((s): s is RowStatus => s !== null);
  return found.sort((a, b) => STATUS_RANK.indexOf(a) - STATUS_RANK.indexOf(b))[0] ?? null;
}

export function todayWorkout(input: {
  plan: Plan;
  date: LocalDate;
  /** The day's prescription items. */
  items: PrescriptionItem[];
  logs: Record<string, ActivityLog | undefined>;
  /** Free exercise logs on `date`. */
  freeLogs: ExerciseLog[];
  /** Today's coverage and order; null on other days or while loading (plan order, no statuses). */
  state: WorkoutStateInput | null;
  /** Configured rest day for `date` (also given by `state` today). */
  restDay?: boolean;
  inventory?: Inventory;
}): TodayWorkout {
  const { plan, items, logs, freeLogs, state } = input;
  const inventory = input.inventory ?? exerciseInventory;
  const restDay = state?.restDay ?? input.restDay ?? false;
  const label = new Map(inventory.muscleGroups.map((m) => [m.id, m.label]));
  const byMovement = new Map(inventory.exercises.map((e) => [e.movement, e]));

  const sessions = items.filter((i) => i.kind === 'activity' && i.session && i.activity);
  type Planned = { activityId: string; key: string; done: boolean; dose: Dose; name: string };
  const planned = new Map<string, Planned>();
  for (const item of sessions.filter((s) => s.state !== 'skipped')) {
    for (const r of sessionProgress(item.session!, logs[item.key]).rows) {
      if (r.optional || planned.has(r.exercise.movement)) continue;
      planned.set(r.exercise.movement, { activityId: item.key, key: r.key, done: r.done, dose: fromExercise(r.exercise), name: r.exercise.label });
    }
  }

  const eligible = eligibleExercises(plan.exercise, inventory).filter((e) => e.exercise.kind === 'strength');
  const caution = new Map(eligible.map((e) => [e.exercise.movement, e.caution]));
  const movements = [...planned.keys(), ...eligible.map((e) => e.exercise.movement).filter((m) => !planned.has(m))];

  const free = new Map<string, string[]>();
  for (const l of freeLogs) free.set(l.movement, [...(free.get(l.movement) ?? []), l.id]);

  const rows: WorkoutRow[] = movements.map((movement) => {
    const p = planned.get(movement);
    const inv = byMovement.get(movement);
    const dose = p?.dose ?? doseFor(movement, plan, undefined, inventory);
    const freeLogIds = free.get(movement) ?? [];
    const doneBy = p?.done ? 'session' : freeLogIds.length ? 'free' : null;
    return {
      movement,
      name: inv?.name ?? p?.name ?? movement,
      dose,
      doseLabel: formatDose(dose),
      plan: p ? { activityId: p.activityId, key: p.key } : null,
      muscles: (inv?.primary ?? []).map((m) => label.get(m) ?? m),
      status: state && inv ? statusOf(inv.primary, state.coverage, restDay) : null,
      caution: caution.get(movement) ?? false,
      done: doneBy !== null,
      doneBy,
      freeLogIds,
    };
  });

  // Order: frozen day priority; until there's enough history, planned exercises first in plan order.
  const rank = new Map((state?.dayOrder ?? []).map((m, i) => [m, i]));
  const original = new Map(movements.map((m, i) => [m, i]));
  const key = (r: WorkoutRow) => {
    const byPriority = rank.get(r.movement) ?? Number.MAX_SAFE_INTEGER;
    if (state?.priorityOrder) return [byPriority, original.get(r.movement)!];
    return [r.plan ? 0 : 1, r.plan ? original.get(r.movement)! : byPriority, original.get(r.movement)!];
  };
  const cmp = (a: WorkoutRow, b: WorkoutRow) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  };
  const ordered = [...rows].sort(cmp);
  const sorted = [...ordered.filter((r) => !r.done), ...ordered.filter((r) => r.done)];
  const done = sorted.filter((r) => r.done).length;
  return { rows: sorted, total: sorted.length, done, remaining: sorted.length - done, next: sorted.find((r) => !r.done) ?? null, restDay, sessions };
}

/** What one tap on a row does. Pure: the screen carries it out with the existing store actions. */
export type WorkoutToggle =
  | { kind: 'session'; activityId: string; key: string; ticked: boolean }
  | { kind: 'log'; id: string; dose: Dose }
  | { kind: 'unlog'; ids: string[] };

/**
 * Ticking a planned exercise writes its session tick; ticking any other exercise writes one free log with the
 * row's dose, under an id fixed per day and movement, so a repeated tap can't create a second record. Unticking
 * undoes whichever record made it done (a free log made with "a different dose" included).
 */
export function workoutToggle(row: WorkoutRow, date: LocalDate): WorkoutToggle {
  if (row.done) {
    if (row.doneBy === 'session' && row.plan) return { kind: 'session', activityId: row.plan.activityId, key: row.plan.key, ticked: false };
    return { kind: 'unlog', ids: row.freeLogIds };
  }
  if (row.plan) return { kind: 'session', activityId: row.plan.activityId, key: row.plan.key, ticked: true };
  return { kind: 'log', id: oneTapLogId(date, row.movement), dose: row.dose };
}

export const oneTapLogId = (date: LocalDate, movement: string) => `tap-${date}-${movement}`;

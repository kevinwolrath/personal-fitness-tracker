import { addDays, weekdayOf, type LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { prescribeDay } from '../prescription/prescribe';
import type { PrescribedSession } from '../prescription/session';
import type { SessionOrder } from '../prescription/exercises';
import { newId, type ActivityLog, type ExerciseIntensity, type MuscleReport, type TrackingStore } from '../storage/types';
import {
  hasEnoughHistory,
  muscleCoverage,
  sessionExerciseOrder,
  suggestExercises,
  type ExerciseEntry,
  type MuscleCoverage,
  type Suggestion,
} from './coverage';
import { activityEntries, freeLogEntry, sessionEntries, snapshotSession } from './history';
import { eligibleExercises, exerciseInventory, type Inventory } from './inventory';

/**
 * Exercise history and muscle coverage from the store (#56, step 4). The only I/O is `loadExerciseHistory` and the
 * actions; everything else is pure. No UI here: where coverage and logging appear on screen is still to be designed.
 */

/** How far back history is read: enough for the 7-training-day window with several rest days, and the 72 h recovery. */
export const HISTORY_DAYS = 60;

export type ExerciseHistory = { entries: ExerciseEntry[]; reports: MuscleReport[] };

/**
 * Every completed exercise in the last `HISTORY_DAYS`, each once:
 * - session ticks, with the doses from that day's snapshot, else from the plan in effect;
 * - plan activities that name a movement (conditioning);
 * - exercises logged on their own.
 * Activity logs the current plan no longer knows still count when their day snapshot holds the session.
 */
export async function loadExerciseHistory(store: TrackingStore, plan: Plan, today: LocalDate): Promise<ExerciseHistory> {
  const from = addDays(today, -HISTORY_DAYS);
  const [{ activityLogs, dayOverrides }, logs, reports] = await Promise.all([
    store.planHistory(plan.id),
    store.exerciseLogs({ from, to: today }),
    store.muscleReports(),
  ]);
  const byId = new Map(plan.activities.map((a) => [a.id, a]));
  const recent = activityLogs.filter((l) => l.date >= from && l.date <= today);
  // Skipped Muscle Growth items (#122) are not work: they never count for muscles.
  const entries: ExerciseEntry[] = logs.filter((l) => l.status !== 'skipped').map(freeLogEntry);

  for (const date of [...new Set(recent.map((l) => l.date))].sort()) {
    const day: Record<string, ActivityLog> = {};
    for (const { planId: _p, date: _d, ...log } of recent.filter((l) => l.date === date)) day[log.activityId] = log;

    for (const log of Object.values(day)) {
      const activity = byId.get(log.activityId);
      if (activity?.movement) entries.push(...activityEntries({ planId: plan.id, date, activity, log }));
    }

    const sessionLogs = Object.values(day).filter((l) => l.status === 'done' || (l.exercisesDone?.length ?? 0) > 0);
    if (!sessionLogs.length) continue;
    const [snapshot, events] = await Promise.all([store.daySnapshot(plan.id, date), store.completionEvents(plan.id, date)]);
    let prescribed: Map<string, PrescribedSession> | null = null;
    const planSession = (activityId: string) => {
      prescribed ??= new Map(
        prescribeDay(plan, date, { activities: day, dayTypeOverride: dayOverrides.find((o) => o.date === date)?.dayTypeId ?? null, observations: [], quickLogs: [] })
          .items.filter((i) => i.session)
          .map((i) => [i.key, i.session!]),
      );
      return prescribed.get(activityId);
    };
    for (const log of sessionLogs) {
      const session = snapshotSession(snapshot?.prescribed, log.activityId) ?? planSession(log.activityId);
      if (session) entries.push(...sessionEntries({ planId: plan.id, date, activityId: log.activityId, log, session, events: events.filter((e) => e.activityId === log.activityId) }));
    }
  }
  return { entries, reports };
}

export type ExerciseState = {
  coverage: MuscleCoverage[];
  /** Eligible strength exercises, most useful first; nothing is removed. */
  suggestions: Suggestion[];
  enoughHistory: boolean;
  restDay: boolean;
  /** Display order for today's scheduled sessions, by activity id (option C). Fixed for the day: see below. */
  sessionOrders: Record<string, SessionOrder>;
  /** Eligible strength movements in the day's frozen priority order (history before today), for Today's workout. */
  dayOrder: string[];
  /** History before today is long enough for priority to decide order (else plan order first). */
  priorityOrder: boolean;
};

/**
 * Coverage and suggestions at `now`. Session order uses history **before today** only, so a workout's list never
 * reshuffles while the user is ticking it off. Rest days only change the volume window; exercise stays loggable. Pure.
 */
export function exerciseState(
  plan: Plan,
  history: ExerciseHistory,
  at: { now: string; today: LocalDate; todaySessions?: { activityId: string; session: PrescribedSession }[] },
  inventory: Inventory = exerciseInventory,
): ExerciseState {
  const restDays = plan.exercise?.restDays ?? [];
  const coverage = muscleCoverage({ inventory, entries: history.entries, reports: history.reports, now: at.now, today: at.today, restDays });
  const doneToday = new Set(history.entries.filter((e) => e.date === at.today).map((e) => e.movement));
  const suggestions = suggestExercises(eligibleExercises(plan.exercise, inventory), coverage, { doneToday });

  const before = history.entries.filter((e) => e.date < at.today);
  const startOfDay = muscleCoverage({ inventory, entries: before, reports: history.reports, now: at.now, today: at.today, restDays });
  const enoughBefore = hasEnoughHistory(before, inventory, at.today);
  const sessionOrders: Record<string, SessionOrder> = {};
  for (const { activityId, session } of at.todaySessions ?? []) {
    sessionOrders[activityId] = {
      full: sessionExerciseOrder(session.exercises, startOfDay, inventory, enoughBefore),
      ...(session.short ? { short: sessionExerciseOrder(session.short.exercises, startOfDay, inventory, enoughBefore) } : {}),
    };
  }
  const restDay = restDays.includes(weekdayOf(at.today));
  const dayOrder = suggestExercises(eligibleExercises(plan.exercise, inventory), startOfDay).map((s) => s.exercise.movement);
  return { coverage, suggestions, enoughHistory: hasEnoughHistory(history.entries, inventory, at.today), restDay, sessionOrders, dayOrder, priorityOrder: enoughBefore };
}

/** Log an exercise done outside any session (#56), at any time and on any day, rest days included. */
export async function logExercise(
  store: TrackingStore,
  input: { id?: string; movement: string; date: LocalDate; at: string; sets: number; reps?: number; seconds?: number; intensity?: ExerciseIntensity },
  inventory: Inventory = exerciseInventory,
): Promise<string> {
  if (!inventory.exercises.some((e) => e.movement === input.movement)) throw new Error(`"${input.movement}" is not in the exercise inventory`);
  if (!Number.isInteger(input.sets) || input.sets < 1) throw new Error('sets must be a whole number from 1');
  if (input.reps !== undefined && (!Number.isInteger(input.reps) || input.reps < 1)) throw new Error('reps must be a whole number from 1');
  if (input.seconds !== undefined && (!Number.isFinite(input.seconds) || input.seconds <= 0)) throw new Error('seconds must be positive');
  // A form retains this ID over retries: both store adapters upsert by ID, so a retry cannot double count.
  const id = input.id ?? newId();
  await store.addExerciseLog({
    id,
    movement: input.movement,
    date: input.date,
    at: input.at,
    sets: input.sets,
    reps: input.reps ?? null,
    seconds: input.seconds ?? null,
    intensity: input.intensity ?? null,
  });
  return id;
}

/** Report a muscle group as sore or injured; it is unavailable until cleared (#56). */
export async function reportMuscle(store: TrackingStore, muscle: string, kind: MuscleReport['kind'], at: string, inventory: Inventory = exerciseInventory): Promise<string> {
  if (!inventory.muscleGroups.some((m) => m.id === muscle)) throw new Error(`"${muscle}" is not a muscle group`);
  const id = newId();
  await store.addMuscleReport({ id, muscle, kind, at, clearedAt: null });
  return id;
}

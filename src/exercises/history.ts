import type { LocalDate } from '../plan/dates';
import type { Activity } from '../plan/schema';
import { sessionProgress } from '../prescription/exercises';
import type { PrescribedSession } from '../prescription/session';
import type { ActivityLog, CompletionEvent, ExerciseLog } from '../storage/types';
import type { ExerciseEntry } from './coverage';

/**
 * Exercise history from its two sources (#56). Pure.
 * - **Session ticks**: exercises done inside a scheduled session (#28), from the day's activity log.
 * - **Free logs**: exercises logged outside any session (`ExerciseLog`, stored on their own).
 * They never overlap: a tick lives only in its session's log, and a free log is never written for a session
 * exercise, so each completed exercise is one entry. Entry ids are stable, so merging twice changes nothing.
 */

export type { ExerciseLog };

export const freeLogEntry = (l: ExerciseLog): ExerciseEntry => ({
  id: `free|${l.id}`,
  movement: l.movement,
  date: l.date,
  at: l.at,
  sets: l.sets,
  ...(l.reps !== null ? { reps: l.reps } : {}),
  ...(l.seconds !== null ? { seconds: l.seconds } : {}),
  ...(l.intensity !== null ? { intensity: l.intensity } : {}),
  source: 'free',
});

export type SessionDay = {
  planId: string;
  date: LocalDate;
  activityId: string;
  log: ActivityLog;
  /** The session as prescribed that day (from the day snapshot, else the plan in effect). */
  session: PrescribedSession;
  /** That activity's completion events on that date, for each exercise's tick time. */
  events: CompletionEvent[];
};

/**
 * The exercises done in one day's session: the ticked ones, or every exercise of the chosen version when the
 * workout was marked done as a whole. Exercises marked "avoid" with no substitute were never prescribed to do.
 * Dose comes from the prescription (sets, reps or seconds); the time is the exercise's last tick, else the log's.
 */
export function sessionEntries({ planId, date, activityId, log, session, events }: SessionDay): ExerciseEntry[] {
  const progress = sessionProgress(session, log);
  const tickAt = (label: string) =>
    events
      .filter((e) => e.action === 'tick' && e.label === label && e.activityId === activityId && e.date === date)
      .reduce<string | null>((max, e) => (max === null || Date.parse(e.at) > Date.parse(max) ? e.at : max), null);
  return progress.rows
    .filter((r) => r.done && !r.optional)
    .map((r) => {
      const ex = r.exercise;
      return {
        id: `session|${planId}|${date}|${activityId}|${r.key}`,
        movement: ex.movement,
        date,
        at: tickAt(ex.label) ?? log.updatedAt,
        sets: ex.sets ?? 1,
        ...(ex.reps !== undefined ? { reps: ex.reps } : {}),
        ...(ex.seconds !== undefined ? { seconds: ex.seconds } : {}),
        source: 'session' as const,
      };
    });
}

type SnapshotExercise = { movement: string; label: string; substitutedFor: string | null; sets?: number; reps?: number; seconds?: number; avoid?: boolean };
type SnapshotSession = { doses?: number; minutes?: number; exercises: SnapshotExercise[]; short?: { minutes?: number; exercises: SnapshotExercise[] } };

/**
 * The session prescribed for `activityId` in a day snapshot, with its doses, or null when the snapshot predates
 * structured doses (#56) or has no such session: the caller then uses the plan in effect that day. Pure.
 */
export function snapshotSession(prescribed: unknown, activityId: string): PrescribedSession | null {
  const items = (prescribed as { items?: { key?: string; session?: SnapshotSession | null }[] } | null)?.items;
  const s = Array.isArray(items) ? items.find((i) => i?.key === activityId)?.session : undefined;
  if (!s || s.doses !== 1 || !Array.isArray(s.exercises)) return null;
  const ex = (e: SnapshotExercise) => ({
    movement: e.movement,
    label: e.label,
    ...(e.substitutedFor ? { substitutedFor: e.substitutedFor } : {}),
    ...(e.sets !== undefined ? { sets: e.sets } : {}),
    ...(e.reps !== undefined ? { reps: e.reps } : {}),
    ...(e.seconds !== undefined ? { seconds: e.seconds } : {}),
    ...(e.avoid ? { avoid: true } : {}),
  });
  return {
    minutes: s.minutes,
    exercises: s.exercises.map(ex),
    ...(s.short ? { short: { minutes: s.short.minutes, exercises: s.short.exercises.map(ex) } } : {}),
  };
}

/**
 * A completed plan activity that names an inventory movement (#56), e.g. VR boxing: one entry per activity and day,
 * so the same completion is never counted twice. Count tracking (rounds) counts the rounds done, even part-way;
 * a check counts once done. Minutes are the plan's duration (the shorter end of a range), shared out per round for
 * count tracking; without a duration, rounds count by the conditioning model's default round length. Skipped: nothing.
 */
export function activityEntries({ planId, date, activity, log }: { planId: string; date: LocalDate; activity: Activity; log: ActivityLog }): ExerciseEntry[] {
  if (!activity.movement || log.status === 'skipped') return [];
  const planned = activity.duration ? ('minutes' in activity.duration ? activity.duration.minutes : activity.duration.min) : undefined;
  const base = { id: `activity|${planId}|${date}|${activity.id}`, movement: activity.movement, date, at: log.updatedAt, source: 'activity' as const };
  if (activity.tracking.type === 'count') {
    if (log.count <= 0) return [];
    const minutes = planned !== undefined ? (planned * log.count) / activity.tracking.target : undefined;
    return [{ ...base, sets: log.count, ...(minutes !== undefined ? { minutes } : {}) }];
  }
  if (log.status !== 'done') return [];
  return [{ ...base, sets: 1, ...(planned !== undefined ? { minutes: planned } : {}) }];
}

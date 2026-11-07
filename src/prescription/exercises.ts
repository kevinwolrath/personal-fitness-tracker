import type { Activity } from '../plan/schema';
import type { ActivityLog } from '../storage/types';
import { change, type CompletionChange, type CompletionCtx } from './completion';
import type { PrescribedExercise, PrescribedSession } from './session';

/**
 * Exercise-by-exercise completion of a session (#28, contract 08). Pure.
 *
 * - The version (full or short) is an explicit choice, never inferred from ticks: the short version is
 *   usually a subset of the full one, so ticking its exercises mid-way through a full session must not
 *   complete the workout. Default: full.
 * - Ticks are kept per version (`<variant>:<index>:<movement>`): the doses differ.
 * - Ticking the last required exercise of the chosen version completes the workout; unticking one of a
 *   completed workout reopens it. Every change is an event in the append-only history.
 * - The workout stays ONE item in the day's progress.
 */

export type Variant = 'full' | 'short';

export type ChecklistRow = {
  key: string;
  exercise: PrescribedExercise;
  done: boolean;
  /** Marked "avoid" with no substitute: shown, but not required to finish. */
  optional: boolean;
};

export type SessionProgress = {
  variant: Variant;
  /** The plan offers a short version. */
  hasShort: boolean;
  minutes: number | undefined;
  rows: ChecklistRow[];
  done: number;
  /** Required exercises in the chosen version. */
  total: number;
  /** First required exercise not yet done, or null when all are. */
  next: ChecklistRow | null;
  complete: boolean;
};

export const exerciseKey = (variant: Variant, index: number, e: PrescribedExercise) => `${variant}:${index}:${e.movement}`;

const exercisesOf = (s: PrescribedSession, v: Variant) => (v === 'short' && s.short ? s.short.exercises : s.exercises);

/**
 * Display order for a session's exercises, per version: indexes into that version's exercise list (#56, option C:
 * the session keeps its exercises, ordered by muscle priority). Keys never change, so ticks stay attached.
 */
export type SessionOrder = Partial<Record<Variant, readonly number[]>>;

/**
 * Where a session stands for a day's log. A workout marked done as a whole shows every exercise of its version as done.
 * With `order`, rows (and so "next") follow it; an order that isn't a permutation of the version's exercises is ignored.
 */
export function sessionProgress(session: PrescribedSession, log: ActivityLog | undefined, order?: SessionOrder): SessionProgress {
  const variant: Variant = log?.variant === 'short' && session.short ? 'short' : 'full';
  const wholeDone = log?.status === 'done';
  const ticks = new Set(log?.exercisesDone ?? []);
  const planned = exercisesOf(session, variant).map((exercise, i) => {
    const key = exerciseKey(variant, i, exercise);
    return { key, exercise, done: wholeDone || ticks.has(key), optional: !!exercise.avoid };
  });
  const o = order?.[variant];
  const valid = !!o && o.length === planned.length && [...o].sort((a, b) => a - b).every((v, i) => v === i);
  const ordered = valid ? o!.map((i) => planned[i]) : planned;
  // Display only: preserve the day's frozen priority order within each partition and the original keys.
  const rows = [...ordered.filter(r => !r.done), ...ordered.filter(r => r.done)];
  const required = rows.filter((r) => !r.optional);
  const done = required.filter((r) => r.done).length;
  return {
    variant,
    hasShort: !!session.short,
    minutes: variant === 'short' ? session.short?.minutes : session.minutes,
    rows,
    done,
    total: required.length,
    next: required.find((r) => !r.done) ?? null,
    complete: required.length > 0 && done === required.length,
  };
}

/** Ticks currently recorded for this version (a whole-workout "done" counts as all of them). */
function ticksOf(p: SessionProgress, log: ActivityLog | undefined): Set<string> {
  const own = (log?.exercisesDone ?? []).filter((k) => k.startsWith(`${p.variant}:`));
  return log?.status === 'done' ? new Set(p.rows.filter((r) => !r.optional).map((r) => r.key)) : new Set(own);
}

/** Keep the other version's ticks untouched when one version changes. */
const otherTicks = (log: ActivityLog | undefined, v: Variant) => (log?.exercisesDone ?? []).filter((k) => !k.startsWith(`${v}:`));

/** Tick or untick one exercise of the chosen version. May complete (last one) or reopen (untick of a done workout) the workout. */
export function tickExercise(ctx: CompletionCtx, activity: Activity, session: PrescribedSession, key: string, ticked: boolean): CompletionChange {
  const cur = ctx.current;
  const p = sessionProgress(session, cur);
  const row = p.rows.find((r) => r.key === key);
  if (!row) throw new Error(`exercise ${key} is not in the ${p.variant} version of ${activity.id}`);
  const ticks = ticksOf(p, cur);
  if (ticked) ticks.add(key);
  else ticks.delete(key);
  const complete = p.rows.filter((r) => !r.optional).every((r) => ticks.has(r.key));
  const wasDone = cur?.status === 'done';
  const log: ActivityLog = {
    activityId: activity.id,
    status: complete ? 'done' : 'pending',
    count: 0,
    labelSnapshot: activity.label,
    updatedAt: ctx.now,
    variant: p.variant,
    exercisesDone: [...otherTicks(cur, p.variant), ...exercisesOf(session, p.variant).map((e, i) => exerciseKey(p.variant, i, e)).filter(key => ticks.has(key))],
  };
  const purpose = activity.purpose ?? ctx.item.purpose;
  if (complete && !wasDone) return change(ctx, activity.id, activity.label, purpose, log, 'complete', p.variant);
  if (!complete && wasDone) return change(ctx, activity.id, activity.label, purpose, log, 'undo', p.variant);
  return change(ctx, activity.id, row.exercise.label, purpose, log, ticked ? 'tick' : 'untick', p.variant);
}

/** Choose the full or short version. Each version keeps its own ticks; the workout is complete only if the new version's are all done. */
export function chooseVariant(ctx: CompletionCtx, activity: Activity, session: PrescribedSession, variant: Variant): CompletionChange | null {
  const cur = ctx.current;
  const from = sessionProgress(session, cur);
  if (variant === from.variant || (variant === 'short' && !session.short)) return null;
  // A workout done as a whole has its version's ticks made explicit, so switching back finds them.
  const keep = cur?.status === 'done' ? [...otherTicks(cur, from.variant), ...ticksOf(from, cur)] : (cur?.exercisesDone ?? []);
  const draft: ActivityLog = { activityId: activity.id, status: 'pending', count: 0, labelSnapshot: activity.label, updatedAt: ctx.now, variant, exercisesDone: keep };
  const to = sessionProgress(session, draft);
  const log: ActivityLog = { ...draft, status: to.complete ? 'done' : 'pending' };
  return change(ctx, activity.id, activity.label, activity.purpose ?? ctx.item.purpose, log, 'switch', variant);
}

/** Switching would visibly change recorded progress (the current version has ticks): ask first (#28). */
export const switchNeedsConfirm = (session: PrescribedSession, log: ActivityLog | undefined) => sessionProgress(session, log).done > 0;

import type { Activity } from '../plan/schema';
import { newId, type ActivityLog, type CompletionEvent, type DaySnapshot } from '../storage/types';
import { requirementKey, type Prescription, type PrescriptionItem } from './prescribe';
import { exerciseDose } from './session';

/** What was prescribed, in a stable, plan-independent form (kept even if the plan is later edited). */
export function snapshotOf(p: Prescription, planId: string, planRevision: number, now: string): DaySnapshot {
  return {
    planId,
    date: p.date,
    planRevision,
    updatedAt: now,
    prescribed: {
      dayType: p.day.dayTypeId,
      items: p.items.map((i) => ({
        key: i.key,
        kind: i.kind,
        label: i.label,
        purpose: i.purpose,
        required: i.required,
        part: i.window.part,
        time: i.window.time,
        options: i.options.map((o) => ({ id: o.id, label: o.label })),
        session: i.session && {
          minutes: i.session.minutes,
          exercises: i.session.exercises.map((e) => ({ movement: e.movement, label: e.label, dose: exerciseDose(e), substitutedFor: e.substitutedFor ?? null })),
        },
      })),
    },
  };
}

export type CompletionChange = { activityId: string; log: ActivityLog | null; event: CompletionEvent };

export type CompletionCtx = { planId: string; date: string; now: string; current: ActivityLog | undefined; item: PrescriptionItem };
type Ctx = CompletionCtx;

export function change(ctx: Ctx, activityId: string, label: string, purpose: string | null, log: ActivityLog | null, action: CompletionEvent['action'], variant: CompletionEvent['variant']): CompletionChange {
  return {
    activityId,
    log,
    event: {
      id: newId(),
      planId: ctx.planId,
      date: ctx.date,
      activityId,
      requirementId: ctx.item.requirement?.id ?? null,
      action,
      count: log?.count ?? 0,
      variant,
      label,
      purpose,
      at: ctx.now,
    },
  };
}

/**
 * Primary tap on an activity (the item's own activity, or one of a requirement's alternatives):
 * check → done ↔ undone; count → +1, done at target, then back to 0. Pure.
 */
export function advance(ctx: Ctx, activity: Activity): CompletionChange {
  const purpose = activity.purpose ?? ctx.item.purpose;
  const base = { activityId: activity.id, labelSnapshot: activity.label, updatedAt: ctx.now, ...(ctx.item.requirement ? { requirementId: ctx.item.requirement.id } : {}) };
  const cur = ctx.current;
  if (activity.tracking.type === 'check' || cur?.status === 'skipped') {
    if (cur?.status === 'done') return change(ctx, activity.id, activity.label, purpose, null, 'undo', null);
    return change(ctx, activity.id, activity.label, purpose, { ...base, status: 'done', count: 0, variant: 'full' }, 'complete', 'full');
  }
  const count = (cur?.count ?? 0) + 1;
  if (count > activity.tracking.target) return change(ctx, activity.id, activity.label, purpose, null, 'undo', null);
  const done = count === activity.tracking.target;
  return change(ctx, activity.id, activity.label, purpose, { ...base, status: done ? 'done' : 'pending', count }, done ? 'complete' : 'progress', done ? 'full' : null);
}

/** Explicit complete (optionally the short session) or undo. */
export function setDone(ctx: Ctx, activity: Activity, done: boolean, variant: 'full' | 'short' = 'full'): CompletionChange {
  const purpose = activity.purpose ?? ctx.item.purpose;
  if (!done) return change(ctx, activity.id, activity.label, purpose, null, 'undo', null);
  const count = activity.tracking.type === 'count' ? activity.tracking.target : 0;
  const log: ActivityLog = {
    activityId: activity.id, status: 'done', count, labelSnapshot: activity.label, updatedAt: ctx.now, variant,
    ...(ctx.item.requirement ? { requirementId: ctx.item.requirement.id } : {}),
    // Whole-workout "done" (a manual override, #28) keeps any exercise ticks already recorded.
    ...(ctx.current?.exercisesDone ? { exercisesDone: ctx.current.exercisesDone } : {}),
  };
  return change(ctx, activity.id, activity.label, purpose, log, 'complete', variant);
}

/** Skip or restore a whole item (an activity, or a requirement as a unit). */
export function setSkipped(ctx: Ctx, skipped: boolean): CompletionChange {
  const id = ctx.item.kind === 'requirement' ? requirementKey(ctx.item.requirement!.id) : ctx.item.key;
  const log: ActivityLog | null = skipped ? { activityId: id, status: 'skipped', count: 0, labelSnapshot: ctx.item.label, updatedAt: ctx.now } : null;
  return change(ctx, id, ctx.item.label, ctx.item.purpose, log, skipped ? 'skip' : 'restore', null);
}

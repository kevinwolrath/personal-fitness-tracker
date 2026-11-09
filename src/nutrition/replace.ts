import type { Plan } from '../plan/schema';
import * as completion from '../prescription/completion';
import { prescribeDay } from '../prescription/prescribe';
import type { DayRecords, MealCompletion } from '../storage/types';

export type { MealCompletion };

/**
 * Replace semantics (#97). Pure. Logging a different meal for a scheduled meal marks that meal done, so the day's
 * progress ("n of 7") moves on; the meal log records what was actually eaten. The planned recipe is never counted
 * as eaten (it never was: ticked plan meals don't count, contract 14). Removing the meal log puts the scheduled
 * meal back to not done.
 */

/** The completion change for replacing (`replaced = true`) or un-replacing a scheduled meal; null if it isn't scheduled that day. */
export function replacementCompletion(plan: Plan, date: string, records: DayRecords, activityId: string, replaced: boolean, now: string): MealCompletion | null {
  const p = prescribeDay(plan, date, records);
  const item = p.items.find((i) => i.kind === 'activity' && i.key === activityId && i.activity?.kind === 'meal');
  if (!item?.activity) return null;
  const current = records.activities[activityId];
  if (!replaced && current?.status !== 'done') return null;
  if (replaced && current?.status === 'done') return null; // already done: nothing to change
  const c = completion.setDone({ planId: plan.id, date, now, current, item }, item.activity, replaced);
  const activities = { ...records.activities };
  if (c.log) activities[activityId] = c.log;
  else delete activities[activityId];
  const snapshot = completion.snapshotOf(prescribeDay(plan, date, { ...records, activities }), plan.id, plan.revision, now);
  return { planId: plan.id, date, activityId, log: c.log, event: c.event, snapshot };
}

import { convertEnergy } from '../energy';
import type { Plan } from '../plan/schema';
import type { ActivityLogRecord } from '../storage/types';
import type { MealLog } from './contract';

/**
 * Ticked planned meals count as eaten (#154). Pure.
 *
 * Ticking a scheduled meal on Today is the user's confirmation that they ate it: one tick, no second "Ate this".
 * The confirmation *is* the meal's activity log (status `done`), which is already stored once per plan, date and
 * meal, kept across restarts, backed up and restored. So nothing new is stored and nothing can be counted twice:
 * ticking again, unticking or restoring a backup changes that one record, and this reads it.
 *
 * - **Values** come from the meal's planned nutrition (`activity.nutrition`) in the plan version in effect that day,
 *   as **estimates**. Energy is converted to kJ; protein is the plan's grams target named protein.
 * - **Missing values stay missing:** a meal without a planned energy or protein value contributes `null` for it, and
 *   the day is marked incomplete. Never zero, never guessed. A flexible meal never states nutrition (03), so ticking
 *   it adds nothing and marks the day incomplete.
 * - **Replaced meals:** when a logged meal (`MealLog`) replaced the scheduled meal ("Log different meal", 15), the
 *   logged food counts and the plan's values don't. That is also how a different portion is corrected.
 * - **Extra logged meals** (not replacing a scheduled meal) are separate meals and count in addition.
 */

export type ConfirmedMeal = {
  date: string;
  planId: string;
  activityId: string;
  label: string;
  /** Planned estimate in kJ, or null when the plan gives none. */
  energyKj: number | null;
  /** Planned estimate in grams, or null when the plan gives none. */
  proteinG: number | null;
};

/** The plan's energy target and its protein (grams) target, the same way Progress and the rest-of-day advice find them. */
export function nutritionTargets(plan: Plan) {
  return {
    energy: plan.nutrition.targets.find((t) => t.quantity === 'energy') ?? null,
    protein: plan.nutrition.targets.find((t) => t.quantity === 'grams' && /protein/i.test(`${t.id} ${t.label}`)) ?? null,
  };
}

/**
 * Confirmed planned meals from activity logs. `planOn(date, planId)` returns the plan that applied on that date (or
 * null when unknown: such logs are skipped, since their meals can't be identified).
 */
export function confirmedMeals(logs: ActivityLogRecord[], mealLogs: MealLog[], planOn: (date: string, planId: string) => Plan | null): ConfirmedMeal[] {
  const replaced = new Set(mealLogs.filter((m) => m.activityId && m.planId).map((m) => `${m.date}|${m.planId}|${m.activityId}`));
  const seen = new Set<string>();
  const out: ConfirmedMeal[] = [];
  for (const log of logs) {
    if (log.status !== 'done') continue;
    const key = `${log.date}|${log.planId}|${log.activityId}`;
    if (seen.has(key) || replaced.has(key)) continue;
    const plan = planOn(log.date, log.planId);
    const activity = plan?.activities.find((a) => a.id === log.activityId);
    if (!plan || activity?.kind !== 'meal') continue;
    seen.add(key);
    const { energy, protein } = nutritionTargets(plan);
    const e = energy ? activity.nutrition?.[energy.id] : undefined;
    const p = protein ? activity.nutrition?.[protein.id] : undefined;
    out.push({
      date: log.date,
      planId: log.planId,
      activityId: log.activityId,
      label: activity.label,
      energyKj: e === undefined ? null : convertEnergy(e, plan.units.energy, 'kJ'),
      proteinG: p === undefined ? null : p,
    });
  }
  return out;
}

/** The Daily Log's records for one day as activity-log records of `planId`. */
export const dayLogs = (activities: Record<string, { activityId: string } & Omit<ActivityLogRecord, 'planId' | 'date'>>, planId: string, date: string): ActivityLogRecord[] =>
  Object.values(activities).map((a) => ({ ...a, planId, date }));

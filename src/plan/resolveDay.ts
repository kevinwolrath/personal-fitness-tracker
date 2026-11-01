import { weekdayOf, type LocalDate } from './dates';
import type { Activity, Measurement, NutritionTarget, Plan, Weekday } from './schema';

type AppliesTo = Activity['appliesTo'];

export type BudgetLine = { targetId: string; label: string; quantity: NutritionTarget['quantity']; remaining: number };

export type ResolvedDay = {
  date: LocalDate;
  weekday: Weekday;
  dayTypeId: string;
  dayTypeLabel: string;
  /** True when the day type came from a user override rather than plan.schedule. */
  overridden: boolean;
  timed: Activity[];
  anytime: Activity[];
  targets: NutritionTarget[];
  measurementsDue: Measurement[];
  /** Remaining budget per target for the single flexible meal; empty when it cannot be computed. */
  flexibleBudget: { activityId: string; lines: BudgetLine[] } | null;
};

function applies(a: AppliesTo, dayTypeId: string, weekday: Weekday): boolean {
  if (!a) return true;
  if ('dayTypes' in a) return a.dayTypes.includes(dayTypeId);
  return a.days.includes(weekday);
}

/** Contract 03 "Resolving a day". Pure: same plan + date + override ⇒ same result. */
export function resolveDay(plan: Plan, date: LocalDate, dayTypeOverride?: string | null): ResolvedDay {
  const weekday = weekdayOf(date);
  const validOverride = dayTypeOverride && plan.dayTypes.some((d) => d.id === dayTypeOverride);
  const dayTypeId = validOverride ? dayTypeOverride! : plan.schedule[weekday];
  const dayTypeLabel = plan.dayTypes.find((d) => d.id === dayTypeId)?.label ?? dayTypeId;

  const activities = plan.activities.filter((a) => applies(a.appliesTo, dayTypeId, weekday));
  // Array.prototype.sort is stable, so equal times keep plan order.
  const timed = activities.filter((a) => a.time).sort((a, b) => a.time!.localeCompare(b.time!));
  const anytime = activities.filter((a) => !a.time);

  const targets = plan.nutrition.targets.filter((t) => applies(t.appliesTo, dayTypeId, weekday));
  const measurementsDue = plan.measurements.filter(
    (m) => m.cadence.every === 'day' || m.cadence.on === weekday,
  );

  return {
    date,
    weekday,
    dayTypeId,
    dayTypeLabel,
    overridden: !!validOverride && dayTypeOverride !== plan.schedule[weekday],
    timed,
    anytime,
    targets,
    measurementsDue,
    flexibleBudget: flexibleBudget(activities, targets),
  };
}

/**
 * Planned (not measured) remaining budget for the day's flexible meal.
 * A line is only produced when every fixed meal states a value for that target,
 * so a plan with missing meal values never shows a misleading number.
 */
function flexibleBudget(activities: Activity[], targets: NutritionTarget[]): ResolvedDay['flexibleBudget'] {
  const meals = activities.filter((a) => a.kind === 'meal');
  const flexible = meals.filter((m) => m.flexible);
  if (flexible.length !== 1) return null;
  const fixed = meals.filter((m) => !m.flexible);

  const lines: BudgetLine[] = [];
  for (const t of targets) {
    if (!fixed.every((m) => m.nutrition?.[t.id] !== undefined)) continue;
    const planned = fixed.reduce((sum, m) => sum + (m.nutrition?.[t.id] ?? 0), 0);
    const limit = t.min ?? t.max!;
    lines.push({ targetId: t.id, label: t.label, quantity: t.quantity, remaining: Math.max(0, limit - planned) });
  }
  return lines.length ? { activityId: flexible[0].id, lines } : null;
}

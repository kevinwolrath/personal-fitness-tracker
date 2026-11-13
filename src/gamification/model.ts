import { addDays, weekdayOf, toLocalDate, type LocalDate } from '../plan/dates';
import { planSchema, type Plan } from '../plan/schema';
import { prescribeDay, type PrescriptionItem } from '../prescription/prescribe';
import type { StoreSnapshot, DayRecords } from '../storage/types';
import { dailySeries, weekStart } from '../progress/series';
import { measurementMetric } from '../observations/planMetrics';

/** All initial scoring and safety limits live here. No reward scales with calories, load, speed or volume. */
export const scoring = { quest: 20, recovery: 20, weekly: 40, level: 200, dailyCap: 80, weeklyDays: 3, stepThreshold: 3000, sustainedDays: 28, maxWeeklyLossFraction: 0.01 } as const;
export const RECOVERY_LOG = 'gamification-recovery';
export type Quest = { id: string; label: string; done: boolean; xp: number; date: LocalDate; recovery?: boolean };
export type Achievement = { id: string; title: string; detail: string; unlocked: boolean; progress: string; milestone?: boolean };
export type Game = { xp: number; level: number; next: number; quests: Quest[]; weekly: Quest; achievements: Achievement[]; earned: string[]; activeDays: number };

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const safeNumber = (v: number) => Number.isFinite(v) && v > 0;
const eventDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '9999-12-31' : toLocalDate(d);
};
/** An earlier plan version from the configuration history, with the schema's defaults; null when unusable. */
const plans = new Map<string, Plan | null>();
function previousPlan(json: string, planId: string): Plan | null {
  if (!plans.has(json)) {
    let parsed: Plan | null = null;
    try {
      const r = planSchema.safeParse(JSON.parse(json));
      parsed = r.success ? r.data : null;
    } catch {
      parsed = null; // a malformed old backup: keep the current plan
    }
    if (plans.size > 50) plans.clear();
    plans.set(json, parsed);
  }
  const p = plans.get(json) ?? null;
  return p && p.id === planId ? p : null;
}

/** Pure projection, never an incrementing reward ledger. Deletions and corrections reverse their rewards. */
export function gameFrom(snapshot: StoreSnapshot, plan: Plan, today: LocalDate): Game {
  const dates = new Set<string>([today]);
  const add = (d: string) => { if (validDate(d) && d <= today) dates.add(d); };
  snapshot.activityLogs.filter(l => l.planId === plan.id).forEach(l => add(l.date));
  snapshot.observations.forEach(o => add(o.date));
  snapshot.quickLogs.filter(l => l.planId === plan.id).forEach(l => add(l.date));
  (snapshot.mealLogs ?? []).forEach(l => add(l.date));
  const steps = new Map(dailySeries(snapshot.observations, 'steps').map(p => [p.date, p.value]));
  const weeks = new Map<string, Set<string>>();
  const all: Quest[] = [];
  let xp = 0, strengthDays = 0, recoveryDays = 0;
  for (const date of [...dates].sort()) {
    const activities = Object.fromEntries(snapshot.activityLogs.filter(l => l.planId === plan.id && l.date === date).map(l => [l.activityId, l]));
    const records: DayRecords = { activities, dayTypeOverride: snapshot.dayOverrides.find(l => l.planId === plan.id && l.date === date)?.dayTypeId ?? null, observations: [], quickLogs: [] };
    // A saved prescription is the authority for an acted-on historical date. Otherwise use that date's plan revision.
    const versions = snapshot.configChanges.filter(c => eventDate(c.appliedAt) > date).sort((a,b) => a.appliedAt.localeCompare(b.appliedAt));
    let historical = plan;
    // #176: plans are stored as written, without the schema's defaults (e.g. `tracking`). Parse them through the schema,
    // as Progress does (planVersionsFrom); a raw cast made prescribeDay throw and Quests load forever.
    const previous = versions[0] ? previousPlan(versions[0].previousPlanJson, plan.id) : null;
    if (previous) historical = previous;
    const saved = snapshot.daySnapshots.find(s => s.planId === plan.id && s.date === date)?.prescribed as { items?: PrescriptionItem[] } | undefined;
    const prescription = prescribeDay(historical, date, records);
    const items = saved?.items ?? prescription.items;
    const rest = historical.exercise?.restDays?.includes(weekdayOf(date)) ?? false;
    const injured = (snapshot.muscleReports ?? []).some(r => r.kind === 'injured' && eventDate(r.at) <= date && (!r.clearedAt || eventDate(r.clearedAt) > date));
    const groups = new Map<string, { label: string; done: boolean }>();
    for (const item of items) {
      const meal = item.activity?.kind === 'meal' || historical.activities.find(a => a.id === item.key)?.kind === 'meal' || item.purpose === 'nutrition';
      const purpose = meal ? 'nutrition' : item.purpose;
      if (!purpose || !['strength','conditioning_high_intensity','conditioning_low_intensity','walking','mobility','recovery','nutrition'].includes(purpose)) continue;
      const training = ['strength','conditioning_high_intensity','conditioning_low_intensity'].includes(purpose);
      if (training && (rest || injured)) continue;
      const key = purpose.startsWith('conditioning') ? 'conditioning' : purpose;
      const ids = item.kind === 'requirement' ? item.options.map(o => o.id) : [item.key];
      const done = ids.some(id => activities[id]?.status === 'done') || (key === 'walking' && (steps.get(date) ?? 0) >= scoring.stepThreshold) || (meal && (snapshot.mealLogs ?? []).some(m => m.date === date && m.planId === plan.id));
      const old = groups.get(key);
      groups.set(key, { label: old?.label ?? (meal ? 'Record a meal' : item.label), done: !!old?.done || done });
    }
    if (rest || injured) groups.set('recovery', { label: injured ? 'Respect recovery today' : 'Honour your scheduled rest', done: snapshot.quickLogs.some(l => l.planId === plan.id && l.date === date && l.quickLogId === RECOVERY_LOG) || groups.get('recovery')?.done === true });
    const quests = [...groups].map(([key, g]): Quest => ({ id: `${plan.id}:${date}:${key}`, date, ...g, xp: key === 'recovery' ? scoring.recovery : scoring.quest, recovery: key === 'recovery' && (rest || injured) }));
    all.push(...quests);
    const done = quests.filter(q => q.done);
    xp += Math.min(scoring.dailyCap, done.reduce((sum,q) => sum+q.xp,0));
    if (done.length) { const week = weekStart(date); const set = weeks.get(week) ?? new Set(); set.add(date); weeks.set(week,set); }
    if (groups.get('strength')?.done) strengthDays++;
    if (groups.get('recovery')?.done) recoveryDays++;
  }
  const activeDays = [...weeks.values()].reduce((n,s) => n+s.size,0);
  const earned = all.filter(q => q.done).map(q => `quest:${q.id}`);
  for (const [week, days] of weeks) if (days.size >= scoring.weeklyDays) { xp += scoring.weekly; earned.push(`week:${plan.id}:${week}`); }
  const countBadge = (id: string, title: string, detail: string, count: number, target: number): Achievement => ({ id, title, detail, unlocked: count >= target, progress: `${Math.min(count,target)} / ${target}` });
  const achievements: Achievement[] = [
    countBadge('first', 'First spark', 'Complete your first plan quest.', activeDays, 1),
    countBadge('consistency', 'Built to last', 'Record plan quests on 30 days. They need not be consecutive.', activeDays, 30),
    countBadge('strength', 'Strength foundation', 'Complete strength sessions on 12 separate days.', strengthDays, 12),
    countBadge('recovery', 'Recovery matters', 'Honour 4 planned rest or recovery days.', recoveryDays, 4),
    countBadge('continuing', 'Keep forging', 'Record plan quests on 90 days, including after reaching goals.', activeDays, 90),
  ];
  // Performance rewards compare the same movement across dates, never extra sets on a single day.
  const exercises = (snapshot.exerciseLogs ?? []).filter(l => l.date <= today && l.status !== 'skipped' && safeNumber(l.reps ?? 0)).sort((a,b) => a.date.localeCompare(b.date));
  const improved = exercises.some(l => exercises.some(base => base.movement === l.movement && addDays(base.date, scoring.sustainedDays) <= l.date && l.reps! >= base.reps! * 1.2));
  achievements.push({ id: 'performance', title: 'Growing stronger', detail: 'Improve recorded reps for the same movement by 20% over at least 28 days.', unlocked: improved, progress: improved ? 'Reached' : 'Keep recording your capability', milestone: true });
  if (plan.profile?.ageBand !== 'under_18') for (const goal of plan.goals) {
    const m = plan.measurements.find(m => m.id === goal.measurementId);
    if (!m) continue;
    const metric = measurementMetric(plan,m);
    const points = dailySeries(snapshot.observations, metric.metric).filter(p => p.date <= today && safeNumber(p.value));
    const first = points[0];
    const baseline = first ? metric.toPlan(first.value) : null;
    const unsafeIndex = metric.metric === 'weight' ? points.findIndex((p,i) => { if (!i) return false; const prev = points[i-1]; const days = (Date.parse(p.date)-Date.parse(prev.date))/86400000; return days > 0 && (prev.value-p.value)/prev.value > scoring.maxWeeklyLossFraction*days/7+1e-8; }) : -1;
    const fractions = points.map((p,i) => {
      const span = (Date.parse(p.date)-Date.parse(first.date))/86400000;
      if (baseline === null || span < scoring.sustainedDays || unsafeIndex >= 0 && i >= unsafeIndex) return 0;
      const value = metric.toPlan(p.value);
      if (goal.direction === 'maintain') return Math.abs(value-goal.target) <= Math.abs(goal.target)*0.02 ? 1 : 0;
      if (goal.direction === 'decrease') return goal.target < baseline ? (baseline-value)/(baseline-goal.target) : 0;
      return goal.target > baseline ? (value-baseline)/(goal.target-baseline) : 0;
    });
    // A later regression doesn't erase a healthy milestone. Correcting/deleting its source still reverses it.
    for (const [suffix, threshold] of [['halfway',0.5],['goal',1]] as const) {
      const unlocked = fractions.some(f => f >= threshold);
      achievements.push({ id: `${plan.id}:${goal.id}:${suffix}:${goal.target}`, title: `${goal.label} · ${suffix === 'goal' ? 'Goal reached' : 'Halfway'}`, detail: `Your own target: ${goal.target} ${metric.planUnit}. Sustained progress, no weight-loss XP.`, unlocked, progress: unlocked ? 'Reached' : 'Build a gradual record over 28+ days', milestone: true });
    }
  }
  achievements.filter(a => a.unlocked).forEach(a => earned.push(`achievement:${a.id}`));
  const level = 1+Math.floor(xp/scoring.level);
  // Semantic level ids prevent replay after corrections and re-enable.
  for (let n=2;n<=level;n++) earned.push(`level:${plan.id}:${n}`);
  const week = weekStart(today), days = weeks.get(week)?.size ?? 0;
  return { xp, level, next: scoring.level-xp%scoring.level, activeDays, quests: all.filter(q => q.date === today), weekly: { id: `week:${plan.id}:${week}`, date: today, label: `This week: ${Math.min(days,scoring.weeklyDays)} / ${scoring.weeklyDays} days with plan quests`, done: days >= scoring.weeklyDays, xp: scoring.weekly }, achievements, earned };
}

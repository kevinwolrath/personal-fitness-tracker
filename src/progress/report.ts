import { addDays, toLocalDate, type LocalDate } from '../plan/dates';
import { planSchema, type Plan } from '../plan/schema';
import type { Observation } from '../observations/types';
import { convertEnergy, entryUnit, type EnergyDisplay } from '../energy';
import { prescribeDay } from '../prescription/prescribe';
import type { ActivityLogRecord, ConfigChange, DayOverrideRecord } from '../storage/types';
import { fromCanonical, toCanonical } from '../observations/units';
import { activitySummary, isHealthActivity, isWalk } from '../observations/activity';
import { formatDistance } from '../observations/units';
import type { MealLog } from '../nutrition/contract';
import { mealSumsByDate, nutrientForMetric } from '../nutrition/intake';
import { forecast, trendInsight } from './forecast';
import {
  bmiSeries,
  bucketMeans,
  compareWeeks,
  composition,
  dailySeries,
  inRange,
  percentChange,
  projectGoal,
  rollingAverage,
  slowdown,
  weeklyRate,
  weeklyTotals,
  weekStart,
  meanBetween,
  type Point,
  type WeekCompare,
} from './series';

/**
 * Progress view model (#52, first PR: measurements and weight trends). Pure: observations + plan + today + range
 * in, one model per chart out. Measured values are dots; calculated values (averages, BMI, changes) are lines
 * and say so; device estimates are tagged. Nothing is filled in between measurements.
 */
export const chartIds = ['weight', 'waist', 'bmi', 'weight-vs-waist', 'rate', 'goal', 'body-fat', 'workouts', 'active-minutes', 'steps', 'energy', 'energy-balance', 'protein'] as const;
export type ChartId = (typeof chartIds)[number];
export const chartTitles: Record<ChartId, string> = {
  weight: 'Weight',
  waist: 'Waist',
  bmi: 'BMI',
  'weight-vs-waist': 'Weight vs waist',
  rate: 'Weekly rate',
  goal: 'Goal',
  'body-fat': 'Body fat',
  workouts: 'Workouts',
  'active-minutes': 'Active minutes',
  steps: 'Steps',
  energy: 'Energy eaten vs burned',
  'energy-balance': 'Energy balance',
  protein: 'Protein',
};
export const progressMetrics = ['weight', 'waist', 'body_fat', 'exercise_session', 'active_minutes', 'steps', 'distance', 'energy_intake', 'total_energy', 'protein_intake'];

export const ranges = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All', days: null },
] as const;
export type RangeId = (typeof ranges)[number]['id'];

/** `dashed`: a forecast line; `band`: a shaded range between `points` (low) and `upper` (#57). */
export type Series = { label: string; points: Point[]; style: 'dots' | 'line' | 'bars' | 'dashed' | 'band'; tone: 'accent' | 'ink' | 'warm'; upper?: Point[] };
export type ChartModel = {
  id: ChartId;
  title: string;
  /** Latest headline value with unit, or null when empty. */
  headline: string | null;
  sub: string | null;
  tag: 'Calculated' | 'Estimate' | null;
  unit: string;
  series: Series[];
  /** A flat reference line (the goal). */
  reference?: { value: number; label: string };
  /** Why the chart is empty, in the user's terms; null when it has data. */
  empty: string | null;
  note: string | null;
  /** One sentence for screen readers. */
  summary: string;
};

const fmt = (n: number, d = 1) => n.toFixed(d);
const signed = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`;
const shortDate = (d: LocalDate) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export type ProgressOptions = {
  /** How energy is shown on this phone (contract 11); charts use its first unit. */
  energy?: EnergyDisplay;
  /**
   * The plan's activity logs and day-type overrides, for workouts done vs scheduled. `planVersions` (#67): earlier
   * versions of the plan from the configuration history, each in effect for dates before `until`, so a past day is
   * compared with the schedule it actually had.
   */
  history?: { activityLogs: ActivityLogRecord[]; dayOverrides: DayOverrideRecord[]; planVersions?: { until: LocalDate; plan: Plan }[] };
  /** Meals actually eaten (#97): a day's eaten energy and protein when it has no day total of its own. */
  mealLogs?: MealLog[];
};

/**
 * Eaten per day (#97, contract 15): the day total (entered, from a screenshot or imported) where there is one,
 * otherwise the sum of that day's logged meals. The two are never added together.
 */
export function intakeSeries(observations: Observation[], mealLogs: MealLog[], metric: 'energy_intake' | 'protein_intake'): Point[] {
  const totals = dailySeries(observations, metric);
  const has = new Set(totals.map((p) => p.date));
  const meals = [...mealSumsByDate(mealLogs, nutrientForMetric(metric)!)]
    .filter(([date]) => !has.has(date))
    .map(([date, value]): Point => ({ date, value, kind: 'measured', source: 'meals' }));
  return [...totals, ...meals].sort((a, b) => a.date.localeCompare(b.date));
}

export function progressReport(observations: Observation[], plan: Plan, today: LocalDate, range: RangeId, opts: ProgressOptions = {}) {
  const days = ranges.find((r) => r.id === range)!.days;
  const from = days ? addDays(today, -(days - 1)) : null;
  const mass = plan.units.mass;
  const length = plan.units.length;
  const toMass = (p: Point): Point => ({ ...p, value: fromCanonical(p.value, mass, 'mass') ?? p.value });
  const toLength = (p: Point): Point => ({ ...p, value: fromCanonical(p.value, length, 'length') ?? p.value });

  const weightKg = dailySeries(observations, 'weight');
  const weight = weightKg.map(toMass);
  const avgAll = rollingAverage(weight);
  const waistAll = dailySeries(observations, 'waist').map(toLength);
  const bodyFatAll = dailySeries(observations, 'body_fat');
  const w = inRange(weight, from, today);
  const avg = inRange(avgAll, from, today);
  const waist = inRange(waistAll, from, today);
  const hasWaistMeasurement = plan.measurements.some((m) => m.id === 'waist');
  const span = days ? `in ${days} days` : 'overall';
  const change = (ps: Point[]) => (ps.length >= 2 ? ps[ps.length - 1].value - ps[0].value : null);

  const charts = {} as Record<ChartId, ChartModel>;

  // 1. Weight with its 7-day average.
  const avgChange = change(avg);
  charts.weight = {
    id: 'weight',
    title: chartTitles.weight,
    headline: avg.length ? `${fmt(avg[avg.length - 1].value)} ${mass}` : w.length ? `${fmt(w[w.length - 1].value)} ${mass}` : null,
    sub: avg.length ? `7-day average${avgChange !== null ? ` · ${signed(avgChange)} ${mass} ${span}` : ''}` : w.length ? 'Latest weigh-in' : null,
    tag: null,
    unit: mass,
    series: [
      { label: 'Weigh-ins', points: w, style: 'dots', tone: 'accent' },
      { label: '7-day average', points: avg, style: 'line', tone: 'ink' },
    ],
    empty: w.length ? null : 'No weigh-ins in this range. Log your weight on Today.',
    note: null,
    summary: w.length ? `Weight: ${w.length} weigh-ins; latest 7-day average ${avg.length ? fmt(avg[avg.length - 1].value) : fmt(w[w.length - 1].value)} ${mass}.` : 'Weight: no weigh-ins in this range.',
  };

  // 2. Waist: measurements only (often weekly), never joined up.
  const waistChange = change(waist);
  charts.waist = {
    id: 'waist',
    title: chartTitles.waist,
    headline: waist.length ? `${fmt(waist[waist.length - 1].value)} ${length}` : null,
    sub: waist.length ? `Latest, ${shortDate(waist[waist.length - 1].date)}${waistChange !== null ? ` · ${signed(waistChange)} ${length} ${span}` : ''}` : null,
    tag: null,
    unit: length,
    series: [{ label: 'Measurements', points: waist, style: 'dots', tone: 'accent' }],
    empty: waist.length ? null : hasWaistMeasurement ? 'No waist measurements in this range. Log one on Today when it’s due.' : 'Waist isn’t tracked in your plan. Add it with Configure with AI.',
    note: null,
    summary: waist.length ? `Waist: ${waist.length} measurements; latest ${fmt(waist[waist.length - 1].value)} ${length}.` : 'Waist: no measurements in this range.',
  };

  // 3. BMI: only from exact weigh-ins and a stated height.
  const heightCm = plan.profile?.heightCm;
  const bmi = bmiSeries(inRange(weightKg, from, today), heightCm);
  charts.bmi = {
    id: 'bmi',
    title: chartTitles.bmi,
    headline: bmi?.length ? fmt(bmi[bmi.length - 1].value) : null,
    sub: bmi?.length ? `From your weigh-ins and height ${heightCm} cm` : null,
    tag: 'Calculated',
    unit: 'kg/m²',
    series: bmi ? [{ label: 'BMI', points: bmi, style: 'line', tone: 'ink' }] : [],
    empty: !heightCm ? 'Add your height (☰ menu: Edit setup answers) to see BMI. It’s only calculated from real weigh-ins.' : bmi?.length ? null : 'No weigh-ins in this range.',
    note: bmi?.length ? 'BMI is a rough population measure; it doesn’t tell fat from muscle.' : null,
    summary: bmi?.length ? `BMI ${fmt(bmi[bmi.length - 1].value)}, calculated.` : 'BMI: not available.',
  };

  // 4. Weight vs waist as % change from the start of the range.
  const wPct = percentChange(avg.length >= 2 ? avg : w);
  const cPct = percentChange(waist);
  const both = wPct.length >= 2 && cPct.length >= 2;
  const lastW = both ? wPct[wPct.length - 1].value : 0;
  const lastC = both ? cPct[cPct.length - 1].value : 0;
  charts['weight-vs-waist'] = {
    id: 'weight-vs-waist',
    title: chartTitles['weight-vs-waist'],
    headline: both ? `${signed(lastW)}% · ${signed(lastC)}%` : null,
    sub: both ? `Weight · waist, change ${span}` : null,
    tag: 'Calculated',
    unit: '%',
    series: [
      { label: 'Weight (7-day avg)', points: wPct, style: 'line', tone: 'ink' },
      { label: 'Waist', points: cPct, style: 'dots', tone: 'warm' },
    ],
    empty: both ? null : 'Needs at least two weigh-ins and two waist measurements in this range.',
    note: both && lastC < -0.5 && Math.abs(lastW) < 0.5 ? 'Waist down while weight holds steady is consistent with body recomposition, but it isn’t proof of muscle gain.' : null,
    summary: both ? `Weight changed ${signed(lastW)} percent and waist ${signed(lastC)} percent.` : 'Weight vs waist: not enough data.',
  };

  // 5. Weekly rate and whether it's slowing.
  const rate = weeklyRate(weight, today, 28);
  const slow = slowdown(weight, today);
  const weekly = bucketMeans(inRange(weight, from ? addDays(from, -7) : null, today), 'week');
  const weeklyChanges: Point[] = weekly.slice(1).map((b, i) => ({ date: b.bucket, value: b.value - weekly[i].value, kind: 'calculated' }));
  const slowText =
    slow.status === 'insufficient'
      ? 'Comparing with the 4 weeks before needs 8 weeks of weigh-ins.'
      : slow.status === 'slower'
        ? `Slower than the 4 weeks before (${signed(slow.previous, 2)} ${mass}/week). Week-to-week changes are normal.`
        : slow.status === 'faster'
          ? `Faster than the 4 weeks before (${signed(slow.previous, 2)} ${mass}/week).`
          : slow.status === 'reversed'
            ? `The direction changed from the 4 weeks before (${signed(slow.previous, 2)} ${mass}/week).`
            : 'About the same as the 4 weeks before.';
  charts.rate = {
    id: 'rate',
    title: chartTitles.rate,
    headline: rate !== null ? `${signed(rate, 2)} ${mass}/week` : null,
    sub: rate !== null ? `Trend over the last 4 weeks. ${slowText}` : null,
    tag: 'Calculated',
    unit: `${mass}/week`,
    series: [{ label: 'Change from the week before (weekly averages)', points: weeklyChanges, style: 'line', tone: 'ink' }],
    reference: { value: 0, label: 'No change' },
    empty: rate === null ? 'Needs weigh-ins across at least a week.' : null,
    note: null,
    summary: rate !== null ? `Weight trend ${signed(rate, 2)} ${mass} per week. ${slowText}` : 'Weekly rate: not enough data.',
  };

  // 6. Goal and a projection range from the observed trend.
  const goal = plan.goals.find((g) => plan.measurements.find((m) => m.id === g.measurementId)?.quantity === 'mass');
  // Goal targets are written in the plan's mass unit; the trend is in kg.
  const targetKg = goal ? toCanonical(goal.target, mass, 'mass') ?? goal.target : null;
  const proj = goal && targetKg !== null ? projectGoal(weightKg, { target: targetKg, direction: goal.direction }, today) : null;
  const projText = !proj
    ? null
    : proj.status === 'projected'
      ? `At the last 4 weeks’ rate: ${proj.latest ? `between ${shortDate(proj.earliest)} and ${shortDate(proj.latest)}` : `${shortDate(proj.earliest)} at the earliest`}. A projection, not a promise.`
      : proj.status === 'reached'
        ? 'Reached. Well done.'
        : proj.status === 'not-moving-towards'
          ? 'The recent trend isn’t heading towards the goal, so there’s no projection.'
          : 'A projection needs a few weeks of weigh-ins.';
  // #57: the forecast from the recent trend (early weeks left out), with its widening range. An estimate.
  const fc = forecast(weight, today);
  const fcText = fc.status === 'ok' ? `Forecast ${fmt(fc.low[fc.low.length - 1].value)}–${fmt(fc.high[fc.high.length - 1].value)} ${mass} in ${fc.mid.length} weeks.` : null;
  charts.goal = {
    id: 'goal',
    title: chartTitles.goal,
    headline: goal ? `${goal.label}: ${fmt(goal.target)} ${mass}` : null,
    sub: [fcText, projText].filter(Boolean).join(' ') || null,
    tag: fc.status === 'ok' || proj?.status === 'projected' ? 'Estimate' : null,
    unit: mass,
    series: [
      { label: '7-day average', points: avg, style: 'line', tone: 'ink' },
      ...(fc.status === 'ok'
        ? ([
            { label: 'Forecast range', points: [{ date: fc.from.date, value: fc.from.value, kind: 'calculated' }, ...fc.low], upper: [{ date: fc.from.date, value: fc.from.value, kind: 'calculated' }, ...fc.high], style: 'band', tone: 'accent' },
            { label: 'Forecast', points: [{ date: fc.from.date, value: fc.from.value, kind: 'calculated' }, ...fc.mid], style: 'dashed', tone: 'accent' },
          ] as Series[])
        : []),
    ],
    reference: goal ? { value: goal.target, label: 'Goal' } : undefined,
    empty: goal ? (avg.length ? null : 'No weigh-ins in this range.') : 'No weight goal in your plan. Add one with Configure with AI.',
    note: null,
    summary: goal ? `Goal ${fmt(goal.target)} ${mass}. ${projText ?? ''}` : 'No weight goal.',
  };

  // 7. Body fat from a scale: estimates only.
  const bf = inRange(bodyFatAll, from, today);
  const comp = composition(inRange(weightKg, from, today), bf);
  const lastComp = comp[comp.length - 1];
  charts['body-fat'] = {
    id: 'body-fat',
    title: chartTitles['body-fat'],
    headline: bf.length ? `${fmt(bf[bf.length - 1].value)} %` : null,
    sub: lastComp ? `≈ ${fmt(fromCanonical(lastComp.fat, mass, 'mass') ?? lastComp.fat)} ${mass} fat · ${fmt(fromCanonical(lastComp.lean, mass, 'mass') ?? lastComp.lean)} ${mass} lean on ${shortDate(lastComp.date)}` : null,
    tag: 'Estimate',
    unit: '%',
    series: [{ label: 'Scale readings', points: bf, style: 'dots', tone: 'warm' }],
    empty: bf.length ? null : 'No body-fat readings. A smart scale can provide them through Health Connect.',
    note: bf.length ? 'Consumer scales estimate body fat; readings vary with hydration and time of day.' : null,
    summary: bf.length ? `Body fat ${fmt(bf[bf.length - 1].value)} percent, a scale estimate.` : 'Body fat: no readings.',
  };

  const activity = activityCharts(observations, plan, today, from, opts);
  Object.assign(charts, activity.charts);

  const summary: { weight: WeekCompare; waist: WeekCompare; workouts: WeekCompare; mass: string; length: string } = {
    weight: compareWeeks(weight, today, 'mean'),
    waist: compareWeeks(waistAll, today, 'last'),
    workouts: compareWeeks(activity.doneDaily, today, 'total'),
    mass,
    length,
  };
  // #57: the weight trend's plain status, over the whole history (not the chart range).
  const trend = trendInsight(weight, today, mass);
  return { charts, summary, trend };
}

/** Saved chart order and visibility, made whole: unknown ids dropped, new charts appended. */
export function chartLayout(saved: { order?: string[]; hidden?: string[] } | null): { order: ChartId[]; hidden: ChartId[] } {
  const known = (xs: string[] | undefined) => (xs ?? []).filter((x): x is ChartId => (chartIds as readonly string[]).includes(x));
  const order = [...new Set([...known(saved?.order), ...chartIds])];
  return { order, hidden: known(saved?.hidden) };
}

const thousands = (n: number) => Math.round(n).toLocaleString('en-AU');
const workoutPurposes: string[] = ['strength', 'conditioning_high_intensity', 'conditioning_low_intensity'];

/**
 * Part 2 (#52): workouts done vs scheduled, active minutes, steps, energy eaten vs burned, energy balance and
 * protein. Intake comes only from logged or imported intake observations, never from ticked planned meals.
 * Energy values are estimates (food logging and wearables both are) and say so.
 */
function activityCharts(observations: Observation[], plan: Plan, today: LocalDate, from: LocalDate | null, opts: ProgressOptions) {
  const charts = {} as Record<ChartId, ChartModel>;
  const span = from ? `since ${new Date(`${from}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'overall';

  // Workouts: required training items of the plan in effect each day, done vs scheduled, per week.
  const logs = opts.history?.activityLogs ?? [];
  const versions = [...(opts.history?.planVersions ?? [])].sort((a, b) => a.until.localeCompare(b.until));
  /** The plan that applied on `d`: the version replaced by the first change made after that day, else the current one. */
  const planOn = (d: LocalDate) => versions.find((v) => d < v.until)?.plan ?? plan;
  const overrides = new Map((opts.history?.dayOverrides ?? []).map((o) => [o.date, o.dayTypeId]));
  const firstLog = logs.length ? logs[0].date : today;
  const start = from ?? (firstLog < today ? firstLog : addDays(today, -27));
  const doneDaily: Point[] = [];
  const scheduledDaily: Point[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dayPlan = planOn(d);
    const activities = Object.fromEntries(logs.filter((l) => l.date === d && l.planId === dayPlan.id).map((l) => [l.activityId, l]));
    const p = prescribeDay(dayPlan, d, { activities, dayTypeOverride: overrides.get(d) ?? null, observations: [], quickLogs: [] });
    // Workouts are training sessions: a structured session, strength or conditioning. Walks and errands count in
    // active minutes and steps instead.
    const workouts = p.items.filter((i) => i.required && (!!i.session || (i.purpose !== null && workoutPurposes.includes(i.purpose))));
    if (!workouts.length) continue;
    scheduledDaily.push({ date: d, value: workouts.length, kind: 'calculated' });
    doneDaily.push({ date: d, value: workouts.filter((i) => i.state === 'done').length, kind: 'measured' });
  }
  const done = weeklyTotals(doneDaily);
  const scheduled = weeklyTotals(scheduledDaily);
  // Every recorded session counts, including several on one day (#67).
  const healthSessions=observations.filter(o=>isHealthActivity(o)&&(!from||o.date>=from)&&o.date<=today);
  const healthSummary = activitySummary(healthSessions);
  const distinctHealth=[...new Set(healthSessions.map(o=>o.date))].flatMap(date=>activitySummary(healthSessions.filter(o=>o.date===date)).unique);
  const sessionsRecorded: Point[] = observations.filter(o=>!isHealthActivity(o)||distinctHealth.includes(o))
    .filter((o) => o.metric === 'exercise_session' && o.kind === 'observed' && (!from || o.date >= from) && o.date <= today)
    .map((o) => ({ date: o.date, value: 1, kind: 'measured' }));
  const imported = weeklyTotals(sessionsRecorded);
  const thisWeek = { done: done.find((w) => w.week === weekStart(today))?.total ?? 0, of: scheduled.find((w) => w.week === weekStart(today))?.total ?? 0 };
  const importedTotal = imported.reduce((s, w) => s + w.total, 0);
  charts.workouts = {
    id: 'workouts',
    title: chartTitles.workouts,
    headline: scheduled.length ? `This week: ${thisWeek.done} of ${thisWeek.of} done` : null,
    sub: scheduled.length ? `Strength and conditioning sessions per week, against the plan in effect each day${importedTotal ? ` · ${importedTotal} more recorded by other apps ${span}` : ''}` : null,
    tag: null,
    unit: 'workouts',
    series: [
      { label: 'Done', points: done.map((w) => ({ date: w.week, value: w.total, kind: 'measured' })), style: 'bars', tone: 'accent' },
      { label: 'Scheduled', points: scheduled.map((w) => ({ date: w.week, value: w.total, kind: 'calculated' })), style: 'dots', tone: 'ink' },
    ],
    empty: scheduled.length ? null : 'No workouts are scheduled in your plan for this range.',
    note: healthSummary.uncertainTime ? 'Some imported records have no timing; their separate sessions cannot be verified.' : null,
    summary: scheduled.length ? `Workouts this week: ${thisWeek.done} of ${thisWeek.of} done.` : 'Workouts: none scheduled.',
  };

  // Active minutes per week: a wearable's active minutes where present, otherwise recorded workout durations.
  const active = dailySeries(observations, 'active_minutes');
  const sessions = dailySeries(observations, 'exercise_session', 'sum');
  const activeDays = new Set(active.map((p) => p.date));
  const minutes = inRange([...active, ...sessions.filter((p) => !activeDays.has(p.date))].sort((a, b) => a.date.localeCompare(b.date)), from, today);
  const minWeeks = weeklyTotals(minutes);
  const minThis = minWeeks.find((w) => w.week === weekStart(today))?.total;
  const walks=activitySummary(healthSessions.filter(isWalk));
  charts['active-minutes'] = {
    id: 'active-minutes',
    title: chartTitles['active-minutes'],
    headline: minWeeks.length ? `This week: ${thousands(minThis ?? 0)} min` : null,
    sub: minWeeks.length ? 'Per week, from active minutes or recorded workouts (imported)' : null,
    tag: null,
    unit: 'min',
    series: [{ label: 'Minutes per week', points: minWeeks.map((w) => ({ date: w.week, value: w.total, kind: 'measured' })), style: 'bars', tone: 'accent' }],
    empty: minWeeks.length ? null : 'No active minutes or workouts recorded. They can come from Health Connect or a screenshot import.',
    note: healthSessions.length ? `Overlapping Health Connect time counts once.${healthSummary.uncertainTime?' Incomplete timings make duration a lower bound.':''}${walks.metres!==null?` Walking distance: ${formatDistance(walks.metres)} recorded${walks.partialDistance?' (partial)':''}.`:''}` : null,
    summary: minWeeks.length ? `Active minutes this week: ${thousands(minThis ?? 0)}.` : 'Active minutes: none recorded.',
  };

  // Steps: days as dots, a 7-day average, distance in the subtitle.
  const steps = inRange(dailySeries(observations, 'steps'), from, today);
  const stepsAvg = inRange(rollingAverage(dailySeries(observations, 'steps')), from, today);
  const km = inRange(dailySeries(observations, 'distance'), from, today).reduce((s, p) => s + p.value, 0);
  charts.steps = {
    id: 'steps',
    title: chartTitles.steps,
    headline: stepsAvg.length ? `${thousands(stepsAvg[stepsAvg.length - 1].value)} a day` : steps.length ? thousands(steps[steps.length - 1].value) : null,
    sub: steps.length ? `7-day average${km ? ` · ${km.toFixed(1)} km ${span}` : ''}` : null,
    tag: null,
    unit: 'steps',
    series: [
      { label: 'Days', points: steps, style: 'dots', tone: 'accent' },
      { label: '7-day average', points: stepsAvg, style: 'line', tone: 'ink' },
    ],
    empty: steps.length ? null : 'No steps recorded. Connect Health Connect or import a screenshot.',
    note: null,
    summary: steps.length ? `Steps: ${steps.length} days; 7-day average ${stepsAvg.length ? thousands(stepsAvg[stepsAvg.length - 1].value) : 'not yet'}.` : 'Steps: none recorded.',
  };

  // Energy eaten vs burned (estimates), in the device's energy unit.
  const unit = entryUnit(opts.energy ?? plan.units.energy);
  const toUnit = (p: Point): Point => ({ ...p, value: convertEnergy(p.value, 'kJ', unit) });
  const eaten = inRange(intakeSeries(observations, opts.mealLogs ?? [], 'energy_intake'), from, today).map(toUnit);
  const burned = inRange(dailySeries(observations, 'total_energy'), from, today).map(toUnit);
  const last7 = (ps: Point[]) => meanBetween(ps, addDays(today, -6), today);
  const e7 = last7(eaten);
  const b7 = last7(burned);
  charts.energy = {
    id: 'energy',
    title: chartTitles.energy,
    headline: e7 !== null || b7 !== null ? `${e7 !== null ? thousands(e7) : '—'} eaten · ${b7 !== null ? thousands(b7) : '—'} burned` : null,
    sub: e7 !== null || b7 !== null ? `${unit} a day, last 7 days (days with data only)` : null,
    tag: 'Estimate',
    unit,
    series: [
      { label: 'Eaten (logged or imported)', points: eaten, style: 'dots', tone: 'accent' },
      { label: 'Burned (from a wearable)', points: burned, style: 'dots', tone: 'warm' },
    ],
    empty: eaten.length || burned.length ? null : 'Energy appears here when you log or import what you ate, or a wearable reports energy burned. Ticking a planned meal doesn’t count as eaten.',
    note: eaten.length || burned.length ? 'Both are estimates: food logs and wearables can be off by a lot.' : null,
    summary: eaten.length || burned.length ? `Energy, last 7 days: ${e7 !== null ? thousands(e7) : 'no'} ${unit} eaten and ${b7 !== null ? thousands(b7) : 'no'} ${unit} burned a day.` : 'Energy: no data.',
  };

  // Energy balance per week (eaten − burned) against the weight trend.
  // Only days with both values: a day's eaten minus that same day's burned, then the weekly average of those days (#67).
  const burnedOn = new Map(burned.map((p) => [p.date, p.value]));
  const dailyBalance: Point[] = eaten.filter((p) => burnedOn.has(p.date)).map((p) => ({ date: p.date, value: p.value - burnedOn.get(p.date)!, kind: 'calculated' }));
  const balance: Point[] = bucketMeans(dailyBalance, 'week').map((b) => ({ date: b.bucket, value: b.value, kind: 'calculated' }));
  const lastBal = balance[balance.length - 1];
  charts['energy-balance'] = {
    id: 'energy-balance',
    title: chartTitles['energy-balance'],
    headline: lastBal ? `${lastBal.value > 0 ? '+' : lastBal.value < 0 ? '−' : ''}${thousands(Math.abs(lastBal.value))} ${unit}/day` : null,
    sub: lastBal ? 'Eaten minus burned on the same day, averaged over each week’s days with both' : null,
    tag: 'Estimate',
    unit: `${unit}/day`,
    series: [{ label: 'Weekly balance', points: balance, style: 'bars', tone: 'warm' }],
    reference: { value: 0, label: 'Balanced' },
    empty: balance.length ? null : 'Needs energy eaten and energy burned recorded on the same days.',
    note: balance.length ? 'Estimates rarely match the scale exactly. Your weight trend is the better guide.' : null,
    summary: lastBal ? `Latest weekly energy balance ${thousands(lastBal.value)} ${unit} a day, an estimate.` : 'Energy balance: not enough data.',
  };

  // Protein vs the plan's protein target.
  const protein = inRange(intakeSeries(observations, opts.mealLogs ?? [], 'protein_intake'), from, today);
  const target = plan.nutrition.targets.find((t) => t.quantity === 'grams' && /protein/i.test(`${t.id} ${t.label}`));
  const p7 = last7(protein);
  charts.protein = {
    id: 'protein',
    title: chartTitles.protein,
    headline: p7 !== null ? `${Math.round(p7)} g a day` : null,
    sub: p7 !== null ? `Last 7 days (days with data)${target?.min ? ` · target ${target.min}${target.max ? `–${target.max}` : '+'} g` : ''}` : null,
    tag: null,
    unit: 'g',
    series: [{ label: 'Logged or imported', points: protein, style: 'dots', tone: 'accent' }],
    reference: target?.min ? { value: target.min, label: 'Target (minimum)' } : undefined,
    empty: protein.length ? null : 'Protein appears here when you log or import it. Ticking a planned meal doesn’t count as eaten.',
    note: null,
    summary: p7 !== null ? `Protein ${Math.round(p7)} grams a day over the last 7 days.` : 'Protein: none recorded.',
  };

  return { charts, doneDaily };
}

/**
 * Earlier plan versions from the configuration history (#67): each change replaced a plan, and that plan applied
 * to the days before the change. Unreadable entries are skipped.
 */
export function planVersionsFrom(changes: ConfigChange[]): { until: LocalDate; plan: Plan }[] {
  return changes.flatMap((c) => {
    try {
      const r = planSchema.safeParse(JSON.parse(c.previousPlanJson));
      return r.success ? [{ until: toLocalDate(new Date(c.appliedAt)), plan: r.data }] : [];
    } catch {
      return [];
    }
  });
}

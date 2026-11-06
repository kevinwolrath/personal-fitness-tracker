import { addDays, type LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import type { Observation } from '../observations/types';
import { fromCanonical, toCanonical } from '../observations/units';
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
  type Point,
  type WeekCompare,
} from './series';

/**
 * Progress view model (#52, first PR: measurements and weight trends). Pure: observations + plan + today + range
 * in, one model per chart out. Measured values are dots; calculated values (averages, BMI, changes) are lines
 * and say so; device estimates are tagged. Nothing is filled in between measurements.
 */
export const chartIds = ['weight', 'waist', 'bmi', 'weight-vs-waist', 'rate', 'goal', 'body-fat'] as const;
export type ChartId = (typeof chartIds)[number];
export const chartTitles: Record<ChartId, string> = {
  weight: 'Weight',
  waist: 'Waist',
  bmi: 'BMI',
  'weight-vs-waist': 'Weight vs waist',
  rate: 'Weekly rate',
  goal: 'Goal',
  'body-fat': 'Body fat',
};
export const progressMetrics = ['weight', 'waist', 'body_fat'];

export const ranges = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All', days: null },
] as const;
export type RangeId = (typeof ranges)[number]['id'];

export type Series = { label: string; points: Point[]; style: 'dots' | 'line'; tone: 'accent' | 'ink' | 'warm' };
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

export function progressReport(observations: Observation[], plan: Plan, today: LocalDate, range: RangeId) {
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
  charts.goal = {
    id: 'goal',
    title: chartTitles.goal,
    headline: goal ? `${goal.label}: ${fmt(goal.target)} ${mass}` : null,
    sub: projText,
    tag: proj?.status === 'projected' ? 'Calculated' : null,
    unit: mass,
    series: [{ label: '7-day average', points: avg, style: 'line', tone: 'ink' }],
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

  const summary: { weight: WeekCompare; waist: WeekCompare; mass: string; length: string } = {
    weight: compareWeeks(weight, today, 'mean'),
    waist: compareWeeks(waistAll, today, 'last'),
    mass,
    length,
  };
  return { charts, summary };
}

/** Saved chart order and visibility, made whole: unknown ids dropped, new charts appended. */
export function chartLayout(saved: { order?: string[]; hidden?: string[] } | null): { order: ChartId[]; hidden: ChartId[] } {
  const known = (xs: string[] | undefined) => (xs ?? []).filter((x): x is ChartId => (chartIds as readonly string[]).includes(x));
  const order = [...new Set([...known(saved?.order), ...chartIds])];
  return { order, hidden: known(saved?.hidden) };
}

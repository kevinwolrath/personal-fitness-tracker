import { addDays, type LocalDate } from '../plan/dates';
import { daysBetween, inRange, rollingAverage, trend, type Point } from './series';

/**
 * Weight forecast and plateau guidance (#57). Pure, advisory only: nothing here changes a plan, a target or a
 * workout. Every result says when there isn't enough data instead of guessing.
 *
 * - **Early water weight:** the first two weeks of weigh-ins are left out of the trend once later data exists, so a
 *   fast start (water and glycogen) is never projected forward.
 * - **Forecast:** a straight line from the latest 7-day average at the recent rate (the last 4–6 weeks), with a
 *   band that widens with time from the rate's uncertainty. Never further than 12 weeks ahead.
 * - **Plateau:** at least 3 weeks of regular weigh-ins (6 or more) whose trend is flat (|rate| below 0.1 kg a
 *   week, or the equivalent in the plan's unit). Isolated weigh-ins or a few flat days never count.
 */

export const EARLY_DAYS = 14;
const MIN_FORECAST_SPAN = 21;
const MIN_FORECAST_POINTS = 6;
const PLATEAU_DAYS = 21;
const PLATEAU_POINTS = 6;
const HORIZON_DAYS = 84;

export type Forecast =
  | { status: 'insufficient'; reason: string }
  | {
      status: 'ok';
      /** Rate per week used (negative = losing). */
      perWeek: number;
      /** ± per week (one standard error). */
      perWeekError: number;
      from: { date: LocalDate; value: number };
      /** Weekly points ahead: middle, low and high of the band. */
      mid: Point[];
      low: Point[];
      high: Point[];
      /** Days of data the rate came from, and whether early weigh-ins were left out. */
      basisDays: number;
      earlyExcluded: boolean;
    };

/** The weigh-ins the trend is fitted on: recent weeks, without the first two weeks of the whole history. */
export function trendBasis(weights: Point[], today: LocalDate, days = 42): { points: Point[]; earlyExcluded: boolean } {
  if (!weights.length) return { points: [], earlyExcluded: false };
  const earlyEnd = addDays(weights[0].date, EARLY_DAYS - 1);
  const window = inRange(weights, addDays(today, -(days - 1)), today);
  const later = window.filter((p) => p.date > earlyEnd);
  // Only leave the early weeks out when what's left is still enough to fit a trend.
  const enough = later.length >= MIN_FORECAST_POINTS && later.length && daysBetween(later[0].date, later[later.length - 1].date) >= MIN_FORECAST_SPAN;
  return enough ? { points: later, earlyExcluded: later.length < window.length } : { points: window, earlyExcluded: false };
}

export function forecast(weights: Point[], today: LocalDate, horizonDays = HORIZON_DAYS): Forecast {
  const { points, earlyExcluded } = trendBasis(weights, today);
  if (points.length < MIN_FORECAST_POINTS) return { status: 'insufficient', reason: `A forecast needs at least ${MIN_FORECAST_POINTS} weigh-ins over 3 weeks.` };
  const span = daysBetween(points[0].date, points[points.length - 1].date);
  if (span < MIN_FORECAST_SPAN) return { status: 'insufficient', reason: 'A forecast needs weigh-ins spread over at least 3 weeks.' };
  if (addDays(points[points.length - 1].date, 14) < today) return { status: 'insufficient', reason: 'No weigh-in in the last 2 weeks, so there is no current trend.' };
  const t = trend(points);
  if (!t || !Number.isFinite(t.se)) return { status: 'insufficient', reason: 'Not enough variation in the weigh-ins to fit a trend.' };
  const avg = rollingAverage(points, 7, 1);
  const last = avg[avg.length - 1];
  const mid: Point[] = [];
  const low: Point[] = [];
  const high: Point[] = [];
  for (let d = 7; d <= Math.min(horizonDays, HORIZON_DAYS); d += 7) {
    const date = addDays(last.date, d);
    const m = last.value + t.perDay * d;
    // The band grows with the rate's uncertainty and a floor for day-to-day noise (0.3 units).
    const spread = t.se * d + 0.3;
    mid.push({ date, value: m, kind: 'calculated' });
    low.push({ date, value: m - spread, kind: 'calculated' });
    high.push({ date, value: m + spread, kind: 'calculated' });
  }
  return { status: 'ok', perWeek: t.perDay * 7, perWeekError: t.se * 7, from: { date: last.date, value: last.value }, mid, low, high, basisDays: span, earlyExcluded };
}

export type Plateau =
  | { status: 'insufficient' }
  | { status: 'none'; perWeek: number }
  | { status: 'plateau'; weeks: number; perWeek: number };

/** A flat trend over at least 3 weeks of regular weigh-ins. `flatPerWeek` in the series' unit (0.1 kg ≈ 0.2 lb). */
export function plateau(weights: Point[], today: LocalDate, flatPerWeek = 0.1): Plateau {
  const recent = inRange(weights, addDays(today, -(PLATEAU_DAYS - 1)), today);
  if (recent.length < PLATEAU_POINTS || daysBetween(recent[0].date, recent[recent.length - 1].date) < PLATEAU_DAYS - 7) return { status: 'insufficient' };
  const t = trend(recent);
  if (!t) return { status: 'insufficient' };
  const perWeek = t.perDay * 7;
  if (Math.abs(perWeek) >= flatPerWeek) return { status: 'none', perWeek };
  // How long it has been flat: extend back a week at a time while it stays flat.
  let weeks = 3;
  for (let w = 4; w <= 12; w++) {
    const win = inRange(weights, addDays(today, -(w * 7 - 1)), today);
    const tw = trend(win);
    if (!tw || Math.abs(tw.perDay * 7) >= flatPerWeek) break;
    weeks = w;
  }
  return { status: 'plateau', weeks, perWeek };
}

/** Optional, safe next steps for a plateau or a slow trend. Never a lower calorie target or more training by default. */
export const plateauSteps = [
  'Check how complete your food logs have been: unlogged meals and oil add up.',
  'Look at your activity: steps and workouts often drift down without noticing.',
  'Keep protein up and keep strength training, so what you lose is mostly fat.',
  'Sleep and stress change water weight and appetite; a flat week or two is common.',
  'If it stays flat, consider a small, deliberate change to your plan with Configure with AI. It’s your choice.',
];

export const plateauExplanation =
  'As you get lighter, your body uses a little less energy each day, and day-to-day intake and activity vary. A flat trend means those now balance out; it isn’t your body refusing to lose fat.';

export type TrendInsight = {
  kind: 'plateau' | 'slower' | 'steady' | 'gaining' | 'insufficient';
  title: string;
  body: string;
  /** Optional steps; only for a plateau or a slowdown. */
  steps: string[] | null;
  /**
   * Identifies this finding for an alert (#57 option b): the same plateau or slowdown keeps its key, so it alerts
   * once. Null when nothing is worth an alert.
   */
  alertKey: string | null;
  /** What else changed over the same weeks (plateau or slowdown only), with a not-causation caveat. */
  changes?: string[];
};

/** One decimal, no "−0.0": weekly rates aren't precise to more. */
const r2 = (n: number) => {
  const v = Math.round(n * 10) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
};

/**
 * The Progress Trend card (#57, layout A): the plain status of the weight trend, its explanation and optional steps.
 * Weights in the plan's unit; `unit` labels them ("kg"/"lb"). Advisory only.
 */
export function trendInsight(weights: Point[], today: LocalDate, unit: string): TrendInsight {
  const flat = unit === 'lb' ? 0.2 : 0.1;
  const p = plateau(weights, today, flat);
  const f = forecast(weights, today);
  if (p.status === 'plateau') {
    const since = addDays(today, -(p.weeks * 7 - 1));
    return {
      kind: 'plateau',
      title: `Flat for ${p.weeks} weeks`,
      body: `≈ ${r2(p.perWeek)} ${unit}/week over the last ${p.weeks} weeks. ${plateauExplanation}`,
      steps: plateauSteps,
      alertKey: `plateau-${since.slice(0, 7)}`,
    };
  }
  if (f.status !== 'ok') return { kind: 'insufficient', title: 'Not enough weigh-ins yet', body: f.reason, steps: null, alertKey: null };
  const early = f.earlyExcluded ? ', after your first 2 weeks' : '';
  if (f.perWeek > flat) {
    return { kind: 'gaining', title: 'Trending up', body: `≈ ${r2(f.perWeek)} ${unit}/week over the last ${Math.round(f.basisDays / 7)} weeks${early}. Water, salt and training can move this; look again after another week or two.`, steps: null, alertKey: null };
  }
  // Slower: the last 3 weeks' rate is under half the rate of the whole basis, and still losing.
  const recent = trend(inRange(weights, addDays(today, -20), today));
  if (recent && recent.perDay * 7 > f.perWeek / 2 && f.perWeek < -flat) {
    return {
      kind: 'slower',
      title: 'Slower than before',
      body: `≈ ${r2(recent.perDay * 7)} ${unit}/week over the last 3 weeks, against ${r2(f.perWeek)} ${unit}/week over ${Math.round(f.basisDays / 7)} weeks${early}. ${plateauExplanation.split('. ')[0]}.`,
      steps: plateauSteps,
      alertKey: `slower-${today.slice(0, 7)}`,
    };
  }
  return { kind: 'steady', title: 'Steady', body: `≈ ${r2(f.perWeek)} ${unit}/week over the last ${Math.round(f.basisDays / 7)} weeks${early}. Forecasts are estimates, not promises.`, steps: null, alertKey: null };
}

/**
 * Whether a finding should alert now (#57 option b): only a new key, at most once a week, and only with a weigh-in
 * in the last 3 days (fresh data). `last` is the previous alert this phone showed.
 */
export function shouldAlert(insight: TrendInsight, weights: Point[], today: LocalDate, last: { key: string; at: LocalDate } | null): boolean {
  if (!insight.alertKey) return false;
  const latest = weights[weights.length - 1]?.date;
  if (!latest || addDays(latest, 3) < today) return false;
  if (last?.key === insight.alertKey) return false;
  if (last && addDays(last.at, 7) > today) return false;
  return true;
}

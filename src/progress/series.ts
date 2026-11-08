import { addDays, type LocalDate } from '../plan/dates';
import type { Observation, SourceType } from '../observations/types';

/**
 * Progress reporting (#52), pure. Turns stored observations into dated series and derived values.
 * Rules: one value per date; no interpolation (gaps stay gaps); every point says what it is.
 *
 * - `measured`: a value as recorded (manual entry, screenshot import or an integration).
 * - `calculated`: arithmetic on measured values (7-day average, BMI, rate of change).
 * - `estimate`: derived from a device's own estimate (body-fat %, fat and lean mass), shown with caveats.
 */
export type PointKind = 'measured' | 'calculated' | 'estimate';
/** `meals`: the sum of that day's logged meals (#97), used only on days with no day total of its own. */
export type Point = { date: LocalDate; value: number; kind: PointKind; source?: SourceType | 'meals'; app?: string | null };

/** Whole days from `a` to `b` (b − a), on local calendar dates. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const t = (d: LocalDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const userFirst = (o: Observation) => (o.source.type === 'integration' ? 1 : 0);

/**
 * One measured value per date for a metric. On a date with several values, the same precedence as Today
 * (contract 06, #36): a value the user entered or confirmed beats an integration's; then the latest recorded.
 * `sum` adds them instead (workout sessions on one day). Inferred observations are never used.
 */
export function dailySeries(observations: Observation[], metric: string, mode: 'pick' | 'sum' = 'pick'): Point[] {
  const byDate = new Map<LocalDate, Observation[]>();
  for (const o of observations) {
    if (o.metric !== metric || o.kind !== 'observed' || !Number.isFinite(o.value)) continue;
    byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, os]) => {
      if (mode === 'sum') return { date, value: os.reduce((s, o) => s + o.value, 0), kind: 'measured' as const };
      const best = [...os].sort((a, b) => userFirst(a) - userFirst(b) || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0];
      return { date, value: best.value, kind: 'measured' as const, source: best.source.type, app: best.source.app };
    });
}

/** Points from `from` to `to` inclusive (either open). */
export const inRange = (points: Point[], from: LocalDate | null, to: LocalDate | null) =>
  points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));

/**
 * Rolling average over the last `days` calendar days, only on dates that have a measurement, from the
 * measurements that exist in that window (no filled-in days). Needs at least `minPoints` in the window.
 */
export function rollingAverage(points: Point[], days = 7, minPoints = 2): Point[] {
  return points.flatMap((p) => {
    const from = addDays(p.date, -(days - 1));
    const win = points.filter((q) => q.date >= from && q.date <= p.date);
    if (win.length < minPoints) return [];
    return [{ date: p.date, value: win.reduce((s, q) => s + q.value, 0) / win.length, kind: 'calculated' as const }];
  });
}

/** BMI = kg / m², on each weigh-in date. Null without a height: never guessed, never from a range. */
export function bmiSeries(weightKg: Point[], heightCm: number | undefined | null): Point[] | null {
  if (!heightCm || heightCm <= 0) return null;
  const m = heightCm / 100;
  return weightKg.map((p) => ({ date: p.date, value: p.value / (m * m), kind: 'calculated' as const }));
}

/** Percentage change from the first point in the series (for overlaying weight and waist on one axis). */
export function percentChange(points: Point[]): Point[] {
  if (!points.length || points[0].value === 0) return [];
  const base = points[0].value;
  return points.map((p) => ({ date: p.date, value: ((p.value - base) / base) * 100, kind: 'calculated' as const }));
}

/** Least-squares slope (per day) and its standard error, over points by date. Null with too little data. */
export function trend(points: Point[]): { perDay: number; se: number; n: number; spanDays: number } | null {
  if (points.length < 3) return null;
  const x0 = points[0].date;
  const xs = points.map((p) => daysBetween(x0, p.date));
  const spanDays = xs[xs.length - 1] - xs[0];
  if (spanDays < 7) return null;
  const n = points.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = points.reduce((s, p) => s + p.value, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const perDay = xs.reduce((s, x, i) => s + (x - mx) * (points[i].value - my), 0) / sxx;
  const resid = points.reduce((s, p, i) => s + (p.value - (my + perDay * (xs[i] - mx))) ** 2, 0);
  const se = n > 2 ? Math.sqrt(resid / (n - 2) / sxx) : Infinity;
  return { perDay, se, n, spanDays };
}

/** Rate of change per week over the `days` up to `today` (e.g. kg/week). Null with too little data. */
export function weeklyRate(points: Point[], today: LocalDate, days = 28): number | null {
  const t = trend(inRange(points, addDays(today, -(days - 1)), today));
  return t ? t.perDay * 7 : null;
}

export type Slowdown =
  | { status: 'insufficient' }
  | { status: 'slower' | 'similar' | 'faster' | 'reversed'; recent: number; previous: number };

/**
 * Is progress slowing? The weekly rate over the last 4 weeks against the 4 weeks before. Wording stays factual
 * ("slower than before"); it never claims a cause such as metabolic adaptation. `threshold` in units/week.
 */
export function slowdown(points: Point[], today: LocalDate, threshold = 0.1): Slowdown {
  const recent = weeklyRate(points, today, 28);
  const previous = weeklyRate(points, addDays(today, -28), 28);
  if (recent === null || previous === null) return { status: 'insufficient' };
  if (Math.sign(recent) !== Math.sign(previous) && Math.abs(recent) > threshold && Math.abs(previous) > threshold) {
    return { status: 'reversed', recent, previous };
  }
  const d = Math.abs(recent) - Math.abs(previous);
  return { status: d < -threshold ? 'slower' : d > threshold ? 'faster' : 'similar', recent, previous };
}

export type Projection =
  | { status: 'insufficient' | 'reached' | 'not-moving-towards' }
  | { status: 'projected'; earliest: LocalDate; latest: LocalDate | null; perWeek: number };

/**
 * When a goal might be reached at the observed rate (last `days`), as a range from the trend's uncertainty
 * (± one standard error). `latest` is null when the slow end of the range never gets there.
 */
export function projectGoal(points: Point[], goal: { target: number; direction: 'decrease' | 'increase' | 'maintain' }, today: LocalDate, days = 28): Projection {
  if (goal.direction === 'maintain') return { status: 'insufficient' };
  const recent = inRange(points, addDays(today, -(days - 1)), today);
  const t = trend(recent);
  const latestValue = points.length ? points[points.length - 1].value : null;
  if (latestValue !== null && (goal.direction === 'decrease' ? latestValue <= goal.target : latestValue >= goal.target)) return { status: 'reached' };
  if (!t) return { status: 'insufficient' };
  const sign = goal.direction === 'decrease' ? -1 : 1;
  const towards = (rate: number) => rate * sign > 0;
  if (!towards(t.perDay)) return { status: 'not-moving-towards' };
  const avg = rollingAverage(recent, 7, 1);
  const from = avg.length ? avg[avg.length - 1].value : latestValue!;
  const remaining = Math.abs(goal.target - from);
  const fast = Math.abs(t.perDay) + t.se;
  const slow = Math.abs(t.perDay) - t.se;
  return {
    status: 'projected',
    earliest: addDays(today, Math.ceil(remaining / fast)),
    latest: towards(slow * sign) && slow > 0 ? addDays(today, Math.ceil(remaining / slow)) : null,
    perWeek: t.perDay * 7,
  };
}

/** Monday of the week containing `date`. */
export function weekStart(date: LocalDate): LocalDate {
  const t = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
  return addDays(date, -((t.getUTCDay() + 6) % 7));
}
const monthOf = (date: LocalDate) => date.slice(0, 7);

/** Mean value per week (Monday start) or calendar month, for buckets that have data. */
export function bucketMeans(points: Point[], by: 'week' | 'month'): { bucket: string; value: number; n: number }[] {
  const key = by === 'week' ? weekStart : monthOf;
  const m = new Map<string, number[]>();
  for (const p of points) m.set(key(p.date), [...(m.get(key(p.date)) ?? []), p.value]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, vs]) => ({ bucket, value: vs.reduce((s, v) => s + v, 0) / vs.length, n: vs.length }));
}

/** Totals per week (Monday start), e.g. workout minutes or steps. Weeks without data are absent, not zero. */
export function weeklyTotals(points: Point[]): { week: LocalDate; total: number; days: number }[] {
  const m = new Map<LocalDate, Point[]>();
  for (const p of points) m.set(weekStart(p.date), [...(m.get(weekStart(p.date)) ?? []), p]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, ps]) => ({ week, total: ps.reduce((s, p) => s + p.value, 0), days: ps.length }));
}

/**
 * Weight change vs waist change per week or month: the change in each bucket's mean from the previous bucket
 * that has data. A bucket missing either measurement gives null for that side, never an invented value.
 */
export function changeComparison(weight: Point[], waist: Point[], by: 'week' | 'month'): { bucket: string; weight: number | null; waist: number | null }[] {
  const w = bucketMeans(weight, by);
  const c = bucketMeans(waist, by);
  const buckets = [...new Set([...w, ...c].map((b) => b.bucket))].sort();
  const delta = (series: { bucket: string; value: number }[], bucket: string) => {
    const i = series.findIndex((b) => b.bucket === bucket);
    return i > 0 ? series[i].value - series[i - 1].value : null;
  };
  return buckets.slice(1).map((bucket) => ({ bucket, weight: delta(w, bucket), waist: delta(c, bucket) }));
}

/** Fat and lean mass on dates with both a weight and a body-fat %. Both are estimates (consumer scales). */
export function composition(weightKg: Point[], bodyFatPct: Point[]): { date: LocalDate; fat: number; lean: number }[] {
  const bf = new Map(bodyFatPct.map((p) => [p.date, p.value]));
  return weightKg.flatMap((p) => {
    const pct = bf.get(p.date);
    if (pct === undefined || pct <= 0 || pct >= 100) return [];
    const fat = (p.value * pct) / 100;
    return [{ date: p.date, fat, lean: p.value - fat }];
  });
}

/** Mean of the points in [from, to]; null when there are none. */
export function meanBetween(points: Point[], from: LocalDate, to: LocalDate): number | null {
  const ps = inRange(points, from, to);
  return ps.length ? ps.reduce((s, p) => s + p.value, 0) / ps.length : null;
}

/** Last value in [from, to]; null when there is none. */
export function lastBetween(points: Point[], from: LocalDate, to: LocalDate): number | null {
  const ps = inRange(points, from, to);
  return ps.length ? ps[ps.length - 1].value : null;
}

export type WeekCompare = { thisWeek: number | null; lastWeek: number | null; change: number | null };

/**
 * This week (Monday to `today`) against last week, for the summary card. `how`: mean (weight), last value
 * (waist, BMI), or total (workouts, steps). A side without data stays null, and so does the change.
 */
export function compareWeeks(points: Point[], today: LocalDate, how: 'mean' | 'last' | 'total'): WeekCompare {
  const start = weekStart(today);
  const prevStart = addDays(start, -7);
  const prevEnd = addDays(start, -1);
  const f = (from: LocalDate, to: LocalDate) =>
    how === 'mean' ? meanBetween(points, from, to) : how === 'last' ? lastBetween(points, from, to) : inRange(points, from, to).length ? inRange(points, from, to).reduce((s, p) => s + p.value, 0) : null;
  const thisWeek = f(start, today);
  const lastWeek = f(prevStart, prevEnd);
  return { thisWeek, lastWeek, change: thisWeek !== null && lastWeek !== null ? thisWeek - lastWeek : null };
}

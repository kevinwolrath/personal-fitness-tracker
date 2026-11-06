import { addDays } from '../../plan/dates';
import { manualSource, type Observation, type SourceType } from '../../observations/types';
import {
  bmiSeries,
  bucketMeans,
  changeComparison,
  compareWeeks,
  composition,
  dailySeries,
  daysBetween,
  inRange,
  percentChange,
  projectGoal,
  rollingAverage,
  slowdown,
  trend,
  weekStart,
  weeklyRate,
  weeklyTotals,
  type Point,
} from '../series';

/** #52: the pure calculations behind Progress. No interpolation, every point says what it is. */

let n = 0;
const obs = (date: string, metric: string, value: number, type: SourceType = 'manual', over: Partial<Observation> = {}): Observation => ({
  id: `o${n++}`,
  date,
  metric,
  value,
  unit: 'kg',
  kind: 'observed',
  label: null,
  note: null,
  source: { ...manualSource(), type, app: type === 'integration' ? 'withings' : null },
  recordedAt: `${date}T08:00:00Z`,
  ...over,
});
const pts = (start: string, values: (number | null)[]): Point[] =>
  values.flatMap((v, i) => (v === null ? [] : [{ date: addDays(start, i), value: v, kind: 'measured' as const }]));
const TODAY = '2026-11-06'; // a Friday

describe('daily series', () => {
  it('one value per date, sorted; a user value beats an integration on the same day; inferred never used', () => {
    const s = dailySeries(
      [
        obs('2026-11-03', 'weight', 97.4, 'integration', { recordedAt: '2026-11-03T09:00:00Z' }),
        obs('2026-11-03', 'weight', 97.1, 'manual', { recordedAt: '2026-11-03T07:00:00Z' }),
        obs('2026-11-01', 'weight', 98.0, 'integration'),
        obs('2026-11-02', 'weight', 50, 'manual', { kind: 'inferred' }),
        obs('2026-11-02', 'waist', 101, 'manual'),
      ],
      'weight',
    );
    expect(s).toEqual([
      { date: '2026-11-01', value: 98.0, kind: 'measured', source: 'integration', app: 'withings' },
      { date: '2026-11-03', value: 97.1, kind: 'measured', source: 'manual', app: null },
    ]);
  });

  it('between two values from the same kind of source, the latest recorded wins', () => {
    const s = dailySeries([obs('2026-11-03', 'weight', 97.4, 'manual', { recordedAt: '2026-11-03T07:00:00Z' }), obs('2026-11-03', 'weight', 97.2, 'manual', { recordedAt: '2026-11-03T21:00:00Z' })], 'weight');
    expect(s.map((p) => p.value)).toEqual([97.2]);
  });

  it('sum mode adds the day: two workouts on one day', () => {
    expect(dailySeries([obs('2026-11-03', 'exercise_session', 30), obs('2026-11-03', 'exercise_session', 25), obs('2026-11-04', 'exercise_session', 40)], 'exercise_session', 'sum').map((p) => p.value)).toEqual([55, 40]);
  });
});

describe('7-day average', () => {
  it('only on measured dates, from the measurements in the window; gaps are not filled', () => {
    const w = pts('2026-11-01', [100, null, null, 98, null, null, null, null, null, null, 96]);
    const avg = rollingAverage(w);
    expect(avg.map((p) => p.date)).toEqual(['2026-11-04']); // 1 Nov alone, and 11 Nov has nothing within 7 days
    expect(avg[0]).toEqual({ date: '2026-11-04', value: 99, kind: 'calculated' });
  });
});

describe('BMI', () => {
  it('kg / m² on each weigh-in; nothing at all without a height', () => {
    expect(bmiSeries(pts('2026-11-01', [81]), 180)).toEqual([{ date: '2026-11-01', value: 25, kind: 'calculated' }]);
    expect(bmiSeries(pts('2026-11-01', [81]), undefined)).toBeNull();
    expect(bmiSeries(pts('2026-11-01', [81]), 0)).toBeNull();
  });
});

describe('percentage change (weight vs waist on one axis)', () => {
  it('relative to the first point', () => {
    expect(percentChange(pts('2026-11-01', [100, 99, 98])).map((p) => Math.round(p.value * 10) / 10)).toEqual([0, -1, -2]);
    expect(percentChange([])).toEqual([]);
  });
});

describe('trend and weekly rate', () => {
  it('a steady loss of 0.1 kg a day is −0.7 kg/week, with irregular days', () => {
    const w = pts('2026-10-10', Array.from({ length: 28 }, (_, i) => (i % 3 === 1 ? null : 100 - 0.1 * i)));
    expect(weeklyRate(w, addDays('2026-10-10', 27))).toBeCloseTo(-0.7, 5);
  });

  it('too little data gives no rate: under 3 points or under a week of span', () => {
    expect(trend(pts('2026-11-01', [100, 99]))).toBeNull();
    expect(trend(pts('2026-11-01', [100, 99, 98, 97]))).toBeNull(); // 3 days of span
    expect(weeklyRate([], TODAY)).toBeNull();
  });
});

describe('slowing down?', () => {
  const series = (prevPerDay: number, recentPerDay: number) =>
    pts('2026-09-11', Array.from({ length: 56 }, (_, i) => (i < 28 ? 100 + prevPerDay * i : 100 + prevPerDay * 27 + recentPerDay * (i - 27))));
  const end = addDays('2026-09-11', 55);

  it('slower, similar or faster: the last 4 weeks against the 4 before', () => {
    expect(slowdown(series(-0.1, -0.03), end)).toMatchObject({ status: 'slower' });
    expect(slowdown(series(-0.05, -0.05), end)).toMatchObject({ status: 'similar' });
    expect(slowdown(series(-0.03, -0.1), end)).toMatchObject({ status: 'faster' });
    expect(slowdown(series(-0.1, 0.1), end)).toMatchObject({ status: 'reversed' });
  });

  it('insufficient without enough data in both windows', () => {
    expect(slowdown(pts(addDays(TODAY, -20), Array(21).fill(90)), TODAY)).toEqual({ status: 'insufficient' });
  });
});

describe('goal projection', () => {
  const goal = { target: 95, direction: 'decrease' as const };
  const noisy = pts('2026-10-10', Array.from({ length: 28 }, (_, i) => 100 - 0.1 * i + (i % 2 ? 0.2 : -0.2)));
  const end = addDays('2026-10-10', 27);

  it('a date range from the observed rate and its uncertainty', () => {
    const p = projectGoal(noisy, goal, end);
    if (p.status !== 'projected') throw new Error(p.status);
    expect(p.perWeek).toBeCloseTo(-0.7, 1);
    expect(p.earliest <= p.latest!).toBe(true);
    expect(daysBetween(end, p.earliest)).toBeGreaterThan(10);
  });

  it('reached, moving away, maintain goals and too little data', () => {
    expect(projectGoal(pts('2026-11-01', [94.5]), goal, TODAY)).toEqual({ status: 'reached' });
    const rising = pts('2026-10-10', Array.from({ length: 28 }, (_, i) => 100 + 0.05 * i));
    expect(projectGoal(rising, goal, addDays('2026-10-10', 27))).toEqual({ status: 'not-moving-towards' });
    expect(projectGoal(noisy, { target: 95, direction: 'maintain' }, end)).toEqual({ status: 'insufficient' });
    expect(projectGoal(pts('2026-11-01', [100, 99.9]), goal, TODAY)).toEqual({ status: 'insufficient' });
  });
});

describe('weeks and months', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-11-06')).toBe('2026-11-02'); // Fri → Mon
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // Sun → Mon
  });

  it('weekly totals skip weeks without data (absent, not zero)', () => {
    const w = weeklyTotals([...pts('2026-10-19', [30, null, 45]), ...pts('2026-11-02', [20])]);
    expect(w).toEqual([{ week: '2026-10-19', total: 75, days: 2 }, { week: '2026-11-02', total: 20, days: 1 }]);
  });

  it('weight vs waist change per week; a week missing one measurement stays null for it', () => {
    const weight = [...pts('2026-10-19', [100, 100]), ...pts('2026-10-26', [99, 99]), ...pts('2026-11-02', [98.5])];
    const waist = [...pts('2026-10-25', [104]), ...pts('2026-11-08', [103])]; // Sundays: weeks of 19 Oct and 2 Nov only
    expect(changeComparison(weight, waist, 'week')).toEqual([
      { bucket: '2026-10-26', weight: -1, waist: null },
      { bucket: '2026-11-02', weight: -0.5, waist: -1 },
    ]);
    expect(bucketMeans(weight, 'month').map((b) => b.bucket)).toEqual(['2026-10', '2026-11']);
  });
});

describe('body composition (estimates)', () => {
  it('fat and lean mass only on dates with both a weight and a body-fat %', () => {
    const c = composition(pts('2026-11-01', [100, 99, 98]), pts('2026-11-02', [30, null]));
    expect(c).toEqual([{ date: '2026-11-02', fat: 29.7, lean: 69.3 }]);
    expect(composition(pts('2026-11-01', [100]), pts('2026-11-01', [0]))).toEqual([]);
  });
});

describe('this week vs last', () => {
  it('mean, last or total per week; missing weeks stay null', () => {
    const w = [...pts('2026-10-26', [99, 98.8]), ...pts('2026-11-02', [98.4, 98.2])];
    expect(compareWeeks(w, TODAY, 'mean')).toEqual({ thisWeek: expect.closeTo(98.3, 5), lastWeek: expect.closeTo(98.9, 5), change: expect.closeTo(-0.6, 5) });
    expect(compareWeeks(pts('2026-11-02', [30, 20]), TODAY, 'total')).toEqual({ thisWeek: 50, lastWeek: null, change: null });
    expect(compareWeeks(pts('2026-11-01', [104]), TODAY, 'last')).toEqual({ thisWeek: null, lastWeek: 104, change: null });
  });

  it('range filter is inclusive', () => {
    expect(inRange(pts('2026-11-01', [1, 2, 3]), '2026-11-02', '2026-11-03').map((p) => p.value)).toEqual([2, 3]);
  });
});

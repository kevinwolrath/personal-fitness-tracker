import seed from '../../../plans/seed.plan.json';
import { addDays } from '../../plan/dates';
import { validatePlan } from '../../plan/validate';
import { manualSource, type Observation } from '../../observations/types';
import { chartIds, chartLayout, progressReport } from '../report';

/** #52 first PR: the Progress view model. Measurements as dots, calculations as lines, honest empty states. */

const TODAY = '2026-11-06';
const plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error('seed');
  return r.plan;
})();
let n = 0;
const obs = (date: string, metric: string, value: number, over: Partial<Observation> = {}): Observation => ({
  id: `o${n++}`, date, metric, value, unit: metric === 'waist' ? 'cm' : metric === 'body_fat' ? '%' : 'kg', kind: 'observed', label: null, note: null,
  source: manualSource(), recordedAt: `${date}T07:00:00Z`, ...over,
});
/** 60 days of weigh-ins losing ~0.05 kg/day, and weekly Sunday waist measurements. */
const history = (): Observation[] => [
  ...Array.from({ length: 60 }, (_, i) => obs(addDays(TODAY, -59 + i), 'weight', 100 - 0.05 * i + (i % 2 ? 0.2 : -0.2))),
  ...[0, 7, 14, 21, 28, 35, 42, 49, 56].map((d, i) => obs(addDays('2026-09-08', d), 'waist', 105 - 0.4 * i)),
];

describe('empty: no data at all', () => {
  const r = progressReport([], plan, TODAY, '30d');
  it('every chart explains what it needs, and nothing is invented', () => {
    for (const id of chartIds) {
      if (id === 'workouts') continue; // the schedule is plan data: "0 of N done" is true, not invented
      expect(r.charts[id].empty).toBeTruthy();
      if (id !== 'goal') expect(r.charts[id].headline).toBeNull(); // the goal itself is plan data, not a measurement
    }
    expect(r.summary.weight).toEqual({ thisWeek: null, lastWeek: null, change: null });
  });
  it('BMI asks for a height; a goal is read from the plan', () => {
    expect(r.charts.bmi.empty).toMatch(/Add your height/);
    expect(r.charts.goal.empty).toMatch(/No weigh-ins/); // the plan has a weight goal
  });
});

describe('with history', () => {
  const r = progressReport(history(), plan, TODAY, '30d');

  it('weight: weigh-ins as dots plus a calculated 7-day average line, only inside the range', () => {
    const [dots, line] = r.charts.weight.series;
    expect(dots).toMatchObject({ style: 'dots' });
    expect(line).toMatchObject({ style: 'line' });
    expect(dots.points).toHaveLength(30);
    expect(dots.points[0].date).toBe(addDays(TODAY, -29));
    expect(line.points.every((p) => p.kind === 'calculated')).toBe(true);
    expect(r.charts.weight.headline).toMatch(/^9\d\.\d kg$/);
    expect(r.charts.weight.sub).toMatch(/7-day average · −1\.\d kg in 30 days/);
  });

  it('waist: measurements only, never joined into a line', () => {
    expect(r.charts.waist.series).toEqual([expect.objectContaining({ style: 'dots' })]);
    expect(r.charts.waist.series[0].points.length).toBeGreaterThanOrEqual(4);
  });

  it('weekly rate and the slowdown comparison are factual', () => {
    expect(r.charts.rate.headline).toMatch(/^−0\.3\d kg\/week$/);
    expect(r.charts.rate.sub).not.toMatch(/metabolic|adapt/i);
  });

  it('goal projection is a range or an honest status, in the plan unit', () => {
    expect(r.charts.goal.headline).toBe('Goal: 78.0 kg');
    expect(r.charts.goal.reference).toEqual({ value: 78, label: 'Goal' });
    expect(r.charts.goal.sub).toMatch(/A projection, not a promise|isn’t heading|needs a few weeks/);
  });

  it('weight vs waist: both as % change; recomposition wording only when the waist falls with steady weight', () => {
    expect(r.charts['weight-vs-waist'].empty).toBeNull();
    expect(r.charts['weight-vs-waist'].series.map((s) => s.style)).toEqual(['line', 'dots']);
    const steady = progressReport(
      [...Array.from({ length: 30 }, (_, i) => obs(addDays(TODAY, -29 + i), 'weight', 90 + (i % 2) * 0.1)), obs(addDays(TODAY, -28), 'waist', 100), obs(TODAY, 'waist', 97)],
      plan, TODAY, '30d',
    );
    expect(steady.charts['weight-vs-waist'].note).toMatch(/consistent with body recomposition, but it isn’t proof/);
  });

  it('this week vs last: weight average change and waist', () => {
    expect(r.summary.weight.change).toBeLessThan(0);
  });
});

describe('BMI and estimates', () => {
  it('BMI only with a stated height, from real weigh-ins; never from a band', () => {
    const withHeight = { ...plan, profile: { heightCm: 180 } };
    const r = progressReport([obs(TODAY, 'weight', 81)], withHeight as typeof plan, TODAY, '30d');
    expect(r.charts.bmi).toMatchObject({ headline: '25.0', tag: 'Calculated', empty: null });
    const banded = { ...plan, formatVersion: 6, profile: { heightCm: 180, weightBand: '70_99' } };
    expect(progressReport([], banded as unknown as typeof plan, TODAY, '30d').charts.bmi.headline).toBeNull();
  });

  it('body fat is tagged as an estimate, with fat and lean mass on days with both readings', () => {
    const r = progressReport([obs(TODAY, 'weight', 100), obs(TODAY, 'body_fat', 30)], plan, TODAY, '7d');
    expect(r.charts['body-fat']).toMatchObject({ tag: 'Estimate', headline: '30.0 %' });
    expect(r.charts['body-fat'].sub).toMatch(/≈ 30\.0 kg fat · 70\.0 kg lean/);
  });

  it('lb plans show lb and convert the trend; inferred values are never used', () => {
    const lb = { ...plan, units: { ...plan.units, mass: 'lb' as const } };
    const r = progressReport([obs(TODAY, 'weight', 100), obs(TODAY, 'weight', 50, { kind: 'inferred' })], lb, TODAY, '7d');
    expect(r.charts.weight.headline).toBe('220.5 lb');
  });

  it('a value the user entered beats an imported one on the same day', () => {
    const r = progressReport([obs(TODAY, 'weight', 99, { source: { ...manualSource(), type: 'integration', app: 'withings' }, recordedAt: `${TODAY}T09:00:00Z` }), obs(TODAY, 'weight', 98.5)], plan, TODAY, '7d');
    expect(r.charts.weight.series[0].points).toEqual([expect.objectContaining({ value: 98.5, source: 'manual' })]);
  });
});

describe('chart order and visibility', () => {
  it('saved choices are kept; unknown ids dropped; new charts appended', () => {
    expect(chartLayout(null).order).toEqual([...chartIds]);
    expect(chartLayout({ order: ['bmi', 'gone', 'weight'], hidden: ['waist', 'gone'] })).toEqual({
      order: ['bmi', 'weight', 'waist', 'weight-vs-waist', 'rate', 'goal', 'body-fat', 'workouts', 'active-minutes', 'steps', 'energy', 'energy-balance', 'protein'],
      hidden: ['waist'],
    });
  });
});

describe('part 2: activity, energy and protein', () => {
  const log = (date: string, activityId: string, status: 'done' | 'skipped' = 'done') => ({ planId: plan.id, date, activityId, status, count: 0, labelSnapshot: activityId, updatedAt: `${date}T10:00:00Z` });

  it('workouts: strength and conditioning sessions of the plan, done vs scheduled; walks and school runs are not workouts', () => {
    // Mon 2 Nov: a home day with school runs, the strength session and conditioning.
    const history = { activityLogs: [log('2026-11-02', 'school-run-am'), log('2026-11-02', 'resistance'), log('2026-11-02', 'school-run-pm', 'skipped')], dayOverrides: [] };
    const r = progressReport([], plan, TODAY, '7d', { history });
    const done = r.charts.workouts.series[0].points;
    const scheduled = r.charts.workouts.series[1].points;
    expect(done.find((p) => p.date === '2026-11-02')!.value).toBe(1); // the strength session; the school run doesn't count
    expect(scheduled.find((p) => p.date === '2026-11-02')!.value).toBeGreaterThan(1);
    expect(r.charts.workouts.headline).toMatch(/^This week: 1 of \d+ done$/);
    expect(r.summary.workouts.thisWeek).toBe(1);
  });

  it('a day-type override changes what was scheduled', () => {
    const homeOnly = { ...plan, activities: plan.activities.map((a) => (a.id === 'resistance' ? { ...a, appliesTo: { dayTypes: ['home'] } } : a)) } as typeof plan;
    const office = progressReport([], homeOnly, TODAY, '7d', { history: { activityLogs: [], dayOverrides: [{ planId: plan.id, date: '2026-11-02', dayTypeId: 'office' }] } });
    const home = progressReport([], homeOnly, TODAY, '7d', { history: { activityLogs: [], dayOverrides: [] } });
    const week = (r: typeof office) => r.charts.workouts.series[1].points.find((p) => p.date === '2026-11-02')!.value;
    expect(week(office)).not.toBe(week(home));
  });

  it('ticked planned meals never count as eaten: energy and protein stay empty without intake data', () => {
    const r = progressReport([], plan, TODAY, '30d', { history: { activityLogs: [log('2026-11-05', 'lunch'), log('2026-11-05', 'dinner')], dayOverrides: [] } });
    expect(r.charts.energy.empty).toMatch(/Ticking a planned meal doesn’t count as eaten/);
    expect(r.charts.protein.empty).toMatch(/Ticking a planned meal doesn’t count as eaten/);
  });

  it('energy: estimates in the phone’s energy unit; balance only for weeks with both', () => {
    const data = [
      ...[0, 1, 2].map((d) => obs(addDays(TODAY, -d), 'energy_intake', 8368, { unit: 'kJ' })), // 2,000 kcal
      ...[0, 1].map((d) => obs(addDays(TODAY, -d), 'total_energy', 10460, { unit: 'kJ' })), // 2,500 kcal
      obs(addDays(TODAY, -20), 'energy_intake', 8000, { unit: 'kJ' }), // a week with no burned value
    ];
    const r = progressReport(data, plan, TODAY, '30d', { energy: 'kcal' });
    expect(r.charts.energy).toMatchObject({ tag: 'Estimate', unit: 'kcal', headline: '2,000 eaten · 2,500 burned' });
    expect(r.charts['energy-balance'].series[0].points).toHaveLength(1);
    expect(r.charts['energy-balance'].headline).toBe('−500 kcal/day');
    expect(r.charts['energy-balance'].note).toMatch(/weight trend is the better guide/);
  });

  it('protein against the plan’s protein target', () => {
    const r = progressReport([obs(TODAY, 'protein_intake', 150, { unit: 'g' }), obs(addDays(TODAY, -1), 'protein_intake', 170, { unit: 'g' })], plan, TODAY, '7d');
    expect(r.charts.protein).toMatchObject({ headline: '160 g a day', reference: { value: 160, label: 'Target (minimum)' } });
    expect(r.charts.protein.sub).toMatch(/target 160–180 g/);
  });

  it('steps with a 7-day average and distance; active minutes prefer a wearable’s value over workout durations on the same day', () => {
    const r = progressReport(
      [obs(TODAY, 'steps', 8000, { unit: 'count' }), obs(addDays(TODAY, -1), 'steps', 6000, { unit: 'count' }), obs(TODAY, 'distance', 5.2, { unit: 'km' }), obs(TODAY, 'active_minutes', 40, { unit: 'min' }), obs(TODAY, 'exercise_session', 30, { unit: 'min' }), obs(addDays(TODAY, -1), 'exercise_session', 25, { unit: 'min' })],
      plan, TODAY, '7d',
    );
    expect(r.charts.steps).toMatchObject({ headline: '7,000 a day' });
    expect(r.charts.steps.sub).toMatch(/5\.2 km/);
    expect(r.charts['active-minutes'].headline).toBe('This week: 65 min'); // 40 (wearable) + 25 (workout on a day without one)
  });
});

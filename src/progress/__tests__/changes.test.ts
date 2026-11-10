import seed from '../../../plans/seed.plan.json';
import type { MealLog } from '../../nutrition/contract';
import { manualSource, type Observation } from '../../observations/types';
import { addDays } from '../../plan/dates';
import { validatePlan } from '../../plan/validate';
import { observedChanges, WINDOW_DAYS } from '../changes';
import { progressReport } from '../report';

/** #57 audit follow-up: what else changed over the same weeks as a plateau or slowdown (never as the cause). */

const TODAY = '2026-11-06';
let n = 0;
const obs = (date: string, metric: string, value: number, over: Partial<Observation> = {}): Observation => ({
  id: `c${n++}`, date, metric, value, unit: metric === 'steps' ? 'count' : metric === 'exercise_session' ? 'min' : metric === 'weight' ? 'kg' : 'kJ',
  kind: 'observed', label: null, note: null, source: manualSource(), recordedAt: `${date}T07:00:00Z`, ...over,
});
/** One value a day for `days` days ending `endOffset` days before today. */
const daily = (metric: string, endOffset: number, days: number, value: number) =>
  Array.from({ length: days }, (_, i) => obs(addDays(TODAY, -endOffset - i), metric, value));
const recent = (metric: string, value: number, days = WINDOW_DAYS) => daily(metric, 1, days, value);
const before = (metric: string, value: number, days = WINDOW_DAYS) => daily(metric, WINDOW_DAYS + 1, days, value);
const meal = (date: string) => ({ id: `m${date}`, date }) as MealLog;

describe('observedChanges', () => {
  it('names a clear drop in steps, with both numbers and the percentage', () => {
    const c = observedChanges([...before('steps', 10000), ...recent('steps', 6000)], [], TODAY);
    expect(c).toEqual([{ metric: 'steps', direction: 'down', text: 'Steps: about 6,000 a day in the last 3 weeks, down from 10,000 (−40%).' }]);
  });

  it('ignores small changes (under 15%) and windows with fewer than 7 days of data', () => {
    expect(observedChanges([...before('steps', 10000), ...recent('steps', 9000)], [], TODAY)).toEqual([]);
    expect(observedChanges([...before('steps', 10000, 6), ...recent('steps', 4000)], [], TODAY)).toEqual([]);
    expect(observedChanges([...before('steps', 10000), ...recent('steps', 4000, 6)], [], TODAY)).toEqual([]);
  });

  it('never counts today (still in progress)', () => {
    // 7 recent days only if today were counted: not enough, so nothing is named.
    const o = [...before('steps', 10000), ...recent('steps', 4000, 6), obs(TODAY, 'steps', 100)];
    expect(observedChanges(o, [], TODAY)).toEqual([]);
  });

  it('active energy in the user’s unit', () => {
    const o = [...before('active_energy', 2000), ...recent('active_energy', 1000)];
    expect(observedChanges(o, [], TODAY, 'kJ')[0].text).toBe('Active energy: about 1,000 kJ a day, down from 2,000 (−50%).');
    expect(observedChanges(o, [], TODAY, 'kcal')[0].text).toBe('Active energy: about 239 kcal a day, down from 478 (−50%).');
  });

  it('workout minutes per week, counting weeks without a workout as zero', () => {
    const o = [
      ...[2, 5, 9, 12, 16, 19].map((d) => obs(addDays(TODAY, -WINDOW_DAYS - d), 'exercise_session', 60)),
      ...[3, 10].map((d) => obs(addDays(TODAY, -d), 'exercise_session', 60)),
    ];
    expect(observedChanges(o, [], TODAY)).toEqual([{ metric: 'exercise_minutes', direction: 'down', text: 'Workouts: about 40 minutes a week, down from 120 (−67%).' }]);
  });

  it('a rise is named too', () => {
    expect(observedChanges([...before('steps', 5000), ...recent('steps', 8000)], [], TODAY)[0]).toMatchObject({ direction: 'up', text: expect.stringContaining('up from 5,000 (+60%)') });
  });

  it('fewer days with food logged, from meal logs or day totals', () => {
    const logs = [...Array.from({ length: 15 }, (_, i) => meal(addDays(TODAY, -WINDOW_DAYS - 1 - i))), ...[1, 2, 3].map((d) => meal(addDays(TODAY, -d)))];
    const totals = [obs(addDays(TODAY, -4), 'energy_intake', 8000), obs(addDays(TODAY, -5), 'energy_intake', 8000)];
    expect(observedChanges(totals, logs, TODAY)).toEqual([
      { metric: 'food_logging', direction: 'down', text: 'Food logged on 5 of the last 21 days, down from 15. Unlogged meals make intake look lower than it is.' },
    ]);
    // A small drop is not named.
    expect(observedChanges([], logs.slice(0, 12).concat(logs.slice(15)).concat(Array.from({ length: 6 }, (_, i) => meal(addDays(TODAY, -6 - i)))), TODAY)).toEqual([]);
  });

  it('nothing with no data', () => {
    expect(observedChanges([], [], TODAY)).toEqual([]);
  });
});

describe('Progress trend: observed changes only for a plateau or slowdown', () => {
  const plan = (() => {
    const r = validatePlan(seed);
    if (!r.ok) throw new Error('seed');
    return r.plan;
  })();
  const steps = [...before('steps', 10000), ...recent('steps', 5000)];

  it('a plateau lists what changed', () => {
    // Losing 0.5 kg a week for 6 weeks, then flat for 4 weeks.
    const weights = Array.from({ length: 70 }, (_, i) => obs(addDays(TODAY, -70 + i), 'weight', i < 42 ? 100 - (i * 0.5) / 7 : 97));
    const r = progressReport([...weights, ...steps], plan, TODAY, '90d');
    expect(['plateau', 'slower']).toContain(r.trend.kind);
    expect(r.trend.changes).toEqual(['Steps: about 5,000 a day in the last 3 weeks, down from 10,000 (−50%).']);
  });

  it('steady progress lists nothing', () => {
    const weights = Array.from({ length: 70 }, (_, i) => obs(addDays(TODAY, -70 + i), 'weight', 100 - (i * 0.5) / 7));
    const r = progressReport([...weights, ...steps], plan, TODAY, '90d');
    expect(r.trend.kind).not.toBe('plateau');
    expect(r.trend.kind).not.toBe('slower');
    expect(r.trend.changes).toBeUndefined();
  });
});

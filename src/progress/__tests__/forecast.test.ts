import { addDays } from '../../plan/dates';
import { forecast, plateau, trendBasis } from '../forecast';
import type { Point } from '../series';

const START = '2026-08-03';
const series = (days: number, f: (d: number) => number, every = 1): Point[] =>
  Array.from({ length: Math.floor(days / every) }, (_, i) => ({ date: addDays(START, i * every), value: f(i * every), kind: 'measured' as const }));
const end = (days: number) => addDays(START, days - 1);

describe('forecast (#57)', () => {
  it('needs 3 weeks of regular weigh-ins; says so instead of guessing', () => {
    expect(forecast(series(10, (d) => 100 - d * 0.1), end(10))).toMatchObject({ status: 'insufficient' });
    expect(forecast([], '2026-11-01').status).toBe('insufficient');
  });

  it('does not project the early water-weight drop: the first two weeks are left out once later data exists', () => {
    // 2 kg in the first 2 weeks, then 0.5 kg a week.
    const w = series(40, (d) => (d < 14 ? 100 - d * (2 / 14) : 98 - (d - 14) * (0.5 / 7)));
    const f = forecast(w, end(40));
    expect(f.status).toBe('ok');
    if (f.status !== 'ok') return;
    expect(f.earlyExcluded).toBe(true);
    expect(f.perWeek).toBeCloseTo(-0.5, 1);
    expect(trendBasis(w, end(40)).points[0].date > addDays(START, 13)).toBe(true);
  });

  it('a band that widens with time around the projected line, up to 12 weeks', () => {
    const w = series(42, (d) => 95 - d * (0.5 / 7) + (d % 3 === 0 ? 0.4 : -0.2));
    const f = forecast(w, end(42));
    if (f.status !== 'ok') throw new Error('no forecast');
    expect(f.mid).toHaveLength(12);
    const width = (i: number) => f.high[i].value - f.low[i].value;
    expect(width(11)).toBeGreaterThan(width(0));
    expect(f.mid[11].value).toBeLessThan(f.from.value);
  });

  it('adapts as new data arrives: a later flat month changes the rate', () => {
    const w = series(70, (d) => (d < 42 ? 95 - d * (0.5 / 7) : 92));
    const early = forecast(w.slice(0, 42), end(42));
    const late = forecast(w, end(70));
    if (early.status !== 'ok' || late.status !== 'ok') throw new Error('no forecast');
    expect(Math.abs(late.perWeek)).toBeLessThan(Math.abs(early.perWeek));
  });

  it('no recent weigh-in: no current trend', () => {
    const w = series(42, (d) => 95 - d * 0.07);
    expect(forecast(w, addDays(end(42), 20))).toMatchObject({ status: 'insufficient', reason: expect.stringMatching(/last 2 weeks/) });
  });
});

describe('plateau (#57)', () => {
  it('needs 3 weeks and 6+ weigh-ins; a few flat days are not a plateau', () => {
    expect(plateau(series(10, () => 90), end(10))).toEqual({ status: 'insufficient' });
    expect(plateau(series(21, () => 90, 7), end(21))).toEqual({ status: 'insufficient' }); // only 3 weigh-ins
  });

  it('a flat trend over 3+ weeks is a plateau, with how long it has lasted', () => {
    const w = series(70, (d) => (d < 35 ? 95 - d * 0.1 : 91.5 + (d % 2 ? 0.3 : -0.3)));
    const p = plateau(w, end(70));
    expect(p.status).toBe('plateau');
    if (p.status === 'plateau') expect(p.weeks).toBeGreaterThanOrEqual(4);
  });

  it('a steady loss is not a plateau', () => {
    expect(plateau(series(42, (d) => 95 - d * 0.07), end(42))).toMatchObject({ status: 'none' });
  });
});

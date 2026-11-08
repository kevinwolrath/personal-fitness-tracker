import { mapExtraction, slugApp } from '../extraction';
import { formatMinutes, toCanonical } from '../units';

const ctx = { defaultDate: '2026-11-01', today: '2026-11-01' };
const o = (over: Record<string, unknown>) => ({
  metric: 'steps', label: 'Steps', value: 1, unit: 'steps', kind: 'observed', evidence: '1', date: null, confidence: 0.9, ...over,
});

describe('units', () => {
  it('converts into canonical units', () => {
    expect(toCanonical(215, 'lbs', 'mass')).toBeCloseTo(97.52, 2);
    expect(toCanonical(2000, 'kcal', 'energy')).toBe(8368);
    expect(toCanonical(7.75, 'h', 'duration')).toBe(465);
    expect(toCanonical(5, 'mi', 'distance')).toBeCloseTo(8.05, 2);
    expect(toCanonical(1, 'steps', 'mass')).toBeNull();
    expect(formatMinutes(465)).toBe('7 hr 45 min');
  });
  it('normalises source app names', () => {
    expect(slugApp(' Google Fit ')).toBe('google-fit');
    expect(slugApp('')).toBeNull();
  });
});

describe('mapExtraction', () => {
  it('maps the issue example (smart scale) and keeps observed vs inferred apart', () => {
    const r = mapExtraction('a1', {
      sourceApp: 'Renpho',
      screenDate: '2026-11-01',
      observations: [
        o({ metric: 'weight', label: 'Weight', value: 97.25, unit: 'kg', evidence: '97.25 kg', confidence: 0.98 }),
        o({ metric: 'weight_change', label: 'Total loss', value: -2.55, unit: 'kg', evidence: '2.55 kg lost' }),
        o({ metric: 'weight', label: 'Starting weight', value: 99.8, unit: 'kg', kind: 'inferred', evidence: '97.25 + 2.55' }),
      ],
    }, ctx);
    expect(r.sourceApp).toBe('renpho');
    expect(r.dropped).toEqual([]);
    expect(r.candidates.map((c) => [c.metric, c.value, c.unit, c.kind, c.include])).toEqual([
      ['weight', 97.25, 'kg', 'observed', true],
      ['weight_change', -2.55, 'kg', 'observed', true],
      ['weight', 99.8, 'kg', 'inferred', false], // never included by default
    ]);
  });

  it('maps a Fitbit day summary into canonical units', () => {
    const r = mapExtraction('a2', {
      sourceApp: 'Fitbit',
      screenDate: '2026-10-31',
      observations: [
        o({ value: 13765, evidence: '13,765' }),
        o({ metric: 'sleep_duration', label: 'Sleep', value: 465, unit: 'min', evidence: '7 hr 45 min' }),
        o({ metric: 'sleep_score', label: 'Sleep score', value: 84, unit: 'score' }),
        o({ metric: 'readiness_score', label: 'Daily Readiness', value: 48, unit: '' }),
        o({ metric: 'total_energy', label: 'Calories', value: 2345, unit: 'cal' }),
        o({ metric: 'exercise_session', label: 'Weights', value: 35, unit: 'min' }),
      ],
    }, ctx);
    expect(r.candidates.map((c) => [c.metric, c.label, c.value, c.unit, c.date])).toEqual([
      ['steps', 'Steps', 13765, 'count', '2026-10-31'],
      ['sleep_duration', 'Sleep', 465, 'min', '2026-10-31'],
      ['sleep_score', 'Sleep score', 84, 'score', '2026-10-31'],
      ['readiness_score', 'Readiness', 48, 'score', '2026-10-31'],
      ['total_energy', 'Energy burned', 9811, 'kJ', '2026-10-31'],
      ['exercise_session', 'Weights', 35, 'min', '2026-10-31'],
    ]);
  });

  it('drops values that cannot be stored faithfully, with reasons', () => {
    const r = mapExtraction('a', {
      sourceApp: null,
      screenDate: null,
      observations: [
        o({ metric: 'weight', label: 'Weight', value: 97, unit: 'steps' }),
        o({ value: -5 }),
        o({ value: Number.NaN }),
      ],
    }, ctx);
    expect(r.candidates).toEqual([]);
    expect(r.dropped).toEqual(['Weight: unit "steps" doesn\'t fit weight', 'Steps: negative value', 'Steps: not a number']);
  });

  it('uses the per-value date, falls back for missing/future/invalid dates, and de-duplicates', () => {
    const r = mapExtraction('a', {
      sourceApp: 'x',
      screenDate: '2026-11-05', // future → default date
      observations: [
        o({ value: 1, date: '2026-10-30' }),
        o({ value: 2, date: '2026-02-30' }), // not a real day
        o({ value: 3 }),
        o({ value: 3 }), // duplicate
      ],
    }, ctx);
    expect(r.candidates.map((c) => [c.value, c.date])).toEqual([[1, '2026-10-30'], [2, '2026-11-01'], [3, '2026-11-01']]);
  });

  it('keeps unknown metrics as "other" with their label, clamps confidence', () => {
    const r = mapExtraction('a', { sourceApp: null, screenDate: null, observations: [o({ metric: 'other', label: 'VO2 max', value: 41, unit: 'ml/kg/min', confidence: 3 })] }, ctx);
    expect(r.candidates[0]).toMatchObject({ metric: 'other', label: 'VO2 max', unit: 'ml/kg/min', confidence: 1 });
  });

  it('reports an unreadable extractor result instead of throwing', () => {
    expect(mapExtraction('a', { nope: true }, ctx).dropped).toEqual(['The extractor returned an unreadable result.']);
  });
});

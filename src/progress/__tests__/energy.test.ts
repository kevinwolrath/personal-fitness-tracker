/**
 * Progress energy and protein audit: Health Connect import → store → Progress, burned without double counting,
 * balance only on valid finished days, the same intake as Today, and planned meals never counted.
 */
import seed from '../../../plans/seed.plan.json';
import { mapHealthConnect } from '../../observations/healthConnect';
import { manualSource, type Observation } from '../../observations/types';
import { dayIntake } from '../../nutrition/intake';
import type { MealLog } from '../../nutrition/contract';
import { addDays } from '../../plan/dates';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { expenditureSeries, restingInputs, restingKcal } from '../expenditure';
import { intakeSeries, progressMetrics, progressReport } from '../report';

const TODAY = '2026-11-06';
const base: Plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const withProfile = (profile: Record<string, unknown>): Plan => ({ ...base, formatVersion: 6, profile: { ...(base.profile ?? {}), ...profile } } as Plan);
const adult = withProfile({ heightCm: 180, age: 45, gender: 'male' });
const obs = (date: string, metric: string, value: number, type: 'manual' | 'integration' = 'manual', unit = 'kJ'): Observation => ({
  id: `${metric}-${date}-${type}`, date, metric, value, unit, kind: 'observed', label: null, note: null,
  source: type === 'manual' ? manualSource() : { ...manualSource(), type: 'integration', app: 'samsung-health', importId: 'health-connect' },
  recordedAt: `${date}T20:00:00+11:00`,
});
const meal = (id: string, date: string, energyKj: number | null, proteinG: number | null): MealLog => ({
  id, date, at: `${date}T12:00:00+11:00`, planId: null, activityId: null, replacedLabel: null, name: id,
  items: [{ name: id, quantity: 1, unit: 'serve', energyKj, proteinG, carbsG: null, fatG: null }],
  aiTotals: null, confidence: null, assumptions: [], uncertainties: [], source: 'manual', schemaVersion: null, edited: false, photos: [],
  recordedAt: `${date}T12:05:00+11:00`, updatedAt: `${date}T12:05:00+11:00`,
});

describe('resting energy', () => {
  it('uses Mifflin–St Jeor from the user’s own height, age and sex', () => {
    expect(restingKcal(90, { heightCm: 180, age: 45, sex: 'male' })).toBeCloseTo(10 * 90 + 6.25 * 180 - 5 * 45 + 5);
    expect(restingKcal(70, { heightCm: 165, age: 30, sex: 'female' })).toBeCloseTo(700 + 1031.25 - 150 - 161);
    expect(restingKcal(80, { heightCm: 175, age: 50, sex: 'unknown' })).toBeCloseTo(800 + 1093.75 - 250 - 78);
  });
  it('never guesses missing inputs; age bands use their middle; under-18 is not estimated', () => {
    expect(restingInputs(withProfile({})).missing.sort()).toEqual(['age', 'height']);
    expect(restingInputs(withProfile({ heightCm: 170, ageBand: '40_59' })).inputs).toEqual({ heightCm: 170, age: 50, sex: 'unknown' });
    expect(restingInputs(withProfile({ heightCm: 170, ageBand: 'under_18' })).inputs).toBeNull();
  });
});

describe('energy burned: never double counted', () => {
  it('a day with a total uses the total only; active energy is never added to it', () => {
    const e = expenditureSeries([obs('2026-11-03', 'total_energy', 11000), obs('2026-11-03', 'active_energy', 2000, 'integration'), obs('2026-11-03', 'weight', 90, 'manual', 'kg')], adult);
    expect(e.points).toEqual([expect.objectContaining({ date: '2026-11-03', value: 11000, basis: 'total', kind: 'estimate' })]);
  });
  it('a day with only active energy becomes resting estimate + active, using the weigh-in for that time', () => {
    const e = expenditureSeries([obs('2026-11-01', 'weight', 90, 'manual', 'kg'), obs('2026-11-03', 'active_energy', 2000, 'integration')], adult);
    const resting = restingKcal(90, { heightCm: 180, age: 45, sex: 'male' }) * 4.184;
    expect(e.points).toEqual([expect.objectContaining({ date: '2026-11-03', basis: 'resting+active', kind: 'estimate' })]);
    expect(e.points[0].value).toBeCloseTo(resting + 2000);
  });
  it('without height or age, active energy alone is never shown as burned, and the reason is given', () => {
    const e = expenditureSeries([obs('2026-11-03', 'active_energy', 2000, 'integration'), obs('2026-11-01', 'weight', 90, 'manual', 'kg')], base);
    expect(e.points).toEqual([]);
    expect(e.missing?.sort()).toEqual(['age', 'height']);
    const r = progressReport([obs('2026-11-03', 'active_energy', 2000, 'integration')], base, TODAY, '30d', { energy: 'kJ' });
    expect(r.charts.energy.series.flatMap((s) => s.points)).toEqual([]);
    expect(r.charts.energy.empty).toMatch(/can't be estimated without your (age and height|height and age)/);
  });
});

describe('no weigh-in yet', () => {
  it('asks for a weight instead of guessing one', () => {
    const e = expenditureSeries([obs('2026-11-03', 'active_energy', 2000, 'integration')], adult);
    expect(e.points).toEqual([]);
    expect(e.missing).toEqual(['weight']);
  });
});

describe('Health Connect → store → Progress (the reported bug: steps imported, energy charts empty)', () => {
  it('imported active energy reaches Progress as estimated burned, and balance appears with logged meals', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    const dates = [addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1), TODAY];
    const mapped = mapHealthConnect(
      { steps: dates.map((date) => ({ date, value: 9000, origins: ['com.sec.android.app.shealth'] })), activeKcal: dates.map((date) => ({ date, value: 500, origins: ['com.sec.android.app.shealth'] })), weight: [{ id: 'w', time: `${dates[0]}T07:00:00+11:00`, kg: 92, origin: 'com.sec.android.app.shealth' }] },
      dates, '2026-11-06T21:00:00+11:00', (iso) => iso.slice(0, 10),
    );
    await store.replaceIntegrationObservations('health-connect', dates, mapped.metrics, mapped.observations);
    // Meals actually eaten: a typed meal and a photo-estimated protein shake.
    for (const m of [meal('dinner', dates[0], 6000, 45), meal('protein-shake', dates[0], 900, 30), meal('lunch', dates[1], 5000, 35)]) await store.saveMealLog(m);

    const observations = await store.observationsFor(progressMetrics);
    expect(observations.some((o) => o.metric === 'active_energy')).toBe(true); // loaded at all (it wasn't before)
    const r = progressReport(observations, adult, TODAY, '30d', { energy: 'kJ', mealLogs: await store.mealLogs() });

    const burned = r.charts.energy.series.find((s) => /resting \+ active/.test(s.label))!;
    expect(burned.points.map((p) => p.date)).toEqual(dates);
    expect(r.charts.energy.tag).toBe('Estimate');
    expect(r.charts.energy.note).toMatch(/estimated resting energy.*active energy from Health Connect/);
    expect(r.charts.energy.series[0].points.map((p) => [p.date, p.value])).toEqual([[dates[0], 6900], [dates[1], 5000]]);
    // Balance: only finished days with both (never today).
    expect(r.charts['energy-balance'].series[0].points.length).toBe(1);
    expect(r.charts['energy-balance'].empty).toBeNull();
    // Protein from logged meals, shake included.
    expect(r.charts.protein.series[0].points.map((p) => [p.date, p.value])).toEqual([[dates[0], 75], [dates[1], 35]]);
  });
});

describe('intake: the same numbers as Today (logged and ticked meals)', () => {
  it('Progress intake equals Today’s dayIntake on every date (day total wins over meals, never added)', () => {
    const observations = [obs('2026-11-02', 'energy_intake', 9000), obs('2026-11-02', 'energy_intake', 7000, 'integration'), obs('2026-11-03', 'protein_intake', 140)];
    const meals = [meal('a', '2026-11-02', 3000, 20), meal('b', '2026-11-03', 4000, 30), meal('c', '2026-11-04', 2500, null)];
    for (const metric of ['energy_intake', 'protein_intake'] as const) {
      const key = metric === 'energy_intake' ? 'energyKj' : 'proteinG';
      for (const p of intakeSeries(observations, meals, metric)) expect(p.value).toBe(dayIntake(p.date, meals, observations).values[key]!.value);
      for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
        const today = dayIntake(date, meals, observations).values[key];
        expect(intakeSeries(observations, meals, metric).find((p) => p.date === date)?.value ?? null).toBe(today?.value ?? null);
      }
    }
  });

  it('#154: a ticked planned meal counts as eaten at its planned estimate, on past days too', () => {
    const tick = (date: string, activityId: string, status: 'done' | 'pending' = 'done') => ({ planId: base.id, date, activityId, status, count: 0, labelSnapshot: activityId, updatedAt: 't' });
    const r = progressReport([obs('2026-11-03', 'total_energy', 10000)], adult, TODAY, '30d', {
      energy: 'kJ',
      mealLogs: [],
      history: { activityLogs: [tick('2026-11-03', 'lunch'), tick('2026-11-04', 'lunch', 'pending')], dayOverrides: [] },
    });
    expect(r.charts.energy.series[0].points.map((p) => [p.date, p.value])).toEqual([['2026-11-03', 1780]]);
    expect(r.charts.protein.series[0].points.map((p) => [p.date, p.value])).toEqual([['2026-11-03', 42]]);
    expect(r.charts['energy-balance'].series[0].points).toEqual([expect.objectContaining({ value: 1780 - 10000 })]);
    expect(r.charts.energy.note).toMatch(/Ticked plan meals count at the plan’s estimates/);
  });

  it('#154: a ticked meal with no planned energy makes the day incomplete: shown, never in the balance', () => {
    const tick = (activityId: string) => ({ planId: base.id, date: '2026-11-03', activityId, status: 'done' as const, count: 0, labelSnapshot: activityId, updatedAt: 't' });
    const r = progressReport([obs('2026-11-03', 'total_energy', 10000)], adult, TODAY, '30d', { energy: 'kJ', mealLogs: [], history: { activityLogs: [tick('lunch'), tick('snack')], dayOverrides: [] } });
    expect(r.charts.energy.series[0].points).toEqual([expect.objectContaining({ date: '2026-11-03', value: 1780, incomplete: true })]);
    expect(r.charts['energy-balance'].series[0].points).toEqual([]);
  });

  it('a day whose logged meals don’t all state their energy is an under-count: shown as eaten, never in the balance', () => {
    const meals = [meal('known', '2026-11-04', 3000, 20), meal('unknown', '2026-11-04', null, 10), meal('ok', '2026-11-05', 9000, 50)];
    const data = [obs('2026-11-04', 'total_energy', 10000), obs('2026-11-05', 'total_energy', 10000)];
    const r = progressReport(data, adult, TODAY, '30d', { energy: 'kJ', mealLogs: meals });
    expect(r.charts.energy.series[0].points.map((p) => p.date)).toEqual(['2026-11-04', '2026-11-05']);
    expect(r.charts['energy-balance'].series[0].points).toEqual([expect.objectContaining({ value: -1000 })]);
  });

  it('today is never in the balance: the day is still in progress', () => {
    const data = [obs(TODAY, 'energy_intake', 3000), obs(TODAY, 'total_energy', 9000), obs('2026-11-05', 'energy_intake', 9000), obs('2026-11-05', 'total_energy', 9500)];
    const r = progressReport(data, adult, TODAY, '30d', { energy: 'kJ' });
    expect(r.charts['energy-balance'].series[0].points).toEqual([expect.objectContaining({ value: -500 })]);
  });
});

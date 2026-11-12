/**
 * #154: ticking a planned meal on Today confirms it was eaten, at the plan's estimates. One record per meal and day
 * (its activity log), so toggles, restarts and restores can't double count; replaced meals count as their log.
 */
import seed from '../../../plans/seed.plan.json';
import { manualSource, type Observation } from '../../observations/types';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import type { ActivityLogRecord } from '../../storage/types';
import type { MealLog } from '../contract';
import { intakeLines } from '../format';
import { dayIntake } from '../intake';
import { confirmedMeals, dayLogs } from '../plannedMeals';

const plan: Plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const DAY = '2026-11-03';
const tick = (activityId: string, status: 'done' | 'pending' | 'skipped' = 'done', date = DAY, planId = plan.id): ActivityLogRecord => ({
  planId, date, activityId, status, count: 0, labelSnapshot: activityId, updatedAt: `${date}T12:00:00Z`,
});
const meal = (id: string, energyKj: number | null, proteinG: number | null, replaces: string | null = null, date = DAY): MealLog => ({
  id, date, at: `${date}T12:00:00+11:00`, planId: replaces ? plan.id : null, activityId: replaces, replacedLabel: replaces, name: id,
  items: [{ name: id, quantity: 1, unit: 'serve', energyKj, proteinG, carbsG: null, fatG: null }],
  aiTotals: null, confidence: null, assumptions: [], uncertainties: [], source: 'manual', schemaVersion: null, edited: false, photos: [],
  recordedAt: `${date}T12:05:00+11:00`, updatedAt: `${date}T12:05:00+11:00`,
});
const same = (_d: string, planId: string) => (planId === plan.id ? plan : null);
const total = (metric: string, value: number): Observation => ({
  id: `${metric}-${value}`, metric, date: DAY, value, unit: metric === 'energy_intake' ? 'kJ' : 'g', kind: 'observed', source: manualSource(), recordedAt: `${DAY}T20:00:00Z`,
} as Observation);

describe('confirmedMeals', () => {
  it('a ticked meal counts once at its planned energy and protein', () => {
    expect(confirmedMeals([tick('lunch')], [], same)).toEqual([{ date: DAY, planId: plan.id, activityId: 'lunch', label: 'Fixed lunch', energyKj: 1780, proteinG: 42 }]);
  });

  it('unticked, skipped or never-ticked meals and non-meal activities never count', () => {
    expect(confirmedMeals([tick('lunch', 'pending'), tick('snack', 'skipped')], [], same)).toEqual([]);
    const notMeal = plan.activities.find((a) => a.kind !== 'meal')!;
    expect(confirmedMeals([tick(notMeal.id)], [], same)).toEqual([]);
  });

  it('duplicate records for the same meal and day never double count', () => {
    expect(confirmedMeals([tick('lunch'), tick('lunch')], [], same)).toHaveLength(1);
  });

  it('missing planned values stay missing (null), never zero: snack has none, the flexible dinner never does', () => {
    const c = confirmedMeals([tick('snack'), tick('dinner')], [], same);
    expect(c.map((m) => [m.activityId, m.energyKj, m.proteinG])).toEqual([['snack', null, null], ['dinner', null, null]]);
  });

  it('a meal replaced by a logged meal counts only as the logged meal; an extra logged meal counts as well', () => {
    expect(confirmedMeals([tick('lunch')], [meal('different lunch', 2400, 30, 'lunch')], same)).toEqual([]);
    expect(confirmedMeals([tick('lunch')], [meal('extra snack', 600, 10)], same)).toHaveLength(1);
    // A replacement on another day doesn't hide this day's tick.
    expect(confirmedMeals([tick('lunch')], [meal('other day', 2400, 30, 'lunch', '2026-11-02')], same)).toHaveLength(1);
  });

  it('kcal plans are converted to kJ', () => {
    const kcal = { ...plan, units: { ...plan.units, energy: 'kcal' }, activities: plan.activities.map((a) => (a.id === 'lunch' ? { ...a, nutrition: { energy: 500, protein: 40 } } : a)) } as Plan;
    expect(confirmedMeals([tick('lunch')], [], () => kcal)[0].energyKj).toBeCloseTo(2092);
  });

  it('past days use the plan version in effect that day; unknown plans are skipped', () => {
    const older = { ...plan, activities: plan.activities.map((a) => (a.id === 'lunch' ? { ...a, nutrition: { energy: 1500, protein: 30 } } : a)) } as Plan;
    const planOn = (d: string) => (d < '2026-11-03' ? older : plan);
    const c = confirmedMeals([tick('lunch', 'done', '2026-11-02'), tick('lunch', 'done', '2026-11-03')], [], (d) => planOn(d));
    expect(c.map((m) => [m.date, m.energyKj])).toEqual([['2026-11-02', 1500], ['2026-11-03', 1780]]);
    expect(confirmedMeals([tick('lunch', 'done', DAY, 'another-plan')], [], same)).toEqual([]);
  });
});

describe('dayIntake with ticked meals', () => {
  it('adds ticked meals to logged meals, on their own date only (day boundaries)', () => {
    const c = confirmedMeals([tick('lunch'), tick('lunch', 'done', '2026-11-04')], [], same);
    const d = dayIntake(DAY, [meal('extra', 600, 10)], [], c);
    expect(d.values.energyKj).toEqual({ value: 2380, from: 'meals', incomplete: false });
    expect(d.values.proteinG).toEqual({ value: 52, from: 'meals', incomplete: false });
    expect(d.confirmed).toHaveLength(1);
  });

  it('a ticked meal without planned values marks the day incomplete and adds nothing', () => {
    const d = dayIntake(DAY, [], [], confirmedMeals([tick('lunch'), tick('snack')], [], same));
    expect(d.values.energyKj).toEqual({ value: 1780, from: 'meals', incomplete: true });
    const none = dayIntake(DAY, [], [], confirmedMeals([tick('snack')], [], same));
    expect(none.values.energyKj).toBeNull();
  });

  it('a day total still wins over meals, ticked ones included (never added)', () => {
    const d = dayIntake(DAY, [], [total('energy_intake', 9000)], confirmedMeals([tick('lunch')], [], same));
    expect(d.values.energyKj).toEqual({ value: 9000, from: 'day-total', incomplete: false });
    expect(d.overridden).toContain('energyKj');
  });

  it('carbohydrate and fat still come from logged meals only', () => {
    expect(dayIntake(DAY, [], [], confirmedMeals([tick('lunch')], [], same)).values.carbsG).toBeNull();
  });
});

describe('the Daily Log "Eaten" line', () => {
  it('names ticked meals as plan estimates, and no longer says they don’t count', () => {
    const l = intakeLines(dayIntake(DAY, [meal('extra', 600, 10)], [], confirmedMeals([tick('lunch')], [], same)), 'kJ')!;
    expect(l.main).toBe('Eaten ≈ 2,380 kJ · 52 g protein');
    expect(l.note).toBe('from 1 logged meal · 1 ticked meal at plan estimates');
    expect(l.note).not.toMatch(/don’t count/);
  });

  it('only ticked meals without values: says it isn’t known, never 0', () => {
    expect(intakeLines(dayIntake(DAY, [], [], confirmedMeals([tick('snack')], [], same)), 'kJ')).toEqual({ main: 'Eaten: not known yet', note: '1 ticked meal with no planned energy or protein' });
  });
});

describe('persistence', () => {
  it('ticks survive a restart and a backup restore; toggling never double counts', async () => {
    const kv = new MemoryKeyValue();
    const store = new KeyValueTrackingStore(kv);
    const log = (status: 'done' | 'pending') => ({ activityId: 'lunch', status, count: 0, labelSnapshot: 'Fixed lunch', updatedAt: `${DAY}T12:00:00Z` });
    await store.setActivity(plan.id, DAY, 'lunch', log('done'));
    await store.setActivity(plan.id, DAY, 'lunch', log('pending'));
    await store.setActivity(plan.id, DAY, 'lunch', log('done'));
    await store.setActivity(plan.id, DAY, 'lunch', log('done'));
    const reopened = new KeyValueTrackingStore(kv);
    const eaten = async (s: KeyValueTrackingStore) => dayIntake(DAY, [], [], confirmedMeals((await s.planHistory(plan.id)).activityLogs, [], same)).values.energyKj?.value ?? null;
    expect(await eaten(reopened)).toBe(1780);
    const restored = new KeyValueTrackingStore(new MemoryKeyValue());
    await restored.restore(await store.snapshot());
    expect(await eaten(restored)).toBe(1780);
    await reopened.setActivity(plan.id, DAY, 'lunch', null); // unticked
    expect(await eaten(reopened)).toBeNull();
  });

  it('dayLogs turns the Daily Log’s records into the same records', () => {
    expect(dayLogs({ lunch: { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'l', updatedAt: 't' } }, plan.id, DAY)).toEqual([tick('lunch', 'done', DAY)].map((r) => ({ ...r, labelSnapshot: 'l', updatedAt: 't' })));
  });
});

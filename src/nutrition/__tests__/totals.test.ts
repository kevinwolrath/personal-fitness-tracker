import { dayIntake, mealSumsByDate } from '../intake';
import { energyMismatch, mealTotals, totalsDiscrepancies } from '../totals';
import type { MealItem, MealLog } from '../contract';
import { manualSource, type Observation } from '../../observations/types';

const item = (name: string, energyKj: number | null, proteinG: number | null, carbsG: number | null = 0, fatG: number | null = 0): MealItem => ({ name, quantity: null, unit: null, energyKj, proteinG, carbsG, fatG });

const meal = (id: string, date: string, items: MealItem[]): MealLog => ({
  id, date, at: `${date}T12:00:00+11:00`, planId: 'p', activityId: 'lunch', replacedLabel: 'Fixed lunch', name: id, items,
  aiTotals: null, confidence: null, assumptions: [], uncertainties: [], source: 'photo-ai', schemaVersion: 1, edited: false, photos: [],
  recordedAt: 't', updatedAt: 't',
});

const obs = (metric: string, date: string, value: number, type: Observation['source']['type'] = 'manual', recordedAt = 't'): Observation => ({
  id: `${metric}-${date}-${type}`, date, metric, value, unit: metric === 'energy_intake' ? 'kJ' : 'g', kind: 'observed', label: null, note: null,
  source: { ...manualSource(), type }, recordedAt,
});

describe('mealTotals (#97): always recalculated from the foods', () => {
  it('sums known values and counts unknown ones, never filling them in', () => {
    const t = mealTotals([item('Rice', 980, 5, 52, 1), item('Chicken', 830, 30, 0, 5), item('Guacamole', null, null, null, null)]);
    expect(t).toEqual({ energyKj: 1810, proteinG: 35, carbsG: 52, fatG: 6, unknown: { energyKj: 1, proteinG: 1, carbsG: 1, fatG: 1 } });
    expect(mealTotals([item('Mystery', null, null, null, null)])).toMatchObject({ energyKj: null, proteinG: null });
    expect(mealTotals([])).toMatchObject({ energyKj: null, unknown: { energyKj: 0 } });
  });

  it('flags where the AI totals and the item sums disagree, beyond a tolerance', () => {
    const t = mealTotals([item('Rice', 980, 5, 52, 1), item('Chicken', 1970, 33, 30, 23)]);
    expect(totalsDiscrepancies({ energyKj: 3100, proteinG: 38, carbsG: 82, fatG: 24 }, t)).toEqual([]); // within 10% / tolerance
    const d = totalsDiscrepancies({ energyKj: 4000, proteinG: 39, carbsG: null, fatG: 50 }, t);
    expect(d.map((x) => x.key)).toEqual(['energyKj', 'fatG']);
    expect(d[0].message).toBe('Energy: the AI’s total is 4,000 kJ; the foods add up to 2,950 kJ.');
    expect(totalsDiscrepancies(null, t)).toEqual([]);
    expect(totalsDiscrepancies({ energyKj: null, proteinG: 10, carbsG: null, fatG: null }, mealTotals([item('X', 100, null)]))[0].message).toMatch(/no food states it/);
  });

  it('flags an item whose energy is far from what its macros imply', () => {
    expect(energyMismatch(item('Rice', 980, 5, 52, 1))).toBeNull(); // 17*57 + 37 = 1006
    expect(energyMismatch(item('Rice', 3000, 5, 52, 1))).toBe(1006);
    expect(energyMismatch(item('Rice', 980, null, 52, 1))).toBeNull();
  });
});

describe('dayIntake (#97): logged meals and day totals are never added together', () => {
  const meals = [meal('lunch', '2026-11-02', [item('Rice', 980, 5, 52, 1), item('Chicken', 830, 30, 0, 5)]), meal('dinner', '2026-11-02', [item('Pasta', 2500, 20, 80, 15)]), meal('other day', '2026-11-01', [item('Toast', 400, 4)])];

  it('sums the day’s logged meals, each once', () => {
    const d = dayIntake('2026-11-02', meals, []);
    expect(d.meals.map((m) => m.id)).toEqual(['lunch', 'dinner']);
    expect(d.values).toEqual({
      energyKj: { value: 4310, from: 'meals', incomplete: false },
      proteinG: { value: 55, from: 'meals', incomplete: false },
      carbsG: { value: 132, from: 'meals', incomplete: false },
      fatG: { value: 21, from: 'meals', incomplete: false },
    });
    expect(d.overridden).toEqual([]);
  });

  it('a day total entered or imported elsewhere is used instead of the meals (no double counting)', () => {
    const d = dayIntake('2026-11-02', meals, [obs('energy_intake', '2026-11-02', 7000, 'integration'), obs('energy_intake', '2026-11-02', 6500, 'manual')]);
    expect(d.values.energyKj).toEqual({ value: 6500, from: 'day-total', incomplete: false }); // the user's entry beats an import
    expect(d.values.proteinG).toEqual({ value: 55, from: 'meals', incomplete: false });
    expect(d.values.carbsG?.from).toBe('meals');
    expect(d.overridden).toEqual(['energyKj']);
  });

  it('marks a meal sum with unknown items as incomplete, and has no value when nothing is known', () => {
    const d = dayIntake('2026-11-03', [meal('x', '2026-11-03', [item('Rice', 900, null), item('Sauce', null, null)])], []);
    expect(d.values.energyKj).toEqual({ value: 900, from: 'meals', incomplete: true });
    expect(d.values.proteinG).toBeNull();
    expect(dayIntake('2026-11-09', meals, []).values.energyKj).toBeNull();
  });

  it('sums meals by date for Progress', () => {
    expect([...mealSumsByDate(meals, 'energyKj')]).toEqual([['2026-11-02', 4310], ['2026-11-01', 400]]);
  });
});

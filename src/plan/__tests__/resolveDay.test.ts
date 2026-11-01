import generic from '../../../fixtures/plans/generic-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { addDays, toLocalDate, weekdayOf } from '../dates';
import { dayProgress, resolveDay } from '../resolveDay';
import { validatePlan } from '../validate';

const load = (json: unknown) => {
  const r = validatePlan(json);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const seedPlan = load(seed);
const genericPlan = load(generic);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('dates', () => {
  it('maps local dates to contract weekdays', () => {
    expect(weekdayOf('2026-11-02')).toBe('mon');
    expect(weekdayOf('2026-11-05')).toBe('thu');
    expect(weekdayOf('2026-11-07')).toBe('sat');
    expect(weekdayOf('2026-11-08')).toBe('sun');
  });
  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('uses the local calendar date, not UTC', () => {
    expect(toLocalDate(new Date(2026, 10, 2, 23, 59))).toBe('2026-11-02');
    expect(toLocalDate(new Date(2026, 10, 3, 0, 1))).toBe('2026-11-03');
  });
});

describe('seed plan resolves from JSON', () => {
  it('Monday: home day, school runs, resistance, timed then anytime', () => {
    const day = resolveDay(seedPlan, '2026-11-02');
    expect(day.dayTypeId).toBe('home');
    expect(day.dayTypeLabel).toBe('Home day');
    expect(ids(day.timed)).toEqual(['school-run-am', 'lunch', 'dog-walk', 'school-run-pm', 'dinner']);
    expect(ids(day.anytime)).toEqual(['snack', 'resistance', 'vr-boxing']);
    expect(ids(day.measurementsDue)).toEqual(['weight']);
  });

  it('Thursday: office day, lunch walk, no school runs or resistance', () => {
    const day = resolveDay(seedPlan, '2026-11-05');
    expect(day.dayTypeId).toBe('office');
    expect(ids(day.timed)).toEqual(['lunch', 'lunch-walk', 'dinner']);
    expect(ids(day.anytime)).toEqual(['snack', 'vr-boxing']);
  });

  it('Saturday: weekend, long resistance, optional movement', () => {
    const day = resolveDay(seedPlan, '2026-11-07');
    expect(day.dayTypeId).toBe('weekend');
    expect(ids(day.timed)).toEqual(['lunch', 'dinner']);
    expect(ids(day.anytime)).toEqual(['snack', 'resistance-long', 'weekend-movement', 'vr-boxing']);
  });

  it('Sunday: weekly waist measurement is due', () => {
    expect(ids(resolveDay(seedPlan, '2026-11-08').measurementsDue)).toEqual(['weight', 'waist']);
  });

  it('a day-type override re-resolves dayTypes-scoped activities', () => {
    const day = resolveDay(seedPlan, '2026-11-05', 'home');
    expect(day.overridden).toBe(true);
    expect(ids(day.timed)).toContain('school-run-am');
    expect(ids(day.timed)).not.toContain('lunch-walk');
  });

  it('ignores an override for an unknown day type', () => {
    const day = resolveDay(seedPlan, '2026-11-05', 'gone');
    expect(day.dayTypeId).toBe('office');
    expect(day.overridden).toBe(false);
  });

  it('shows no flexible budget while fixed meals lack nutrition values', () => {
    expect(resolveDay(seedPlan, '2026-11-02').flexibleBudget).toBeNull();
  });
});

describe('flexible-meal budget', () => {
  it('is target minus planned fixed meals (max for energy, min for protein)', () => {
    const day = resolveDay(genericPlan, '2026-11-02');
    expect(day.flexibleBudget).toEqual({
      activityId: 'dinner',
      lines: [
        { targetId: 'energy', label: 'Energy', quantity: 'energy', remaining: 8000 - (1900 + 2300 + 900) },
        { targetId: 'protein', label: 'Protein', quantity: 'grams', remaining: 120 - (35 + 45 + 30) },
      ],
    });
  });
});

describe('dayProgress', () => {
  const day = resolveDay(seedPlan, '2026-11-02');
  it('counts required activities only', () => {
    // 8 resolved, dog walk optional
    expect(dayProgress(day, {})).toEqual({ done: 0, total: 7, complete: false });
  });
  it('excludes skipped activities and completes when the rest are done', () => {
    const states = Object.fromEntries(
      [...day.timed, ...day.anytime].filter((a) => a.required).map((a) => [a.id, { status: 'done' as const }]),
    );
    states['resistance'] = { status: 'skipped' } as any;
    expect(dayProgress(day, states)).toEqual({ done: 6, total: 6, complete: true });
  });
});

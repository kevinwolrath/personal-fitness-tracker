import seed from '../../../plans/seed.plan.json';
import { manualSource, type Observation } from '../../observations/types';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { prescribeDay } from '../../prescription/prescribe';
import type { ActivityLog, DayRecords } from '../../storage/types';
import type { MealItem, MealLog } from '../contract';
import { restOfDay, type RestOfDayInput } from '../restOfDay';

/** #99: rest-of-day suggestions after a logged meal. The seed's snack gets a shake's numbers for these tests. */

const load = (raw: unknown): Plan => {
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const plan = load({ ...seed, activities: seed.activities.map((a) => (a.id === 'snack' ? { ...a, nutrition: { energy: 900, protein: 30 } } : a)) });
const MON = '2026-11-02';
const FRI = '2026-11-06';
const done = (id: string): ActivityLog => ({ activityId: id, status: 'done', count: 0, labelSnapshot: id, updatedAt: 't' });
const item = (energyKj: number | null, proteinG: number | null): MealItem => ({ name: 'Food', quantity: null, unit: null, energyKj, proteinG, carbsG: null, fatG: null });
const meal = (items: MealItem[], date = MON): MealLog => ({
  id: 'm', date, at: `${date}T12:30:00+11:00`, planId: plan.id, activityId: 'lunch', replacedLabel: 'Fixed lunch', name: 'Burrito', items,
  aiTotals: null, confidence: 'medium', assumptions: [], uncertainties: [], source: 'photo-ai', schemaVersion: 1, edited: false, photos: [], recordedAt: 't', updatedAt: 't',
});

function run(over: Partial<RestOfDayInput> & { logs?: ActivityLog[]; meals?: MealLog[]; date?: string; at?: string; p?: Plan } = {}) {
  const p = over.p ?? plan;
  const date = over.date ?? MON;
  const records: DayRecords = { activities: Object.fromEntries((over.logs ?? [done('lunch')]).map((l) => [l.activityId, l])), dayTypeOverride: null, observations: over.observations ?? [], quickLogs: [] };
  const [h, m] = (over.at ?? '13:00').split(':').map(Number);
  return restOfDay({
    plan: p, date, today: over.today ?? date, nowMinutes: h * 60 + m, items: prescribeDay(p, date, records).items,
    mealLogs: over.meals ?? [meal([item(5200, 60)])], observations: over.observations ?? [], energy: 'kJ', weightKg: over.weightKg === undefined ? 95 : over.weightKg,
    restDay: over.restDay ?? false, injured: over.injured ?? false,
  });
}

it('hidden without a logged meal, and on other days', () => {
  expect(run({ meals: [] }).show).toBe(false);
  expect(run({ today: '2026-11-03' }).show).toBe(false);
});

it('normal lunch: keep the plan, with what’s left for dinner', () => {
  const r = run({ meals: [meal([item(1800, 42)])] });
  expect(r.status).toBe('within');
  expect(r.suggestions[0]).toMatchObject({ kind: 'keep', title: 'Keep the plan' });
  expect(r.suggestions.find((s) => s.kind === 'dinner')?.title).toMatch(/Family dinner: about 4,830 kJ left/);
  expect(r.suggestions.some((s) => s.kind === 'activity')).toBe(false);
});

it('large lunch: optional smaller snack only if protein still reaches its minimum; dinner smaller, never skipped', () => {
  // 7,000 kJ lunch + 900 kJ shake + room for dinner > 7,530; protein 120 + 30 = 150 < 160, so the shake stays.
  const r = run({ meals: [meal([item(7000, 120)])] });
  expect(r.status).toBe('over');
  expect(r.suggestions.find((s) => s.kind === 'snack')?.title).toBe('Keep Fixed snack');
  expect(r.suggestions.find((s) => s.kind === 'dinner')?.title).toMatch(/smaller, protein-rich family dinner/);
  expect(r.suggestions.map((s) => s.title).join(' ')).not.toMatch(/skip.*dinner/i);
  // With plenty of protein already, halving the shake is offered.
  const rich = run({ meals: [meal([item(7000, 170)])] });
  expect(rich.suggestions.find((s) => s.kind === 'snack')?.title).toBe('Optional: halve or skip Fixed snack');
  expect(rich.suggestions.find((s) => s.kind === 'snack')?.detail).toMatch(/protein would still reach about 170 g/);
});

it('protein shortfall: protein first', () => {
  const r = run({ meals: [meal([item(2000, 10)])] });
  expect(r.suggestions.find((s) => s.kind === 'protein')?.detail).toMatch(/About 120 g short/);
});

it('under target: keep the plan, no restriction or extra exercise', () => {
  const r = run({ meals: [meal([item(500, 20)])], logs: [done('lunch'), done('dinner')] });
  expect(r.status).toBe('under');
  expect(run({ meals: [meal([item(500, 20)])] }).status).toBe('within'); // dinner still to come: never "under" yet
  expect(r.suggestions.map((s) => s.kind)).not.toContain('activity');
  expect(r.suggestions.map((s) => s.kind)).not.toContain('snack');
});

it('activity: an optional walk range for the user’s weight, never on a rest day, with an injury, or late; a planned workout comes first', () => {
  const big = [meal([item(9000, 170)])];
  // Monday has a strength session still planned: point to it instead of extra exercise.
  expect(run({ meals: big }).suggestions.find((s) => s.kind === 'activity')?.title).toMatch(/strength workout is still planned/);
  const noWorkout = run({ meals: big, logs: [done('lunch'), done('resistance'), done('vr-boxing')] }).suggestions.find((s) => s.kind === 'activity');
  expect(noWorkout?.title).toBe('Optional: a 30-minute brisk walk');
  expect(noWorkout?.detail).toMatch(/Roughly 700 kJ–850 kJ for your weight, an estimate\. It doesn’t “earn” food back\./);
  expect(run({ meals: big, restDay: true }).suggestions.some((s) => s.kind === 'activity')).toBe(false);
  expect(run({ meals: big, injured: true }).suggestions.some((s) => s.kind === 'activity')).toBe(false);
  expect(run({ meals: big, logs: [done('lunch'), done('resistance'), done('vr-boxing')], weightKg: null }).suggestions.some((s) => s.kind === 'activity')).toBe(false);
});

it('late meal: nothing to change today', () => {
  const r = run({ at: '20:30', meals: [meal([item(9000, 100)])] });
  expect(r.suggestions).toEqual([expect.objectContaining({ kind: 'late', title: 'Nothing to change today' })]);
});

it('missing data: limited guidance, no invented numbers', () => {
  const r = run({ meals: [meal([item(null, null)])] });
  expect(r.status).toBe('unknown');
  expect(r.suggestions).toEqual([expect.objectContaining({ kind: 'keep' })]);
  const noTarget = run({ p: { ...plan, nutrition: { ...plan.nutrition, targets: plan.nutrition.targets.filter((t) => t.quantity !== 'energy') } } });
  expect(noTarget.explanation[0]).toMatch(/no energy limit/);
});

it('an imported day total is used instead of the meals, never added', () => {
  const total: Observation = { id: 'o', date: MON, metric: 'energy_intake', value: 3000, unit: 'kJ', kind: 'observed', label: null, note: null, source: manualSource(), recordedAt: 't' };
  const r = run({ meals: [meal([item(7000, 120)])], observations: [total] });
  expect(r.status).toBe('within'); // 3,000 + 900 planned, not 7,000 + 3,000
});

it('rest day Friday: food suggestions still apply, never activity', () => {
  const r = run({ date: FRI, meals: [meal([item(9000, 170)], FRI)], restDay: true, logs: [done('lunch')] });
  expect(r.show).toBe(true);
  expect(r.suggestions.some((s) => s.kind === 'activity')).toBe(false);
});

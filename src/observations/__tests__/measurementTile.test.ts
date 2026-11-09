import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import { measurementTile } from '../measurementTile';
import { manualSource, type Observation } from '../types';

const plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const waist = plan.measurements.find((m) => m.id === 'waist')!;
const obs = (date: string, value: number): Observation => ({ id: date, date, metric: 'waist', value, unit: 'cm', kind: 'observed', label: null, note: null, source: manualSource(), recordedAt: `${date}T08:00:00Z` });

it('no waist yet: an Add action, every day; Sunday only adds a due hint (#108)', () => {
  expect(measurementTile(plan, waist, null, '2026-11-03', false)).toMatchObject({ value: null, action: 'Add', detail: null });
  expect(measurementTile(plan, waist, null, '2026-11-08', true)).toMatchObject({ value: null, action: 'Add', detail: 'Due today' });
});

it('the latest waist shows on later days with the date it was measured, never as today’s', () => {
  const t = measurementTile(plan, waist, obs('2026-11-01', 107), '2026-11-04', false);
  expect(t).toMatchObject({ value: '107 cm', today: false, action: 'Log' });
  expect(t.detail).toMatch(/^Measured (1 Nov|Nov 1)$/);
  expect(measurementTile(plan, waist, obs('2025-12-20', 110), '2026-11-04', false).detail).toMatch(/2025/);
});

it('measured today reads as today, editable', () => {
  expect(measurementTile(plan, waist, obs('2026-11-04', 106), '2026-11-04', false)).toMatchObject({ value: '106 cm', today: true, action: 'Edit' });
});

it('a value after the viewed date is never shown on an earlier day', () => {
  expect(measurementTile(plan, waist, obs('2026-11-09', 105), '2026-11-04', false).value).toBeNull();
});

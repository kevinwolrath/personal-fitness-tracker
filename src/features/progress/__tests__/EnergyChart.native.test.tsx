/** Progress energy chart renders measured totals and estimates as separate, labelled series (iOS and Android). */
import { render, screen } from '@testing-library/react-native';
import seed from '../../../../plans/seed.plan.json';
import { manualSource, type Observation } from '../../../observations/types';
import type { Plan } from '../../../plan/schema';
import { validatePlan } from '../../../plan/validate';
import { progressReport } from '../../../progress/report';
import { LineChart } from '../LineChart';

const plan: Plan = (() => {
  const r = validatePlan({ ...seed, profile: { ...((seed as { profile?: object }).profile ?? {}), heightCm: 180, age: 45, gender: 'male' } });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const o = (date: string, metric: string, value: number, unit = 'kJ'): Observation => ({ id: `${metric}-${date}`, date, metric, value, unit, kind: 'observed', label: null, note: null, source: manualSource(), recordedAt: `${date}T20:00:00+11:00` });

it('shows eaten, total burned and estimated burned with their own legend labels', () => {
  const r = progressReport(
    [o('2026-11-02', 'energy_intake', 8000), o('2026-11-02', 'total_energy', 10000), o('2026-11-03', 'energy_intake', 7000), o('2026-11-03', 'active_energy', 1500), o('2026-11-01', 'weight', 90, 'kg')],
    plan, '2026-11-06', '30d', { energy: 'kJ' },
  );
  const c = r.charts.energy;
  render(<LineChart series={c.series} unit={c.unit} testID="energy-chart" />);
  expect(screen.getByText('Eaten (ticked, logged or imported)')).toBeTruthy();
  expect(screen.getByText('Burned (total from a wearable or entry)')).toBeTruthy();
  expect(screen.getByText('Burned (estimate: resting + active)')).toBeTruthy();
  expect(c.tag).toBe('Estimate');
});

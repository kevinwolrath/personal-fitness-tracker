import seed from '../../../plans/seed.plan.json';
import { planSchema, type Plan } from '../../plan/schema';
import { planSummary } from '../planSummary';

const plan = planSchema.parse(seed) as Plan;

describe('#174: Plan & goals summary', () => {
  it('lists the plan title, each daily target in the chosen energy display, and each goal with its unit', () => {
    const s = planSummary(plan, 'kJ');
    expect(s.title).toBe(plan.title);
    expect(s.targets).toHaveLength(plan.nutrition.targets.length);
    for (const t of plan.nutrition.targets) expect(s.targets.some((line) => line.startsWith(`${t.label}: `))).toBe(true);
    expect(s.goals).toHaveLength(plan.goals.length);
  });

  it('energy follows the display choice; grams stay grams', () => {
    const p: Plan = { ...plan, units: { ...plan.units, energy: 'kJ' }, nutrition: { targets: [
      { id: 'energy', label: 'Energy', quantity: 'energy', max: 7530 },
      { id: 'protein', label: 'Protein', quantity: 'grams', min: 120 },
      { id: 'fibre', label: 'Fibre', quantity: 'grams', min: 25, max: 35 },
    ] } };
    expect(planSummary(p, 'kcal').targets).toEqual(['Energy: ≤ 1,800 kcal', 'Protein: ≥ 120 g', 'Fibre: 25–35 g']);
    expect(planSummary(p, 'kJ').targets[0]).toBe('Energy: ≤ 7,530 kJ');
  });

  it('goals read as a direction and target in the measurement’s unit', () => {
    const p: Plan = { ...plan, units: { mass: 'kg', energy: 'kJ', length: 'cm' },
      measurements: [{ id: 'weight', label: 'Weight', quantity: 'mass', decimals: 1, cadence: { every: 'day' } }, { id: 'waist', label: 'Waist', quantity: 'length', decimals: 1, cadence: { every: 'day' } }],
      goals: [{ id: 'g1', label: 'Weight', measurementId: 'weight', target: 85, direction: 'decrease' }, { id: 'g2', label: 'Waist', measurementId: 'waist', target: 90, direction: 'maintain' }, { id: 'g3', label: 'Other', measurementId: 'gone', target: 3, direction: 'increase' }] };
    expect(planSummary(p, 'kJ').goals).toEqual(['Weight: down to 85 kg', 'Waist: hold at 90 cm', 'Other: up to 3']);
  });

  it('a tracking-only plan has no targets or goals', () => {
    const s = planSummary({ ...plan, goals: [], nutrition: { targets: [] } }, 'both');
    expect(s).toEqual({ title: plan.title, targets: [], goals: [] });
  });
});

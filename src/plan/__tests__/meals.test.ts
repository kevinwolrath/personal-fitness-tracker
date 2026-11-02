import generic from '../../../fixtures/plans/generic-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { mealView } from '../meals';
import { planSchema } from '../schema';

const plan = planSchema.parse(seed);
const byId = (id: string) => plan.activities.find((a) => a.id === id)!;

describe('mealView (#26)', () => {
  it('renders the seed lunch from the plan: amounts, the plan’s own measures, preparation and nutrition', () => {
    expect(mealView(plan, byId('lunch'))).toEqual({
      ingredients: [
        { name: 'High-protein yoghurt', amount: '200 g', measure: '~¾ cup' },
        { name: 'Rolled oats', amount: '40 g', measure: '~½ cup' },
        { name: 'Protein powder', amount: '30 g', measure: '~¼ cup / 1 scoop' },
        { name: 'Water', amount: null, measure: 'as needed' },
      ],
      preparation: 'Mix yoghurt and protein powder first, then add oats. Add water as needed to reach the desired consistency.',
      nutrition: '≈ 1,780 kJ · 42 g protein',
    });
  });

  it('a different plan renders a completely different meal with no code change', () => {
    const p = planSchema.parse({
      ...seed,
      units: { ...seed.units, energy: 'kcal' },
      activities: seed.activities.map((a: any) =>
        a.id === 'lunch'
          ? { ...a, nutrition: { energy: 520 }, ingredients: [{ name: 'Rice', grams: 150, measure: '1 cup cooked' }, { name: 'Milk', ml: 250 }], preparation: undefined }
          : a,
      ),
    });
    expect(mealView(p, p.activities.find((a) => a.id === 'lunch')!)).toEqual({
      ingredients: [
        { name: 'Rice', amount: '150 g', measure: '1 cup cooked' },
        { name: 'Milk', amount: '250 ml', measure: null },
      ],
      preparation: null,
      nutrition: '≈ 520 kcal',
    });
  });

  it('nothing to show for non-meals, or meals without ingredients, preparation or nutrition', () => {
    expect(mealView(plan, byId('resistance'))).toBeNull();
    expect(mealView(plan, byId('dinner'))).toBeNull(); // flexible: the row shows the budget instead
    const g = planSchema.parse(generic);
    expect(g.activities.filter((a) => a.kind === 'meal').map((a) => mealView(g, a)?.ingredients.length ?? 0).every((n) => n === 0)).toBe(true);
  });
});

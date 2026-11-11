import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import { eligibleExercises, exerciseInventory, validateInventory } from '../inventory';

/** #56: the approved muscle groups and inventory, as data; equipment and limitations from the user's own configuration. */

const plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const ids = (xs: { exercise: { movement: string } }[]) => xs.map((x) => x.exercise.movement);

describe('the bundled inventory (approved on #56)', () => {
  it('has exactly the approved 14 muscle groups, in order', () => {
    expect(exerciseInventory.muscleGroups.map((m) => m.label)).toEqual([
      'Chest', 'Upper back', 'Lats', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Core/abdominals', 'Lower back', 'Glutes', 'Quadriceps', 'Hamstrings', 'Calves', 'Hip flexors',
    ]);
  });

  it('maps each approved exercise to its primary and secondary muscles', () => {
    const label = new Map(exerciseInventory.muscleGroups.map((m) => [m.id, m.label]));
    const table = Object.fromEntries(
      exerciseInventory.exercises.map((e) => [e.name, `${e.primary.map((m) => label.get(m)).join(', ')} | ${e.secondary.map((m) => label.get(m)).join(', ') || 'None'}`]),
    );
    expect(table).toEqual({
      'Push-ups (knuckles)': 'Chest | Triceps, Shoulders, Core/abdominals',
      'Chest press machine': 'Chest | Triceps, Shoulders',
      'Lat pulldown': 'Lats | Biceps, Upper back',
      'One-arm kettlebell row': 'Upper back, Lats | Biceps, Core/abdominals',
      'Goblet squat': 'Quadriceps, Glutes | Core/abdominals, Hamstrings',
      'Leg extension': 'Quadriceps | None',
      'Kettlebell Romanian deadlift': 'Hamstrings, Glutes | Lower back, Core/abdominals',
      'Hammer curls': 'Biceps | Forearms',
      'Supinated cross-body dumbbell curl': 'Biceps | Forearms',
      'Overhead press': 'Shoulders | Triceps, Core/abdominals',
      'Plank': 'Core/abdominals | Shoulders',
      'Straight-leg lying raises': 'Hip flexors | Core/abdominals', // hip flexors: the 14th group (#56 decision 2)
      'Standing calf raises': 'Calves | None',
      'Heavy bag boxing': 'Shoulders | Chest, Triceps, Core/abdominals',
      'VR boxing': 'Shoulders | Chest, Triceps, Core/abdominals',
      'Battle ropes': 'Shoulders | Upper back, Core/abdominals, Forearms',
    });
  });

  it('knuckle push-ups need no equipment (no push-up handles assumed); boxing and ropes are conditioning', () => {
    const by = new Map(exerciseInventory.exercises.map((e) => [e.movement, e]));
    expect(by.get('knuckle_push_up')).toMatchObject({ equipment: [], kind: 'strength' });
    for (const m of ['heavy_bag', 'vr_boxing', 'battle_ropes']) expect(by.get(m)!.kind).toBe('conditioning');
  });

  it('reuses the movement ids plans and the exercise library already use', () => {
    const movements = exerciseInventory.exercises.map((e) => e.movement);
    expect(movements).toEqual(expect.arrayContaining(['chest_press', 'lat_pulldown', 'kettlebell_squat', 'hammer_curl']));
  });
});

describe('validation', () => {
  const base = { inventoryVersion: 1, muscleGroups: [{ id: 'chest', label: 'Chest' }], exercises: [] as unknown[] };
  const ex = (over: object) => ({ movement: 'press', name: 'Press', kind: 'strength', equipment: [], primary: ['chest'], secondary: [], ...over });

  it('rejects an unknown muscle, a duplicate exercise, and a muscle that is both primary and secondary', () => {
    const r = validateInventory({ ...base, exercises: [ex({ secondary: ['triceps'] }), ex({}), ex({ movement: 'fly', secondary: ['chest'] })] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/unknown muscle group "triceps"/);
    expect(r.errors.join('\n')).toMatch(/"press" is defined twice/);
    expect(r.errors.join('\n')).toMatch(/"chest" is both primary and secondary/);
  });

  it('requires at least one primary muscle', () => {
    expect(validateInventory({ ...base, exercises: [ex({ primary: [] })] }).ok).toBe(false);
  });
});

describe('eligibility: the user’s own equipment and limitations', () => {
  it('the seed plan (Fortis, kettlebells, small free weights, bag, ropes, VR) gets the whole inventory', () => {
    expect(ids(eligibleExercises(plan.exercise))).toEqual(exerciseInventory.exercises.map((e) => e.movement));
  });

  it('with no equipment configured, only the no-equipment exercises: nobody is assumed to own a gym', () => {
    expect(ids(eligibleExercises(undefined))).toEqual(['knuckle_push_up', 'plank', 'straight_leg_raise', 'standing_calf_raise']);
    expect(ids(eligibleExercises({ equipment: [{ type: 'dumbbells' }] }))).toEqual(
      expect.arrayContaining(['hammer_curl', 'overhead_press']),
    );
    expect(ids(eligibleExercises({ equipment: [{ type: 'dumbbells' }] }))).not.toContain('chest_press');
  });

  it('an "avoid" limitation removes the movement; "caution" keeps it, flagged', () => {
    const config = { equipment: [{ type: 'free_weights' as const }], limitations: [{ movement: 'hammer_curl', status: 'avoid' as const }, { movement: 'overhead_press', status: 'caution' as const }] };
    const e = eligibleExercises(config);
    expect(ids(e)).not.toContain('hammer_curl');
    expect(e.find((x) => x.exercise.movement === 'overhead_press')!.caution).toBe(true);
  });

  it('no standard biceps curl is ever offered; the seed plan’s elbow limitation keeps hammer curls allowed', () => {
    expect(exerciseInventory.exercises.map((e) => e.movement)).not.toContain('biceps_curl');
    expect(plan.exercise!.limitations).toEqual(expect.arrayContaining([expect.objectContaining({ movement: 'biceps_curl', status: 'avoid' })]));
    expect(eligibleExercises(plan.exercise).find((x) => x.exercise.movement === 'hammer_curl')!.caution).toBe(false);
  });
});

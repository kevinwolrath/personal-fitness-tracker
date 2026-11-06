import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import data from '../../../presets/exercise-routines.json';
import { newDraft } from '../../onboarding/draft';
import { buildStarterPlan } from '../../onboarding/starterPlan';
import { resolveDay } from '../../plan/resolveDay';
import { validatePlan } from '../../plan/validate';
import { prescribeSession } from '../../prescription/session';
import {
  equipmentOptions,
  exerciseStarter,
  limitationOptions,
  routineOptions,
  type Activity,
  type Equipment,
  type ExerciseInputs,
  type Limitation,
  type StarterGoal,
} from '../exercisePlan';

/** #53: offline starter exercise plans from bundled presets. Every combination must be a valid, sensible plan. */

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const contractValidate = ajv.compile(contract);
const subsets = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

const goalCombos: StarterGoal[][] = [
  ['maintain'], ['gradual_loss'], ['faster_loss'], ['gain_muscle'], ['improve_cardio'],
  ['gradual_loss', 'gain_muscle'], ['faster_loss', 'gain_muscle'], ['gradual_loss', 'improve_cardio'],
  ['faster_loss', 'improve_cardio'], ['gain_muscle', 'improve_cardio'], ['maintain', 'gain_muscle'],
  ['maintain', 'improve_cardio'], ['gradual_loss', 'gain_muscle', 'improve_cardio'], [],
];
const levels: Activity[] = ['mostly_sitting', 'some_walking', 'active_job', 'already_training'];

function plan(inputs: ExerciseInputs) {
  const s = exerciseStarter(inputs);
  return { s, raw: { ...buildStarterPlan(newDraft()), activities: s.activities, exercise: s.exercise } };
}

describe('every combination is a valid plan within the days available', () => {
  const cases: [string, ExerciseInputs][] = [];
  for (const goals of goalCombos)
    for (const activityLevel of levels)
      for (const equipment of subsets(equipmentOptions.filter((e) => e !== 'none')) as Equipment[][])
        for (const daysPerWeek of [undefined, 1, 2, 3, 5])
          cases.push([`${goals.join('+') || 'no goal'} · ${activityLevel} · ${equipment.join('+') || 'none'} · ${daysPerWeek ?? 'any'} days`, { goals, activityLevel, equipment, limitations: [], daysPerWeek }]);

  it(`${cases.length} combinations validate against the runtime schema and the JSON Schema`, () => {
    for (const [name, inputs] of cases) {
      const { s, raw } = plan(inputs);
      const r = validatePlan(raw);
      if (!r.ok) throw new Error(`${name}: ${r.errors.join('; ')}`);
      if (!contractValidate(raw)) throw new Error(`${name}: ${JSON.stringify(contractValidate.errors)}`);
      if (inputs.daysPerWeek) expect(s.days.length).toBeLessThanOrEqual(inputs.daysPerWeek);
      expect(s.activities.some((a) => a.id === 'strength')).toBe(true);
    }
  });
});

describe('choices', () => {
  it('the best routine for the equipment; bodyweight is always an option to swap to', () => {
    expect(routineOptions([]).map((r) => r.id)).toEqual(['none']);
    expect(routineOptions(['bands', 'gym']).map((r) => r.id)).toEqual(['gym', 'bands', 'none']);
    expect(exerciseStarter({ goals: ['gain_muscle'], equipment: ['weights'], limitations: [] }).routine.id).toBe('weights');
    expect(exerciseStarter({ goals: ['gain_muscle'], equipment: ['weights'], limitations: [], routineId: 'none' }).routine.id).toBe('none');
    expect(exerciseStarter({ goals: ['gain_muscle'], equipment: [], limitations: [], routineId: 'gym' }).routine.id).toBe('none'); // can't swap to unavailable kit
  });

  it('muscle gain gets three strength days; faster loss adds activity, not a different diet', () => {
    const days = (i: ExerciseInputs) => (exerciseStarter(i).activities.find((a) => a.id === 'strength')!.appliesTo as { days: string[] }).days;
    expect(days({ goals: ['gain_muscle'], activityLevel: 'mostly_sitting', equipment: [], limitations: [] })).toHaveLength(3);
    const count = (goal: StarterGoal) => exerciseStarter({ goals: [goal], activityLevel: 'some_walking', equipment: [], limitations: [] }).days.length;
    expect(count('faster_loss')).toBeGreaterThan(count('gradual_loss'));
  });

  it('cardio goals get steady cardio; others start with walking', () => {
    const ids = (i: ExerciseInputs) => exerciseStarter(i).activities.map((a) => a.id);
    expect(ids({ goals: ['improve_cardio'], equipment: [], limitations: [] })).toContain('cardio');
    expect(ids({ goals: ['gradual_loss'], activityLevel: 'mostly_sitting', equipment: [], limitations: [] })).toEqual(expect.arrayContaining(['walk', 'long-walk']));
  });

  it('a rest day stays free, with optional stretching', () => {
    const s = exerciseStarter({ goals: ['faster_loss', 'gain_muscle', 'improve_cardio'], activityLevel: 'already_training', equipment: ['gym'], limitations: [] });
    const stretch = s.activities.find((a) => a.id === 'stretch');
    expect(stretch).toMatchObject({ required: false, purpose: 'recovery' });
    expect(s.days).not.toContain((stretch!.appliesTo as { days: string[] }).days[0]);
  });
});

describe('limitations', () => {
  it.each(subsets(limitationOptions).filter((l) => l.length) as Limitation[][])('%j: avoided movements are never prescribed', (...lims) => {
    const limitations = lims.flat() as Limitation[];
    for (const equipment of [[], ['bands'], ['weights'], ['gym']] as Equipment[][]) {
      const { raw } = plan({ goals: ['gain_muscle'], equipment, limitations });
      const r = validatePlan(raw);
      if (!r.ok) throw new Error(r.errors.join('; '));
      const avoided = new Set(limitations.flatMap((l) => data.limitations[l].avoid));
      const strength = r.plan.activities.find((a) => a.id === 'strength')!;
      const session = prescribeSession(strength.session, r.plan.exercise)!;
      for (const ex of [...session.exercises, ...(session.short?.exercises ?? [])]) expect(avoided.has(ex.movement)).toBe(false);
    }
  });
});

describe('the bundled presets', () => {
  it('are generic: no personal plan names, brands or loads', () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/Fortis|VR|school run|loadKg/i);
  });

  it('resolve to real days: Monday has the strength session', () => {
    const { raw } = plan({ goals: ['gain_muscle'], equipment: [], limitations: [] });
    const r = validatePlan(raw);
    if (!r.ok) throw new Error('invalid');
    expect(resolveDay(r.plan, '2026-11-02', null).timed.concat(resolveDay(r.plan, '2026-11-02', null).anytime).map((a) => a.id)).toContain('strength');
  });
});

import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import generic from '../../../fixtures/plans/generic-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../validate';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const contractValidate = ajv.compile(contract);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe.each([
  ['seed plan', seed],
  ['generic fixture', generic],
])('%s', (_name, plan) => {
  it('validates against the committed JSON Schema contract', () => {
    expect(contractValidate(plan) ? [] : contractValidate.errors).toEqual([]);
  });
  it('passes runtime validation (schema mirror + semantic rules)', () => {
    const result = validatePlan(plan);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});

// Shape violations: both the JSON Schema and the runtime mirror must reject.
const shapeMutations: [string, (p: any) => void][] = [
  ['bad time format', (p) => (p.activities[0].time = '7:00')],
  ['unknown property', (p) => (p.activities[0].colour = 'red')],
  ['newer formatVersion', (p) => (p.formatVersion = 2)],
  ['missing weekday in schedule', (p) => delete p.schedule.sun],
  ['bad id', (p) => (p.id = 'Not A Slug')],
  ['count target too small', (p) => (p.activities[0].tracking = { type: 'count', target: 1, unitLabel: 'x' })],
  ['appliesTo with both selectors', (p) => (p.activities[0].appliesTo = { days: ['mon'], dayTypes: ['home'] })],
  ['nutrition target without min/max', (p) => delete p.nutrition.targets[0].max],
];

describe.each(shapeMutations)('rejects: %s', (_name, mutate) => {
  const plan = clone(generic);
  mutate(plan);
  it('JSON Schema rejects', () => expect(contractValidate(plan)).toBe(false));
  it('runtime validator rejects', () => expect(validatePlan(plan).ok).toBe(false));
});

// Semantic rules from contract 03 that JSON Schema cannot express.
const semanticMutations: [string, (p: any) => void, RegExp][] = [
  ['unknown day type in schedule', (p) => (p.schedule.mon = 'gym'), /schedule\.mon/],
  ['nutrition on a non-meal', (p) => (p.activities[0].nutrition = { energy: 1 }), /meals only/],
  ['unknown nutrition key', (p) => (p.activities[2].nutrition.fat = 3), /unknown nutrition target "fat"/],
  ['flexible meal with nutrition', (p) => (p.activities[2].flexible = true), /flexible meal/],
  ['duplicate activity id', (p) => p.activities.push(clone(p.activities[0])), /duplicate activity/],
  ['goal for unknown measurement', (p) => (p.goals[0].measurementId = 'height'), /unknown measurement/],
  ['min > max', (p) => (p.nutrition.targets[1].min = 999), /min > max/],
  ['appliesTo unknown day type', (p) => (p.activities[0].appliesTo = { dayTypes: ['gym'] }), /unknown day type "gym"/],
];

it.each(semanticMutations)('rejects (semantic): %s', (_name, mutate, message) => {
  const plan = clone(generic);
  mutate(plan);
  const result = validatePlan(plan);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join('\n')).toMatch(message);
});

it('applies schema defaults', () => {
  const result = validatePlan(seed);
  if (!result.ok) throw new Error('seed invalid');
  const lunch = result.plan.activities.find((a) => a.id === 'lunch')!;
  expect(lunch.required).toBe(true);
  expect(lunch.tracking).toEqual({ type: 'check' });
  expect(lunch.flexible).toBe(false);
});
